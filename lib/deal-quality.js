// How good is this deal, as opposed to how divisible is this apartment.
//
// TORIUM has had one number where it needed two. The Door Score asks whether an
// apartment can be split; it says nothing about whether splitting it pays. On
// the run of 22 August 2026 the two moved in opposite directions: properties
// scoring 80 or more returned an average modelled ROI of -21.3 per cent against
// -8.2 per cent for those under 60, and 172 of the 201 best-scored properties
// lost money. A score cannot rank on a question it does not ask.
//
// Measured on the same run, what does discriminate is the discount to the
// neighbourhood. Of the properties priced at or above their area, none cleared
// break-even; of those 15 to 30 per cent below, 40 per cent did. That is the
// number this module computes.
//
// Feasibility remains necessary - nobody negotiates 25 per cent off a flat that
// cannot be divided - it is simply not the ranking criterion. It is the gate.

export const DEAL_QUALITY_VERSION = 'discount_to_area_break_even_v1';

export const DEFAULT_COSTS = Object.freeze({
  purchaseCostRate: 0.12,
  sellingCostRate: 0.03,
  costPerFinalUnitEur: 25000,
  saleableAreaRatio: 0.92,
});

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The spread this purchase has to clear to break even, expressed as a multiple
 * of its own price per square metre.
 *
 * It is computed per property rather than once for the city because the works
 * are a fixed cost per unit: 25,000 EUR on a 45 sqm unit is 19 per cent of a
 * 2,861 EUR/sqm purchase in Cimiano and 8 per cent of a 6,800 EUR/sqm one in
 * Sarpi. A single citywide threshold would rank the cheap areas as easier when
 * they are harder.
 */
export function breakEvenSpread({ purchaseEurMq, unitCount, saleableAreaMq }, costs = DEFAULT_COSTS) {
  const price = numberOrNull(purchaseEurMq);
  if (price === null) return null;

  const worksTotal = (numberOrNull(unitCount) ?? 0) * costs.costPerFinalUnitEur;
  const saleable = numberOrNull(saleableAreaMq);
  const worksPerSqm = saleable !== null && worksTotal > 0 ? worksTotal / saleable : 0;

  const costSide = ((1 + costs.purchaseCostRate) * price) + worksPerSqm;
  const revenueSide = costs.saleableAreaRatio * (1 - costs.sellingCostRate) * price;
  return Number((costSide / revenueSide).toFixed(3));
}

/**
 * @param {object} property - price, surface, and the planned unit count.
 * @param {object} area - what the neighbourhood says: the median price per
 *   square metre of comparable stock to buy, and the measured exit price of a
 *   renovated small unit.
 * @returns the two numbers a decision needs, and nothing it does not.
 */
export function assessDealQuality(property = {}, area = {}, costs = DEFAULT_COSTS) {
  const priceEur = numberOrNull(property.price_eur ?? property.price);
  const sizeMq = numberOrNull(property.size_mq ?? property.size);
  const purchaseEurMq = priceEur !== null && sizeMq !== null ? priceEur / sizeMq : null;

  const areaBuyEurMq = numberOrNull(area.buy_eur_mq);
  const exitEurMq = numberOrNull(area.exit_eur_mq);
  const unitCount = numberOrNull(property.estimated_final_units ?? property.unit_count);
  const saleableAreaMq = sizeMq !== null ? sizeMq * costs.saleableAreaRatio : null;

  // Every missing input is named. A deal that cannot be assessed must look
  // different from one assessed and found wanting.
  const missing = [];
  if (purchaseEurMq === null) missing.push('purchase_price_or_surface');
  if (areaBuyEurMq === null) missing.push('area_buy_benchmark');
  if (exitEurMq === null) missing.push('area_exit_benchmark');

  // An incomplete assessment is not an empty one. Missing the exit price for an
  // area says nothing about how this property is priced within it, and on a run
  // of 397 properties that distinction covered 106 of the 179 the assessment
  // could not complete - all of them previously given one identical score,
  // while their modelled returns ran from -68 to +73 per cent.
  const discountWhenKnown = purchaseEurMq !== null && areaBuyEurMq !== null
    ? Number(((1 - (purchaseEurMq / areaBuyEurMq)) * 100).toFixed(1))
    : null;

  if (missing.length) {
    return {
      version: DEAL_QUALITY_VERSION,
      status: 'unassessable',
      missing,
      discount_to_area_pct: discountWhenKnown,
      purchase_eur_mq: purchaseEurMq === null ? null : Math.round(purchaseEurMq),
      area_buy_eur_mq: areaBuyEurMq === null ? null : Math.round(areaBuyEurMq),
      spread: null,
      break_even_spread: null,
      margin: null,
      verdict: 'unknown',
    };
  }

  const discount = 1 - (purchaseEurMq / areaBuyEurMq);
  const spread = exitEurMq / purchaseEurMq;
  const required = breakEvenSpread({ purchaseEurMq, unitCount, saleableAreaMq }, costs);
  const margin = Number((spread - required).toFixed(3));

  return {
    version: DEAL_QUALITY_VERSION,
    status: 'assessed',
    missing: [],
    // Negative means priced above the neighbourhood, which on the measured run
    // was where nothing worked.
    discount_to_area_pct: Number((discount * 100).toFixed(1)),
    purchase_eur_mq: Math.round(purchaseEurMq),
    area_buy_eur_mq: Math.round(areaBuyEurMq),
    exit_eur_mq: Math.round(exitEurMq),
    spread: Number(spread.toFixed(3)),
    break_even_spread: required,
    margin,
    // Deliberately three words, not a hundred-point scale. The precision of a
    // score would be borrowed from medians built on a handful of listings.
    verdict: margin >= 0.10 ? 'works' : margin >= 0 ? 'marginal' : 'no',
    // Exit benchmarks borrowed from a whole zone are weaker evidence than ones
    // measured on the street, and the caller is entitled to know which it has.
    exit_measured_at: area.exit_measured_at || null,
    exit_sample: area.exit_sample ?? null,
  };
}

/**
 * Ranks assessed deals. Feasibility is a gate applied by the caller, not a
 * term in this ordering: once a property is known to be divisible, how much
 * more divisible it is tells you nothing about the return.
 */
export function rankByDealQuality(assessments = []) {
  return [...assessments]
    .filter((entry) => entry?.assessment?.status === 'assessed')
    .sort((left, right) => right.assessment.margin - left.assessment.margin);
}
