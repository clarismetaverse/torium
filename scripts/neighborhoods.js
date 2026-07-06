import 'dotenv/config';
import fs from 'node:fs/promises';
import { runDoorEngine } from '../lib/door-engine.js';
import { getPreTriageExclusion, summarizeExclusions } from '../lib/pre-triage-filters.js';
import { normalizeSourceListing } from '../lib/source-normalizers.js';
import { syncSourceListingsRunToSupabase } from '../lib/supabase-source-listings-sync.js';
import { parseMilanIdealistaSelections } from '../lib/milan-idealista-locations.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';
const IDEALISTA_ACTOR_ID = process.env.TORIUM_IDEALISTA_ACTOR_ID || 'igolaizola~idealista-scraper';
const APIFY_MAX_WAIT_SECONDS = Number(process.env.TORIUM_APIFY_MAX_WAIT_SECONDS || 1800);
const APIFY_POLL_INTERVAL_SECONDS = Number(process.env.TORIUM_APIFY_POLL_INTERVAL_SECONDS || 10);
const APIFY_DATASET_PAGE_SIZE = Number(process.env.TORIUM_APIFY_DATASET_PAGE_SIZE || 1000);
const MAX_ITEMS_PER_QUERY = Number(process.env.TORIUM_IDEALISTA_MAX_ITEMS_PER_QUERY || 100);
const TOP_PRESCORE_LIMIT = Number(process.env.TORIUM_IDEALISTA_TOP_PRESCORE_LIMIT || 250);
const MIN_SIZE = String(process.env.TORIUM_MIN_SIZE || 80);
const DRY_RUN = process.env.TORIUM_DRY_RUN === 'true';

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

async function fetchApifyDatasetItems(datasetId, maxItems = MAX_ITEMS_PER_QUERY) {
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

async function pollApifyRun(runId) {
  const started = Date.now();
  while (true) {
    const response = await apifyFetchJson(`actor-runs/${runId}`);
    const run = response?.data ?? response;
    const status = run?.status;
    if (status === 'SUCCEEDED') return run;
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) throw new Error(`Apify actor run ${runId} ended with status ${status}`);
    if (Math.round((Date.now() - started) / 1000) > APIFY_MAX_WAIT_SECONDS) throw new Error(`Apify actor run ${runId} did not finish within ${APIFY_MAX_WAIT_SECONDS}s.`);
    console.log(`Waiting for Apify run ${runId}: ${status || 'UNKNOWN'}`);
    await sleep(APIFY_POLL_INTERVAL_SECONDS * 1000);
  }
}

async function runIdealistaScraper(input) {
  if (!APIFY_TOKEN) throw new Error('Missing APIFY_TOKEN in .env');

  const response = await apifyFetchJson(`acts/${IDEALISTA_ACTOR_ID}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const run = response?.data ?? response;
  console.log(`Started Idealista Apify run: ${run.id}`);
  const finishedRun = await pollApifyRun(run.id);
  return fetchApifyDatasetItems(finishedRun.defaultDatasetId, Number(input.maxItems || MAX_ITEMS_PER_QUERY));
}

function buildIdealistaPayload(location) {
  return {
    country: 'it',
    operation: 'sale',
    propertyType: 'homes',
    location: location.idealista_location_id,
    minSize: MIN_SIZE,
    sortBy: 'lowestPriceM2',
    maxItems: MAX_ITEMS_PER_QUERY,
    fetchDetails: false,
    fetchStats: false,
  };
}

function buildQueries(locations) {
  return locations.map((location) => ({
    actor: 'idealista',
    source_channel: 'idealista',
    source_platform_name: 'idealista',
    query_name: 'idealista-milano-neighborhood',
    query_area: location.idealista_neighborhood_name,
    query_municipality: DEFAULT_CITY,
    query_province: 'MI',
    location,
    payload: buildIdealistaPayload(location),
  }));
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
    idealista_location_id: item.idealista_location_id,
    idealista_neighborhood_name: item.idealista_neighborhood_name,
    excluded: item.pre_triage_excluded,
  }));
}

async function main() {
  const searchName = process.argv[2] || 'milanoIdealistaNeighborhoods';
  const locations = parseMilanIdealistaSelections({
    locationIds: process.env.TORIUM_IDEALISTA_LOCATION_IDS,
    neighborhoods: process.env.TORIUM_IDEALISTA_NEIGHBORHOODS,
  });
  const queries = buildQueries(locations);

  console.log(JSON.stringify({
    selected_locations: locations,
    planned_idealista_payloads: queries.map((query) => ({
      query_area: query.query_area,
      payload: query.payload,
    })),
  }, null, 2));

  if (DRY_RUN) {
    console.log('Dry run only. Planned selected locations and Idealista payloads printed; exiting before Apify calls.');
    return;
  }

  const investorProfile = JSON.parse(await fs.readFile('config/investor-profiles/max-doors-20k.json', 'utf8'));
  const collected = [];
  const queryPayloads = [];

  for (const query of queries) {
    console.log(`Running Idealista neighborhood query: ${query.query_area} (${query.payload.location})`);
    const rawItems = await runIdealistaScraper(query.payload);
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
      collected.push(enrichWithPreScore({
        ...normalized,
        idealista_location_id: query.location.idealista_location_id,
        idealista_zone_id: query.location.idealista_zone_id,
        idealista_zone_name: query.location.idealista_zone_name,
        idealista_neighborhood_name: query.location.idealista_neighborhood_name,
      }, investorProfile));
    }
  }

  const sourceFilteredOut = collected.filter((item) => item.pre_triage_excluded).map((item, index) => ({ index, title: item.title, url: item.source_url, exclusion: item.exclusion }));
  const sourceEligible = collected.filter((item) => !item.pre_triage_excluded);
  const shortlist = [...sourceEligible]
    .sort((a, b) => (b.door_score ?? 0) - (a.door_score ?? 0) || (a.price_by_area ?? 999999) - (b.price_by_area ?? 999999))
    .slice(0, TOP_PRESCORE_LIMIT);

  const output = {
    run_id: nowRunId(searchName),
    search_name: searchName,
    city: DEFAULT_CITY,
    investor_profile: investorProfile.id,
    source_channels: ['idealista'],
    requested_areas: locations.map((location) => location.idealista_neighborhood_name),
    query_payloads: queryPayloads,
    raw_source_count: collected.length,
    scraped_count: collected.length,
    eligible_count: sourceEligible.length,
    filtered_out_count: sourceFilteredOut.length,
    filtered_out_summary: summarizeExclusions(sourceFilteredOut),
    pre_scored_count: shortlist.length,
    gpt_candidate_count: 0,
    gpt_analyzed_count: 0,
    result_links: buildResultLinks(shortlist),
  };

  await syncSourceListingsRunToSupabase(output, collected);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
