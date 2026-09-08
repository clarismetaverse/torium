import { resolveMilanCanonicalZone } from './milan-area-taxonomy.js';

// Matching an investor's saved preferences against triaged properties.
//
// Two rules shape everything here:
//
// 1. A filter the investor set is a promise. If a property cannot be evaluated
//    against a filter - unknown price, unknown zone - it is rejected rather
//    than passed through. Sending an alert TORIUM cannot justify is worse than
//    sending none, and every rejection is counted so the gap stays visible.
//
// 2. Identity must survive the next run. Alerts are deduplicated on a property
//    key, not on a run and array position, so re-running a search does not
//    re-notify the same apartment.

export const ALERT_KEY_VERSION = 'v1';

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedUrl(value) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.origin.toLowerCase() + url.pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Stable identity for alert deduplication, in descending order of durability.
 *
 * The portal's own listing id is stable across runs and is present on 99.9% of
 * triaged properties. The canonical URL is the fallback. Only when both are
 * missing does the key fall back to the run and array position, which is NOT
 * stable across runs - such a property can be alerted again after a re-run, so
 * the caller is told via `stable: false`.
 */
export function propertyAlertKey(property = {}) {
  const channel = String(property.source_channel || 'unknown').toLowerCase();
  const sourceId = clean(property.source_listing_id);
  if (sourceId) return { key: `${ALERT_KEY_VERSION}:${channel}:id:${sourceId}`, stable: true };

  const url = normalizedUrl(property.source_url);
  if (url) return { key: `${ALERT_KEY_VERSION}:${channel}:url:${url}`, stable: true };

  const runId = clean(property.run_id);
  const listingIndex = finiteNumber(property.listing_index);
  if (runId && listingIndex !== null) {
    return { key: `${ALERT_KEY_VERSION}:run:${runId}:${listingIndex}`, stable: false };
  }
  return { key: null, stable: false };
}

export function propertyZoneId(property = {}) {
  const zone = resolveMilanCanonicalZone(
    property.neighborhood,
    property.district,
    property.area_label,
    property.address,
    property.title,
  );
  return zone ? zone.id : null;
}

function pricePerSqm(property) {
  const stated = finitePositive(property.price_by_area);
  if (stated) return stated;
  const price = finitePositive(property.price_eur);
  const size = finitePositive(property.size_mq);
  return price && size ? Math.round(price / size) : null;
}

/**
 * @returns {{ matched: boolean, rejected: string[], zone_id: string|null }}
 */
export function matchesPreferences(property = {}, preferences = {}) {
  const rejected = [];
  const zoneId = propertyZoneId(property);

  const zones = Array.isArray(preferences.neighborhood_ids) ? preferences.neighborhood_ids : [];
  if (zones.length > 0) {
    if (!zoneId) rejected.push('zone_unknown');
    else if (!zones.includes(zoneId)) rejected.push('zone_not_selected');
  }

  const price = finitePositive(property.price_eur);
  const minPrice = finiteNumber(preferences.min_price_eur);
  const maxPrice = finiteNumber(preferences.max_price_eur);
  if (minPrice !== null || maxPrice !== null) {
    if (price === null) rejected.push('price_unknown');
    else if (minPrice !== null && price < minPrice) rejected.push('price_below_minimum');
    else if (maxPrice !== null && price > maxPrice) rejected.push('price_above_maximum');
  }

  const size = finitePositive(property.size_mq);
  const minSize = finiteNumber(preferences.min_size_mq);
  const maxSize = finiteNumber(preferences.max_size_mq);
  if (minSize !== null || maxSize !== null) {
    if (size === null) rejected.push('size_unknown');
    else if (minSize !== null && size < minSize) rejected.push('size_below_minimum');
    else if (maxSize !== null && size > maxSize) rejected.push('size_above_maximum');
  }

  const maxPricePerSqm = finiteNumber(preferences.max_price_per_sqm_eur);
  if (maxPricePerSqm !== null) {
    const perSqm = pricePerSqm(property);
    if (perSqm === null) rejected.push('price_per_sqm_unknown');
    else if (perSqm > maxPricePerSqm) rejected.push('price_per_sqm_above_maximum');
  }

  const minDoorScore = finiteNumber(preferences.min_door_score);
  if (minDoorScore !== null) {
    const doorScore = finiteNumber(property.door_score);
    if (doorScore === null) rejected.push('door_score_unknown');
    else if (doorScore < minDoorScore) rejected.push('door_score_below_minimum');
  }

  const minRoi = finiteNumber(preferences.min_roi_base_pct);
  if (minRoi !== null) {
    const roi = finiteNumber(property.roi_base_pct);
    if (roi === null) rejected.push('roi_unknown');
    else if (roi < minRoi) rejected.push('roi_below_minimum');
  }

  return { matched: rejected.length === 0, rejected, zone_id: zoneId };
}

/**
 * An investor who has saved no filter at all is not subscribed to everything.
 * Alerting on the entire corpus would be indistinguishable from spam, so an
 * empty preference set matches nothing until the investor chooses something.
 */
export function hasUsablePreferences(preferences = {}) {
  const zones = Array.isArray(preferences.neighborhood_ids) ? preferences.neighborhood_ids : [];
  if (zones.length > 0) return true;
  return [
    'min_price_eur', 'max_price_eur', 'min_size_mq', 'max_size_mq',
    'max_price_per_sqm_eur', 'min_door_score', 'min_roi_base_pct',
  ].some((field) => finiteNumber(preferences[field]) !== null);
}

export function alertRowFromProperty(property, { userId, zoneId }) {
  const { key, stable } = propertyAlertKey(property);
  return {
    user_id: userId,
    property_key: key,
    property_key_is_stable: stable,
    run_id: clean(property.run_id),
    listing_index: finiteNumber(property.listing_index),
    source_channel: clean(property.source_channel),
    source_listing_id: clean(property.source_listing_id),
    source_url: clean(property.source_url),
    title: clean(property.title),
    zone_id: zoneId ?? null,
    neighborhood: clean(property.neighborhood),
    price_eur: finitePositive(property.price_eur),
    size_mq: finitePositive(property.size_mq),
    price_by_area: pricePerSqm(property),
    door_score: finiteNumber(property.door_score),
    roi_base_pct: finiteNumber(property.roi_base_pct),
    thumbnail_url: clean(property.thumbnail_url),
  };
}

/**
 * Selects the properties to alert one investor about.
 *
 * `alreadyAlerted` is the set of property keys this investor has been notified
 * about before; it is the caller's job to load it. Deduplication also happens
 * at the database level through a unique constraint, so a concurrent run cannot
 * produce a duplicate alert even if two callers select the same property.
 */
export function selectAlertsForInvestor(properties, preferences, {
  userId,
  alreadyAlerted = new Set(),
  limit = 50,
} = {}) {
  const rejectionCounts = {};
  const countRejection = (reason) => {
    rejectionCounts[reason] = (rejectionCounts[reason] || 0) + 1;
  };

  if (!hasUsablePreferences(preferences)) {
    return { matches: [], inspected: (properties || []).length, rejectionCounts: { no_preferences_set: 1 }, truncated: false };
  }

  const seenInThisBatch = new Set();
  const matches = [];
  let truncated = false;

  for (const property of properties || []) {
    const { key } = propertyAlertKey(property);
    if (!key) {
      countRejection('no_usable_identity');
      continue;
    }
    if (alreadyAlerted.has(key) || seenInThisBatch.has(key)) {
      countRejection('already_alerted');
      continue;
    }

    const verdict = matchesPreferences(property, preferences);
    if (!verdict.matched) {
      for (const reason of verdict.rejected) countRejection(reason);
      continue;
    }

    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    seenInThisBatch.add(key);
    matches.push(alertRowFromProperty(property, { userId, zoneId: verdict.zone_id }));
  }

  // Best opportunities first: the digest is read from the top down.
  matches.sort((left, right) => (right.door_score ?? 0) - (left.door_score ?? 0)
    || (right.roi_base_pct ?? 0) - (left.roi_base_pct ?? 0));

  return {
    matches,
    inspected: (properties || []).length,
    rejectionCounts,
    truncated,
  };
}
