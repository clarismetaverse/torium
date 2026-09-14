// What the market pays for the apartment TORIUM intends to sell.
//
// The valuation has always taken its exit price from a published city-zone
// average: one number per zone, mixing every size and every condition. That
// number is the wrong one twice over.
//
// It mixes sizes, and the whole fractioning thesis is that a 45 sqm unit sells
// for more per square metre than the 150 sqm one it was cut out of. A benchmark
// that averages the two cannot express the premium it depends on.
//
// It mixes conditions, and TORIUM sells a renovated unit while buying one to
// renovate. A benchmark dragged down by "da ristrutturare" listings understates
// the exit and overstates nothing - both errors push the same way, which is why
// the modelled ROI has a median of minus eighteen per cent.
//
// This module builds the benchmark from observed listings instead, split by
// zone, size band and condition, so the two premiums the business rests on are
// measured rather than assumed.
import { MILAN_CANONICAL_ZONES, resolveMilanCanonicalZone } from './milan-area-taxonomy.js';

const ZONES_BY_ID = new Map(MILAN_CANONICAL_ZONES.map((zone) => [zone.id, zone]));

/**
 * Areas are measured at neighbourhood level, with the canonical zone kept only
 * as a fallback for listings that carry no neighbourhood.
 *
 * This is not a detail. Measured across the 32 canonical zones, a small
 * renovated unit appears to sell for 0.88 to 0.97 times what a large renovated
 * one fetches - the opposite of the premium the whole fractioning thesis rests
 * on. Measured by neighbourhood, on exactly the same listings, it is 1.06 to
 * 1.09. The sign flips, because inside one coarse zone the large renovated
 * flats sit on the better streets while the small ones are spread everywhere.
 *
 * A zone-level benchmark is therefore not merely imprecise for this question.
 * It gives the wrong answer.
 */
// The canonical zone still has to resolve: it is what keeps a listing from
// another city out of a Milan benchmark. It just no longer decides the bucket.
function areaOf(listing, zone) {
  if (!zone) return null;
  const neighbourhood = String(listing.neighborhood || '').trim();
  return neighbourhood
    ? { id: neighbourhood, level: 'neighbourhood' }
    : { id: zone.id, level: 'zone' };
}

// The pipeline's own normalizer already resolves a canonical zone. Prefer it,
// so a benchmark and a triage run can never disagree about where a listing is,
// and fall back to the labels only for listings that never went through it.
function zoneOf(listing) {
  const resolved = ZONES_BY_ID.get(String(listing.canonical_zone_id || ''));
  if (resolved) return resolved;
  return resolveMilanCanonicalZone(
    listing.zone_id, listing.neighborhood, listing.district, listing.area_label, listing.address,
  );
}

export const EXIT_BENCHMARK_VERSION = 'milan_exit_by_zone_size_condition_v1';

// Below this many listings a median is an anecdote. Segments under the floor
// are kept in the output with their count, and marked unusable, rather than
// silently dropped: knowing a zone is unmeasured is itself a result.
export const MINIMUM_SAMPLE = 8;

export const SIZE_BANDS = Object.freeze([
  { id: 'monolocale', max_mq: 39.9 },
  { id: 'bilocale', max_mq: 59.9 },
  { id: 'trilocale', max_mq: 89.9 },
  { id: 'large', max_mq: Infinity },
]);

export function classifySizeBand(sizeMq) {
  const size = Number(sizeMq);
  if (!Number.isFinite(size) || size <= 0) return null;
  return SIZE_BANDS.find((band) => size <= band.max_mq).id;
}

/**
 * Condition comes from the query that produced the listing, not from parsing
 * its description: we asked Idealista for `renew` or for `good`, so we already
 * know which market this observation belongs to. The listing's own status is
 * used only to confirm it, and a contradiction is reported rather than hidden.
 */
export function classifyCondition(listing = {}) {
  const queried = String(listing.queried_condition || '').toLowerCase();
  if (queried === 'renew') return 'to_renovate';
  if (queried === 'good' || queried === 'newdevelopment') return 'renovated';

  const status = String(listing.status || '').toLowerCase();
  if (status === 'renew') return 'to_renovate';
  if (['good', 'excellent', 'newconstruction'].includes(status)) return 'renovated';
  return 'unknown';
}

function pricePerSqm(listing = {}) {
  const direct = Number(listing.price_by_area ?? listing.priceByArea);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const price = Number(listing.price_eur ?? listing.price);
  const size = Number(listing.size_mq ?? listing.size);
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null;
  return price / size;
}

// A listing at 900 EUR/sqm in Milan is a data error, a garage or a fractional
// share; one at 30,000 is a penthouse that tells us nothing about a bilocale.
// Both would move a median built from a handful of rows.
function plausible(eurMq) {
  return Number.isFinite(eurMq) && eurMq >= 1200 && eurMq <= 22000;
}

function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
}

function describe(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    median_eur_mq: sorted.length ? Math.round(quantile(sorted, 0.5)) : null,
    p25_eur_mq: sorted.length ? Math.round(quantile(sorted, 0.25)) : null,
    p75_eur_mq: sorted.length ? Math.round(quantile(sorted, 0.75)) : null,
    usable: sorted.length >= MINIMUM_SAMPLE,
  };
}

function ratio(numerator, denominator) {
  if (!numerator?.usable || !denominator?.usable) return null;
  if (!denominator.median_eur_mq) return null;
  return Number((numerator.median_eur_mq / denominator.median_eur_mq).toFixed(3));
}

/**
 * @param {Array} listings - normalized listings, each with a size, a price and
 *   enough location text to resolve a canonical Milan zone. `queried_condition`
 *   carries the filter the scrape used.
 * @returns the benchmark, plus the two premiums it exists to measure.
 */
export function buildExitBenchmarks(listings = [], { minimumSample = MINIMUM_SAMPLE } = {}) {
  const segments = new Map();
  const rejected = {
    no_zone: 0, no_size: 0, no_price: 0, implausible_price: 0, unknown_condition: 0, duplicate: 0,
  };
  let accepted = 0;
  let conditionConflicts = 0;

  // The same apartment reaches us more than once: relisted by a second agency,
  // returned by two overlapping queries, or published as eight identical units
  // of one development. Each copy would count as an independent observation and
  // pull the median towards whatever that one property costs.
  const seenIds = new Set();
  const seenProperties = new Set();
  const areaLevels = new Map();
  const areaZones = new Map();
  const zoneSegments = new Map();

  for (const listing of listings) {
    const zone = zoneOf(listing);
    const area = areaOf(listing, zone);
    if (!area) { rejected.no_zone += 1; continue; }

    const band = classifySizeBand(listing.size_mq ?? listing.size);
    if (!band) { rejected.no_size += 1; continue; }

    const eurMq = pricePerSqm(listing);
    if (eurMq === null) { rejected.no_price += 1; continue; }
    if (!plausible(eurMq)) { rejected.implausible_price += 1; continue; }

    const condition = classifyCondition(listing);
    if (condition === 'unknown') { rejected.unknown_condition += 1; continue; }

    const listingId = listing.source_listing_id ? String(listing.source_listing_id) : null;
    // Identity falls back to the tuple that makes two rows the same flat in
    // practice: same zone, same surface, same asking price to the euro.
    const fingerprint = [zone.id, Math.round(Number(listing.size_mq ?? listing.size)),
      Math.round(Number(listing.price_eur ?? listing.price))].join('|');
    if ((listingId && seenIds.has(listingId)) || seenProperties.has(fingerprint)) {
      rejected.duplicate += 1;
      continue;
    }
    if (listingId) seenIds.add(listingId);
    seenProperties.add(fingerprint);

    // The query said one thing and the listing says another: worth counting,
    // because a high rate means the condition filter is not doing its job.
    const ownStatus = String(listing.status || '').toLowerCase();
    if (ownStatus && (
      (condition === 'renovated' && ownStatus === 'renew')
      || (condition === 'to_renovate' && ['good', 'excellent', 'newconstruction'].includes(ownStatus))
    )) conditionConflicts += 1;

    const key = `${area.id}|${band}|${condition}`;
    areaLevels.set(area.id, area.level);
    if (zone.id !== area.id) areaZones.set(area.id, zone.id);
    if (!segments.has(key)) segments.set(key, []);
    segments.get(key).push(eurMq);

    // The same observation also feeds its canonical zone, which is what a
    // neighbourhood too thin to speak for itself falls back to.
    const zoneKey = `zone:${zone.id}|${band}|${condition}`;
    if (!zoneSegments.has(zoneKey)) zoneSegments.set(zoneKey, []);
    zoneSegments.get(zoneKey).push(eurMq);
    accepted += 1;
  }

  const zoneIds = [...new Set([...segments.keys()].map((key) => key.split('|')[0]))].sort();
  const zones = zoneIds.map((zoneId) => {
    const bands = {};
    for (const band of SIZE_BANDS) {
      const renovated = describe(segments.get(`${zoneId}|${band.id}|renovated`) || []);
      const toRenovate = describe(segments.get(`${zoneId}|${band.id}|to_renovate`) || []);
      bands[band.id] = {
        renovated,
        to_renovate: toRenovate,
        // What the market pays for the work itself, at this size. Independent
        // of what the work costs, which is the point: the two can be compared.
        renovation_premium: ratio(renovated, toRenovate),
      };
    }

    return {
      zone_id: zoneId,
      area_level: areaLevels.get(zoneId) || 'zone',
      canonical_zone_id: areaZones.get(zoneId) || zoneId,
      bands,
      // The number the valuation multiplier stands in for: how much more a
      // renovated small unit fetches per square metre than a renovated large
      // one in the same zone.
      size_premium: {
        monolocale_over_large: ratio(bands.monolocale.renovated, bands.large.renovated),
        bilocale_over_large: ratio(bands.bilocale.renovated, bands.large.renovated),
        trilocale_over_large: ratio(bands.trilocale.renovated, bands.large.renovated),
      },
      // What the valuation should use as the exit for a fractioned unit, with
      // the level it came from attached. A price measured on this street and a
      // price borrowed from the whole zone are both usable, but a reader has to
      // be able to tell them apart.
      exit_eur_mq: Object.fromEntries(['monolocale', 'bilocale', 'trilocale'].map((band) => {
        const own = bands[band].renovated;
        if (own.usable) return [band, { eur_mq: own.median_eur_mq, measured_at: areaLevels.get(zoneId) || 'zone', sample: own.count }];
        const fallback = describe(zoneSegments.get(`zone:${areaZones.get(zoneId) || zoneId}|${band}|renovated`) || []);
        if (fallback.usable) return [band, { eur_mq: fallback.median_eur_mq, measured_at: 'zone', sample: fallback.count }];
        return [band, null];
      })),
    };
  });

  const usableSegments = zones.reduce((total, zone) => total + Object.values(zone.bands)
    .reduce((count, band) => count + (band.renovated.usable ? 1 : 0) + (band.to_renovate.usable ? 1 : 0), 0), 0);

  return {
    version: EXIT_BENCHMARK_VERSION,
    built_at: new Date().toISOString(),
    minimum_sample: minimumSample,
    coverage: {
      listings_seen: listings.length,
      listings_used: accepted,
      rejected,
      zones_with_data: zones.length,
      measured_at_neighbourhood: [...areaLevels.values()].filter((level) => level === 'neighbourhood').length,
      usable_segments: usableSegments,
      condition_conflicts: conditionConflicts,
    },
    zones,
  };
}

/**
 * The one number the current valuation profile encodes as a guess. Pooling
 * across zones is deliberate: a citywide premium built from many zones is more
 * trustworthy than a per-zone one built from six listings, and the per-zone
 * figures stay available for the zones that do have a sample.
 */
export function citywideSizePremium(benchmark) {
  const collect = (key) => benchmark.zones
    .map((zone) => zone.size_premium[key])
    .filter((value) => value !== null)
    .sort((left, right) => left - right);

  const median = (values) => (values.length
    ? Number(quantile(values, 0.5).toFixed(3))
    : null);

  return {
    monolocale_over_large: median(collect('monolocale_over_large')),
    bilocale_over_large: median(collect('bilocale_over_large')),
    trilocale_over_large: median(collect('trilocale_over_large')),
    zones_contributing: {
      monolocale: collect('monolocale_over_large').length,
      bilocale: collect('bilocale_over_large').length,
      trilocale: collect('trilocale_over_large').length,
    },
  };
}
