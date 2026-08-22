import { normalizeItalianFloor } from './italian-localization.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bs\.?\s*n\.?\s*c\.?\b/g, ' snc ')
    .replace(/\b(via|viale|piazza|piazzale|corso|largo|ripa|alzaia)\s+privata\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function relativeDelta(left, right) {
  const a = finiteNumber(left);
  const b = finiteNumber(right);
  if (a === null || b === null || a <= 0 || b <= 0) return null;
  return Math.abs(a - b) / Math.max(a, b);
}

function coordinates(listing) {
  return {
    latitude: finiteNumber(listing?.location?.latitude ?? listing?.latitude),
    longitude: finiteNumber(listing?.location?.longitude ?? listing?.longitude),
  };
}

function distanceMeters(left, right) {
  const a = coordinates(left);
  const b = coordinates(right);
  if ([a.latitude, a.longitude, b.latitude, b.longitude].some((value) => value === null)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function addressParts(listing) {
  const address = listing?.address || {};
  const street = typeof address === 'object' ? address.street : address;
  const houseNumber = typeof address === 'object' ? address.house_number : null;
  return {
    street: normalizeText(street),
    house_number: normalizeText(houseNumber).replace(/\s/g, ''),
  };
}

function primaryFloor(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { key: null, ambiguous: false, display: null };
  const normalized = normalizeItalianFloor(raw);
  const text = normalizeText(normalized);
  const numbers = [...raw.matchAll(/-?\d+/g)].map((match) => Number(match[0]));
  const uniqueNumbers = [...new Set(numbers)];
  if (uniqueNumbers.length === 1) return { key: `number:${uniqueNumbers[0]}`, ambiguous: false, display: normalized };
  if (uniqueNumbers.length > 1) return { key: null, ambiguous: true, display: normalized };
  if (['piano terra'].includes(text)) return { key: 'ground', ambiguous: false, display: normalized };
  if (['piano rialzato', 'ammezzato'].includes(text)) return { key: 'raised_low', ambiguous: false, display: normalized };
  if (['seminterrato'].includes(text)) return { key: 'semi_basement', ambiguous: false, display: normalized };
  if (text.includes('interrato')) return { key: 'basement', ambiguous: false, display: normalized };
  return { key: null, ambiguous: true, display: normalized };
}

function floorCompatibility(left, right) {
  const a = primaryFloor(left?.floor?.raw ?? left?.floor?.normalized ?? left?.floor);
  const b = primaryFloor(right?.floor?.raw ?? right?.floor?.normalized ?? right?.floor);
  if (a.ambiguous || b.ambiguous) return { value: null, left: a, right: b };
  if (!a.key || !b.key) return { value: null, left: a, right: b };
  return { value: a.key === b.key, left: a, right: b };
}

function listingPrice(listing) {
  return listing?.asking_price?.status === 'known'
    ? listing.asking_price.amount_eur
    : listing?.price_eur ?? listing?.price ?? null;
}

function listingSurface(listing) {
  return listing?.surface?.value_sqm ?? listing?.size_mq ?? listing?.size ?? null;
}

function sourceIdentity(listing) {
  const source = String(listing?.source_channel || '').toLowerCase();
  const sourceId = String(listing?.source_listing_id || '').trim();
  return source && sourceId ? `${source}:id:${sourceId}` : listing?.source_observation_key || null;
}

function unwrap(listing) {
  return listing?.normalized_v1 || listing?.listing?.normalized_v1 || listing;
}

export function propertyIdentityBlockKeys(value) {
  const listing = unwrap(value);
  const address = addressParts(listing);
  const location = coordinates(listing);
  const surface = finiteNumber(listingSurface(listing));
  const keys = [];
  if (address.street && address.house_number) keys.push(`address:${address.street}:${address.house_number}`);
  if (address.street && surface) keys.push(`street-surface:${address.street}:${Math.round(surface / 3) * 3}`);
  if (location.latitude !== null && location.longitude !== null && surface) {
    keys.push(`geo-surface:${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}:${Math.round(surface / 3) * 3}`);
  }
  const identity = sourceIdentity(listing);
  if (identity) keys.push(identity);
  return [...new Set(keys)];
}

export function comparePropertyIdentity(left, right) {
  left = unwrap(left);
  right = unwrap(right);
  const leftIdentity = sourceIdentity(left);
  const rightIdentity = sourceIdentity(right);
  if (leftIdentity && leftIdentity === rightIdentity) {
    return {
      classification: 'exact_source_identity',
      confidence: 1,
      auto_merge_eligible: true,
      blockers: [],
      signals: { same_source_identity: true },
    };
  }

  const leftAddress = addressParts(left);
  const rightAddress = addressParts(right);
  const streetMatch = Boolean(leftAddress.street && rightAddress.street && leftAddress.street === rightAddress.street);
  const civicMatch = Boolean(leftAddress.house_number && rightAddress.house_number && leftAddress.house_number === rightAddress.house_number);
  const civicConflict = Boolean(leftAddress.house_number && rightAddress.house_number && leftAddress.house_number !== rightAddress.house_number);
  const distance = distanceMeters(left, right);
  const sizeDelta = relativeDelta(listingSurface(left), listingSurface(right));
  const priceDelta = relativeDelta(listingPrice(left), listingPrice(right));
  const floors = floorCompatibility(left, right);
  const sameSource = Boolean(left?.source_channel && right?.source_channel && left.source_channel === right.source_channel);
  const differentSourceIds = Boolean(sameSource && left?.source_listing_id && right?.source_listing_id && left.source_listing_id !== right.source_listing_id);
  const leftRooms = finiteNumber(left?.rooms);
  const rightRooms = finiteNumber(right?.rooms);
  const roomsCompatible = leftRooms === null || rightRooms === null || Math.abs(leftRooms - rightRooms) <= 1;
  const typeLeft = normalizeText(left?.property_type);
  const typeRight = normalizeText(right?.property_type);
  const typeCompatible = !typeLeft || !typeRight || typeLeft === typeRight ||
    (typeLeft.includes('appartamento') && typeRight.includes('appartamento'));
  const blockers = [];
  if (differentSourceIds) blockers.push('same_source_different_listing_id');
  if (civicConflict) blockers.push('different_house_number');
  if (distance !== null && distance > 120) blockers.push('distance_over_120m');
  if (sizeDelta !== null && sizeDelta > 0.12) blockers.push('surface_delta_over_12pct');
  if (floors.value === false) blockers.push('different_floor');
  if (!typeCompatible) blockers.push('incompatible_property_type');
  if (!roomsCompatible) blockers.push('rooms_delta_over_1');

  let score = 0;
  if (streetMatch && civicMatch) score += 0.35;
  else if (streetMatch) score += 0.2;
  if (distance !== null && distance <= 10) score += 0.2;
  else if (distance !== null && distance <= 40) score += 0.12;
  else if (distance !== null && distance <= 120) score += 0.05;
  if (sizeDelta !== null && sizeDelta <= 0.02) score += 0.15;
  else if (sizeDelta !== null && sizeDelta <= 0.05) score += 0.1;
  else if (sizeDelta !== null && sizeDelta <= 0.1) score += 0.04;
  if (priceDelta !== null && priceDelta <= 0.03) score += 0.15;
  else if (priceDelta !== null && priceDelta <= 0.08) score += 0.1;
  else if (priceDelta !== null && priceDelta <= 0.15) score += 0.04;
  if (floors.value === true) score += 0.15;

  score = Math.round(score * 1000) / 1000;
  let classification = 'distinct';
  const strongPhysicalIdentity = blockers.length === 0 && !sameSource &&
    streetMatch && civicMatch && distance !== null && distance <= 20 &&
    sizeDelta !== null && sizeDelta <= 0.03 && floors.value === true && roomsCompatible;
  if (strongPhysicalIdentity || (blockers.length === 0 && score >= 0.9 && (streetMatch || (distance !== null && distance <= 10)))) classification = 'probable_cross_source_match';
  else if (blockers.length === 0 && score >= 0.65) classification = 'uncertain_cross_source_match';

  return {
    classification,
    confidence: score,
    auto_merge_eligible: classification === 'probable_cross_source_match',
    blockers,
    signals: {
      street_match: streetMatch,
      civic_match: civicMatch,
      distance_m: distance === null ? null : Math.round(distance * 10) / 10,
      surface_delta_pct: sizeDelta === null ? null : Math.round(sizeDelta * 1000) / 10,
      price_delta_pct: priceDelta === null ? null : Math.round(priceDelta * 1000) / 10,
      floor_compatible: floors.value,
      left_floor: floors.left,
      right_floor: floors.right,
      property_type_compatible: typeCompatible,
      rooms_compatible: roomsCompatible,
      strong_physical_identity: strongPhysicalIdentity,
    },
  };
}

