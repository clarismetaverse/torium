import { boolParam, jsonResponse, latestRunId, numberParam, sendError, supabaseGet } from './_supabase-debug.js';

function appendFilter(parts, name, operator, value) {
  if (value !== undefined && value !== null && value !== '') {
    parts.push(`${name}=${operator}.${encodeURIComponent(value)}`);
  }
}

export default async function handler(request, response) {
  try {
    const limit = numberParam(request.query.limit, 100, 1000);
    const offset = numberParam(request.query.offset, 0, 100000);
    const searchName = request.query.search_name || 'milanoFractioningMassive';
    const runId = request.query.run_id === 'latest' || !request.query.run_id
      ? await latestRunId(searchName)
      : String(request.query.run_id);

    if (!runId) return sendError(response, 404, 'No run found');

    const raw = request.query.raw === '1' || request.query.raw === 'true';
    const select = raw
      ? '*'
      : 'id,created_at,run_id,source_channel,source_url,source_listing_id,canonical_source_key,query_name,query_area,title,address,city,district,neighborhood,area_label,price_eur,price_by_area,size_mq,rooms,bathrooms,floor,property_condition,property_type,has_lift,has_plan,features,is_new,renovation_features,ignored_features,risk_features,quality_flags,pre_triage_excluded,pre_triage_exclusion_reason,door_score,estimated_final_units,new_units_created,estimated_project_cost_eur,thumbnail_url';

    const parts = [
      `run_id=eq.${encodeURIComponent(runId)}`,
      `select=${select}`,
      'order=door_score.desc.nullslast,price_by_area.asc.nullslast',
      `limit=${limit}`,
      `offset=${offset}`,
    ];

    appendFilter(parts, 'query_area', 'eq', request.query.query_area);
    appendFilter(parts, 'property_condition', 'eq', request.query.condition);

    const eligible = boolParam(request.query.eligible);
    if (eligible === true) parts.push('pre_triage_excluded=eq.false');
    if (eligible === false) parts.push('pre_triage_excluded=eq.true');

    if (request.query.min_score) parts.push(`door_score=gte.${Number(request.query.min_score)}`);
    if (request.query.min_size) parts.push(`size_mq=gte.${Number(request.query.min_size)}`);
    if (request.query.max_price_m2) parts.push(`price_by_area=lte.${Number(request.query.max_price_m2)}`);

    const rows = await supabaseGet(`triage_source_listings?${parts.join('&')}`);
    jsonResponse(response, { run_id: runId, count: rows.length, limit, offset, rows });
  } catch (error) {
    sendError(response, 500, error.message);
  }
}
