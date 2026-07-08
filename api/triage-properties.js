import { jsonResponse, latestRunId, numberParam, sendError, supabaseGet } from './_supabase-debug.js';

function appendFilter(parts, name, operator, value) {
  if (value !== undefined && value !== null && value !== '') {
    parts.push(`${name}=${operator}.${encodeURIComponent(value)}`);
  }
}

function redactedTitle(row) {
  const typology = String(row.title || 'Immobile').split(' in ')[0] || 'Immobile';
  const area = row.neighborhood || row.district || row.city || 'Milano';
  return [typology, area, row.size_mq ? `${row.size_mq} mq` : null].filter(Boolean).join(' · ');
}

function redactRow(row) {
  const title = redactedTitle(row);
  const raw = row.raw_result && typeof row.raw_result === 'object' ? row.raw_result : null;
  return {
    ...row,
    title,
    address: null,
    source_url: null,
    source_listing_id: null,
    raw_result: raw ? {
      ...raw,
      title,
      address: null,
      url: null,
      idealista_url: null,
      source_url: null,
      source_listing_id: null,
      listing: raw.listing && typeof raw.listing === 'object' ? {
        ...raw.listing,
        title,
        address: null,
        url: null,
        propertyCode: null,
        suggestedTexts: { ...(raw.listing.suggestedTexts || {}), title },
      } : raw.listing,
    } : raw,
  };
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
    const internal = request.query.internal === '1' || request.query.internal === 'true';
    const select = raw || internal
      ? '*'
      : 'id,created_at,run_id,rank,ranking_score,source_channel,source_url,source_listing_id,source_confidence,title,address,city,district,neighborhood,price_eur,price_by_area,size_mq,rooms,bathrooms,floor,has_lift,has_plan,status,recommended_action,fractioning_confidence,valuation_confidence,estimated_final_units,new_units_created,door_score,estimated_project_cost_eur,spread_base_eur,roi_base_pct,total_sale_value_low_eur,total_sale_value_base_eur,total_sale_value_high_eur,positive_signals,red_flags,missing_information,human_due_diligence_questions,final_unit_plan,thumbnail_url';

    const parts = [
      `run_id=eq.${encodeURIComponent(runId)}`,
      `select=${select}`,
      'order=rank.asc.nullslast,ranking_score.desc.nullslast',
      `limit=${limit}`,
      `offset=${offset}`,
    ];

    appendFilter(parts, 'recommended_action', 'eq', request.query.action);
    appendFilter(parts, 'fractioning_confidence', 'eq', request.query.fractioning_confidence);

    if (request.query.min_score) parts.push(`ranking_score=gte.${Number(request.query.min_score)}`);
    if (request.query.min_roi) parts.push(`roi_base_pct=gte.${Number(request.query.min_roi)}`);

    const rows = await supabaseGet(`triage_properties?${parts.join('&')}`);
    jsonResponse(response, { run_id: runId, count: rows.length, limit, offset, rows: internal ? rows : rows.map(redactRow) });
  } catch (error) {
    sendError(response, 500, error.message);
  }
}
