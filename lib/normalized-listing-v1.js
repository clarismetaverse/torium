import crypto from 'node:crypto';
import { normalizeItalianFloor } from './italian-localization.js';
import { canonicalMilanAreaLabel } from './milan-area-taxonomy.js';

export const NORMALIZED_LISTING_SCHEMA_VERSION = 'normalized_listing_v1';
export const SOURCE_ADAPTER_VERSIONS = Object.freeze({
  idealista: 'idealista_v1',
  immobiliare: 'immobiliare_structured_v1',
});

const SOURCE_HOSTS = Object.freeze({
  idealista: ['idealista.it'],
  immobiliare: ['immobiliare.it'],
});

function cleanString(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value, { integer = false } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return integer ? Math.round(value) : value;
  }
  if (typeof value !== 'string') return null;
  const compact = value.replace(/\s/g, '').replace(/[€$£]/g, '');
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact.replace(',', '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return integer ? Math.round(parsed) : parsed;
}

function positiveNumber(value, options) {
  const parsed = parseNumber(value, options);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(cleanString).filter(Boolean))];
}

function stableHash(parts) {
  const payload = parts.map((part) => cleanString(part) || '').join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function allowedSourceUrl(value, sourceChannel) {
  const candidate = cleanString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    const allowed = SOURCE_HOSTS[sourceChannel] || [];
    if (!allowed.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function sourceObservationKey(sourceChannel, sourceListingId, canonicalUrl, fingerprintParts) {
  if (sourceListingId) return `${sourceChannel}:id:${sourceListingId}`;
  if (canonicalUrl) return `${sourceChannel}:url:${canonicalUrl}`;
  return `${sourceChannel}:fingerprint:${stableHash(fingerprintParts)}`;
}

function normalizeCondition(value) {
  const raw = cleanString(value);
  const normalized = normalizeText(raw);
  if (!normalized) return null;
  if (['da ristrutturare', 'da rifare', 'da rimodernare', 'renew', 'to be renovated'].some((term) => normalized.includes(normalizeText(term)))) return 'renew';
  if (['nuova costruzione', 'new construction', 'newconstruction'].some((term) => normalized.includes(normalizeText(term)))) return 'newconstruction';
  if (['ristrutturato', 'ottimo', 'excellent'].some((term) => normalized.includes(normalizeText(term)))) return 'excellent';
  if (['buono', 'abitabile', 'good'].some((term) => normalized.includes(normalizeText(term)))) return 'good';
  return raw;
}

function splitStreet(value) {
  const formatted = cleanString(value);
  if (!formatted) return { street: null, house_number: null, formatted: null };
  const match = formatted.match(/^(.*?),\s*([0-9]+[a-zA-Z]?(?:\/[a-zA-Z0-9]+)?)$/);
  if (!match) return { street: formatted, house_number: null, formatted };
  return { street: match[1].trim(), house_number: match[2].trim(), formatted };
}

function idealistaAddress(value) {
  const original = cleanString(value);
  if (!original) return splitStreet(null);
  const withoutTypology = original.replace(
    /^.*?\s+in\s+(?=(?:via|viale|piazza|piazzale|corso|ripa|largo|alzaia|foro)\b)/i,
    '',
  );
  const parts = withoutTypology.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^(?:\d+[a-z]?(?:\s*\/\s*[a-z0-9]+)?|s\.?\s*n\.?\s*c\.?)$/i.test(parts[1])) {
    return splitStreet(`${parts[0]}, ${parts[1].replace(/\s*\/\s*/g, '/')}`);
  }
  return splitStreet(parts[0] || withoutTypology);
}

function locationPrecision(rawValue, hasCoordinates) {
  const value = normalizeText(rawValue);
  if (value.includes('exact')) return 'exact';
  if (value.includes('approx')) return 'approximate';
  return hasCoordinates ? 'approximate' : 'unknown';
}

function buildDisplayTitle({ sourceTitle, propertyType, address, microzone, size }) {
  const genericTitles = new Set(['appartamento', 'loft', 'attico', 'villa', 'casa']);
  if (sourceTitle && !genericTitles.has(normalizeText(sourceTitle))) return sourceTitle;
  if (propertyType && address) return `${propertyType} in ${address}`;
  const parts = [propertyType, microzone, size ? `${size} m²` : null].filter(Boolean);
  return parts.join(' · ') || sourceTitle || 'Immobile';
}

function mediaObject(item, sourceChannel) {
  if (!item || typeof item !== 'object') return null;
  const url = allowedMediaUrl(item.hd || item.url || item.src || item.sd, sourceChannel);
  if (!url) return null;
  return {
    url,
    label: cleanString(item.label || item.tag || item.type),
    source_channel: sourceChannel,
    resolution: item.hd ? 'hd' : item.sd ? 'sd' : null,
  };
}

function allowedMediaUrl(value, sourceChannel) {
  const candidate = cleanString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    const allowed = sourceChannel === 'idealista'
      ? hostname.endsWith('.idealista.it') || hostname === 'idealista.it'
      : hostname.endsWith('.im-cdn.it') || hostname === 'im-cdn.it';
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function askingPrice({ rawAmount, displayValue, hidden, pricePerSqm }) {
  const display = cleanString(displayValue);
  const normalizedDisplay = normalizeText(display);
  let status = 'missing';
  let amount = positiveNumber(rawAmount, { integer: true });

  if (normalizedDisplay.includes('su richiesta') || normalizedDisplay.includes('on request')) {
    status = 'on_request';
    amount = null;
  } else if (hidden === true) {
    status = 'hidden';
    amount = null;
  } else if (amount !== null) {
    status = 'known';
  } else if (display) {
    amount = positiveNumber(display, { integer: true });
    status = amount === null ? 'parse_error' : 'known';
  }

  return {
    status,
    amount_eur: status === 'known' ? amount : null,
    raw_text: display,
    price_per_sqm_eur: status === 'known' ? positiveNumber(pricePerSqm, { integer: true }) : null,
    observed_at: null,
  };
}

function baseQuality({ sourceListingId, canonicalUrl, price, surface, canonicalZone, city, schemaIssues = [] }) {
  const blocking = schemaIssues.map((issue) => `adapter_schema:${issue}`);
  const warnings = [];
  if (!sourceListingId && !canonicalUrl) blocking.push('missing_stable_source_identity');
  if (price.status !== 'known') blocking.push(`asking_price_${price.status}`);
  if (!surface) blocking.push('missing_or_invalid_surface');
  if (!city) warnings.push('missing_city');
  if (!canonicalZone) warnings.push('missing_canonical_zone');
  return {
    status: blocking.length ? 'blocked' : warnings.length ? 'review' : 'pass',
    blocking_reasons: blocking,
    warnings,
  };
}

function normalizedFeatures(rawFeatures) {
  if (Array.isArray(rawFeatures)) return uniqueStrings(rawFeatures.map((item) => {
    if (typeof item === 'string') return item;
    return item?.name || item?.label || item?.value || null;
  }));
  if (rawFeatures && typeof rawFeatures === 'object') {
    return uniqueStrings(Object.entries(rawFeatures)
      .filter(([, value]) => value === true)
      .map(([key]) => key));
  }
  return [];
}

function buildFlags({ isAuction, isNewConstruction, features, condition }) {
  const text = normalizeText(features.join(' '));
  return uniqueStrings([
    isAuction === true ? 'auction' : null,
    isNewConstruction === true || condition === 'newconstruction' ? 'new_construction' : null,
    text.includes('nuda proprieta') ? 'bare_ownership' : null,
    text.includes('occupato') ? 'occupied' : null,
    text.includes('mansarda') || text.includes('sottotetto') ? 'attic' : null,
    text.includes('seminterrato') || text.includes('interrato') ? 'basement' : null,
  ]);
}

function isoTimestamp(value) {
  const candidate = cleanString(value);
  if (!candidate) return null;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeIdealistaListingV1(raw, context = {}) {
  const sourceChannel = 'idealista';
  const sourceListingId = cleanString(raw?.propertyCode || raw?.id);
  const canonicalUrl = allowedSourceUrl(raw?.url, sourceChannel);
  const sourceTitle = cleanString(raw?.suggestedTexts?.title || raw?.title);
  const address = idealistaAddress(raw?.address);
  const observedCity = cleanString(raw?.municipality);
  const city = observedCity || cleanString(context.query_municipality || context.municipality);
  const macrozone = cleanString(raw?.district);
  const microzone = cleanString(raw?.neighborhood);
  const canonicalZone = canonicalMilanAreaLabel({
    neighborhood: microzone,
    district: macrozone,
    area: microzone || macrozone,
    query_area: context.query_area,
    title: sourceTitle,
    address: address.formatted,
  });
  const latitude = parseNumber(raw?.latitude);
  const longitude = parseNumber(raw?.longitude);
  const surface = positiveNumber(raw?.size);
  const price = askingPrice({
    rawAmount: raw?.price,
    displayValue: raw?.priceInfo?.price?.amount || raw?.price,
    hidden: false,
    pricePerSqm: raw?.priceByArea,
  });
  const rawImages = Array.isArray(raw?.multimedia?.images) ? raw.multimedia.images : [];
  const images = rawImages
    .filter((item) => normalizeText(item?.tag) !== 'plan')
    .map((item) => mediaObject(item, sourceChannel))
    .filter(Boolean);
  const floorPlans = rawImages
    .filter((item) => normalizeText(item?.tag) === 'plan')
    .map((item) => mediaObject(item, sourceChannel))
    .filter(Boolean);
  const thumbnailUrl = allowedMediaUrl(raw?.thumbnail, sourceChannel) || images[0]?.url || null;
  const condition = normalizeCondition(raw?.status);
  const propertyType = cleanString(raw?.propertyType || raw?.detailedType?.typology);
  const features = normalizedFeatures(raw?.features);
  const isNewConstruction = raw?.newDevelopment === true || raw?.newProperty === true || condition === 'newconstruction';
  const schemaIssues = [];
  if (!raw || typeof raw !== 'object') schemaIssues.push('payload_not_object');
  if (!('propertyCode' in (raw || {})) && !('id' in (raw || {}))) schemaIssues.push('missing_identity_field');
  const quality = baseQuality({ sourceListingId, canonicalUrl, price, surface, canonicalZone, city, schemaIssues });
  const displayTitle = buildDisplayTitle({ sourceTitle, propertyType, address: address.formatted, microzone, size: surface });

  return {
    schema_version: NORMALIZED_LISTING_SCHEMA_VERSION,
    adapter_version: SOURCE_ADAPTER_VERSIONS.idealista,
    source_channel: sourceChannel,
    source_listing_id: sourceListingId,
    source_observation_key: sourceObservationKey(sourceChannel, sourceListingId, canonicalUrl, [sourceTitle, address.formatted, price.amount_eur, surface]),
    canonical_url: canonicalUrl,
    observed_at: null,
    raw_reference: null,
    source_title: sourceTitle,
    display_title: displayTitle,
    property_type: propertyType,
    property_subtype: cleanString(raw?.detailedType?.subTypology),
    address,
    location: {
      city,
      city_is_inferred: !observedCity,
      source_macrozone: macrozone,
      source_microzone: microzone,
      canonical_zone_id: canonicalZone?.id || null,
      canonical_zone_name: canonicalZone?.name || null,
      zone_confidence: canonicalZone ? (microzone ? 0.95 : 0.8) : null,
      latitude,
      longitude,
      precision: locationPrecision(raw?.showAddress === true ? 'exact' : 'approximate', latitude !== null && longitude !== null),
    },
    asking_price: price,
    surface: { value_sqm: surface, kind: 'unspecified' },
    rooms: positiveNumber(raw?.rooms, { integer: true }),
    bathrooms: positiveNumber(raw?.bathrooms, { integer: true }),
    floor: { normalized: normalizeItalianFloor(cleanString(raw?.floor)), raw: cleanString(raw?.floor) },
    has_lift: typeof raw?.hasLift === 'boolean' ? raw.hasLift : null,
    condition,
    is_new_construction: isNewConstruction,
    media: {
      images,
      floor_plans: floorPlans,
      thumbnail_url: thumbnailUrl,
      has_floor_plan: floorPlans.length > 0,
    },
    features,
    flags: buildFlags({ isAuction: raw?.isAuction, isNewConstruction, features, condition }),
    field_provenance: {
      source_listing_id: 'propertyCode', canonical_url: 'url', source_title: 'suggestedTexts.title',
      address: 'address', city: 'municipality', source_macrozone: 'district', source_microzone: 'neighborhood',
      asking_price: 'price', surface: 'size', media: 'multimedia.images',
    },
    adapter_schema: { valid: schemaIssues.length === 0, issues: schemaIssues },
    quality,
  };
}

export function normalizeImmobiliareListingV1(raw, context = {}) {
  const sourceChannel = 'immobiliare';
  const sourceListingId = cleanString(raw?.id || raw?.uuid);
  const canonicalUrl = allowedSourceUrl(
    raw?.url || (sourceListingId ? `https://www.immobiliare.it/annunci/${encodeURIComponent(sourceListingId)}/` : null),
    sourceChannel,
  );
  const sourceTitle = cleanString(raw?.title);
  const address = splitStreet(raw?.geography?.street);
  const observedCity = cleanString(raw?.geography?.municipality?.name);
  const city = observedCity || cleanString(context.query_municipality || context.municipality);
  const macrozone = cleanString(raw?.geography?.macrozone?.name || raw?.analytics?.macrozone);
  const microzone = cleanString(raw?.geography?.microzone?.name || raw?.analytics?.microzone);
  const canonicalZone = canonicalMilanAreaLabel({
    neighborhood: microzone,
    district: macrozone,
    area: microzone || macrozone,
    query_area: context.query_area,
    title: sourceTitle,
    address: address.formatted,
  });
  const latitude = parseNumber(raw?.geography?.geolocation?.latitude);
  const longitude = parseNumber(raw?.geography?.geolocation?.longitude);
  const surface = positiveNumber(raw?.topology?.surface?.size);
  const price = askingPrice({
    rawAmount: raw?.price?.raw,
    displayValue: raw?.price?.value,
    hidden: raw?.price?.isHidden === true,
    pricePerSqm: raw?.price?.pricePerSquareMeter,
  });
  const images = (Array.isArray(raw?.media?.images) ? raw.media.images : [])
    .map((item) => mediaObject(item, sourceChannel)).filter(Boolean);
  const floorPlans = (Array.isArray(raw?.media?.floorPlans) ? raw.media.floorPlans : [])
    .map((item) => mediaObject(item, sourceChannel)).filter(Boolean);
  const condition = normalizeCondition(raw?.analytics?.propertyStatus);
  const propertyType = cleanString(raw?.topology?.typology?.name || raw?.topology?.category?.name || raw?.title);
  const features = normalizedFeatures(raw?.analytics?.otherFeatures);
  const isNewConstruction = condition === 'newconstruction';
  const schemaIssues = ['analytics', 'geography', 'media', 'price', 'topology']
    .filter((key) => !raw?.[key] || typeof raw[key] !== 'object');
  const quality = baseQuality({ sourceListingId, canonicalUrl, price, surface, canonicalZone, city, schemaIssues });
  const displayTitle = buildDisplayTitle({ sourceTitle, propertyType, address: address.formatted, microzone, size: surface });

  return {
    schema_version: NORMALIZED_LISTING_SCHEMA_VERSION,
    adapter_version: SOURCE_ADAPTER_VERSIONS.immobiliare,
    source_channel: sourceChannel,
    source_listing_id: sourceListingId,
    source_observation_key: sourceObservationKey(sourceChannel, sourceListingId, canonicalUrl, [sourceTitle, address.formatted, price.amount_eur, surface]),
    canonical_url: canonicalUrl,
    observed_at: isoTimestamp(raw?.lastModified || raw?.creationDate),
    raw_reference: null,
    source_title: sourceTitle,
    display_title: displayTitle,
    property_type: propertyType,
    property_subtype: cleanString(raw?.topology?.typology?.category),
    address,
    location: {
      city,
      city_is_inferred: !observedCity,
      source_macrozone: macrozone,
      source_microzone: microzone,
      canonical_zone_id: canonicalZone?.id || null,
      canonical_zone_name: canonicalZone?.name || null,
      zone_confidence: canonicalZone ? (microzone ? 0.95 : 0.8) : null,
      latitude,
      longitude,
      precision: locationPrecision(raw?.geography?.geolocation?.visibilityType, latitude !== null && longitude !== null),
    },
    asking_price: price,
    surface: { value_sqm: surface, kind: 'commercial' },
    rooms: positiveNumber(raw?.topology?.rooms, { integer: true }),
    bathrooms: positiveNumber(raw?.topology?.bathrooms, { integer: true }),
    floor: { normalized: normalizeItalianFloor(cleanString(raw?.topology?.floor)), raw: cleanString(raw?.topology?.floor) },
    has_lift: typeof raw?.topology?.lift === 'boolean' ? raw.topology.lift : null,
    condition,
    is_new_construction: isNewConstruction,
    media: {
      images,
      floor_plans: floorPlans,
      thumbnail_url: images[0]?.url || null,
      has_floor_plan: floorPlans.length > 0,
    },
    features,
    flags: buildFlags({ isAuction: raw?.contract?.isAuction, isNewConstruction, features, condition }),
    field_provenance: {
      source_listing_id: 'id', canonical_url: 'derived:id', source_title: 'title',
      address: 'geography.street', city: 'geography.municipality.name',
      source_macrozone: 'geography.macrozone.name|analytics.macrozone',
      source_microzone: 'geography.microzone.name|analytics.microzone',
      asking_price: 'price', surface: 'topology.surface.size', media: 'media.images|media.floorPlans',
    },
    adapter_schema: { valid: schemaIssues.length === 0, issues: schemaIssues },
    quality,
  };
}

export function normalizeListingV1(raw, context = {}) {
  const sourceChannel = cleanString(context.source_channel || context.sourceChannel)?.toLowerCase();
  if (sourceChannel === 'idealista') return normalizeIdealistaListingV1(raw, context);
  if (sourceChannel === 'immobiliare') return normalizeImmobiliareListingV1(raw, context);
  throw new Error(`Unsupported NormalizedListingV1 source: ${sourceChannel || 'missing'}`);
}

