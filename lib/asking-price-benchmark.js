import { createHash } from 'node:crypto';

export const BENCHMARK_VERSION = 'asking_comparables_v2';
const CONDITIONS = new Set(['to_renovate', 'good', 'renovated', 'new_construction']);
const TYPES = new Map([[1, 'monolocale'], [2, 'bilocale'], [3, 'trilocale']]);
export function normalizeArea(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function sizeBand(size) {
  if (!(Number(size) > 0)) return null;
  return size < 40 ? 'under40' : size < 60 ? '40to59' : size < 90 ? '60to89' : '90plus';
}
function condition(value) {
  return ({ renew: 'to_renovate', good: 'good', newconstruction: 'new_construction' })[value] || (CONDITIONS.has(value) ? value : null);
}
function key(city, area, type, band, state) { return JSON.stringify([city, area, type, band, state]); }
function quantile(values, q) {
  const i = (values.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return values[lo] + (values[hi] - values[lo]) * (i - lo);
}

// Inputs are observations, never inferred from a query label alone. Distinct
// source IDs remain distinct even when size and price match. Cross-source
// grouping requires a previously confirmed property identity supplied upstream.
export function buildAskingBenchmark(observations, { minimumSample = 8, maxAgeDays = 90, now = new Date().toISOString() } = {}) {
  if (!Number.isInteger(minimumSample) || minimumSample < 2 || !(maxAgeDays > 0) || !Number.isFinite(Date.parse(now))) throw Error('Invalid benchmark policy');
  const rejected = {}, accept = new Map(), conflicts = new Set();
  const reject = reason => { rejected[reason] = (rejected[reason] || 0) + 1; };
  for (const row of observations) {
    const source = String(row.source || row.source_channel || '').trim();
    const id = row.source_listing_id;
    if (!source || !id) { reject('missing_source_identity'); continue; }
    const city = normalizeArea(row.city), area = normalizeArea(row.neighborhood);
    const type = TYPES.get(Number(row.rooms));
    const size = Number(row.size_mq), price = Number(row.price_eur);
    const state = condition(row.condition || row.property_condition);
    const queryState = condition(row.queried_condition);
    const at = Date.parse(row.observed_at);
    if (!city || !area || !type) { reject('missing_location_or_room_type'); continue; }
    if (!state || (state === 'renovated' && row.renovation_verified !== true)) { reject('unverified_condition'); continue; }
    if (queryState && queryState !== state) { reject('condition_conflict'); continue; }
    if (!(size > 0 && price > 0 && Number.isFinite(price / size))) { reject('invalid_price_or_area'); continue; }
    if (!Number.isFinite(at) || at > Date.parse(now) || Date.parse(now) - at > maxAgeDays * 86400000) { reject('stale_or_invalid_observation'); continue; }
    const identity = JSON.stringify([source, String(id)]);
    const entry = { ...row, source, source_listing_id: String(id), city, neighborhood: area, type, condition: state,
      price_eur: price, size_mq: size, observed_at: new Date(at).toISOString(), at, key: key(city, area, type, sizeBand(size), state) };
    const previous = accept.get(identity);
    if (previous?.at === at && (previous.price_eur !== price || previous.key !== entry.key || previous.size_mq !== size
      || (previous.identity_confirmed && entry.identity_confirmed && previous.canonical_property_id !== entry.canonical_property_id))) {
      conflicts.add(identity); reject('same_time_conflict'); continue;
    }
    if (!previous || at > previous.at || (at === previous.at && entry.identity_confirmed === true && previous.identity_confirmed !== true)) accept.set(identity, entry);
    else reject('older_or_duplicate_observation');
  }
  const groups = new Map();
  for (const [identity, entry] of [...accept].sort(([a], [b]) => a.localeCompare(b))) {
    if (conflicts.has(identity)) continue;
    if (!groups.has(entry.key)) groups.set(entry.key, new Map());
    const group = groups.get(entry.key);
    const property = entry.identity_confirmed === true && entry.canonical_property_id ? `canonical:${entry.canonical_property_id}` : identity;
    const old = group.get(property);
    // Conservative asking reference for confirmed duplicate offers. Keep their
    // original observations below so the spread is never erased from history.
    if (!old || entry.price_eur / entry.size_mq < old.price_eur / old.size_mq) group.set(property, entry);
  }
  const segments = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([segmentKey, group]) => {
    const rows = [...group.values()], values = rows.map(r => r.price_eur / r.size_mq).sort((a,b) => a-b);
    const [city, neighborhood, unitType, band, state] = JSON.parse(segmentKey);
    return { city, neighborhood, unit_type: unitType, size_band: band, condition: state, count: values.length,
      usable: values.length >= minimumSample, median_eur_mq: quantile(values, .5), p25_eur_mq: quantile(values, .25),
      p75_eur_mq: quantile(values, .75), oldest_observed_at: new Date(Math.min(...rows.map(r => r.at))).toISOString() };
  });
  const kept = [...accept].filter(([id]) => !conflicts.has(id)).map(([,r]) => r).sort((a,b) => `${a.source}:${a.source_listing_id}`.localeCompare(`${b.source}:${b.source_listing_id}`));
  return { version: BENCHMARK_VERSION, price_basis: 'asking_not_achieved', built_at: now, minimum_sample: minimumSample, max_age_days: maxAgeDays,
    input_sha256: createHash('sha256').update(JSON.stringify(kept)).digest('hex'), rejected, observations: kept, segments };
}

export function lookupAskingPrice(benchmark, { city, neighborhood, unitType, sizeMq, condition: state = 'renovated', now = new Date().toISOString() }) {
  if (benchmark?.version !== BENCHMARK_VERSION || benchmark.price_basis !== 'asking_not_achieved') return null;
  if (!Array.isArray(benchmark.segments) || !Number.isInteger(benchmark.minimum_sample) || benchmark.minimum_sample < 2 || !(benchmark.max_age_days > 0)) return null;
  return benchmark.segments.find(s => s.city === normalizeArea(city) && s.neighborhood === normalizeArea(neighborhood)
    && s.unit_type === unitType && s.size_band === sizeBand(sizeMq) && s.condition === state
    && s.usable && s.count >= benchmark.minimum_sample
    && [s.p25_eur_mq, s.median_eur_mq, s.p75_eur_mq].every(v => Number.isFinite(v) && v > 0)
    && s.p25_eur_mq <= s.median_eur_mq && s.median_eur_mq <= s.p75_eur_mq
    && Date.parse(s.oldest_observed_at) <= Date.parse(now)
    && Date.parse(now) - Date.parse(s.oldest_observed_at) <= benchmark.max_age_days * 86400000) || null;
}
