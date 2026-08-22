import 'dotenv/config';
import { runDoorEngine } from '../lib/door-engine.js';
import { getPreTriageExclusion, summarizeExclusions } from '../lib/pre-triage-filters.js';
import { normalizeSourceListing, listingMatchesAnyArea } from '../lib/source-normalizers.js';
import { buildImmobiliareSearchUrl } from '../lib/immobiliare-url-builder.js';
import { syncSourceListingsRunToSupabase } from '../lib/supabase-source-listings-sync.js';
import { buildStrategySearchName, compareShortlistItems, resolveSearchStrategy } from '../lib/search-strategies.js';
import { findMilanIdealistaLocation } from '../lib/milan-idealista-locations.js';
import { evaluateDataQuality } from '../lib/data-quality-gate.js';
import { comparePropertyIdentity, propertyIdentityBlockKeys } from '../lib/property-identity.js';
import { mergeUnifiedProperty, summarizePriceDifferences } from '../lib/source-offers.js';
import fs from 'node:fs/promises';

const INVESTOR_PROFILE_URL = new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url);

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';
const IDEALISTA_ACTOR_ID = process.env.TORIUM_IDEALISTA_ACTOR_ID || 'igolaizola~idealista-scraper';
const IMMOBILIARE_STRUCTURED_ACTOR_ID = process.env.TORIUM_IMMOBILIARE_STRUCTURED_ACTOR_ID || 'igolaizola~immobiliare-it-scraper';
const IMMOBILIARE_URL_ACTOR_ID = process.env.TORIUM_IMMOBILIARE_URL_ACTOR_ID || 'shahidirfan~immobiliare-it-scraper';
const IDEALISTA_DATASET_ID = process.env.TORIUM_IDEALISTA_DATASET_ID || null;
const IDEALISTA_RUN_ID = process.env.TORIUM_IDEALISTA_RUN_ID || null;
const APIFY_MAX_WAIT_SECONDS = Number(process.env.TORIUM_APIFY_MAX_WAIT_SECONDS || 1800);
const APIFY_POLL_INTERVAL_SECONDS = Number(process.env.TORIUM_APIFY_POLL_INTERVAL_SECONDS || 10);
const APIFY_DATASET_PAGE_SIZE = Number(process.env.TORIUM_APIFY_DATASET_PAGE_SIZE || 1000);
let SEARCH_STRATEGY = resolveSearchStrategy(process.env.TORIUM_SEARCH_STRATEGY);

const RUN_MODE_DEFAULTS = {
  scout: {
    areas: 'corso-san-gottardo',
    maxItemsPerQuery: 20,
    maxPagesPerQuery: 1,
    topPrescoreLimit: 40,
    includeDiscountedVariant: false,
  },
  normal: {
    areas: 'corso-san-gottardo,Barona,Corvetto',
    maxItemsPerQuery: 100,
    maxPagesPerQuery: 5,
    topPrescoreLimit: 250,
    includeDiscountedVariant: false,
  },
  deep: {
    areas: 'corso-san-gottardo,Barona,Corvetto,NoLo,Bovisa,Dergano,Lambrate,Giambellino',
    maxItemsPerQuery: 120,
    maxPagesPerQuery: 6,
    topPrescoreLimit: 300,
    includeDiscountedVariant: true,
  },
};

const IMMOBILIARE_ACTOR = (process.env.TORIUM_IMMOBILIARE_ACTOR || 'structured').toLowerCase();
let SOURCES = (process.env.TORIUM_MASSIVE_SOURCES || 'immobiliare')
  .split(',')
  .map((source) => source.trim().toLowerCase())
  .filter(Boolean);
const MIN_ROOMS = Number(process.env.TORIUM_MIN_ROOMS || 1);
const MAX_ROOMS = Number(process.env.TORIUM_MAX_ROOMS || 12);

function areaList(value) {
  return (Array.isArray(value) ? value : String(value || '').split(','))
    .map((area) => String(area).trim())
    .filter(Boolean);
}

export function resolveMassiveRunConfig(options = {}, env = process.env) {
  const runMode = String(options.runMode || env.TORIUM_RUN_MODE || 'scout').toLowerCase();
  const modeDefaults = RUN_MODE_DEFAULTS[runMode] || RUN_MODE_DEFAULTS.scout;
  const requestedAreas = areaList(options.requestedAreas ?? env.TORIUM_MASSIVE_AREAS ?? modeDefaults.areas);
  const maxItemsPerQuery = Number(options.maxItemsPerQuery ?? env.TORIUM_MASSIVE_MAX_ITEMS_PER_QUERY ?? modeDefaults.maxItemsPerQuery);
  const maxItemsPerSource = Number(options.maxItemsPerSource ?? env.TORIUM_MASSIVE_MAX_ITEMS_PER_SOURCE ?? maxItemsPerQuery);
  const maxPagesPerQuery = Number(options.maxPagesPerQuery ?? env.TORIUM_MASSIVE_MAX_PAGES_PER_QUERY ?? modeDefaults.maxPagesPerQuery);
  const defaultTotalRawListings = maxItemsPerQuery * Math.max(1, requestedAreas.length);

  return {
    runMode,
    requestedAreas,
    maxItemsPerQuery,
    maxItemsPerSource,
    maxPagesPerQuery,
    maxTotalRawListings: Number(options.maxTotalRawListings ?? env.TORIUM_MASSIVE_MAX_TOTAL_RAW_LISTINGS ?? defaultTotalRawListings),
    topPrescoreLimit: Number(options.topPrescoreLimit ?? env.TORIUM_MASSIVE_TOP_PRESCORE_LIMIT ?? modeDefaults.topPrescoreLimit),
    minSize: Number(options.minSize ?? env.TORIUM_MIN_SIZE ?? 80),
    idealistaCondition: Array.isArray(options.idealistaCondition) ? options.idealistaCondition : [],
    includeDiscountedVariant: env.TORIUM_MASSIVE_INCLUDE_DISCOUNTED_VARIANT === 'true' || modeDefaults.includeDiscountedVariant,
  };
}

let ACTIVE_RUN_CONFIG = resolveMassiveRunConfig();

function optionalNumberEnv(name, fallback = null) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '' || value === 'off') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const BATHROOMS = optionalNumberEnv('TORIUM_BATHROOMS', null);
const CONDITION_CODE = optionalNumberEnv('TORIUM_IMMOBILIARE_CONDITION_CODE', null);
const HEATING_CODE = optionalNumberEnv('TORIUM_IMMOBILIARE_HEATING_CODE', null);
const GARAGE_CODE = optionalNumberEnv('TORIUM_IMMOBILIARE_GARAGE_CODE', null);
const OWNERSHIP_CODE = optionalNumberEnv('TORIUM_IMMOBILIARE_OWNERSHIP_CODE', 1);
const REQUIRE_LIFT = process.env.TORIUM_IMMOBILIARE_REQUIRE_LIFT === 'true';
const FURNISHED = process.env.TORIUM_IMMOBILIARE_FURNISHED === 'true';
const EXCLUDE_AUCTIONS = process.env.TORIUM_IMMOBILIARE_EXCLUDE_AUCTIONS === 'true';
const INCLUDE_RENOVATION_VARIANT = process.env.TORIUM_MASSIVE_INCLUDE_RENOVATION_VARIANT !== 'false';

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })
  );
}

function nowRunId(searchName) {
  return `${Date.now()}-${searchName}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apifyUrl(pathname, params = {}) {
  return `https://api.apify.com/v2/${pathname.replace(/^\/+/, '')}?${new URLSearchParams({ token: APIFY_TOKEN, ...params })}`;
}

async function apifyFetchJson(pathname, options = {}, params = {}) {
  const response = await fetch(apifyUrl(pathname, params), options);
  const body = await response.text();
  if (!response.ok) throw new Error(`Apify request failed: ${response.status}\n${body}`);
  return body ? JSON.parse(body) : null;
}

async function fetchApifyDatasetItems(datasetId, maxItems = ACTIVE_RUN_CONFIG.maxTotalRawListings) {
  const items = [];
  let offset = 0;
  while (items.length < maxItems) {
    const limit = Math.min(APIFY_DATASET_PAGE_SIZE, maxItems - items.length);
    const page = await apifyFetchJson(`datasets/${datasetId}/items`, {}, {
      clean: 'true',
      format: 'json',
      offset: String(offset),
      limit: String(limit),
    });
    const pageItems = Array.isArray(page) ? page : [];
    items.push(...pageItems);
    if (pageItems.length < limit) break;
    offset += pageItems.length;
  }
  return items;
}

async function fetchApifyRun(runId) {
  const response = await apifyFetchJson(`actor-runs/${runId}`);
  return response?.data ?? response;
}

async function pollApifyRun(runId) {
  const started = Date.now();
  while (true) {
    const run = await fetchApifyRun(runId);
    const status = run?.status;
    if (status === 'SUCCEEDED') return run;
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
      throw new Error(`Apify actor run ${runId} ended with status ${status}`);
    }
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    if (elapsedSeconds > APIFY_MAX_WAIT_SECONDS) {
      throw new Error(`Apify actor run ${runId} did not finish within ${APIFY_MAX_WAIT_SECONDS}s. Re-run with TORIUM_IDEALISTA_RUN_ID=${runId} after it succeeds.`);
    }
    console.log(`Waiting for Apify run ${runId}: ${status || 'UNKNOWN'} (${elapsedSeconds}s)`);
    await sleep(APIFY_POLL_INTERVAL_SECONDS * 1000);
  }
}

async function startApifyActorRun(actorId, input) {
  const response = await apifyFetchJson(`acts/${actorId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response?.data ?? response;
}

function buildImmobiliareStructuredPayload(area, variant) {
  const broadMilan = String(area || '').trim().toLowerCase() === 'milano';
  return compactObject({
    maxItems: ACTIVE_RUN_CONFIG.maxItemsPerQuery,
    province: 'MI',
    municipality: DEFAULT_CITY,
    locations: [DEFAULT_CITY],
    area: broadMilan ? null : area,
    operation: 'buy',
    sortType: variant.sortType,
    minSize: ACTIVE_RUN_CONFIG.minSize,
    minRooms: MIN_ROOMS,
    maxRooms: MAX_ROOMS,
    bedrooms: 0,
    propertyType: 'apartment',
    propertyCondition: variant.propertyCondition,
    excludeAuctions: EXCLUDE_AUCTIONS,
  });
}

function buildImmobiliareUrlPayload(area) {
  const startUrl = buildImmobiliareSearchUrl({
    city: DEFAULT_CITY,
    area,
    minSize: ACTIVE_RUN_CONFIG.minSize,
    minRooms: MIN_ROOMS,
    maxRooms: MAX_ROOMS,
    bathrooms: BATHROOMS,
    conditionCode: CONDITION_CODE,
    heatingCode: HEATING_CODE,
    garageCode: GARAGE_CODE,
    ownershipCode: OWNERSHIP_CODE,
    requireLift: REQUIRE_LIFT,
    furnished: FURNISHED,
    excludeAuctions: EXCLUDE_AUCTIONS,
  });

  return {
    startUrl,
    results_wanted: ACTIVE_RUN_CONFIG.maxItemsPerQuery,
    max_pages: ACTIVE_RUN_CONFIG.maxPagesPerQuery,
    proxyConfiguration: { useApifyProxy: false },
  };
}

export function buildImmobiliareQueries(areas, strategy = SEARCH_STRATEGY) {
  if (IMMOBILIARE_ACTOR === 'url') {
    return areas.map((area) => ({
      actor: 'immobiliare-url',
      actor_id: IMMOBILIARE_URL_ACTOR_ID,
      source_channel: 'immobiliare',
      source_platform_name: 'immobiliare',
      query_name: 'immobiliare-url-starturl',
      query_area: area,
      query_municipality: DEFAULT_CITY,
      query_province: 'MI',
      payload: buildImmobiliareUrlPayload(area),
    }));
  }

  const variants = [];
  if (INCLUDE_RENOVATION_VARIANT) {
    variants.push({
      name: 'immobiliare-renovation',
      sortType: strategy.id === 'neutral_fractionability' ? 'mostRecent' : 'lessExpensiveM2',
      propertyCondition: 'toBeRenovated',
    });
  }
  if (ACTIVE_RUN_CONFIG.includeDiscountedVariant) {
    variants.push({ name: 'immobiliare-discounted-broad', sortType: 'discounted' });
  }

  return areas.flatMap((area) => variants.map((variant) => ({
    actor: 'immobiliare-structured',
    actor_id: IMMOBILIARE_STRUCTURED_ACTOR_ID,
    source_channel: 'immobiliare',
    source_platform_name: 'immobiliare',
    query_name: variant.name,
    query_area: area,
    query_municipality: DEFAULT_CITY,
    query_province: 'MI',
    payload: buildImmobiliareStructuredPayload(area, variant),
  })));
}

export function buildIdealistaQueries(areas) {
  return areas.map((area) => {
    const idealistaLocation = findMilanIdealistaLocation(area);
    return {
    actor: 'idealista',
    source_channel: 'idealista',
    source_platform_name: 'idealista',
    query_name: idealistaLocation ? 'idealista-location-id' : 'idealista-milano-broad-post-area-filter',
    query_area: area,
    query_municipality: DEFAULT_CITY,
    query_province: 'MI',
    source_area_enforced: Boolean(idealistaLocation),
    idealista_location_id: idealistaLocation?.idealista_location_id ?? null,
    idealista_zone_id: idealistaLocation?.idealista_zone_id ?? null,
    idealista_zone_name: idealistaLocation?.idealista_zone_name ?? null,
    idealista_neighborhood_name: idealistaLocation?.idealista_neighborhood_name ?? null,
    payload: {
      country: 'it',
      operation: 'sale',
      propertyType: 'homes',
      location: idealistaLocation?.idealista_location_id || DEFAULT_CITY,
      minSize: String(ACTIVE_RUN_CONFIG.minSize),
      ...(ACTIVE_RUN_CONFIG.idealistaCondition.length ? { condition: ACTIVE_RUN_CONFIG.idealistaCondition } : {}),
      sortBy: SEARCH_STRATEGY.idealistaSortBy,
      maxItems: ACTIVE_RUN_CONFIG.maxItemsPerQuery,
      fetchDetails: false,
      fetchStats: false,
    },
    };
  });
}

async function runIdealistaScraper(input) {
  const maxItems = Number(input.maxItems || ACTIVE_RUN_CONFIG.maxTotalRawListings);

  if (IDEALISTA_DATASET_ID) {
    console.log(`Loading Idealista items from existing Apify dataset: ${IDEALISTA_DATASET_ID}`);
    return fetchApifyDatasetItems(IDEALISTA_DATASET_ID, maxItems);
  }

  if (IDEALISTA_RUN_ID) {
    console.log(`Loading Idealista items from existing Apify run: ${IDEALISTA_RUN_ID}`);
    const run = await pollApifyRun(IDEALISTA_RUN_ID);
    return fetchApifyDatasetItems(run.defaultDatasetId, maxItems);
  }

  console.log(`Starting Idealista actor asynchronously: ${IDEALISTA_ACTOR_ID}`);
  const run = await startApifyActorRun(IDEALISTA_ACTOR_ID, input);
  console.log(`Started Idealista Apify run: ${run.id}`);
  const finishedRun = await pollApifyRun(run.id);
  console.log(`Idealista Apify run succeeded: ${finishedRun.id}; dataset=${finishedRun.defaultDatasetId}`);
  return fetchApifyDatasetItems(finishedRun.defaultDatasetId, maxItems);
}

async function runApifyActorScraper(actorId, input, maxItems) {
  console.log(`Starting Apify actor asynchronously: ${actorId}`);
  const run = await startApifyActorRun(actorId, input);
  console.log(`Started Apify run: ${run.id} (${actorId})`);
  const finishedRun = await pollApifyRun(run.id);
  console.log(`Apify run succeeded: ${finishedRun.id}; dataset=${finishedRun.defaultDatasetId}`);
  return fetchApifyDatasetItems(finishedRun.defaultDatasetId, maxItems);
}

async function runSourceQuery(query) {
  if (query.actor === 'immobiliare-url' || query.actor === 'immobiliare-structured') {
    return runApifyActorScraper(query.actor_id, query.payload, ACTIVE_RUN_CONFIG.maxItemsPerQuery);
  }
  if (query.actor === 'idealista') return runIdealistaScraper(query.payload);
  throw new Error(`Unsupported actor: ${query.actor}`);
}

export function sourceAreaMatches(normalized, raw, area) {
  if (!listingMatchesAnyArea(normalized.listing, [area])) return false;
  if (!normalized.location_is_inferred) return true;
  const normalizeLocation = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const rawLocationText = normalizeLocation(JSON.stringify(raw || {}));
  const normalizedArea = normalizeLocation(area);
  return Boolean(normalizedArea && rawLocationText.includes(normalizedArea));
}

export function enrichWithPreScore(item, investorProfile) {
  const exclusion = getPreTriageExclusion(item.listing);
  const doorEngine = runDoorEngine(item.listing, investorProfile, {
    includeEconomicSignals: SEARCH_STRATEGY.includeEconomicDoorSignals,
    scoringMode: SEARCH_STRATEGY.scoringMode,
  });
  const dataQuality = evaluateDataQuality({
    ...item,
    listing: item.listing,
    door_engine: doorEngine,
  });
  const qualityReasons = dataQuality.critical_flags.map((reason) => `data_quality:${reason}`);
  const exclusionReasons = [...new Set([...exclusion.reasons, ...qualityReasons])];

  return {
    ...item,
    pre_triage_excluded: exclusion.excluded || !dataQuality.valid,
    pre_triage_exclusion_reason: exclusionReasons.join(','),
    door_score: doorEngine.doorScore,
    estimated_final_units: doorEngine.estimatedFinalUnits,
    new_units_created: doorEngine.newUnitsCreated,
    estimated_project_cost_eur: doorEngine.estimatedProjectCost,
    door_engine: doorEngine,
    data_quality: dataQuality,
    quality_flags: [...new Set([...(item.quality_flags || []), ...dataQuality.critical_flags, ...dataQuality.warning_flags])],
    exclusion: { ...exclusion, excluded: exclusion.excluded || !dataQuality.valid, reasons: exclusionReasons },
  };
}

export function canonicalPropertyKey(item) {
  const address = String(item.address || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (address.length >= 8 && item.price_eur && item.size_mq) {
    return `property:${address}:${Math.round(item.price_eur)}:${Math.round(item.size_mq)}:${String(item.floor || '')}`;
  }
  return `${item.source_channel}:${item.source_key || item.source_url || item.source_fingerprint}`;
}

export function dedupeListings(items) {
  const groups = [];
  const groupsByBlock = new Map();

  for (const item of items) {
    const blocks = [...new Set([
      `legacy:${item.canonical_source_key || canonicalPropertyKey(item)}`,
      ...propertyIdentityBlockKeys(item),
    ])];
    const candidateIndexes = [...new Set(blocks.flatMap((block) => [...(groupsByBlock.get(block) || [])]))];
    let groupIndex = null;
    for (const index of candidateIndexes) {
      if (groups[index].some((member) => comparePropertyIdentity(member, item).auto_merge_eligible)) {
        groupIndex = index;
        break;
      }
      const exactLegacyKey = item.canonical_source_key || canonicalPropertyKey(item);
      if (groups[index].some((member) => (member.canonical_source_key || canonicalPropertyKey(member)) === exactLegacyKey)) {
        groupIndex = index;
        break;
      }
    }
    if (groupIndex === null) {
      groupIndex = groups.length;
      groups.push([]);
    }
    groups[groupIndex].push(item);
    for (const block of blocks) {
      if (!groupsByBlock.has(block)) groupsByBlock.set(block, new Set());
      groupsByBlock.get(block).add(groupIndex);
    }
  }

  return groups.map((members) => mergeUnifiedProperty(members));
}

function buildResultLinks(items) {
  return items.slice(0, 30).map((item, index) => ({
    rank: index + 1,
    score: item.door_score,
    title: item.title,
    url: item.source_url,
    price: item.price_eur,
    price_by_area: item.price_by_area,
    size_mq: item.size_mq,
    source_channel: item.source_channel,
    query_area: item.query_area,
    area: item.area_label || item.district || item.neighborhood || null,
    excluded: item.pre_triage_excluded,
    condition: item.property_condition,
    features: item.features,
    quality_flags: item.quality_flags,
    source_offers: item.source_offers,
    price_comparison: item.price_comparison,
  }));
}

export async function runMassiveTriage(options = {}) {
  ACTIVE_RUN_CONFIG = resolveMassiveRunConfig(options);
  SEARCH_STRATEGY = resolveSearchStrategy(options.searchStrategy || process.env.TORIUM_SEARCH_STRATEGY);
  SOURCES = (options.sources || process.env.TORIUM_MASSIVE_SOURCES || 'immobiliare')
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);

  if (!APIFY_TOKEN && process.env.TORIUM_DRY_RUN !== 'true') throw new Error('Missing APIFY_TOKEN in .env');

  const baseSearchName = options.baseSearchName || process.argv[2] || 'milanoFractioningMassive';
  const searchName = buildStrategySearchName(baseSearchName, SEARCH_STRATEGY);
  const investorProfile = JSON.parse(await fs.readFile(INVESTOR_PROFILE_URL, 'utf8'));

  const queries = [];
  if (SOURCES.includes('idealista')) queries.push(...buildIdealistaQueries(ACTIVE_RUN_CONFIG.requestedAreas));
  if (SOURCES.includes('immobiliare')) queries.push(...buildImmobiliareQueries(ACTIVE_RUN_CONFIG.requestedAreas, SEARCH_STRATEGY));
  if (!queries.length) throw new Error('No sources selected. Set TORIUM_MASSIVE_SOURCES=immobiliare or immobiliare,idealista.');

  console.log(JSON.stringify({
    run_mode: ACTIVE_RUN_CONFIG.runMode,
    search_name: searchName,
    search_strategy: SEARCH_STRATEGY.id,
    scoring_mode: SEARCH_STRATEGY.scoringMode,
    shortlist_tie_breaker: SEARCH_STRATEGY.shortlistTieBreaker,
    sources: SOURCES,
    immobiliare_actor: IMMOBILIARE_ACTOR,
    requested_areas: ACTIVE_RUN_CONFIG.requestedAreas,
    max_items_per_query: ACTIVE_RUN_CONFIG.maxItemsPerQuery,
    max_items_per_source: ACTIVE_RUN_CONFIG.maxItemsPerSource,
    max_pages_per_query: ACTIVE_RUN_CONFIG.maxPagesPerQuery,
    max_total_raw_listings: ACTIVE_RUN_CONFIG.maxTotalRawListings,
    filters: {
      min_size: ACTIVE_RUN_CONFIG.minSize,
      condition_code: CONDITION_CODE,
      bathrooms: BATHROOMS,
      ownership_code: OWNERSHIP_CODE,
      heating_code: HEATING_CODE,
      garage_code: GARAGE_CODE,
      require_lift: REQUIRE_LIFT,
      furnished: FURNISHED,
    },
    planned_queries: queries.map((query) => ({
      actor: query.actor,
      area: query.query_area,
      payload: query.payload,
    })),
  }, null, 2));

  if (process.env.TORIUM_DRY_RUN === 'true') {
    console.log('Dry run only. Set TORIUM_DRY_RUN=false or remove it to execute Apify calls.');
    return;
  }

  const collected = [];
  const collectedBySource = Object.fromEntries(SOURCES.map((source) => [source, 0]));
  const queryPayloads = [];
  const queryErrors = [];

  for (const query of queries) {
    if (collected.length >= ACTIVE_RUN_CONFIG.maxTotalRawListings) break;
    if ((collectedBySource[query.source_channel] || 0) >= ACTIVE_RUN_CONFIG.maxItemsPerSource) continue;

    console.log(`Running ${query.actor} query: ${query.query_name} / ${query.query_area || 'all'}`);
    let rawResults;
    try {
      rawResults = await runSourceQuery(query);
    } catch (error) {
      const message = String(error?.message || error);
      console.error(`Source query failed (${query.actor} / ${query.query_area || 'all'}): ${message}`);
      queryErrors.push({ actor: query.actor, source_channel: query.source_channel, query_name: query.query_name, query_area: query.query_area, error: message });
      queryPayloads.push({ actor: query.actor, source_channel: query.source_channel, query_name: query.query_name, query_area: query.query_area, payload: query.payload, returned_count: 0, status: 'failed', error: message });
      continue;
    }
    const rawItems = Array.isArray(rawResults) ? rawResults : [];

    queryPayloads.push({
      actor: query.actor,
      source_channel: query.source_channel,
      query_name: query.query_name,
      query_area: query.query_area,
      payload: query.payload,
      returned_count: rawItems.length,
      status: 'succeeded',
    });

    for (const raw of rawItems) {
      if ((collectedBySource[query.source_channel] || 0) >= ACTIVE_RUN_CONFIG.maxItemsPerSource) break;
      const normalized = {
        ...normalizeSourceListing(raw, {
        source_channel: query.source_channel,
        source_platform_name: query.source_platform_name,
        query_name: query.query_name,
        query_area: query.query_area,
        query_municipality: query.query_municipality,
        query_province: query.query_province,
        query_payload: query.payload,
        }),
        idealista_location_id: query.idealista_location_id,
        idealista_zone_id: query.idealista_zone_id,
        idealista_zone_name: query.idealista_zone_name,
        idealista_neighborhood_name: query.idealista_neighborhood_name,
      };
      normalized.canonical_source_key = canonicalPropertyKey(normalized);

      const mustValidateArea = query.source_channel === 'immobiliare' || (query.source_channel === 'idealista' && !query.source_area_enforced);
      if (mustValidateArea && !sourceAreaMatches(normalized, raw, query.query_area)) {
        continue;
      }

      const enriched = enrichWithPreScore(normalized, investorProfile);
      collected.push(enriched);
      collectedBySource[query.source_channel] = (collectedBySource[query.source_channel] || 0) + 1;
      if (collected.length >= ACTIVE_RUN_CONFIG.maxTotalRawListings) break;
    }
  }

  if (!collected.length && queryErrors.length) {
    throw new Error(`All source queries failed: ${queryErrors.map((item) => `${item.source_channel}/${item.query_area}: ${item.error}`).join(' | ')}`);
  }

  const deduped = dedupeListings(collected);
  const priceComparisonSummary = summarizePriceDifferences(deduped);
  const sourceFilteredOut = collected
    .filter((item) => item.pre_triage_excluded)
    .map((item, index) => ({ index, title: item.title, url: item.source_url, exclusion: item.exclusion }));
  const sourceEligible = collected.filter((item) => !item.pre_triage_excluded);
  const dedupedEligible = deduped.filter((item) => !item.pre_triage_excluded);
  const preScored = dedupedEligible
    .sort((a, b) => compareShortlistItems(a, b, SEARCH_STRATEGY));

  const shortlist = preScored.slice(0, ACTIVE_RUN_CONFIG.topPrescoreLimit);
  const output = {
    run_id: nowRunId(searchName),
    search_name: searchName,
    run_mode: ACTIVE_RUN_CONFIG.runMode,
    city: DEFAULT_CITY,
    investor_profile: investorProfile.id,
    search_strategy: SEARCH_STRATEGY.id,
    scoring_mode: SEARCH_STRATEGY.scoringMode,
    source_channels: SOURCES,
    requested_areas: ACTIVE_RUN_CONFIG.requestedAreas,
    sample_config: {
      max_items_per_query: ACTIVE_RUN_CONFIG.maxItemsPerQuery,
      max_items_per_source: ACTIVE_RUN_CONFIG.maxItemsPerSource,
      max_total_raw_listings: ACTIVE_RUN_CONFIG.maxTotalRawListings,
      top_prescore_limit: ACTIVE_RUN_CONFIG.topPrescoreLimit,
      min_size_mq: ACTIVE_RUN_CONFIG.minSize,
    },
    query_payloads: queryPayloads,
    query_errors: queryErrors,
    raw_source_count: collected.length,
    raw_source_counts_by_channel: collectedBySource,
    scraped_count: collected.length,
    deduped_count: deduped.length,
    price_comparison_summary: priceComparisonSummary,
    eligible_source_count: sourceEligible.length,
    eligible_count: dedupedEligible.length,
    filtered_out_count: sourceFilteredOut.length,
    filtered_out_summary: summarizeExclusions(sourceFilteredOut),
    pre_scored_count: shortlist.length,
    gpt_candidate_count: 0,
    gpt_analyzed_count: 0,
    result_links: buildResultLinks(shortlist),
  };

  await syncSourceListingsRunToSupabase(output, collected);

  console.log(JSON.stringify({
    run_id: output.run_id,
    sources: output.source_channels,
    requested_areas: output.requested_areas,
    raw_source_count: output.raw_source_count,
    raw_source_counts_by_channel: output.raw_source_counts_by_channel,
    deduped_count: output.deduped_count,
    eligible_count: output.eligible_count,
    filtered_out_count: output.filtered_out_count,
    pre_scored_count: output.pre_scored_count,
    top_30: output.result_links,
    price_comparison_summary: output.price_comparison_summary,
  }, null, 2));

  return output;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('pipelines/triage-multisource-massive.js')) {
  runMassiveTriage().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
