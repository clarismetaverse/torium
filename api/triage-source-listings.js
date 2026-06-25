import { boolParam, jsonResponse, latestRunId, numberParam, sendError, supabaseGet } from './_supabase-debug.js';

const AREA_ALIASES = {
  'corso-san-gottardo': ['corso san gottardo', 'san gottardo', 'navigli', 'porta genova'],
  nolo: ['nolo', 'no lo', 'viale monza', 'pasteur', 'turro', 'rovereto', 'precotto'],
  bovisa: ['bovisa', 'dergano-bovisa'],
  dergano: ['dergano', 'maciachini'],
  lambrate: ['lambrate', 'citta studi', 'città studi', 'rubattino', 'ortica'],
  corvetto: ['corvetto', 'porto di mare', 'rogoredo', 'brenta'],
  barona: ['barona', 'famagosta', 'romolo'],
  giambellino: ['giambellino', 'lorenteggio', 'bande nere'],
};

function appendFilter(parts, name, operator, value) {
  if (value !== undefined && value !== null && value !== '') {
    parts.push(`${name}=${operator}.${encodeURIComponent(value)}`);
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areaAliases(area) {
  const normalized = normalizeText(area);
  return AREA_ALIASES[area] || AREA_ALIASES[normalized.replaceAll(' ', '-')] || [normalized];
}

function rowAreaText(row) {
  return normalizeText([
    row.title,
    row.address,
    row.city,
    row.district,
    row.neighborhood,
    row.area_label,
    row.raw_listing?.title,
    row.raw_listing?.address,
    row.raw_listing?.location,
    row.raw_listing?.district,
    row.raw_listing?.neighborhood,
    row.raw_listing?.area,
  ].filter(Boolean).join(' '));
}

function matchesQueryArea(row) {
  if (!row.query_area) return null;
  const text = rowAreaText(row);
  const aliases = areaAliases(row.query_area).map(normalizeText);
  return aliases.some((alias) => alias && text.includes(alias));
}

function canonicalKey(row) {
  return row.canonical_source_key || row.source_url || row.source_listing_id || row.source_fingerprint || row.source_key || String(row.id);
}

function scoreForCanonicalPick(row) {
  let score = Number(row.door_score || 0);
  if (row.pre_triage_excluded) score -= 1000;
  if (matchesQueryArea(row)) score += 30;
  if (row.property_condition === 'renew') score += 20;
  if (row.price_by_area) score += Math.max(0, 10 - Math.floor(row.price_by_area / 1000));
  return score;
}

function dedupeRows(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = canonicalKey(row);
    const current = byKey.get(key);
    if (!current || scoreForCanonicalPick(row) > scoreForCanonicalPick(current)) {
      byKey.set(key, row);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => (Number(b.door_score || 0) - Number(a.door_score || 0)) || (Number(a.price_by_area || 999999) - Number(b.price_by_area || 999999)));
}

function enrichRows(rows) {
  return rows.map((row) => ({
    ...row,
    area_match: matchesQueryArea(row),
    canonical_key: canonicalKey(row),
  }));
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
    const deduped = request.query.deduped === '1' || request.query.deduped === 'true';
    const areaMatchFilter = boolParam(request.query.area_match);
    const fetchLimit = deduped || areaMatchFilter !== null ? 1000 : limit;
    const fetchOffset = deduped || areaMatchFilter !== null ? 0 : offset;

    const select = raw || areaMatchFilter !== null
      ? '*'
      : 'id,created_at,run_id,source_channel,source_url,source_listing_id,source_fingerprint,canonical_source_key,query_name,query_area,title,address,city,district,neighborhood,area_label,price_eur,price_by_area,size_mq,rooms,bathrooms,floor,property_condition,property_type,has_lift,has_plan,features,is_new,renovation_features,ignored_features,risk_features,quality_flags,pre_triage_excluded,pre_triage_exclusion_reason,door_score,estimated_final_units,new_units_created,estimated_project_cost_eur,thumbnail_url';

    const parts = [
      `run_id=eq.${encodeURIComponent(runId)}`,
      `select=${select}`,
      'order=door_score.desc.nullslast,price_by_area.asc.nullslast',
      `limit=${fetchLimit}`,
      `offset=${fetchOffset}`,
    ];

    appendFilter(parts, 'query_area', 'eq', request.query.query_area);
    appendFilter(parts, 'property_condition', 'eq', request.query.condition);

    const eligible = boolParam(request.query.eligible);
    if (eligible === true) parts.push('pre_triage_excluded=eq.false');
    if (eligible === false) parts.push('pre_triage_excluded=eq.true');

    if (request.query.min_score) parts.push(`door_score=gte.${Number(request.query.min_score)}`);
    if (request.query.min_size) parts.push(`size_mq=gte.${Number(request.query.min_size)}`);
    if (request.query.max_price_m2) parts.push(`price_by_area=lte.${Number(request.query.max_price_m2)}`);

    let rows = enrichRows(await supabaseGet(`triage_source_listings?${parts.join('&')}`));
    const rawCount = rows.length;

    if (areaMatchFilter !== null) {
      rows = rows.filter((row) => row.area_match === areaMatchFilter);
    }

    if (deduped) {
      rows = dedupeRows(rows);
    }

    const pagedRows = deduped || areaMatchFilter !== null ? rows.slice(offset, offset + limit) : rows;

    jsonResponse(response, {
      run_id: runId,
      mode: deduped ? 'deduped' : 'raw',
      raw_count_loaded: rawCount,
      count: pagedRows.length,
      total_after_filters: rows.length,
      limit,
      offset,
      rows: pagedRows,
    });
  } catch (error) {
    sendError(response, 500, error.message);
  }
}
