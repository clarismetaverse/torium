import crypto from 'node:crypto';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function valuesFromObject(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap((current) => {
    if (Array.isArray(current)) return current;
    return [current];
  });
}

function deepFindValue(value, keyHints, predicate) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return null;

  for (const [key, currentValue] of Object.entries(value)) {
    const normalizedKey = normalizeText(key);
    if (keyHints.some((hint) => normalizedKey.includes(normalizeText(hint))) && predicate(currentValue)) {
      return currentValue;
    }
  }

  for (const currentValue of valuesFromObject(value)) {
    if (currentValue && typeof currentValue === 'object') {
      const nested = deepFindValue(currentValue, keyHints, predicate);
      if (nested !== null && nested !== undefined) return nested;
    }
  }

  return null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return null;

  const cleaned = value
    .replace(/€/g, '')
    .replace(/mq/g, '')
    .replace(/m²/g, '')
    .replace(/m2/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();

  const match = cleaned.match(/\d+(\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function deepFindNumber(raw, hints) {
  const found = deepFindValue(raw, hints, (value) => parseNumber(value) !== null);
  return parseNumber(found);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function deepFindString(raw, hints) {
  const found = deepFindValue(raw, hints, (value) => typeof value === 'string' && value.trim().length > 0);
  return firstString(found);
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = normalizeText(value);
      if (['true', 'yes', 'si', 'sì', '1'].includes(normalized)) return true;
      if (['false', 'no', '0'].includes(normalized)) return false;
    }
  }
  return null;
}

function deepFindBoolean(raw, hints) {
  const found = deepFindValue(raw, hints, (value) => typeof value === 'boolean' || typeof value === 'string');
  return firstBoolean(found);
}

function getNested(raw, path) {
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), raw);
}

function getFirstPath(raw, paths) {
  return firstDefined(...paths.map((path) => getNested(raw, path)));
}

function extractImage(raw) {
  const direct = firstString(raw.thumbnail, raw.thumbnailUrl, raw.image, raw.imageUrl, raw.coverImage);
  if (direct) return direct;

  const images = raw.images || raw.multimedia?.images || raw.realEstate?.properties?.[0]?.multimedia?.photos;
  if (!Array.isArray(images)) return null;

  const first = images[0];
  return firstString(first?.url, first?.src, first?.medium, first?.large, first?.small, first);
}

function extractHasPlan(raw) {
  const direct = firstBoolean(raw.hasPlan, raw.plan, raw.floorPlan, raw.floorplan, raw.planimetry);
  if (direct !== null) return direct;

  const images = raw.images || raw.multimedia?.images || raw.realEstate?.properties?.[0]?.multimedia?.photos;
  if (!Array.isArray(images)) return null;

  return images.some((image) => normalizeText(`${image?.tag || ''} ${image?.type || ''} ${image?.label || ''}`).includes('plan'));
}

function buildFingerprint(parts) {
  const payload = parts.filter(Boolean).map((part) => normalizeText(part)).join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function normalizeCondition(raw) {
  const value = firstString(raw.propertyCondition, raw.condition, raw.status, deepFindString(raw, ['condition', 'stato']));
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (['toberenovated', 'to be renovated', 'daristrutturare', 'da ristrutturare', 'renew', 'da rifare', 'da rimodernare'].some((term) => normalized.includes(normalizeText(term)))) return 'renew';
  if (['newconstruction', 'nuova costruzione', 'new'].some((term) => normalized.includes(normalizeText(term)))) return 'newconstruction';
  if (['excellent', 'ottimo', 'ristrutturato'].some((term) => normalized.includes(normalizeText(term)))) return 'excellent';
  if (['good', 'buono', 'abitabile'].some((term) => normalized.includes(normalizeText(term)))) return 'good';
  return value;
}

function normalizeFeatureArray(raw) {
  const direct = raw.features;
  const candidates = [];

  if (Array.isArray(direct)) candidates.push(...direct);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) candidates.push(...Object.values(direct));

  const extra = [
    raw.featureList,
    raw.characteristics,
    raw.amenities,
    raw.tags,
    getFirstPath(raw, ['realEstate.properties.0.featureList']),
  ];

  for (const value of extra) {
    if (Array.isArray(value)) candidates.push(...value);
  }

  return [...new Set(candidates.map((feature) => {
    if (typeof feature === 'string') return feature.trim();
    if (feature && typeof feature === 'object') return firstString(feature.name, feature.label, feature.text, feature.value, feature.title);
    return null;
  }).filter(Boolean))];
}

function featureIncludes(features, terms) {
  const text = normalizeText(features.join(' '));
  return terms.some((term) => text.includes(normalizeText(term)));
}

function categorizeFeatures(features) {
  const ignoredTerms = ['fibra ottica', 'videocitofono', 'porta blindata', 'impianto tv', 'cancello elettrico', 'impianto di allarme', 'allarme'];
  const ignored_features = features.filter((feature) => featureIncludes([feature], ignoredTerms));
  const risk_features = features.filter((feature) => featureIncludes([feature], ['mansarda', 'sottotetto', 'seminterrato', 'interrato', 'piano terra', 'arredato', 'parzialmente arredato']));

  const renovation_features = {
    has_balcony: featureIncludes(features, ['balcone']),
    has_terrace: featureIncludes(features, ['terrazzo']),
    has_cellar: featureIncludes(features, ['cantina']),
    double_exposure: featureIncludes(features, ['esposizione doppia', 'doppia esposizione']),
    external_exposure: featureIncludes(features, ['esposizione esterna']),
    attic_signal: featureIncludes(features, ['mansarda', 'sottotetto']),
    furnished_signal: featureIncludes(features, ['arredato', 'parzialmente arredato']),
    accessibility_signal: featureIncludes(features, ['accesso per disabili']),
  };

  return { renovation_features, ignored_features, risk_features };
}

function buildQualityFlags({ condition, isNew, propertyType, floor, features, priceByArea }) {
  const flags = [];
  const normalizedFloor = normalizeText(floor);
  const normalizedPropertyType = normalizeText(propertyType);

  if (isNew === true) flags.push('is_new_true');
  if (['excellent', 'good', 'newconstruction'].includes(condition)) flags.push(`condition_${condition}_low_spread`);
  if (condition === 'renew') flags.push('condition_renew_spread_signal');
  if (normalizedPropertyType.includes('villa')) flags.push('villa_typology_risk');
  if (normalizedFloor.includes('interrato') || normalizedFloor.includes('-1') || normalizedFloor.includes('s1') || normalizedFloor.includes('s2')) flags.push('basement_or_interrato_risk');
  if (featureIncludes(features, ['mansarda', 'sottotetto'])) flags.push('attic_or_mansarda_check');
  if (featureIncludes(features, ['arredato', 'parzialmente arredato'])) flags.push('furnished_low_spread_check');
  if (priceByArea && priceByArea > 6500) flags.push('high_price_m2_low_spread_risk');

  return [...new Set(flags)];
}

export function listingMatchesAnyArea(listing, areas) {
  if (!Array.isArray(areas) || areas.length === 0) return true;
  const text = normalizeText([
    listing?.address,
    listing?.city,
    listing?.district,
    listing?.neighborhood,
    listing?.area_label,
    listing?.title,
    listing?.description,
  ].filter(Boolean).join(' '));
  return areas.some((area) => text.includes(normalizeText(area)));
}

export function normalizeSourceListing(raw, context = {}) {
  const sourceChannel = context.source_channel || context.sourceChannel || 'other';
  const sourcePlatformName = context.source_platform_name || context.sourcePlatformName || sourceChannel;

  const url = firstString(
    raw.url,
    raw.link,
    raw.detailUrl,
    raw.seoUrl,
    raw.adUrl,
    raw.permalink,
    getFirstPath(raw, ['realEstate.url', 'realEstate.seoUrl'])
  );

  const sourceListingId = firstString(
    raw.propertyCode,
    raw.id,
    raw.uuid,
    raw.adId,
    raw.listingId,
    raw.estateId,
    getFirstPath(raw, ['realEstate.id', 'realEstate.realEstateId'])
  );

  const title = firstString(
    raw.title,
    raw.subject,
    raw.name,
    raw.suggestedTexts?.title,
    getFirstPath(raw, ['realEstate.title', 'realEstate.properties.0.title']),
    deepFindString(raw, ['title', 'titolo'])
  );

  const address = firstString(
    raw.address,
    raw.street,
    raw.location,
    raw.formattedAddress,
    getFirstPath(raw, ['realEstate.properties.0.location.microzone.name']),
    deepFindString(raw, ['address', 'indirizzo'])
  );

  const city = firstString(raw.municipality, raw.city, raw.comune, context.query_municipality, context.municipality);
  const district = firstString(raw.district, raw.zone, raw.zona, getFirstPath(raw, ['location.zone', 'realEstate.properties.0.location.zone']));
  const neighborhood = firstString(raw.neighborhood, raw.microzone, raw.quartiere, getFirstPath(raw, ['location.microzone', 'realEstate.properties.0.location.microzone.name']));
  const areaLabel = firstString(raw.area, district, neighborhood);

  const price = firstNumber(
    raw.price,
    raw.priceValue,
    raw.price_value,
    raw.priceInfo?.price,
    raw.price?.value,
    getFirstPath(raw, ['realEstate.price.value', 'realEstate.properties.0.price.value']),
    deepFindNumber(raw, ['price', 'prezzo'])
  );

  const size = firstNumber(
    raw.size,
    raw.surface,
    raw.surfaceMq,
    raw.surface_mq,
    raw.features?.surface,
    getFirstPath(raw, ['realEstate.properties.0.surface', 'realEstate.properties.0.featureList.0.value']),
    deepFindNumber(raw, ['surface', 'size', 'superficie', 'mq', 'm2'])
  );

  const priceByArea = firstNumber(
    raw.priceByArea,
    raw.pricePerSqm,
    raw.pricePerSquareMeter,
    raw.price_m2,
    raw.priceInfo?.pricePerSquareMeter,
    deepFindNumber(raw, ['pricebyarea', 'prezzomq', 'prezzo mq', 'priceper'])
  ) || (price && size ? Math.round(price / size) : null);

  const rooms = firstNumber(raw.rooms, raw.locali, raw.roomsNumber, raw.features?.rooms, deepFindNumber(raw, ['rooms', 'locali']));
  const bathrooms = firstNumber(raw.bathrooms, raw.bagni, raw.features?.bathrooms, deepFindNumber(raw, ['bathrooms', 'bagni']));
  const floor = firstString(raw.floor, raw.floorNumber, raw.features?.floor, deepFindString(raw, ['floor', 'piano']));

  const hasLift = firstBoolean(raw.hasLift, raw.lift, raw.elevator, raw.ascensore, deepFindBoolean(raw, ['lift', 'elevator', 'ascensore']));
  const hasPlan = extractHasPlan(raw);

  const latitude = firstNumber(raw.latitude, raw.lat, raw.location?.latitude, raw.location?.lat, getFirstPath(raw, ['realEstate.properties.0.location.latitude']));
  const longitude = firstNumber(raw.longitude, raw.lng, raw.lon, raw.location?.longitude, raw.location?.lng, getFirstPath(raw, ['realEstate.properties.0.location.longitude']));
  const thumbnail = extractImage(raw);

  const description = firstString(raw.description, raw.caption, raw.text, raw.descriptionText, deepFindString(raw, ['description', 'descrizione']));
  const propertyType = firstString(raw.propertyType, raw.type, raw.category, raw.typology, deepFindString(raw, ['propertytype', 'typology', 'tipologia']));
  const condition = normalizeCondition(raw);
  const features = normalizeFeatureArray(raw);
  const isNew = firstBoolean(raw.isNew, raw.new, raw.newConstruction, raw.is_new, raw.is_new_construction);
  const { renovation_features, ignored_features, risk_features } = categorizeFeatures(features);
  const quality_flags = buildQualityFlags({ condition, isNew, propertyType, floor, features, priceByArea });

  const sourceFingerprint = buildFingerprint([sourceChannel, sourceListingId, url, title, address, price, size]);
  const sourceKey = sourceListingId || url || sourceFingerprint;

  const listing = {
    propertyCode: sourceListingId,
    url,
    source_channel: sourceChannel,
    source_platform_name: sourcePlatformName,
    source_key: sourceKey,
    source_fingerprint: sourceFingerprint,
    suggestedTexts: { title },
    title,
    address,
    municipality: city,
    city,
    district,
    neighborhood,
    area_label: areaLabel,
    query_area: context.query_area || context.area || null,
    price,
    priceByArea,
    size,
    rooms,
    bathrooms,
    floor,
    hasLift,
    hasPlan,
    status: condition,
    propertyType,
    detailedType: {
      typology: propertyType,
      subTypology: firstString(raw.subTypology, raw.subtype, raw.subType),
    },
    latitude,
    longitude,
    thumbnail,
    description,
    features,
    isNew,
    renovation_features,
    ignored_features,
    risk_features,
    quality_flags,
    raw,
  };

  return {
    source_channel: sourceChannel,
    source_platform_name: sourcePlatformName,
    source_url: url,
    source_listing_id: sourceListingId,
    source_fingerprint: sourceFingerprint,
    source_key: sourceKey,
    query_name: context.query_name || null,
    query_area: context.query_area || context.area || null,
    query_municipality: context.query_municipality || context.municipality || null,
    query_province: context.query_province || context.province || null,
    query_payload: context.query_payload || {},
    title,
    address,
    city,
    district,
    neighborhood,
    area_label: areaLabel,
    price_eur: price,
    price_by_area: priceByArea,
    size_mq: size,
    rooms,
    bathrooms,
    floor,
    property_condition: condition,
    property_type: propertyType,
    has_lift: hasLift,
    has_plan: hasPlan,
    features,
    is_new: isNew,
    renovation_features,
    ignored_features,
    risk_features,
    quality_flags,
    latitude,
    longitude,
    thumbnail_url: thumbnail,
    raw_listing: raw,
    listing,
  };
}
