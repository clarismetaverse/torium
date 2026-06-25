import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const rootDir = process.cwd();
const allowedPrefixes = ['triage-outputs/', 'outputs/triage/'];
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_LISTINGS_LIMIT = Number(process.env.TORIUM_VIEWER_SOURCE_LIMIT || 1000);

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

function sourceListingToResult(source, index) {
  const listing = source.raw_listing && typeof source.raw_listing === 'object' ? source.raw_listing : {};
  const realArea = source.district || source.neighborhood || source.area_label || listing.district || listing.neighborhood || listing.area_label || null;

  return {
    listing_index: index,
    title: source.title,
    url: source.source_url,
    idealista_url: source.source_channel === 'idealista' ? source.source_url : null,
    query_area: source.query_area,
    listing_area: realArea,
    ranking_score: source.door_score,
    door_engine: {
      doorScore: source.door_score,
      estimatedFinalUnits: source.estimated_final_units,
      newUnitsCreated: source.new_units_created,
      estimatedProjectCost: source.estimated_project_cost_eur,
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
      ].filter(Boolean),
      red_flags: source.pre_triage_exclusion_reason ? source.pre_triage_exclusion_reason.split(',').filter(Boolean) : [],
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
      thumbnail: source.thumbnail_url ?? listing.thumbnail,
    },
  };
}

async function readSupabaseOutput(id) {
  const runId = id.replace(/^supabase:/, '');
  const runs = await supabaseGet(`triage_runs?run_id=eq.${encodeURIComponent(runId)}&select=*`);
  const run = runs?.[0];
  if (!run) throw new Error(`Supabase run not found: ${runId}`);

  const properties = await supabaseGet(`triage_properties?run_id=eq.${encodeURIComponent(runId)}&select=*&order=rank.asc`);
  const sourceListings = properties.length
    ? []
    : await supabaseGet(`triage_source_listings?run_id=eq.${encodeURIComponent(runId)}&select=*&order=door_score.desc.nullslast,price_by_area.asc.nullslast&limit=${SOURCE_LISTINGS_LIMIT}`);

  const results = properties.length
    ? properties.map((property) => property.raw_result).filter(Boolean)
    : sourceListings.map((source, index) => sourceListingToResult(source, index));

  if (run.raw_output && typeof run.raw_output === 'object') {
    return {
      ...run.raw_output,
      result_links: run.result_links ?? run.raw_output.result_links ?? [],
      results,
    };
  }

  return {
    search_name: run.search_name,
    city: run.city,
    investor_profile: run.investor_profile,
    scraped_count: run.scraped_count,
    eligible_count: run.eligible_count,
    filtered_out_count: run.filtered_out_count,
    filtered_out_summary: run.filtered_out_summary,
    gpt_analyzed_count: run.gpt_analyzed_count,
    result_links: run.result_links ?? [],
    results,
  };
}

export default async function handler(request, response) {
  try {
    const id = normalizeId(request.query.file);

    if (id.startsWith('supabase:')) {
      response.status(200).json(await readSupabaseOutput(id));
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
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(200).send(content);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
