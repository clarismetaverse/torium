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

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim() || null;
}

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !String(item).toLowerCase().includes('idealista'));
}

function publicTitle(result) {
  const listing = result?.listing || result || {};
  const rawTitle = result?.title || listing?.suggestedTexts?.title || listing?.title || '';
  const typology = String(rawTitle).split(' in ')[0] || listing.propertyType || result?.property_type || 'Immobile';
  const area = listing.listing_area || listing.area_label || listing.neighborhood || listing.district || result?.listing_area || result?.area_label || result?.neighborhood || result?.district || result?.query_area || 'Milano';
  const size = listing.size || result?.size_mq || result?.size;
  return [typology, area, size ? `${size} mq` : null].filter(Boolean).join(' · ');
}

function extractPhotos(result) {
  const seen = new Set();
  const photos = [];
  const push = (item) => {
    const url = typeof item === 'string' ? item : item?.url || item?.thumbnail;
    if (!url || seen.has(url)) return;
    seen.add(url);
    photos.push({ url, tag: item?.tag && !String(item.tag).toLowerCase().includes('idealista') ? item.tag : null });
  };
  push(result?.thumbnail_url);
  push(result?.listing?.thumbnail);
  push(result?.listing?.thumbnail_url);
  push(result?.source_row?.thumbnail_url);
  const imageSets = [
    result?.photos,
    result?.listing?.photos,
    result?.listing?.multimedia?.images,
    result?.source_row?.photos,
    result?.source_row?.raw_listing?.multimedia?.images,
    result?.source_row?.raw_listing?.multimedia?.virtual3DTours,
  ];
  for (const images of imageSets) if (Array.isArray(images)) images.forEach(push);
  return photos.slice(0, 24);
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

function redactListing(listing, redactedTitle, photos, description) {
  if (!listing || typeof listing !== 'object') return listing;
  return {
    ...listing,
    title: redactedTitle,
    address: null,
    url: null,
    propertyCode: null,
    source_url: null,
    sourceUrl: null,
    idealista_url: null,
    description,
    photos,
    multimedia: { images: photos },
    suggestedTexts: { ...(listing.suggestedTexts || {}), title: redactedTitle },
  };
}

function redactResult(result) {
  if (!result || typeof result !== 'object') return result;
  const redactedTitle = publicTitle(result);
  const photos = extractPhotos(result);
  const description = extractDescription(result);
  return {
    ...result,
    title: redactedTitle,
    address: null,
    url: null,
    idealista_url: null,
    source_url: null,
    source_channel: null,
    source_listing_id: null,
    propertyCode: null,
    description,
    photos,
    share_url: `/?property=${encodeURIComponent(result.listing_index ?? result.id ?? redactedTitle)}`,
    gpt_analysis: redactAnalysis(result.gpt_analysis),
    listing: redactListing(result.listing, redactedTitle, photos, description),
    source_row: result.source_row ? {
      ...result.source_row,
      title: redactedTitle,
      address: null,
      source_channel: null,
      source_url: null,
      source_listing_id: null,
      description,
      photos,
      raw_listing: result.source_row.raw_listing ? {
        ...result.source_row.raw_listing,
        title: redactedTitle,
        address: null,
        url: null,
        propertyCode: null,
        externalReference: null,
        description,
        photos,
        multimedia: { images: photos },
      } : result.source_row.raw_listing,
    } : result.source_row,
  };
}

function redactOutput(output) {
  if (!output || typeof output !== 'object') return output;
  return {
    ...output,
    result_links: Array.isArray(output.result_links) ? output.result_links.map(redactResult) : output.result_links,
    results: Array.isArray(output.results) ? output.results.map(redactResult) : output.results,
  };
}

function sourceListingToResult(source, index) {
  const listing = source.raw_listing && typeof source.raw_listing === 'object' ? source.raw_listing : {};
  const realArea = source.district || source.neighborhood || source.area_label || listing.district || listing.neighborhood || listing.area_label || null;
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
  result.description = extractDescription(result);
  return result;
}

async function readSupabaseOutput(id, { publicView = true } = {}) {
  const runId = id.replace(/^supabase:/, '');
  const runs = await supabaseGet(`triage_runs?run_id=eq.${encodeURIComponent(runId)}&select=*`);
  const run = runs?.[0];
  if (!run) throw new Error(`Supabase run not found: ${runId}`);

  const properties = await supabaseGet(`triage_properties?run_id=eq.${encodeURIComponent(runId)}&select=*&order=rank.asc`);
  const sourceListings = properties.length ? [] : await supabaseGet(`triage_source_listings?run_id=eq.${encodeURIComponent(runId)}&select=*&order=door_score.desc.nullslast,price_by_area.asc.nullslast&limit=${SOURCE_LISTINGS_LIMIT}`);

  const results = properties.length ? properties.map((property) => property.raw_result || property).filter(Boolean) : sourceListings.map((source, index) => sourceListingToResult(source, index));

  const output = run.raw_output && typeof run.raw_output === 'object'
    ? { ...run.raw_output, result_links: run.result_links ?? run.raw_output.result_links ?? [], results }
    : {
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

  return publicView ? redactOutput(output) : output;
}

export default async function handler(request, response) {
  try {
    const id = normalizeId(request.query.file);
    const publicView = !(request.query.internal === 'true' || request.query.internal === '1');

    if (id.startsWith('supabase:')) {
      response.status(200).json(await readSupabaseOutput(id, { publicView }));
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
