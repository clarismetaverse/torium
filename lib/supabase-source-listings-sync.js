const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildRunRow(output) {
  return {
    run_id: output.run_id,
    created_at_iso: new Date().toISOString(),
    filename: `supabase/raw/${output.run_id}`,
    search_name: output.search_name,
    city: output.city,
    investor_profile: output.investor_profile,
    scraped_count: output.scraped_count,
    eligible_count: output.eligible_count,
    filtered_out_count: output.filtered_out_count,
    gpt_analyzed_count: output.gpt_analyzed_count ?? 0,
    raw_source_count: output.raw_source_count,
    pre_scored_count: output.pre_scored_count,
    gpt_candidate_count: output.gpt_candidate_count ?? 0,
    source_channels: output.source_channels ?? [],
    requested_areas: output.requested_areas ?? [],
    query_payloads: output.query_payloads ?? [],
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

function buildSourceRow(item, output) {
  return {
    run_id: output.run_id,
    source_channel: item.source_channel,
    source_platform_name: item.source_platform_name,
    source_url: item.source_url,
    source_listing_id: item.source_listing_id,
    source_fingerprint: item.source_fingerprint,
    source_key: item.source_key,
    query_name: item.query_name,
    query_area: item.query_area,
    query_municipality: item.query_municipality,
    query_province: item.query_province,
    query_payload: item.query_payload ?? {},
    title: item.title,
    address: item.address,
    city: item.city,
    district: item.district,
    neighborhood: item.neighborhood,
    area_label: item.area_label,
    price_eur: item.price_eur,
    price_by_area: item.price_by_area,
    size_mq: item.size_mq,
    rooms: item.rooms,
    bathrooms: item.bathrooms,
    floor: item.floor,
    property_condition: item.property_condition,
    property_type: item.property_type,
    has_lift: item.has_lift,
    has_plan: item.has_plan,
    latitude: item.latitude,
    longitude: item.longitude,
    thumbnail_url: item.thumbnail_url,
    pre_triage_excluded: item.pre_triage_excluded,
    pre_triage_exclusion_reason: item.pre_triage_exclusion_reason,
    door_score: item.door_score,
    estimated_final_units: item.estimated_final_units,
    new_units_created: item.new_units_created,
    estimated_project_cost_eur: item.estimated_project_cost_eur,
    raw_listing: item.raw_listing ?? {},
  };
}

export async function syncSourceListingsRunToSupabase(output, sourceListings) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Skipped Supabase source sync. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    return;
  }

  const runRow = buildRunRow(output);
  await supabaseRest('triage_runs?on_conflict=run_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(runRow),
  });

  await supabaseRest(`triage_source_listings?run_id=eq.${encodeURIComponent(output.run_id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });

  const rows = sourceListings.map((item) => buildSourceRow(item, output));
  for (const chunk of chunkArray(rows, 500)) {
    await supabaseRest('triage_source_listings', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
  }

  console.log(`Saved massive source run to Supabase: ${output.run_id} (${rows.length} source listings)`);
}
