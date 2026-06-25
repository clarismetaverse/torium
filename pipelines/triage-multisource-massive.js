import 'dotenv/config';
import { runDoorEngine } from '../lib/door-engine.js';
import { getPreTriageExclusion, summarizeExclusions } from '../lib/pre-triage-filters.js';
import { normalizeSourceListing, listingMatchesAnyArea } from '../lib/source-normalizers.js';
import { syncSourceListingsRunToSupabase } from '../lib/supabase-source-listings-sync.js';
import { runImmobiliareScraper } from '../scrapers/immobiliare/client.js';
import fs from 'node:fs/promises';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DEFAULT_CITY = process.env.TORIUM_CITY || 'Milano';
const DEFAULT_AREAS = 'Barona,Corvetto,NoLo,Bovisa,Dergano,Lambrate,Giambellino,Certosa,Precotto,Bande Nere';
const REQUESTED_AREAS = (process.env.TORIUM_MASSIVE_AREAS || DEFAULT_AREAS)
  .split(',')
  .map((area) => area.trim())
  .filter(Boolean);
const SOURCES = (process.env.TORIUM_MASSIVE_SOURCES || 'immobiliare')
  .split(',')
  .map((source) => source.trim().toLowerCase())
  .filter(Boolean);
const MAX_ITEMS_PER_QUERY = Number(process.env.TORIUM_MASSIVE_MAX_ITEMS_PER_QUERY || 100);
const MAX_TOTAL_RAW_LISTINGS = Number(process.env.TORIUM_MASSIVE_MAX_TOTAL_RAW_LISTINGS || 1000);
const TOP_PRESCORE_LIMIT = Number(process.env.TORIUM_MASSIVE_TOP_PRESCORE_LIMIT || 200);
const MIN_SIZE = Number(process.env.TORIUM_MIN_SIZE || 120);
const INCLUDE_RENOVATION_VARIANT = process.env.TORIUM_MASSIVE_INCLUDE_RENOVATION_VARIANT !== 'false';
const INCLUDE_DISCOUNTED_VARIANT = process.env.TORIUM_MASSIVE_INCLUDE_DISCOUNTED_VARIANT !== 'false';

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

function buildImmobiliareQueries(areas) {
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

  return areas.flatMap((area) => variants.map((variant) => {
    const payload = compactObject({
      maxItems: MAX_ITEMS_PER_QUERY,
      province: 'MI',
      municipality: DEFAULT_CITY,
      area,
      operation: 'buy',
      sortType: variant.sortType,
      minSize: MIN_SIZE,
      propertyType: 'apartment',
      propertyCondition: variant.propertyCondition,
      excludeAuctions: true,
    });

    return {
      source_channel: 'immobiliare',
      source_platform_name: 'immobiliare',
      query_name: variant.name,
      query_area: area,
      query_municipality: DEFAULT_CITY,
      query_province: 'MI',
      payload,
    };
  }));
}

function buildIdealistaQuery() {
  return {
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
      maxItems: Math.min(MAX_TOTAL_RAW_LISTINGS, Math.max(MAX_ITEMS_PER_QUERY, 500)),
      fetchDetails: false,
      fetchStats: false,
    },
  };
}

async function runIdealistaScraper(input) {
  const url = `https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?${new URLSearchParams({ token: APIFY_TOKEN })}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Apify Idealista request failed: ${response.status}\n${await response.text()}`);
  return response.json();
}

async function runSourceQuery(query) {
  if (query.source_channel === 'immobiliare') return runImmobiliareScraper(query.payload);
  if (query.source_channel === 'idealista') return runIdealistaScraper(query.payload);
  throw new Error(`Unsupported source_channel: ${query.source_channel}`);
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
    area: item.query_area || item.area_label,
    excluded: item.pre_triage_excluded,
  }));
}

async function main() {
  const searchName = process.argv[2] || 'milanoFractioningMassive';
  const investorProfile = JSON.parse(await fs.readFile('config/investor-profiles/max-doors-20k.json', 'utf8'));

  const queries = [];
  if (SOURCES.includes('immobiliare')) queries.push(...buildImmobiliareQueries(REQUESTED_AREAS));
  if (SOURCES.includes('idealista')) queries.push(buildIdealistaQuery());
  if (!queries.length) throw new Error('No sources selected. Set TORIUM_MASSIVE_SOURCES=immobiliare or immobiliare,idealista.');

  const collected = [];
  const queryPayloads = [];

  for (const query of queries) {
    if (collected.length >= MAX_TOTAL_RAW_LISTINGS) break;

    console.log(`Running ${query.source_channel} query: ${query.query_name} / ${query.query_area || 'all'}`);
    const rawResults = await runSourceQuery(query);
    const rawItems = Array.isArray(rawResults) ? rawResults : [];

    queryPayloads.push({
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
  const filteredOut = deduped
    .filter((item) => item.pre_triage_excluded)
    .map((item, index) => ({
      index,
      title: item.title,
      url: item.source_url,
      exclusion: item.exclusion,
    }));

  const eligible = deduped.filter((item) => !item.pre_triage_excluded);
  const preScored = eligible
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
    eligible_count: eligible.length,
    filtered_out_count: filteredOut.length,
    filtered_out_summary: summarizeExclusions(filteredOut),
    pre_scored_count: shortlist.length,
    gpt_candidate_count: 0,
    gpt_analyzed_count: 0,
    result_links: buildResultLinks(shortlist),
  };

  await syncSourceListingsRunToSupabase(output, deduped);

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
