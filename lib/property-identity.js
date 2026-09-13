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

// Portals publish the address as one free-text line, and the shape varies:
// "Via Celio, 2", "Via Petitti Carlo Ilarione 16", "Viale Monza, 17, 20125
// Milano MI, Italia", "Piazza della Repubblica s.n.c". Comparing those lines
// whole made the civic number invisible to the matcher, even though it is the
// strongest piece of identity evidence a listing carries: two portals
// describing the same apartment scored no better than two apartments on the
// same street. Split the line so street and civic can be judged separately.
function splitStreetLine(value) {
  const normalized = normalizeText(value);
  if (!normalized) return { street: '', house_number: '' };

  let tokens = normalized.split(' ');

  // Drop the postal code and everything after it, then any trailing city or
  // country tokens one portal appends and another does not.
  const capIndex = tokens.findIndex((token) => /^\d{5}$/.test(token));
  if (capIndex > 0) tokens = tokens.slice(0, capIndex);
  while (tokens.length && ['milano', 'mi', 'italia', 'italy', 'snc'].includes(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }

  // "12/A" normalizes to "12 a": fold the letter back onto the number.
  if (tokens.length >= 2 && /^[a-z]$/.test(tokens[tokens.length - 1]) && /^\d{1,4}$/.test(tokens[tokens.length - 2])) {
    tokens = [...tokens.slice(0, -2), tokens[tokens.length - 2] + tokens[tokens.length - 1]];
  }

  // Only a trailing number is a civic. A number anywhere else belongs to the
  // street name ("Via 20 Settembre"), and reading it as a civic would strip the
  // name down to its street type.
  const last = tokens[tokens.length - 1] || '';
  if (tokens.length >= 3 && /^\d{1,4}[a-z]?$/.test(last)) {
    return { street: tokens.slice(0, -1).join(' '), house_number: last };
  }
  return { street: tokens.join(' '), house_number: '' };
}

function addressParts(listing) {
  const address = listing?.address || {};
  if (typeof address === 'object') {
    const structured = normalizeText(address.house_number).replace(/\s/g, '');
    if (structured) return { street: normalizeText(address.street), house_number: structured };
    return splitStreetLine(address.street);
  }
  return splitStreetLine(address);
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

  // Price is deliberately absent from the score.
  //
  // It used to contribute up to 0.15 against an automatic threshold of 0.9,
  // while the address line was compared whole, so the civic number never
  // registered and physical evidence alone topped out at 0.85. Agreement on the
  // asking price was therefore the only way a pair could ever cross the line -
  // and since the score could not cross it either, the run of 22 August 2026
  // auto-merged none of its 157 admissible cross-portal pairs, 92 of which were
  // priced identically and 65 of which were not.
  //
  // A cross-portal price difference is the most valuable signal this product
  // produces, and the matcher was in no position to surface it. Price now takes
  // no part in deciding identity: it is measured, reported and preserved, but
  // two listings are the same apartment because of where they are and what they
  // are, never because of what they cost. On that same run the rebalanced score
  // merges 32 of those pairs, 4 of them with a price spread.
  let score = 0;
  if (streetMatch && civicMatch) score += 0.40;
  else if (streetMatch) score += 0.20;
  if (distance !== null && distance <= 10) score += 0.22;
  else if (distance !== null && distance <= 40) score += 0.14;
  else if (distance !== null && distance <= 120) score += 0.06;
  if (sizeDelta !== null && sizeDelta <= 0.02) score += 0.20;
  else if (sizeDelta !== null && sizeDelta <= 0.05) score += 0.13;
  else if (sizeDelta !== null && sizeDelta <= 0.10) score += 0.05;
  if (floors.value === true) score += 0.18;
  if (leftRooms !== null && rightRooms !== null && leftRooms === rightRooms) score += 0.06;
  if (typeLeft && typeRight && typeCompatible) score += 0.04;

  score = Math.round(Math.min(1, score) * 1000) / 1000;
  let classification = 'distinct';
  const strongPhysicalIdentity = blockers.length === 0 && !sameSource &&
    streetMatch && civicMatch && distance !== null && distance <= 20 &&
    sizeDelta !== null && sizeDelta <= 0.03 && floors.value === true && roomsCompatible;

  // Automatic merging stays limited to pairs from different portals. Two
  // listings on the same portal at the same address, floor and surface are far
  // more likely to be two units in one building than one unit listed twice, and
  // no amount of physical agreement distinguishes them.
  //
  // A known, matching floor is required rather than merely not contradicted: at
  // one civic number the floor is what separates one apartment from the one
  // above it, so a pair where either portal omits it stays uncertain and
  // reviewable instead of being merged on surface alone.
  const automatic = blockers.length === 0 && !sameSource && floors.value === true
    && (strongPhysicalIdentity
      || (score >= 0.88 && streetMatch && civicMatch)
      || (score >= 0.92 && distance !== null && distance <= 10));
  if (automatic) classification = 'probable_cross_source_match';
  else if (blockers.length === 0 && score >= 0.6) classification = 'uncertain_cross_source_match';

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
      // Reported so a cross-portal spread stays visible, never scored.
      price_influenced_score: false,
    },
  };
}

