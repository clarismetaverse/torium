import fs from 'node:fs/promises';
import { buildDeterministicValuation } from './deterministic-valuation.js';
import { runDoorEngine } from './door-engine.js';
import { calculateUnderwriting } from './financial-underwriting.js';
import { resolveSearchStrategy } from './search-strategies.js';

const DEFAULT_CLI_MODEL = 'gpt-5.2';
const DEFAULT_GATEWAY_MODEL = 'openai/gpt-5.4';

const VALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'final_unit_plan',
    'total_sale_value_low_eur',
    'total_sale_value_base_eur',
    'total_sale_value_high_eur',
    'fractioning_confidence',
    'valuation_confidence',
    'positive_signals',
    'red_flags',
    'missing_information',
    'human_due_diligence_questions',
    'recommended_action',
  ],
  properties: {
    final_unit_plan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['unit_type', 'estimated_size_mq', 'sale_value_low_eur', 'sale_value_base_eur', 'sale_value_high_eur', 'valuation_reasoning'],
        properties: {
          unit_type: { type: 'string', enum: ['monolocale', 'bilocale', 'trilocale', 'unknown'] },
          estimated_size_mq: { type: 'number' },
          sale_value_low_eur: { type: 'number' },
          sale_value_base_eur: { type: 'number' },
          sale_value_high_eur: { type: 'number' },
          valuation_reasoning: { type: 'string' },
        },
      },
    },
    total_sale_value_low_eur: { type: 'number' },
    total_sale_value_base_eur: { type: 'number' },
    total_sale_value_high_eur: { type: 'number' },
    fractioning_confidence: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] },
    valuation_confidence: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] },
    positive_signals: { type: 'array', items: { type: 'string' } },
    red_flags: { type: 'array', items: { type: 'string' } },
    missing_information: { type: 'array', items: { type: 'string' } },
    human_due_diligence_questions: { type: 'array', items: { type: 'string' } },
    recommended_action: { type: 'string', enum: ['discard', 'monitor', 'request_details', 'send_to_technician', 'high_priority_review'] },
  },
};

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createSupabaseClient(env, fetchImpl = fetch) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  return async function supabaseRest(pathname, options = {}) {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/${pathname}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Supabase REST failed: ${response.status}\n${body}`);
    return body ? JSON.parse(body) : null;
  };
}

export function resolveValuationProvider(env = process.env) {
  if (env.OPENAI_API_KEY) {
    return {
      endpoint: 'https://api.openai.com/v1/responses',
      token: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || DEFAULT_CLI_MODEL,
      provider: 'openai_direct',
    };
  }

  const gatewayToken = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
  if (gatewayToken) {
    return {
      endpoint: 'https://ai-gateway.vercel.sh/v1/responses',
      token: gatewayToken,
      model: env.TORIUM_VALUATION_MODEL || DEFAULT_GATEWAY_MODEL,
      provider: env.AI_GATEWAY_API_KEY ? 'vercel_ai_gateway_key' : 'vercel_ai_gateway_oidc',
    };
  }

  throw new Error('Missing AI credentials: set OPENAI_API_KEY, AI_GATEWAY_API_KEY, or use Vercel OIDC');
}

function extractModelText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  throw new Error('Valuation model returned no output text');
}

function parseModelJson(text) {
  const stripped = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error('Valuation model returned invalid JSON');
  }
}

export function validateValuation(value) {
  const low = Number(value?.total_sale_value_low_eur);
  const base = Number(value?.total_sale_value_base_eur);
  const high = Number(value?.total_sale_value_high_eur);
  if (![low, base, high].every((item) => Number.isFinite(item) && item > 0)) {
    throw new Error('Valuation response is missing positive low/base/high exit values');
  }
  if (!(low <= base && base <= high)) {
    throw new Error('Valuation exit values must satisfy low <= base <= high');
  }
  if (!Array.isArray(value.final_unit_plan)) throw new Error('Valuation response is missing final_unit_plan');
  return value;
}

export function sourceCandidateOrder(strategy) {
  return strategy.id === 'neutral_fractionability'
    ? 'door_score.desc.nullslast'
    : 'door_score.desc.nullslast,price_by_area.asc.nullslast,size_mq.desc.nullslast';
}

export function scoreValuedResult(strategy, doorEngine, spread, gptAnalysis) {
  if (strategy.id === 'neutral_fractionability') return doorEngine.doorScore ?? 0;

  let score = Math.min(40, (doorEngine.doorScore ?? 0) * 0.4);
  if (spread.spread_base_eur > 300000) score += 35;
  else if (spread.spread_base_eur > 200000) score += 25;
  else if (spread.spread_base_eur > 100000) score += 15;
  else if (spread.spread_base_eur > 0) score += 5;
  if (gptAnalysis?.fractioning_confidence === 'high') score += 15;
  if (gptAnalysis?.fractioning_confidence === 'medium') score += 8;
  if (gptAnalysis?.valuation_confidence === 'high') score += 10;
  if (gptAnalysis?.valuation_confidence === 'medium') score += 5;
  score -= Math.min(20, (Array.isArray(gptAnalysis?.red_flags) ? gptAnalysis.red_flags.length : 0) * 4);
  if (gptAnalysis?.recommended_action === 'high_priority_review') score += 8;
  if (gptAnalysis?.recommended_action === 'send_to_technician') score += 5;
  if (gptAnalysis?.recommended_action === 'discard') score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function sortValuedResults(results, strategy) {
  return [...results].sort((left, right) => {
    const scoreDifference = (right.ranking_score ?? 0) - (left.ranking_score ?? 0);
    if (scoreDifference !== 0) return scoreDifference;
    if (strategy.id === 'legacy_low_price_m2') {
      const leftPrice = left.listing?.priceByArea ?? Number.POSITIVE_INFINITY;
      const rightPrice = right.listing?.priceByArea ?? Number.POSITIVE_INFINITY;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    }
    return (left.listing_index ?? 0) - (right.listing_index ?? 0);
  });
}

function sourceRowToListing(row) {
  const raw = row.raw_listing && typeof row.raw_listing === 'object' ? row.raw_listing : {};
  return {
    ...raw,
    propertyCode: row.source_listing_id ?? raw.propertyCode ?? raw.id ?? null,
    url: row.source_url ?? raw.url ?? null,
    source_channel: row.source_channel,
    source_platform_name: row.source_platform_name,
    source_key: row.source_key,
    suggestedTexts: { title: row.title ?? raw?.suggestedTexts?.title ?? raw.title ?? null },
    title: row.title ?? raw.title ?? null,
    address: row.address ?? raw.address ?? null,
    municipality: row.city ?? raw.municipality ?? raw.city ?? null,
    city: row.city ?? raw.city ?? raw.municipality ?? null,
    district: row.district ?? raw.district ?? null,
    neighborhood: row.neighborhood ?? raw.neighborhood ?? null,
    area_label: row.area_label ?? row.query_area ?? null,
    price: row.price_eur ?? raw.price ?? null,
    priceByArea: row.price_by_area ?? raw.priceByArea ?? null,
    size: row.size_mq ?? raw.size ?? null,
    rooms: row.rooms ?? raw.rooms ?? null,
    bathrooms: row.bathrooms ?? raw.bathrooms ?? null,
    floor: row.floor ?? raw.floor ?? null,
    hasLift: row.has_lift ?? raw.hasLift ?? null,
    hasPlan: row.has_plan ?? raw.hasPlan ?? null,
    status: row.property_condition ?? raw.status ?? raw.condition ?? null,
    propertyType: row.property_type ?? raw.propertyType ?? null,
    detailedType: raw.detailedType ?? { typology: row.property_type ?? null, subTypology: null },
    latitude: row.latitude ?? raw.latitude ?? null,
    longitude: row.longitude ?? raw.longitude ?? null,
    thumbnail: row.thumbnail_url ?? raw.thumbnail ?? null,
    raw,
  };
}

async function analyzeListing({ provider, prompt, sourceRow, listing, doorEngine, investorProfile, fetchImpl }) {
  const response = await fetchImpl(provider.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.token}` },
    body: JSON.stringify({
      model: provider.model,
      input: `${prompt}\n\nINPUT_JSON:\n${JSON.stringify({
        source_context: {
          source_channel: sourceRow.source_channel,
          source_url: sourceRow.source_url,
          query_area: sourceRow.query_area,
          pre_score: {
            door_score: sourceRow.door_score,
            estimated_final_units: sourceRow.estimated_final_units,
            new_units_created: sourceRow.new_units_created,
          },
        },
        listing,
        doorEngine,
        investorProfile,
      }, null, 2)}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'torium_property_valuation',
          strict: true,
          schema: VALUATION_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Valuation request failed: ${response.status}\n${await response.text()}`);
  return validateValuation(parseModelJson(extractModelText(await response.json())));
}

function spreadFromUnderwriting(underwriting) {
  return {
    project_cost_eur: underwriting.costs.projectCostEur,
    selling_cost_low_eur: underwriting.scenarios.low.sellingCostEur,
    selling_cost_base_eur: underwriting.scenarios.base.sellingCostEur,
    selling_cost_high_eur: underwriting.scenarios.high.sellingCostEur,
    total_cost_low_eur: underwriting.scenarios.low.totalCostEur,
    total_cost_base_eur: underwriting.scenarios.base.totalCostEur,
    total_cost_high_eur: underwriting.scenarios.high.totalCostEur,
    spread_low_eur: underwriting.scenarios.low.profitLossEur,
    spread_base_eur: underwriting.scenarios.base.profitLossEur,
    spread_high_eur: underwriting.scenarios.high.profitLossEur,
    roi_low_pct: underwriting.scenarios.low.roiPct,
    roi_base_pct: underwriting.scenarios.base.roiPct,
    roi_high_pct: underwriting.scenarios.high.roiPct,
  };
}

function buildResultLink(result, rank) {
  return {
    rank,
    score: result.ranking_score,
    title: result.title,
    url: result.url,
    price: result.listing?.price ?? null,
    price_by_area: result.listing?.priceByArea ?? null,
    size_mq: result.listing?.size ?? null,
    source_channel: result.source_channel,
    area: result.source_row?.query_area ?? result.listing?.area_label ?? null,
    spread_base_eur: result.spread?.spread_base_eur ?? null,
    roi_base_pct: result.spread?.roi_base_pct ?? null,
    action: result.gpt_analysis?.recommended_action ?? null,
  };
}

function buildPropertyRow(result, rank, run) {
  const listing = result.listing ?? {};
  const gpt = result.gpt_analysis ?? {};
  const door = result.door_engine ?? {};
  const spread = result.spread ?? {};
  const source = result.source_row ?? {};
  return {
    triage_run_id: run.id,
    run_id: run.run_id,
    listing_index: result.listing_index ?? null,
    rank,
    ranking_score: result.ranking_score ?? null,
    source_channel: source.source_channel ?? listing.source_channel ?? result.source_channel ?? 'other',
    source_url: result.url ?? listing.url ?? source.source_url ?? null,
    source_listing_id: source.source_listing_id ?? listing.propertyCode ?? null,
    source_platform_name: source.source_platform_name ?? listing.source_platform_name ?? result.source_channel ?? 'other',
    source_confidence: source.source_confidence ?? 'single_source',
    title: result.title ?? listing?.suggestedTexts?.title ?? listing.address ?? null,
    address: listing.address ?? null,
    city: listing.municipality ?? listing.city ?? run.city ?? null,
    district: listing.district ?? null,
    neighborhood: listing.neighborhood ?? null,
    price_eur: listing.price ?? null,
    price_by_area: listing.priceByArea ?? null,
    size_mq: listing.size ?? null,
    rooms: listing.rooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    floor: listing.floor ?? null,
    has_lift: listing.hasLift ?? null,
    has_plan: listing.hasPlan ?? null,
    status: listing.status ?? null,
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,
    thumbnail_url: listing.thumbnail ?? null,
    recommended_action: gpt.recommended_action ?? null,
    fractioning_confidence: gpt.fractioning_confidence ?? null,
    valuation_confidence: gpt.valuation_confidence ?? null,
    estimated_final_units: door.estimatedFinalUnits ?? source.estimated_final_units ?? null,
    new_units_created: door.newUnitsCreated ?? source.new_units_created ?? null,
    door_score: door.doorScore ?? source.door_score ?? null,
    estimated_project_cost_eur: door.estimatedProjectCost ?? source.estimated_project_cost_eur ?? null,
    spread_base_eur: spread.spread_base_eur ?? null,
    roi_base_pct: spread.roi_base_pct ?? null,
    total_sale_value_low_eur: gpt.total_sale_value_low_eur ?? null,
    total_sale_value_base_eur: gpt.total_sale_value_base_eur ?? null,
    total_sale_value_high_eur: gpt.total_sale_value_high_eur ?? null,
    positive_signals: gpt.positive_signals ?? [],
    red_flags: gpt.red_flags ?? [],
    missing_information: gpt.missing_information ?? [],
    human_due_diligence_questions: gpt.human_due_diligence_questions ?? [],
    final_unit_plan: gpt.final_unit_plan ?? [],
    door_engine: door,
    gpt_analysis: gpt,
    raw_listing: listing.raw ?? listing,
    raw_result: result,
  };
}

async function saveResults(supabaseRest, run, results, provider, valuationMode) {
  await supabaseRest(`triage_properties?run_id=eq.${encodeURIComponent(run.run_id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  const rows = results.map((result, index) => buildPropertyRow(result, index + 1, run));
  for (let offset = 0; offset < rows.length; offset += 50) {
    await supabaseRest('triage_properties', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows.slice(offset, offset + 50)),
    });
  }

  const links = results.map((result, index) => buildResultLink(result, index + 1));
  const gptAnalyzedCount = valuationMode === 'ai' ? results.length : Number(run.gpt_analyzed_count || 0);
  const gptCandidateCount = valuationMode === 'ai' ? results.length : Number(run.gpt_candidate_count || 0);
  const valuedCount = results.filter((result) => result.underwriting?.status === 'complete').length;
  const rawOutput = {
    ...(run.raw_output && typeof run.raw_output === 'object' ? run.raw_output : {}),
    search_strategy: run.search_strategy,
    scoring_mode: run.scoring_mode,
    gpt_analyzed_count: gptAnalyzedCount,
    gpt_candidate_count: gptCandidateCount,
    valued_count: valuedCount,
    valuation_mode: valuationMode,
    valuation_provider: provider.provider,
    valuation_model: provider.model,
    result_links: links,
    results,
  };
  await supabaseRest(`triage_runs?run_id=eq.${encodeURIComponent(run.run_id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      gpt_analyzed_count: gptAnalyzedCount,
      gpt_candidate_count: gptCandidateCount,
      result_links: links,
      top_result_url: links[0]?.url ?? null,
      top_result_title: links[0]?.title ?? null,
      top_result_score: links[0]?.score ?? null,
      top_result_spread_base_eur: links[0]?.spread_base_eur ?? null,
      top_result_roi_base_pct: links[0]?.roi_base_pct ?? null,
      raw_output: rawOutput,
    }),
  });
  return { links, valuedCount };
}

export async function runValuationFromSupabase(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const log = options.log || console.log;
  const valuationMode = String(options.valuationMode || env.TORIUM_VALUATION_MODE || 'deterministic').toLowerCase();
  if (!['deterministic', 'ai'].includes(valuationMode)) {
    throw new Error(`Unsupported valuation mode: ${valuationMode}`);
  }
  const maxLimit = valuationMode === 'deterministic' ? 600 : 20;
  const limit = Math.max(1, Math.min(maxLimit, numberOption(options.limit ?? env.TORIUM_GPT_TRIAGE_LIMIT, 5)));
  const minDoorScore = numberOption(options.minDoorScore ?? env.TORIUM_GPT_MIN_DOOR_SCORE, 0);
  const dryRun = options.dryRun ?? env.TORIUM_DRY_RUN === 'true';
  const supabaseRest = createSupabaseClient(env, fetchImpl);

  let runId = options.runId;
  if (!runId || runId === 'latest') {
    const runs = await supabaseRest('triage_runs?select=run_id&raw_source_count=not.is.null&order=created_at.desc&limit=1');
    runId = runs?.[0]?.run_id;
  }
  if (!runId) throw new Error('No massive Supabase run found');

  const runs = await supabaseRest(`triage_runs?run_id=eq.${encodeURIComponent(runId)}&select=*`);
  const run = runs?.[0];
  if (!run?.id) throw new Error(`Supabase run not found or invalid: ${runId}`);
  const strategy = resolveSearchStrategy(run.search_strategy || run.raw_output?.search_strategy || 'legacy_low_price_m2');
  const query = [
    `run_id=eq.${encodeURIComponent(runId)}`,
    'pre_triage_excluded=eq.false',
    `door_score=gte.${minDoorScore}`,
    'select=*',
    `order=${sourceCandidateOrder(strategy)}`,
    `limit=${limit}`,
  ].join('&');
  const candidates = await supabaseRest(`triage_source_listings?${query}`);
  if (!candidates?.length) throw new Error(`No eligible source candidates found for run ${runId}`);

  const preview = {
    run_id: runId,
    search_strategy: strategy.id,
    scoring_mode: strategy.scoringMode,
    mode: dryRun ? 'dry_run' : 'valuation',
    valuation_mode: valuationMode,
    candidate_order: sourceCandidateOrder(strategy),
    candidate_count: candidates.length,
  };
  log(JSON.stringify(preview));
  if (dryRun) return preview;

  const investorProfile = JSON.parse(await fs.readFile(new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url), 'utf8'));
  const prompt = valuationMode === 'ai'
    ? await fs.readFile(new URL('../prompts/triage-valuation-red-flags.md', import.meta.url), 'utf8')
    : null;
  const deterministicProfile = valuationMode === 'deterministic'
    ? JSON.parse(await fs.readFile(new URL('../config/valuation-profiles/milan-microzones-v1.json', import.meta.url), 'utf8'))
    : null;
  const provider = valuationMode === 'ai'
    ? resolveValuationProvider(env)
    : { provider: 'deterministic_market_profile', model: deterministicProfile.version };
  const results = [];

  for (const [index, sourceRow] of candidates.entries()) {
    const listing = sourceRowToListing(sourceRow);
    const doorEngine = runDoorEngine(listing, investorProfile, {
      includeEconomicSignals: strategy.includeEconomicDoorSignals,
      scoringMode: strategy.scoringMode,
    });
    log(`Valuation ${index + 1}/${candidates.length}: ${sourceRow.title || sourceRow.source_url}`);
    const gptAnalysis = valuationMode === 'ai'
      ? await analyzeListing({ provider, prompt, sourceRow, listing, doorEngine, investorProfile, fetchImpl })
      : buildDeterministicValuation({ profileSet: deterministicProfile, sourceRow, listing, doorEngine });
    const underwriting = calculateUnderwriting({
      purchasePriceEur: listing.price,
      purchaseCostRate: doorEngine.purchaseCostRate,
      purchaseCostsEur: doorEngine.purchaseCosts,
      newUnitsCreated: doorEngine.newUnitsCreated,
      costPerNewUnitEur: doorEngine.costPerNewUnit,
      transformationCostEur: doorEngine.transformationCost,
      projectCostEur: doorEngine.estimatedProjectCost,
      finalUnitPlan: gptAnalysis.final_unit_plan,
      exitValues: {
        low: gptAnalysis.total_sale_value_low_eur,
        base: gptAnalysis.total_sale_value_base_eur,
        high: gptAnalysis.total_sale_value_high_eur,
      },
    });
    const spread = spreadFromUnderwriting(underwriting);
    results.push({
      listing_index: index,
      source_channel: sourceRow.source_channel,
      source_row: sourceRow,
      title: sourceRow.title ?? listing?.suggestedTexts?.title ?? listing.address ?? null,
      url: sourceRow.source_url ?? listing.url ?? null,
      idealista_url: sourceRow.source_channel === 'idealista' ? sourceRow.source_url : null,
      ranking_score: scoreValuedResult(strategy, doorEngine, spread, gptAnalysis),
      door_engine: doorEngine,
      underwriting,
      spread,
      gpt_analysis: gptAnalysis,
      listing,
    });
  }

  const sorted = sortValuedResults(results, strategy);
  const { links: resultLinks, valuedCount } = await saveResults(supabaseRest, run, sorted, provider, valuationMode);
  return {
    ok: true,
    run_id: runId,
    search_strategy: strategy.id,
    scoring_mode: strategy.scoringMode,
    valuation_provider: provider.provider,
    valuation_model: provider.model,
    valuation_mode: valuationMode,
    valued_count: valuedCount,
    gpt_analyzed_count: valuationMode === 'ai' ? sorted.length : Number(run.gpt_analyzed_count || 0),
    result_links: resultLinks,
  };
}
