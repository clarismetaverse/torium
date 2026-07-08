import { jsonResponse, latestRunId, numberParam, sendError, supabaseGet } from './_supabase-debug.js';

function appendFilter(parts, name, operator, value) {
  if (value !== undefined && value !== null && value !== '') parts.push(`${name}=${operator}.${encodeURIComponent(value)}`);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim() || null;
}

function redactedTitle(row) {
  const typology = String(row.title || row.raw_result?.title || 'Immobile').split(' in ')[0] || 'Immobile';
  const area = row.neighborhood || row.district || row.city || row.raw_result?.listing?.neighborhood || row.raw_result?.listing?.district || 'Milano';
  return [typology, area, row.size_mq ? `${row.size_mq} mq` : null].filter(Boolean).join(' · ');
}

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !String(item).toLowerCase().includes('idealista'));
}

function extractPhotos(row) {
  const raw = row.raw_result && typeof row.raw_result === 'object' ? row.raw_result : {};
  const seen = new Set();
  const photos = [];
  const push = (item) => {
    const url = typeof item === 'string' ? item : item?.url || item?.thumbnail;
    if (!url || seen.has(url)) return;
    seen.add(url);
    photos.push({ url, tag: item?.tag && !String(item.tag).toLowerCase().includes('idealista') ? item.tag : null });
  };
  push(row.thumbnail_url);
  push(raw.thumbnail_url);
  push(raw.listing?.thumbnail);
  push(raw.source_row?.thumbnail_url);
  const imageSets = [raw.photos, raw.listing?.photos, raw.listing?.multimedia?.images, raw.source_row?.photos, raw.source_row?.raw_listing?.multimedia?.images];
  for (const images of imageSets) if (Array.isArray(images)) images.forEach(push);
  return photos.slice(0, 24);
}

function extractDescription(row) {
  const raw = row.raw_result && typeof row.raw_result === 'object' ? row.raw_result : {};
  return cleanText(raw.description || raw.listing?.description || raw.source_row?.description || raw.source_row?.raw_listing?.description || null);
}

function redactRaw(raw, title, photos, description) {
  if (!raw || typeof raw !== 'object') return raw;
  return {
    ...raw,
    title,
    address: null,
    url: null,
    idealista_url: null,
    source_url: null,
    source_channel: null,
    source_listing_id: null,
    description,
    photos,
    share_url: `/?property=${encodeURIComponent(raw.listing_index ?? title)}`,
    gpt_analysis: raw.gpt_analysis ? {
      ...raw.gpt_analysis,
      positive_signals: cleanItems(raw.gpt_analysis.positive_signals),
      red_flags: cleanItems(raw.gpt_analysis.red_flags),
      missing_information: cleanItems(raw.gpt_analysis.missing_information),
      human_due_diligence_questions: cleanItems(raw.gpt_analysis.human_due_diligence_questions),
    } : raw.gpt_analysis,
    listing: raw.listing && typeof raw.listing === 'object' ? {
      ...raw.listing,
      title,
      address: null,
      url: null,
      propertyCode: null,
      description,
      photos,
      multimedia: { images: photos },
      suggestedTexts: { ...(raw.listing.suggestedTexts || {}), title },
    } : raw.listing,
    source_row: raw.source_row && typeof raw.source_row === 'object' ? {
      ...raw.source_row,
      title,
      address: null,
      source_url: null,
      source_channel: null,
      source_listing_id: null,
      description,
      photos,
      raw_listing: raw.source_row.raw_listing && typeof raw.source_row.raw_listing === 'object' ? {
        ...raw.source_row.raw_listing,
        title,
        address: null,
        url: null,
        propertyCode: null,
        externalReference: null,
        description,
        photos,
        multimedia: { images: photos },
      } : raw.source_row.raw_listing,
    } : raw.source_row,
  };
}

function redactRow(row) {
  const title = redactedTitle(row);
  const photos = extractPhotos(row);
  const description = extractDescription(row);
  return {
    ...row,
    title,
    address: null,
    source_channel: null,
    source_url: null,
    source_listing_id: null,
    positive_signals: cleanItems(row.positive_signals),
    red_flags: cleanItems(row.red_flags),
    missing_information: cleanItems(row.missing_information),
    human_due_diligence_questions: cleanItems(row.human_due_diligence_questions),
    description,
    photos,
    share_url: `/?property=${encodeURIComponent(row.id)}`,
    raw_result: redactRaw(row.raw_result, title, photos, description),
  };
}

export default async function handler(request, response) {
  try {
    const limit = numberParam(request.query.limit, 100, 1000);
    const offset = numberParam(request.query.offset, 0, 100000);
    const searchName = request.query.search_name || 'milanoFractioningMassive';
    const runId = request.query.run_id === 'latest' || !request.query.run_id ? await latestRunId(searchName) : String(request.query.run_id);

    if (!runId) return sendError(response, 404, 'No run found');

    const raw = request.query.raw === '1' || request.query.raw === 'true';
    const internal = request.query.internal === '1' || request.query.internal === 'true';
    const select = raw || internal
      ? '*'
      : 'id,created_at,run_id,rank,ranking_score,source_channel,source_url,source_listing_id,source_confidence,title,address,city,district,neighborhood,price_eur,price_by_area,size_mq,rooms,bathrooms,floor,has_lift,has_plan,status,recommended_action,fractioning_confidence,valuation_confidence,estimated_final_units,new_units_created,door_score,estimated_project_cost_eur,spread_base_eur,roi_base_pct,total_sale_value_low_eur,total_sale_value_base_eur,total_sale_value_high_eur,positive_signals,red_flags,missing_information,human_due_diligence_questions,final_unit_plan,thumbnail_url,raw_result';

    const parts = [`run_id=eq.${encodeURIComponent(runId)}`, `select=${select}`, 'order=rank.asc.nullslast,ranking_score.desc.nullslast', `limit=${limit}`, `offset=${offset}`];
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
