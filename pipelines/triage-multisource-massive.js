import 'dotenv/config';
import { runDoorEngine } from '../lib/door-engine.js';
import { getPreTriageExclusion, summarizeExclusions } from '../lib/pre-triage-filters.js';
import { normalizeSourceListing, listingMatchesAnyArea } from '../lib/source-normalizers.js';
import { buildImmobiliareSearchUrl } from '../lib/immobiliare-url-builder.js';
import { syncSourceListingsRunToSupabase } from '../lib/supabase-source-listings-sync.js';
import { runImmobiliareScraper } from '../scrapers/immobiliare/client.js';
import { runImmobiliareUrlScraper } from '../scrapers/immobiliare-url/client.js';
import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';
const RUN_MODE = (process.env.TORIUM_RUN_MODE || 'scout').toLowerCase();
const IDEALISTA_ACTOR_ID = process.env.TORIUM_IDEALISTA_ACTOR_ID || 'igolaizola~idealista-scraper';
const IDEALISTA_DATASET_ID = process.env.TORIUM_IDEALISTA_DATASET_ID || null;
const IDEALISTA_RUN_ID = process.env.TORIUM_IDEALISTA_RUN_ID || null;
const APIFY_MAX_WAIT_SECONDS = Number(process.env.TORIUM_APIFY_MAX_WAIT_SECONDS || 1800);
const APIFY_POLL_INTERVAL_SECONDS = Number(process.env.TORIUM_APIFY_POLL_INTERVAL_SECONDS || 10);
const APIFY_DATASET_PAGE_SIZE = Number(process.env.TORIUM_APIFY_DATASET_PAGE_SIZE || 1000);

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

const MODE_DEFAULTS = RUN_MODE_DEFAULTS[RUN_MODE] || RUN_MODE_DEFAULTS.scout;
const IMMOBILIARE_ACTOR = (process.env.TORIUM_IMMOBILIARE_ACTOR || 'url').toLowerCase();
const REQUESTED_AREAS = (process.env.TORIUM_MASSIVE_AREAS || MODE_DEFAULTS.areas)
  .split(',')
  .map((area) => area.trim())
  .filter(Boolean);
const SOURCES = (process.env.TORIUM_MASSIVE_SOURCES || 'immobiliare')
  .split(',')
  .map((source) => source.trim().toLowerCase())
  .filter(Boolean);
const MAX_ITEMS_PER_QUERY = Number(process.env.TORIUM_MASSIVE_MAX_ITEMS_PER_QUERY || MODE_DEFAULTS.maxItemsPerQuery);
const MAX_PAGES_PER_QUERY = Number(process.env.TORIUM_MASSIVE_MAX_PAGES_PER_QUERY || MODE_DEFAULTS.maxPagesPerQuery);
const DEFAULT_TOTAL_RAW_LISTINGS = MAX_ITEMS_PER_QUERY * Math.max(1, REQUESTED_AREAS.length);
const MAX_TOTAL_RAW_LISTINGS = Number(process.env.TORIUM_MASSIVE_MAX_TOTAL_RAW_LISTINGS || DEFAULT_TOTAL_RAW_LISTINGS);
const TOP_PRESCORE_LIMIT = Number(process.env.TORIUM_MASSIVE_TOP_PRESCORE_LIMIT || MODE_DEFAULTS.topPrescoreLimit);
const MIN_SIZE = Number(process.env.TORIUM_MIN_SIZE || 80);
const MIN_ROOMS = Number(process.env.TORIUM_MIN_ROOMS || 1);
const MAX_ROOMS = Number(process.env.TORIUM_MAX_ROOMS || 12);

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
const INCLUDE_DISCOUNTED_VARIANT = process.env.TORIUM_MASSIVE_INCLUDE_DISCOUNTED_VARIANT === 'true' || MODE_DEFAULTS.includeDiscountedVariant;

if (!APIFY_TOKEN) throw new Error('Missing APIFY_TOKEN in .env');

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

async function fetchApifyDatasetItems(datasetId, maxItems = MAX_TOTAL_RAW_LISTINGS) {
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
  return compactObject({
    maxItems: MAX_ITEMS_PER_QUERY,
    province: 'MI',
    municipality: DEFAULT_CITY,
    area,
    operation: 'buy',
    sortType: variant.sortType,
    minSize: MIN_SIZE,
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
    minSize: MIN_SIZE,
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
    results_wanted: MAX_ITEMS_PER_QUERY,
    max_pages: MAX_PAGES_PER_QUERY,
    proxyConfiguration: { useApifyProxy: false },
  };
}

function buildImmobiliareQueries(areas) {
  if (IMMOBILIARE_ACTOR === 'url') {
    return areas.map((area) => ({
      actor: 'immobiliare-url',
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
      name: 'immobiliare-renovation-cheap-m2',
      sortType: 'lessExpensiveM2',
      propertyCondition: 'toBeRenovated',
    });
  }
  if (INCLUDE_DISCOUNTED_VARIANT) {
    variants.push({
      name: 'immobiliare-discounted-broad',
      sortType: 'discounted',
    });
  }

  return areas.flatMap((area) => variants.map((variant) => ({
    actor: 'immobiliare-structured',
    source_channel: 'immobiliare',
    source_platform_name: 'immobiliare',
    query_name: variant.name,
    query_area: area,
    query_municipality: DEFAULT_CITY,
    query_province: 'MI',
    payload: buildImmobiliareStructuredPayload(area, variant),
  })));
}

function buildIdealistaQuery() {
  return {
    actor: 'idealista',
    source_channel: 'idealista',
    source_platform_name: 'idealista',
    query_name: 'idealista-milano-broad-post-area-filter',
    query_area: REQUESTED_AREAS.join(','),
    query_municipality: DEFAULT_CITY,
    query_province: 'MI',
    payload: {
      country: 'it',
      operation: 'sale',
      propertyType: 'homes',
      location: DEFAULT_CITY,
      minSize: String(MIN_SIZE),
      sortBy: 'lowestPriceM2',
      maxItems: Math.min(MAX_TOTAL_RAW_LISTINGS, Math.max(MAX_ITEMS_PER_QUERY, 100)),
      fetchDetails: false,
      fetchStats: false,
    },
  };
}

async function runIdealistaScraper(input) {
  const maxItems = Number(input.maxItems || MAX_TOTAL_RAW_LISTINGS);

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

async function runSourceQuery(query) {
  if (query.actor === 'immobiliare-url') return runImmobiliareUrlScraper(query.payload);
  if (query.actor === 'immobiliare-structured') return runImmobiliareScraper(query.payload);
  if (query.actor === 'idealista') return runIdealistaScraper(query.payload);
  throw new Error(`Unsupported actor: ${query.actor}`);
}

function enrichWithPreScore(item, investorProfile) {
  const exclusion = getPreTriageExclusion(item.listing);
  const doorEngine = runDoorEngine(item.listing, investorProfile);

  return {
    ...item,
    pre_triage_excluded: exclusion.excluded,
    pre_triage_exclusion_reason: exclusion.reasons.join(','),
    door_score: doorEngine.doorScore,
    estimated_final_units: doorEngine.estimatedFinalUnits,
    new_units_created: doorEngine.newUnitsCreated,
    estimated_project_cost_eur: doorEngine.estimatedProjectCost,
    door_engine: doorEngine,
    exclusion,
  };
}

function dedupeListings(items) {
  const byKey = new Map();

  for (const item of items) {
    const key = `${item.source_channel}:${item.source_key || item.source_url || item.source_fingerprint}`;
    const existing = byKey.get(key);
    if (!existing || (item.door_score ?? 0) > (existing.door_score ?? 0)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
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
  }));
}

async function main() {
  const searchName = process.argv[2] || 'milanoFractioningMassive';
  const investorProfile = JSON.parse(await fs.readFile('config/investor-profiles/max-doors-20k.json', 'utf8'));

  const queries = [];
  if (SOURCES.includes('immobiliare')) queries.push(...buildImmobiliareQueries(REQUESTED_AREAS));
  if (SOURCES.includes('idealista')) queries.push(buildIdealistaQuery());
  if (!queries.length) throw new Error('No sources selected. Set TORIUM_MASSIVE_SOURCES=immobiliare or immobiliare,idealista.');

  console.log(JSON.stringify({
    run_mode: RUN_MODE,
    sources: SOURCES,
    immobiliare_actor: IMMOBILIARE_ACTOR,
    requested_areas: REQUESTED_AREAS,
    max_items_per_query: MAX_ITEMS_PER_QUERY,
    max_pages_per_query: MAX_PAGES_PER_QUERY,
    max_total_raw_listings: MAX_TOTAL_RAW_LISTINGS,
    filters: {
      min_size: MIN_SIZE,
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
      startUrl: query.payload.startUrl,
      results_wanted: query.payload.results_wanted,
      max_pages: query.payload.max_pages,
      maxItems: query.payload.maxItems,
    })),
  }, null, 2));

  if (process.env.TORIUM_DRY_RUN === 'true') {
    console.log('Dry run only. Set TORIUM_DRY_RUN=false or remove it to execute Apify calls.');
    return;
  }

  const collected = [];
  const queryPayloads = [];

  for (const query of queries) {
    if (collected.length >= MAX_TOTAL_RAW_LISTINGS) break;

    console.log(`Running ${query.actor} query: ${query.query_name} / ${query.query_area || 'all'}`);
    const rawResults = await runSourceQuery(query);
    const rawItems = Array.isArray(rawResults) ? rawResults : [];

    queryPayloads.push({
      actor: query.actor,
      source_channel: query.source_channel,
      query_name: query.query_name,
      query_area: query.query_area,
      payload: query.payload,
      returned_count: rawItems.length,
    });

    for (const raw of rawItems) {
      const normalized = normalizeSourceListing(raw, {
        source_channel: query.source_channel,
        source_platform_name: query.source_platform_name,
        query_name: query.query_name,
        query_area: query.query_area,
        query_municipality: query.query_municipality,
        query_province: query.query_province,
        query_payload: query.payload,
      });

      if (query.source_channel === 'idealista' && !listingMatchesAnyArea(normalized.listing, REQUESTED_AREAS)) {
        continue;
      }

      const enriched = enrichWithPreScore(normalized, investorProfile);
      collected.push(enriched);
      if (collected.length >= MAX_TOTAL_RAW_LISTINGS) break;
    }
  }

  const deduped = dedupeListings(collected);
  const sourceFilteredOut = collected
    .filter((item) => item.pre_triage_excluded)
    .map((item, index) => ({ index, title: item.title, url: item.source_url, exclusion: item.exclusion }));
  const sourceEligible = collected.filter((item) => !item.pre_triage_excluded);
  const dedupedEligible = deduped.filter((item) => !item.pre_triage_excluded);
  const preScored = dedupedEligible
    .sort((a, b) => (b.door_score ?? 0) - (a.door_score ?? 0) || (a.price_by_area ?? 999999) - (b.price_by_area ?? 999999));

  const shortlist = preScored.slice(0, TOP_PRESCORE_LIMIT);
  const output = {
    run_id: nowRunId(searchName),
    search_name: searchName,
    city: DEFAULT_CITY,
    investor_profile: investorProfile.id,
    source_channels: SOURCES,
    requested_areas: REQUESTED_AREAS,
    query_payloads: queryPayloads,
    raw_source_count: collected.length,
    scraped_count: collected.length,
    deduped_count: deduped.length,
    eligible_count: sourceEligible.length,
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
    deduped_count: output.deduped_count,
    eligible_count: output.eligible_count,
    filtered_out_count: output.filtered_out_count,
    pre_scored_count: output.pre_scored_count,
    top_30: output.result_links,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
