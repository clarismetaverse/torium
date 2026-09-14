// Turning a pool of candidates into a ranking by how good the deal is.
//
// Deal quality needs two references the property itself does not carry: what
// comparable stock costs in its neighbourhood, and what a renovated small unit
// sells for there. This module supplies both and applies lib/deal-quality.js.
//
// The buy reference is built from the run's own pool rather than from a stored
// benchmark. That is deliberate. It makes the comparison internal - "cheaper
// than the other large flats this run found on these streets" - so it works on
// the first run in a new city, needs no second collection to stay current, and
// cannot drift away from the market the run actually sampled. The exit
// reference has to come from outside, because the pool contains nothing TORIUM
// would sell: every property in it is large and unrenovated.
import { assessDealQuality, DEFAULT_COSTS } from './deal-quality.js';
import { resolveMilanCanonicalZone } from './milan-area-taxonomy.js';

export const DEAL_RANKING_VERSION = 'deal_quality_ranking_v1';

// Four comparable listings is not a market, but on a run of a few hundred
// properties spread over ninety neighbourhoods it is what most areas will ever
// have. Below it the area is reported as unmeasured rather than guessed.
export const MINIMUM_AREA_SAMPLE = 4;

function pricePerSqm(candidate = {}) {
  const price = Number(candidate.price_eur ?? candidate.price);
  const size = Number(candidate.size_mq ?? candidate.size);
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null;
  return price / size;
}

function areaKeyOf(candidate = {}) {
  const neighbourhood = String(candidate.neighborhood || '').trim();
  if (neighbourhood) return neighbourhood;
  const zone = String(candidate.canonical_zone_id || '').trim();
  return zone || null;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * What comparable stock costs per square metre, by area, measured on the pool
 * itself.
 */
export function buildAreaBuyReferences(candidates = [], { minimumSample = MINIMUM_AREA_SAMPLE } = {}) {
  const byArea = new Map();
  for (const candidate of candidates) {
    const area = areaKeyOf(candidate);
    const eurMq = pricePerSqm(candidate);
    if (!area || eurMq === null) continue;
    // The same implausible values the exit benchmark refuses: a garage, a
    // fractional share, a typing error.
    if (eurMq < 1200 || eurMq > 22000) continue;
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(eurMq);
  }

  const references = new Map();
  for (const [area, values] of byArea) {
    references.set(area, {
      buy_eur_mq: values.length >= minimumSample ? Math.round(median(values)) : null,
      sample: values.length,
    });
  }
  return references;
}

/**
 * The exit price for one fractioned unit, from the measured benchmark. Reads
 * the bilocale band, because that is what the unit mix planner produces from
 * almost every property the search returns, and falls back through the other
 * bands rather than reporting nothing.
 */
function priceFromEntry(entry) {
  for (const band of ['bilocale', 'trilocale', 'monolocale']) {
    const price = entry?.exit_eur_mq?.[band];
    if (price?.eur_mq) {
      return {
        exit_eur_mq: price.eur_mq,
        exit_measured_at: price.measured_at,
        exit_sample: price.sample,
        exit_band: band,
      };
    }
  }
  return null;
}

export function exitReferenceFor(area, benchmark, canonicalZoneId = null) {
  const exact = benchmark?.zones?.find((zone) => zone.zone_id === area);
  const direct = priceFromEntry(exact);
  if (direct) return direct;

  // The two portals name the same streets differently - Idealista says
  // "Navigli - Porta Genova" and "Solari - Savona" where Immobiliare says
  // "Navigli - Darsena" and "Solari" - and the benchmark can only be keyed in
  // one of the two vocabularies. Keyed in Idealista's, as it is, 52 per cent of
  // Idealista's neighbourhoods find a price and only 16 per cent of
  // Immobiliare's, which is the larger source: the ranking would abstain on
  // most of what it ranks.
  //
  // The canonical Milan zone is the vocabulary both portals resolve into, so it
  // is what a name from either side falls back to. The price it finds there is
  // a zone median rather than a street one, and says so.
  if (!canonicalZoneId || !benchmark?.zones) return null;
  for (const zone of benchmark.zones) {
    if (zone.canonical_zone_id !== canonicalZoneId) continue;
    const price = priceFromEntry(zone);
    if (price && price.exit_measured_at === 'zone') return price;
  }
  return null;
}

/**
 * Assesses every candidate against its own area. Returns one entry per
 * candidate, in the order given, so a caller can sort or filter without losing
 * anything.
 */
export function assessCandidates(candidates = [], {
  benchmark = null,
  minimumSample = MINIMUM_AREA_SAMPLE,
  costs = DEFAULT_COSTS,
} = {}) {
  const buyReferences = buildAreaBuyReferences(candidates, { minimumSample });

  return candidates.map((candidate) => {
    const area = areaKeyOf(candidate);
    const buy = area ? buyReferences.get(area) : null;
    const zone = resolveMilanCanonicalZone(
      candidate.canonical_zone_id, candidate.neighborhood, candidate.district, candidate.address);
    const exit = area ? exitReferenceFor(area, benchmark, zone?.id ?? null) : null;

    return {
      candidate,
      area,
      assessment: assessDealQuality(candidate, {
        buy_eur_mq: buy?.buy_eur_mq ?? null,
        area_sample: buy?.sample ?? 0,
        ...(exit || {}),
      }, costs),
    };
  });
}

// An assessed deal that exactly breaks even sits at 50, so the number reads as
// "how far past break-even, in points of margin". An unassessable one sits at
// 25: below anything that covers its costs, above anything that plainly does
// not, and never silently treated as a failure.
export const UNASSESSABLE_SCORE = 25;

// The band an incomplete assessment is ordered within. It sits wholly below 50,
// so nothing unproven can outrank a property shown to cover its costs, and
// wholly above 0, so nothing unproven falls below one shown not to.
const UNASSESSABLE_FLOOR = 5;
const UNASSESSABLE_CEILING = 45;

export function dealRankingScore(assessment) {
  if (assessment?.status === 'assessed' && assessment.margin !== null) {
    return Math.max(0, Math.min(100, Math.round(50 + (assessment.margin * 100))));
  }

  // Not assessable, but not therefore silent. Where the discount to the area is
  // known - the exit price is missing, not the comparison - order by it inside
  // the band. Giving every one of them the same number is the one choice
  // guaranteed to be uninformative.
  const discount = assessment?.discount_to_area_pct;
  if (typeof discount !== 'number' || !Number.isFinite(discount)) return UNASSESSABLE_SCORE;

  // A discount of -20 per cent sits at the floor and +40 at the ceiling; beyond
  // that the scale stops rewarding, because a discount that large is at least
  // as likely to be a bare-ownership sale or an auction as a bargain, and this
  // run held only two of them - too few to justify a rule either way.
  const position = (Math.max(-20, Math.min(40, discount)) + 20) / 60;
  return Math.round(UNASSESSABLE_FLOOR + (position * (UNASSESSABLE_CEILING - UNASSESSABLE_FLOOR)));
}
