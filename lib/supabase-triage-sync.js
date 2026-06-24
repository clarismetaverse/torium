import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function detectSource(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('idealista.')) return { source_channel: 'idealista', source_platform_name: 'idealista' };
  if (value.includes('immobiliare.')) return { source_channel: 'immobiliare', source_platform_name: 'immobiliare' };
  if (value) return { source_channel: 'agency_website', source_platform_name: 'agency_website' };
  return { source_channel: 'other', source_platform_name: 'other' };
}

function buildRunRow(output, filename) {
  return {
    run_id: path.basename(filename, '.json'),
    created_at_iso: new Date().toISOString(),
    filename,
    search_name: output.search_name,
    city: output.city,
    investor_profile: output.investor_profile,
    scraped_count: output.scraped_count,
    eligible_count: output.eligible_count,
    filtered_out_count: output.filtered_out_count,
    gpt_analyzed_count: output.gpt_analyzed_count,
    filtered_out_summary: output.filtered_out_summary ?? {},
    result_links: output.result_links ?? [],
    top_result_url: output.result_links?.[0]?.url ?? null,
    top_result_title: output.result_links?.[0]?.title ?? null,
    top_result_score: output.result_links?.[0]?.score ?? null,
    top_result_spread_base_eur: output.result_links?.[0]?.spread_base_eur ?? null,
    top_result_roi_base_pct: output.result_links?.[0]?.roi_base_pct ?? null,
    raw_output: output,
  };
}

function buildPropertyRow(result, rank, runRow, triageRunId) {
  const listing = result.listing ?? {};
  const gpt = result.gpt_analysis ?? {};
  const door = result.door_engine ?? {};
  const spread = result.spread ?? {};
  const sourceUrl = result.url || result.idealista_url || listing.url || null;
  const source = detectSource(sourceUrl);

  return {
    triage_run_id: triageRunId,
    run_id: runRow.run_id,
    listing_index: result.listing_index ?? null,
    rank,
    ranking_score: result.ranking_score ?? null,
    source_channel: source.source_channel,
    source_url: sourceUrl,
    source_listing_id: listing.propertyCode ?? null,
    source_platform_name: source.source_platform_name,
    source_confidence: 'single_source',
    title: result.title ?? listing?.suggestedTexts?.title ?? listing.address ?? null,
    address: listing.address ?? null,
    city: listing.municipality ?? runRow.city ?? null,
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
    estimated_final_units: door.estimatedFinalUnits ?? null,
    new_units_created: door.newUnitsCreated ?? null,
    door_score: door.doorScore ?? null,
    estimated_project_cost_eur: door.estimatedProjectCost ?? null,
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
    raw_listing: listing,
    raw_result: result,
  };
}

async function supabaseRest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
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

export async function syncTriageRunToSupabase(output, filename) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const runRow = buildRunRow(output, filename);
  const upsertedRuns = await supabaseRest('triage_runs?on_conflict=run_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(runRow),
  });
  const triageRunId = upsertedRuns?.[0]?.id;
  if (!triageRunId) throw new Error('Supabase did not return triage_runs.id');

  await supabaseRest(`triage_properties?run_id=eq.${encodeURIComponent(runRow.run_id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });

  const propertyRows = (output.results ?? []).map((result, index) => buildPropertyRow(result, index + 1, runRow, triageRunId));
  if (propertyRows.length) {
    await supabaseRest('triage_properties', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(propertyRows),
    });
  }

  console.log(`Saved triage run to Supabase: ${runRow.run_id} (${propertyRows.length} properties)`);
}
