function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function listingText(item) {
  const listing = item?.listing || item || {};
  return normalizeText([
    listing.title, listing.description, listing.address, listing.propertyType, listing.status,
    ...(Array.isArray(listing.features) ? listing.features : []),
    JSON.stringify(listing.raw || item?.raw_listing || {}),
  ].filter(Boolean).join(' '));
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function add(score, signals, points, key) {
  signals.push(key);
  return score + points;
}

export function evaluateVillaDataQuality(item) {
  const price = Number(item?.price_eur ?? item?.listing?.price);
  const size = Number(item?.size_mq ?? item?.listing?.size);
  const priceM2 = Number(item?.price_by_area ?? item?.listing?.priceByArea);
  const critical = [];
  const warnings = [];
  if (!Number.isFinite(price) || price <= 0) critical.push('missing_or_invalid_price');
  if (!Number.isFinite(size) || size <= 0) critical.push('missing_or_invalid_surface');
  if (Number.isFinite(size) && size > 5000) critical.push('implausible_villa_surface');
  else if (Number.isFinite(size) && size > 1500) warnings.push('very_large_estate_verify_surface');
  if (Number.isFinite(priceM2) && (priceM2 < 150 || priceM2 > 60000)) critical.push('implausible_villa_price_per_sqm');
  if (!item?.has_plan && !item?.listing?.hasPlan) warnings.push('missing_floor_plan');
  if (!String(item?.address || item?.listing?.address || '').trim()) warnings.push('missing_address');
  return {
    version: 'villa_data_quality_gate_v1',
    valid: critical.length === 0,
    status: critical.length ? 'review' : 'pass',
    critical_flags: critical,
    warning_flags: warnings,
    score: Math.max(0, 100 - critical.length * 40 - warnings.length * 5),
  };
}

export function getVillaPreTriageExclusion(item, intent = 'renovation') {
  const text = listingText(item);
  const reasons = [];
  if (hasAny(text, ['asta', 'auction', 'tribunale', 'esecuzione immobiliare'])) reasons.push('auction_excluded');
  if (hasAny(text, ['nuda proprieta', 'usufrutto', 'occupato', 'locato', 'affittato', 'tenanted'])) reasons.push('ownership_or_occupancy_excluded');
  if (hasAny(text, ['commerciale', 'ufficio', 'magazzino', 'capannone', 'industrial'])) reasons.push('non_residential_excluded');
  const typology = normalizeText(`${item?.property_type || ''} ${item?.listing?.propertyType || ''} ${text}`);
  if (!hasAny(typology, ['villa', 'house', 'casa indipendente', 'casale', 'countryhouse', 'detached', 'bifamiliare', 'rustico'])) {
    reasons.push('villa_or_house_typology_not_confirmed');
  }
  if (intent === 'renovation' && hasAny(text, ['nuova costruzione', 'newconstruction', 'is_new_true'])) reasons.push('new_construction_excluded');
  return { excluded: reasons.length > 0, reasons };
}

export function runVillaOpportunityEngine(item, intent = 'renovation') {
  const listing = item?.listing || item || {};
  const text = listingText(item);
  const size = Number(item?.size_mq ?? listing.size);
  const rooms = Number(item?.rooms ?? listing.rooms);
  const bathrooms = Number(item?.bathrooms ?? listing.bathrooms);
  const features = listing.renovation_features || item?.renovation_features || {};
  const signals = [];
  const redFlags = [];
  let score = 0;

  const renovation = listing.status === 'renew' || hasAny(text, ['da ristrutturare', 'da rifare', 'da rimodernare', 'needs renovation']);
  const garden = features.has_garden || hasAny(text, ['giardino', 'garden', 'parco privato', 'terreno']);
  const pool = features.has_pool || hasAny(text, ['piscina', 'swimming pool']);
  const terrace = features.has_terrace || hasAny(text, ['terrazzo', 'terrazza', 'terrace']);
  const garage = features.has_garage || hasAny(text, ['garage', 'box auto', 'posto auto', 'parcheggio']);
  const panoramic = features.panoramic_view || hasAny(text, ['vista lago', 'lake view', 'vista mare', 'sea view', 'vista panoramica', 'panoramic']);
  const historic = hasAny(text, ['villa d epoca', "villa d'epoca", 'dimora storica', 'casale', 'rustico', 'historic']);
  const hospitality = hasAny(text, ['b&b', 'bed and breakfast', 'agriturismo', 'ricettiv', 'casa vacanze', 'affitti brevi']);
  const plan = item?.has_plan === true || listing.hasPlan === true;

  if (intent === 'renovation') {
    if (renovation) score = add(score, signals, 26, 'needs_renovation');
    if (Number.isFinite(size) && size >= 180 && size <= 700) score = add(score, signals, 12, 'renovation_scale_180_700_sqm');
    if (garden) score = add(score, signals, 12, 'garden_or_land');
    if (panoramic) score = add(score, signals, 12, 'panoramic_or_destination_view');
    if (historic) score = add(score, signals, 8, 'character_or_historic_asset');
    if (garage) score = add(score, signals, 6, 'parking_or_garage');
    if (terrace) score = add(score, signals, 5, 'terrace');
    if (pool) score = add(score, signals, 4, 'pool_present');
  } else {
    if (garden) score = add(score, signals, 18, 'garden_or_land');
    if (pool) score = add(score, signals, 18, 'pool_present');
    if (panoramic) score = add(score, signals, 18, 'panoramic_or_destination_view');
    if (terrace) score = add(score, signals, 9, 'terrace');
    if (garage) score = add(score, signals, 7, 'parking_or_garage');
    if (hospitality) score = add(score, signals, 10, 'hospitality_use_signal');
    if (historic) score = add(score, signals, 6, 'character_or_historic_asset');
    if (Number.isFinite(rooms) && rooms >= 6) score = add(score, signals, 7, 'six_plus_rooms');
  }

  if (Number.isFinite(bathrooms) && bathrooms >= 3) score = add(score, signals, 6, 'three_plus_bathrooms');
  if (plan) score = add(score, signals, 5, 'floor_plan_available');
  if (Number.isFinite(size) && size > 1200) redFlags.push('very_large_estate_execution_complexity');
  if (!plan) redFlags.push('floor_plan_missing');
  if (intent === 'tourism' && !garden && !pool && !panoramic) redFlags.push('tourism_anchor_feature_not_detected');

  return {
    version: `villa_${intent}_opportunity_v1`,
    intent,
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals,
    red_flags: redFlags,
    features: { renovation, garden, pool, terrace, garage, panoramic, historic, hospitality, plan },
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function marketBucket(item) {
  return normalizeText(item?.neighborhood || item?.district || item?.city || item?.query_area || 'area');
}

export function attachDynamicVillaBenchmarks(candidates, comparables) {
  const validComparables = comparables.filter((item) => Number.isFinite(Number(item.price_by_area)) && Number(item.price_by_area) > 0);
  const runMedian = median(validComparables.map((item) => Number(item.price_by_area)));
  const byBucket = new Map();
  for (const item of validComparables) {
    const key = marketBucket(item);
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(Number(item.price_by_area));
  }

  return candidates.map((item) => {
    const localValues = byBucket.get(marketBucket(item)) || [];
    const useLocal = localValues.length >= 4;
    const benchmark = useLocal ? median(localValues) : runMedian;
    const asking = Number(item.price_by_area);
    const size = Number(item.size_mq);
    const discount = Number.isFinite(benchmark) && Number.isFinite(asking) && benchmark > 0
      ? ((benchmark - asking) / benchmark) * 100
      : null;
    const grossValue = Number.isFinite(benchmark) && Number.isFinite(size) ? Math.round(benchmark * size / 5000) * 5000 : null;
    const assessment = {
      version: 'dynamic_villa_asking_comparables_v1',
      benchmark_eur_mq: Number.isFinite(benchmark) ? Math.round(benchmark) : null,
      comparable_count: useLocal ? localValues.length : validComparables.length,
      scope: useLocal ? 'local_area' : 'run_area',
      asking_discount_to_benchmark_pct: Number.isFinite(discount) ? Math.round(discount * 10) / 10 : null,
      indicative_gross_value_eur: grossValue,
      confidence: useLocal && localValues.length >= 8 ? 'medium' : validComparables.length >= 8 ? 'low' : 'insufficient',
      caveat: 'Asking-price comparables only; not a transaction AVM or a renovation exit valuation.',
    };
    const gapBonus = Number.isFinite(discount) ? Math.max(-12, Math.min(18, Math.round(discount * 0.6))) : 0;
    return {
      ...item,
      door_score: Math.max(0, Math.min(100, Number(item.door_score || 0) + gapBonus)),
      renovation_features: { ...(item.renovation_features || {}), villa_assessment: assessment },
      listing: {
        ...(item.listing || {}),
        renovation_features: { ...(item.listing?.renovation_features || {}), villa_assessment: assessment },
      },
    };
  });
}

