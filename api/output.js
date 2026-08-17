import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import {
  DEFAULT_UNDERWRITING_ASSUMPTIONS,
  summarizeRoi,
  underwritingFromResult,
} from '../lib/financial-underwriting.js';
import { combineRunOutputs, rescoreCombinedResults } from '../lib/combine-run-outputs.js';
import { runDoorEngine } from '../lib/door-engine.js';
import { evaluateDataQuality } from '../lib/data-quality-gate.js';

const rootDir = process.cwd();
const allowedPrefixes = ['triage-outputs/', 'outputs/triage/'];
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_LISTINGS_LIMIT = Number(process.env.TORIUM_VIEWER_SOURCE_LIMIT || 1000);
const investorProfilePromise = readFile(new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url), 'utf8').then(JSON.parse);

function normalizeId(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

function isAllowedId(id) {
  if (!id.endsWith('.json')) return false;
  if (id.includes('..')) return false;
  return allowedPrefixes.some((prefix) => id.startsWith(prefix));
}

async function supabaseGet(pathname) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env vars');
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    },
  });
  if (!response.ok) throw new Error(`Supabase output failed: ${response.status}\n${await response.text()}`);
  return response.json();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim() || null;
}

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !String(item).toLowerCase().includes('idealista'));
}

// --- Public payload defense-in-depth sanitizer -----------------------------
// Keys whose string values are real image assets and must be preserved so the
// public gallery/floor plans keep working (their host may be a source CDN).
const PUBLIC_IMAGE_KEYS = new Set(['url', 'thumbnail', 'thumbnail_url', 'src', 'image']);
const PUBLIC_EXTERNAL_LINK_KEYS = new Set(['source_url', 'sourceurl', 'idealista_url']);
// Source/listing identifier keys that must never reach the public viewer.
const PUBLIC_DENY_KEYS = new Set([
  'source_platform_name', 'source_channel', 'source_key', 'canonical_source_key', 'source_fingerprint',
  'source_listing_id', 'externalreference', 'propertycode', 'agency', 'agencylogo',
  'contactinfo', 'micrositeshortname',
]);
// Brand token to strip anywhere it appears (only unambiguous platform brands;
// deliberately NOT "immobiliare", which is also the Italian word for real estate).
const PLATFORM_TOKEN = 'idealista';

function sanitizePublicDeep(node, key) {
  if (node === null || node === undefined) return node;
  if (typeof node === 'string') {
    const k = String(key).toLowerCase();
    if (PUBLIC_DENY_KEYS.has(k)) return null;
    if (PUBLIC_IMAGE_KEYS.has(k)) return node;
    if (PUBLIC_EXTERNAL_LINK_KEYS.has(k)) return safeIdealistaUrl(node);
    return node.toLowerCase().includes(PLATFORM_TOKEN) ? null : node;
  }
  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) {
      if (typeof item === 'string') {
        if (!item.toLowerCase().includes(PLATFORM_TOKEN)) out.push(item);
        continue;
      }
      out.push(sanitizePublicDeep(item, key));
    }
    return out;
  }
  if (typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = sanitizePublicDeep(node[k], k);
    return out;
  }
  return node;
}

export function safeIdealistaUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    return hostname === 'idealista.it' || hostname.endsWith('.idealista.it') ? url.href : null;
  } catch {
    return null;
  }
}

export function publicAddress(result) {
  return cleanText(
    result?.address ||
    result?.listing?.address ||
    result?.source_row?.address ||
    result?.source_row?.raw_listing?.address ||
    null
  );
}

export function publicIdealistaUrl(result) {
  const candidates = [
    result?.idealista_url,
    result?.source_url,
    result?.url,
    result?.listing?.idealista_url,
    result?.listing?.source_url,
    result?.listing?.url,
    result?.source_row?.source_url,
    result?.source_row?.raw_listing?.url,
  ];
  for (const candidate of candidates) {
    const safeUrl = safeIdealistaUrl(candidate);
    if (safeUrl) return safeUrl;
  }
  return null;
}

function publicTitle(result) {
  const listing = result?.listing || result || {};
  const rawTitle = result?.title || listing?.suggestedTexts?.title || listing?.title || '';
  const typology = String(rawTitle).split(' in ')[0] || listing.propertyType || result?.property_type || 'Immobile';
  const area = listing.listing_area || listing.area_label || listing.neighborhood || listing.district || result?.listing_area || result?.area_label || result?.neighborhood || result?.district || result?.query_area || 'Milano';
  const size = listing.size || result?.size_mq || result?.size;
  return [typology, area, size ? `${size} mq` : null].filter(Boolean).join(' · ');
}

function imageBuckets(result) {
  return [
    result?.photos,
    result?.floor_plans,
    result?.listing?.photos,
    result?.listing?.floor_plans,
    result?.listing?.multimedia?.images,
    result?.source_row?.photos,
    result?.source_row?.floor_plans,
    result?.source_row?.raw_listing?.photos,
    result?.source_row?.raw_listing?.floor_plans,
    result?.source_row?.raw_listing?.multimedia?.images,
  ].filter(Array.isArray);
}

function extractPhotos(result) {
  const seen = new Set();
  const photos = [];
  const push = (item) => {
    const url = typeof item === 'string' ? item : item?.url || item?.thumbnail;
    if (!url || seen.has(url)) return;
    seen.add(url);
    const tag = item?.tag && !String(item.tag).toLowerCase().includes('idealista') ? item.tag : null;
    photos.push({ url, tag });
  };
  push(result?.thumbnail_url);
  push(result?.listing?.thumbnail);
  push(result?.listing?.thumbnail_url);
  push(result?.source_row?.thumbnail_url);
  for (const images of imageBuckets(result)) images.forEach(push);
  return photos.slice(0, 32);
}

function extractFloorPlans(result) {
  const seen = new Set();
  const plans = [];
  const push = (item) => {
    const url = typeof item === 'string' ? item : item?.url || item?.thumbnail;
    const tag = String(item?.tag || '').toLowerCase();
    if (!url || seen.has(url)) return;
    if (tag && !['plan', 'floorplan', 'floor_plan', 'layout', 'plano'].includes(tag)) return;
    if (!tag && !String(url).toLowerCase().includes('plan')) return;
    seen.add(url);
    plans.push({ url, tag: item?.tag || 'plan' });
  };
  for (const images of imageBuckets(result)) images.forEach(push);
  return plans.slice(0, 8);
}

function extractDescription(result) {
  return cleanText(
    result?.description ||
    result?.listing?.description ||
    result?.source_row?.description ||
    result?.source_row?.raw_listing?.description ||
    result?.source_row?.raw_listing?.notes ||
    null
  );
}

function redactAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  return {
    ...analysis,
    positive_signals: cleanItems(analysis.positive_signals),
    red_flags: cleanItems(analysis.red_flags),
    missing_information: cleanItems(analysis.missing_information),
    human_due_diligence_questions: cleanItems(analysis.human_due_diligence_questions),
  };
}

function redactListing(listing, redactedTitle, photos, floorPlans, description, address, idealistaUrl) {
  if (!listing || typeof listing !== 'object') return listing;
  return {
    ...listing,
    title: redactedTitle,
    address,
    url: idealistaUrl,
    propertyCode: null,
    source_url: idealistaUrl,
    sourceUrl: idealistaUrl,
    idealista_url: idealistaUrl,
    contactInfo: null,
    agency: null,
    description,
    photos,
    floor_plans: floorPlans,
    multimedia: { images: photos, floor_plans: floorPlans },
    suggestedTexts: { ...(listing.suggestedTexts || {}), title: redactedTitle },
  };
}

function redactSourceRow(sourceRow, redactedTitle, photos, floorPlans, description, address, idealistaUrl) {
  if (!sourceRow || typeof sourceRow !== 'object') return sourceRow;
  return {
    ...sourceRow,
    title: redactedTitle,
    address,
    source_channel: null,
    source_url: idealistaUrl,
    source_listing_id: null,
    canonical_source_key: null,
    source_fingerprint: null,
    source_key: null,
    quality_flags: cleanItems(sourceRow.quality_flags),
    risk_features: cleanItems(sourceRow.risk_features),
    description,
    photos,
    floor_plans: floorPlans,
    raw_listing: sourceRow.raw_listing ? {
      ...sourceRow.raw_listing,
      title: redactedTitle,
      address,
      url: idealistaUrl,
      propertyCode: null,
      externalReference: null,
      contactInfo: null,
      agency: null,
      description,
      photos,
      floor_plans: floorPlans,
      multimedia: { images: photos, floor_plans: floorPlans },
    } : sourceRow.raw_listing,
  };
}

function redactResult(result) {
  if (!result || typeof result !== 'object') return result;
  const redactedTitle = publicTitle(result);
  const photos = extractPhotos(result);
  const floorPlans = extractFloorPlans(result);
  const description = extractDescription(result);
  const address = publicAddress(result);
  const idealistaUrl = publicIdealistaUrl(result);
  return {
    ...result,
    underwriting: underwritingFromResult(result),
    data_quality: evaluateDataQuality(result),
    title: redactedTitle,
    address,
    url: idealistaUrl,
    idealista_url: idealistaUrl,
    source_url: idealistaUrl,
    source_channel: null,
    source_listing_id: null,
    propertyCode: null,
    contactInfo: null,
    agency: null,
    description,
    photos,
    floor_plans: floorPlans,
    share_url: `/?property=${encodeURIComponent(result.listing_index ?? result.id ?? redactedTitle)}`,
    gpt_analysis: redactAnalysis(result.gpt_analysis),
    listing: redactListing(result.listing, redactedTitle, photos, floorPlans, description, address, idealistaUrl),
    source_row: redactSourceRow(result.source_row, redactedTitle, photos, floorPlans, description, address, idealistaUrl),
  };
}

function redactOutput(output) {
  if (!output || typeof output !== 'object') return output;
  // filtered_out holds raw scraped listings (URLs, addresses, source tags) that the
  // public viewer never renders; it only uses filtered_out_count. Drop the raw array.
  const { filtered_out, ...rest } = output;
  const redacted = {
    ...rest,
    result_links: Array.isArray(output.result_links) ? output.result_links.map(redactResult) : output.result_links,
    results: Array.isArray(output.results) ? output.results.map(redactResult) : output.results,
  };
  const publicResults = Array.isArray(redacted.results) ? redacted.results : [];
  const qualityPassedResults = publicResults.filter((result) => result.data_quality?.valid !== false);
  redacted.data_quality_statistics = {
    version: 'data_quality_gate_v1',
    checked_count: publicResults.length,
    passed_count: qualityPassedResults.length,
    review_count: publicResults.length - qualityPassedResults.length,
  };
  // Failed records remain available for audit, but cannot distort run-level ROI.
  redacted.roi_statistics = summarizeRoi(qualityPassedResults.map((result) => result.underwriting));
  // Final safety net across the entire public payload (covers Supabase-shaped
  // rows whose identifier fields differ from the file-based schema).
  return sanitizePublicDeep(redacted, 'root');
}

function sourceListingToResult(source, index) {
  const listing = source.raw_listing && typeof source.raw_listing === 'object' ? source.raw_listing : {};
  const realArea = source.district || source.neighborhood || source.area_label || listing.district || listing.neighborhood || listing.area_label || null;
  const estimatedFinalUnits = source.estimated_final_units == null ? null : Number(source.estimated_final_units);
  const transformationCost = Number.isFinite(estimatedFinalUnits)
    ? estimatedFinalUnits * DEFAULT_UNDERWRITING_ASSUMPTIONS.costPerFinalUnitEur
    : null;
  const purchasePrice = source.price_eur == null ? null : Number(source.price_eur);
  const purchaseCosts = Number.isFinite(purchasePrice)
    ? Math.round(purchasePrice * DEFAULT_UNDERWRITING_ASSUMPTIONS.purchaseCostRate)
    : null;
  const estimatedProjectCost = !Number.isFinite(purchasePrice) || purchaseCosts === null || transformationCost === null
    ? null
    : purchasePrice + purchaseCosts + transformationCost;
  const result = {
    listing_index: index,
    title: source.title,
    url: source.source_url,
    idealista_url: source.source_channel === 'idealista' ? source.source_url : null,
    query_area: source.query_area,
    listing_area: realArea,
    ranking_score: source.door_score,
    source_row: source,
    door_engine: {
      doorScore: source.door_score,
      estimatedFinalUnits,
      newUnitsCreated: source.new_units_created,
      costPerFinalUnit: DEFAULT_UNDERWRITING_ASSUMPTIONS.costPerFinalUnitEur,
      costPerTrilocale: DEFAULT_UNDERWRITING_ASSUMPTIONS.costPerTrilocaleEur,
      transformationCost,
      purchaseCostRate: DEFAULT_UNDERWRITING_ASSUMPTIONS.purchaseCostRate,
      purchaseCosts,
      estimatedProjectCost,
    },
    spread: {},
    gpt_analysis: {
      recommended_action: source.pre_triage_excluded ? 'filtered_out' : 'pre_score_candidate',
      fractioning_confidence: null,
      valuation_confidence: null,
      positive_signals: [
        source.source_channel ? `source:${source.source_channel}` : null,
        source.query_area ? `query_area:${source.query_area}` : null,
        realArea ? `listing_area:${realArea}` : null,
        source.price_by_area ? `price_m2:${source.price_by_area}` : null,
        source.property_condition ? `condition:${source.property_condition}` : null,
        ...(Array.isArray(source.quality_flags) ? source.quality_flags : []),
      ].filter(Boolean),
      red_flags: [
        ...(source.pre_triage_exclusion_reason ? source.pre_triage_exclusion_reason.split(',').filter(Boolean) : []),
        ...(Array.isArray(source.risk_features) ? source.risk_features.map((feature) => `risk_feature:${feature}`) : []),
      ],
      missing_information: ['GPT analysis not run yet; this is a massive pre-score candidate.'],
      human_due_diligence_questions: [],
      final_unit_plan: [],
    },
    listing: {
      ...listing,
      propertyCode: source.source_listing_id ?? listing.propertyCode,
      url: source.source_url ?? listing.url,
      source_channel: source.source_channel,
      query_area: source.query_area,
      listing_area: realArea,
      suggestedTexts: { title: source.title ?? listing?.suggestedTexts?.title },
      title: source.title ?? listing.title,
      address: source.address ?? listing.address,
      municipality: source.city ?? listing.municipality,
      city: source.city ?? listing.city,
      district: source.district ?? listing.district,
      neighborhood: source.neighborhood ?? listing.neighborhood,
      area_label: realArea,
      price: source.price_eur ?? listing.price,
      priceByArea: source.price_by_area ?? listing.priceByArea,
      size: source.size_mq ?? listing.size,
      rooms: source.rooms ?? listing.rooms,
      bathrooms: source.bathrooms ?? listing.bathrooms,
      floor: source.floor ?? listing.floor,
      hasLift: source.has_lift ?? listing.hasLift,
      hasPlan: source.has_plan ?? listing.hasPlan,
      status: source.property_condition ?? listing.status,
      propertyType: source.property_type ?? listing.propertyType,
      features: source.features ?? listing.features ?? [],
      isNew: source.is_new ?? listing.isNew ?? null,
      renovation_features: source.renovation_features ?? listing.renovation_features ?? {},
      ignored_features: source.ignored_features ?? listing.ignored_features ?? [],
      risk_features: source.risk_features ?? listing.risk_features ?? [],
      quality_flags: source.quality_flags ?? listing.quality_flags ?? [],
      thumbnail: source.thumbnail_url ?? listing.thumbnail,
      description: listing.description ?? source.raw_listing?.description ?? null,
    },
  };
  result.photos = extractPhotos(result);
  result.floor_plans = extractFloorPlans(result);
  result.description = extractDescription(result);
  return result;
}

async function readSupabaseOutput(id, { publicView = true } = {}) {
  const runId = id.replace(/^supabase:/, '');
  const [runs, properties] = await Promise.all([
    supabaseGet(`triage_runs?run_id=eq.${encodeURIComponent(runId)}&select=*`),
    supabaseGet(`triage_properties?run_id=eq.${encodeURIComponent(runId)}&select=*&order=rank.asc`),
  ]);
  const run = runs?.[0];
  if (!run) throw new Error(`Supabase run not found: ${runId}`);

  const sourceOrder = run.search_strategy === 'neutral_fractionability'
    ? 'door_score.desc.nullslast'
    : 'door_score.desc.nullslast,price_by_area.asc.nullslast';
  const sourceListings = properties.length ? [] : await supabaseGet(`triage_source_listings?run_id=eq.${encodeURIComponent(runId)}&pre_triage_excluded=eq.false&select=*&order=${sourceOrder}&limit=${SOURCE_LISTINGS_LIMIT}`);
  const results = properties.length ? properties.map((property) => property.raw_result || property).filter(Boolean) : sourceListings.map((source, index) => sourceListingToResult(source, index));

  const output = run.raw_output && typeof run.raw_output === 'object'
    ? { ...run.raw_output, result_links: run.result_links ?? run.raw_output.result_links ?? [], results }
    : {
      search_name: run.search_name,
      city: run.city,
      investor_profile: run.investor_profile,
      search_strategy: run.search_strategy,
      scoring_mode: run.scoring_mode,
      scraped_count: run.scraped_count,
      eligible_count: run.eligible_count,
      filtered_out_count: run.filtered_out_count,
      filtered_out_summary: run.filtered_out_summary,
      gpt_analyzed_count: run.gpt_analyzed_count,
      result_links: run.result_links ?? [],
      results,
    };

  output.search_strategy = run.search_strategy ?? output.search_strategy ?? null;
  output.scoring_mode = run.scoring_mode ?? output.scoring_mode ?? null;

  return publicView ? redactOutput(output) : output;
}

async function readCombinedOutput(id, { publicView = true } = {}) {
  const runIds = id.replace(/^combined:/, '').split('+').filter(Boolean);
  if (runIds.length !== 2 || runIds.some((runId) => !/^[a-zA-Z0-9._-]+$/.test(runId))) {
    throw new Error('Invalid combined output id');
  }
  const components = await Promise.all(runIds.map(async (runId) => ({
    runId,
    output: await readSupabaseOutput(`supabase:${runId}`, { publicView: false }),
  })));
  const investorProfile = await investorProfilePromise;
  const output = rescoreCombinedResults(combineRunOutputs(components), (result) => runDoorEngine(
    result.listing || result,
    investorProfile,
    { includeEconomicSignals: false, scoringMode: 'physical_fractionability_only_v1' },
  ));
  return publicView ? redactOutput(output) : output;
}

export default async function handler(request, response) {
  try {
    const id = normalizeId(request.query.file);
    const publicView = !(request.query.internal === 'true' || request.query.internal === '1');

    if (id.startsWith('combined:')) {
      const output = await readCombinedOutput(id, { publicView });
      response.setHeader('Cache-Control', publicView ? 'public, s-maxage=300, stale-while-revalidate=86400' : 'private, no-store');
      response.status(200).json(output);
      return;
    }

    if (id.startsWith('supabase:')) {
      const output = await readSupabaseOutput(id, { publicView });
      response.setHeader('Cache-Control', publicView ? 'public, s-maxage=300, stale-while-revalidate=86400' : 'private, no-store');
      response.status(200).json(output);
      return;
    }

    if (!isAllowedId(id)) {
      response.status(400).json({ error: 'Invalid output file' });
      return;
    }

    const fullPath = resolve(rootDir, id);
    const backToRoot = relative(rootDir, fullPath).replaceAll(sep, '/');
    if (backToRoot !== id) {
      response.status(400).json({ error: 'Invalid output file' });
      return;
    }

    const content = await readFile(fullPath, 'utf8');
    if (publicView) {
      response.status(200).json(redactOutput(JSON.parse(content)));
      return;
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(200).send(content);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
