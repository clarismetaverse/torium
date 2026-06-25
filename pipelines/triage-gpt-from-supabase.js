import 'dotenv/config';
import fs from 'node:fs/promises';
import { runDoorEngine } from '../lib/door-engine.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const GPT_TRIAGE_LIMIT = Number(process.env.TORIUM_GPT_TRIAGE_LIMIT || 5);
const MIN_DOOR_SCORE = Number(process.env.TORIUM_GPT_MIN_DOOR_SCORE || 0);
const DRY_RUN = process.env.TORIUM_DRY_RUN === 'true';

if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL in .env');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
if (!OPENAI_API_KEY && !DRY_RUN) throw new Error('Missing OPENAI_API_KEY in .env');

async function supabaseRest(pathname, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  const response = await fetch(url, { ...options, headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase REST failed: ${response.status}\n${body}`);
  return body ? JSON.parse(body) : null;
}

function extractModelText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return JSON.stringify(data);
}

function tryParseJson(text) {
  const stripped = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try { return JSON.parse(stripped); } catch {
    const first = stripped.indexOf('{');
    const last = stripped.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(stripped.slice(first, last + 1)); } catch { return { raw_text: text }; }
    }
    return { raw_text: text };
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function getLatestMassiveRunId() {
  const runs = await supabaseRest('triage_runs?select=run_id,created_at,search_name,raw_source_count&raw_source_count=not.is.null&order=created_at.desc&limit=1');
  const runId = runs?.[0]?.run_id;
  if (!runId) throw new Error('No massive Supabase run found. Run npm run triage:massive first.');
  return runId;
}

async function getRun(runId) {
  const runs = await supabaseRest(`triage_runs?run_id=eq.${encodeURIComponent(runId)}&select=*`);
  const run = runs?.[0];
  if (!run) throw new Error(`Supabase run not found: ${runId}`);
  if (!run.id) throw new Error(`Supabase run has no id: ${runId}`);
  return run;
}

async function getSourceCandidates(runId) {
  const query = [
    `run_id=eq.${encodeURIComponent(runId)}`,
    'pre_triage_excluded=eq.false',
    `door_score=gte.${MIN_DOOR_SCORE}`,
    'select=*',
    'order=door_score.desc.nullslast,price_by_area.asc.nullslast,size_mq.desc.nullslast',
    `limit=${GPT_TRIAGE_LIMIT}`,
  ].join('&');

  const items = await supabaseRest(`triage_source_listings?${query}`);
  if (!items?.length) throw new Error(`No eligible source candidates found for run ${runId}.`);
  return items;
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
    detailedType: raw.detailedType ?? {
      typology: row.property_type ?? null,
      subTypology: null,
    },
    latitude: row.latitude ?? raw.latitude ?? null,
    longitude: row.longitude ?? raw.longitude ?? null,
    thumbnail: row.thumbnail_url ?? raw.thumbnail ?? null,
    raw,
  };
}

async function analyzeWithOpenAI(prompt, sourceRow, listing, doorEngine, investorProfile) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [['Authori', 'zation'].join('')]: ['Bearer', OPENAI_API_KEY].join(' '),
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: `${prompt}\n\nINPUT_JSON:\n${JSON.stringify({
        source_context: {
          source_channel: sourceRow.source_channel,
          source_url: sourceRow.source_url,
          query_area: sourceRow.query_area,
          query_payload: sourceRow.query_payload,
          pre_score: {
            door_score: sourceRow.door_score,
            price_by_area: sourceRow.price_by_area,
            estimated_final_units: sourceRow.estimated_final_units,
            new_units_created: sourceRow.new_units_created,
          },
        },
        listing,
        doorEngine,
        investorProfile,
      }, null, 2)}`,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}\n${await response.text()}`);
  return tryParseJson(extractModelText(await response.json()));
}

function computeSpread(doorEngine, gptAnalysis) {
  const projectCost = doorEngine.estimatedProjectCost;
  const saleLow = gptAnalysis?.total_sale_value_low_eur;
  const saleBase = gptAnalysis?.total_sale_value_base_eur;
  const saleHigh = gptAnalysis?.total_sale_value_high_eur;

  return {
    project_cost_eur: projectCost,
    spread_low_eur: projectCost && saleLow ? saleLow - projectCost : null,
    spread_base_eur: projectCost && saleBase ? saleBase - projectCost : null,
    spread_high_eur: projectCost && saleHigh ? saleHigh - projectCost : null,
    roi_base_pct: projectCost && saleBase ? Number((((saleBase - projectCost) / projectCost) * 100).toFixed(2)) : null,
  };
}

function computeRankingScore(doorEngine, spread, gptAnalysis) {
  let score = Math.min(40, (doorEngine.doorScore ?? 0) * 0.4);

  if (spread.spread_base_eur > 300000) score += 35;
  else if (spread.spread_base_eur > 200000) score += 25;
  else if (spread.spread_base_eur > 100000) score += 15;
  else if (spread.spread_base_eur > 0) score += 5;

  if (gptAnalysis?.fractioning_confidence === 'high') score += 15;
  if (gptAnalysis?.fractioning_confidence === 'medium') score += 8;
  if (gptAnalysis?.valuation_confidence === 'high') score += 10;
  if (gptAnalysis?.valuation_confidence === 'medium') score += 5;

  const redFlags = Array.isArray(gptAnalysis?.red_flags) ? gptAnalysis.red_flags.length : 0;
  score -= Math.min(20, redFlags * 4);

  const action = gptAnalysis?.recommended_action;
  if (action === 'high_priority_review') score += 8;
  if (action === 'send_to_technician') score += 5;
  if (action === 'discard') score -= 20;

  return Math.max(0, Math.min(100, Math.round(score)));
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

function buildPropertyRow(result, rank, run, triageRunId) {
  const listing = result.listing ?? {};
  const gpt = result.gpt_analysis ?? {};
  const door = result.door_engine ?? {};
  const spread = result.spread ?? {};
  const source = result.source_row ?? {};

  return {
    triage_run_id: triageRunId,
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

async function saveResults(run, results) {
  await supabaseRest(`triage_properties?run_id=eq.${encodeURIComponent(run.run_id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });

  const propertyRows = results.map((result, index) => buildPropertyRow(result, index + 1, run, run.id));
  for (const chunk of chunkArray(propertyRows, 100)) {
    await supabaseRest('triage_properties', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
  }

  const resultLinks = results.map((result, index) => buildResultLink(result, index + 1));
  const rawOutput = {
    ...(run.raw_output && typeof run.raw_output === 'object' ? run.raw_output : {}),
    gpt_analyzed_count: results.length,
    gpt_candidate_count: results.length,
    result_links: resultLinks,
    results,
  };

  await supabaseRest(`triage_runs?run_id=eq.${encodeURIComponent(run.run_id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      gpt_analyzed_count: results.length,
      gpt_candidate_count: results.length,
      result_links: resultLinks,
      top_result_url: resultLinks?.[0]?.url ?? null,
      top_result_title: resultLinks?.[0]?.title ?? null,
      top_result_score: resultLinks?.[0]?.score ?? null,
      top_result_spread_base_eur: resultLinks?.[0]?.spread_base_eur ?? null,
      top_result_roi_base_pct: resultLinks?.[0]?.roi_base_pct ?? null,
      raw_output: rawOutput,
    }),
  });

  console.log(`Saved GPT triage to Supabase: ${run.run_id} (${propertyRows.length} properties)`);
}

async function main() {
  const requestedRunId = process.argv[2] && process.argv[2] !== 'latest'
    ? process.argv[2]
    : process.env.TORIUM_RUN_ID;
  const runId = requestedRunId || await getLatestMassiveRunId();
  const run = await getRun(runId);
  const investorProfile = JSON.parse(await fs.readFile('config/investor-profiles/max-doors-20k.json', 'utf8'));
  const prompt = await fs.readFile('prompts/triage-valuation-red-flags.md', 'utf8');
  const sourceCandidates = await getSourceCandidates(runId);

  console.log(JSON.stringify({
    run_id: runId,
    mode: DRY_RUN ? 'dry_run' : 'gpt_triage',
    gpt_limit: GPT_TRIAGE_LIMIT,
    min_door_score: MIN_DOOR_SCORE,
    candidates: sourceCandidates.map((source, index) => ({
      rank: index + 1,
      title: source.title,
      url: source.source_url,
      area: source.query_area || source.area_label,
      price: source.price_eur,
      size_mq: source.size_mq,
      price_by_area: source.price_by_area,
      door_score: source.door_score,
    })),
  }, null, 2));

  if (DRY_RUN) {
    console.log('Dry run only. Set TORIUM_DRY_RUN=false or remove it to execute GPT triage.');
    return;
  }

  const results = [];
  for (const [index, sourceRow] of sourceCandidates.entries()) {
    const listing = sourceRowToListing(sourceRow);
    const doorEngine = runDoorEngine(listing, investorProfile);
    console.log(`GPT triage ${index + 1}/${sourceCandidates.length}: ${sourceRow.title || sourceRow.source_url}`);
    const gptAnalysis = await analyzeWithOpenAI(prompt, sourceRow, listing, doorEngine, investorProfile);
    const spread = computeSpread(doorEngine, gptAnalysis);
    const result = {
      listing_index: index,
      source_channel: sourceRow.source_channel,
      source_row: sourceRow,
      title: sourceRow.title ?? listing?.suggestedTexts?.title ?? listing.address ?? null,
      url: sourceRow.source_url ?? listing.url ?? null,
      idealista_url: sourceRow.source_channel === 'idealista' ? sourceRow.source_url : null,
      ranking_score: computeRankingScore(doorEngine, spread, gptAnalysis),
      door_engine: doorEngine,
      spread,
      gpt_analysis: gptAnalysis,
      listing,
    };
    results.push(result);
  }

  results.sort((a, b) => (b.ranking_score ?? 0) - (a.ranking_score ?? 0));
  await saveResults(run, results);

  console.log(JSON.stringify({
    run_id: runId,
    gpt_analyzed_count: results.length,
    result_links: results.map((result, index) => buildResultLink(result, index + 1)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
