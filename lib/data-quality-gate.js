export const DATA_QUALITY_GATE_VERSION = 'data_quality_gate_v1';

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function listingOf(result) {
  return result?.listing && typeof result.listing === 'object' ? result.listing : {};
}

/**
 * Rejects only inputs that would make the ranking or underwriting materially
 * misleading. Incomplete but plausible listings remain eligible and receive
 * warnings, so missing source data is not confused with corrupted source data.
 */
export function evaluateDataQuality(result) {
  const listing = listingOf(result);
  const door = result?.door_engine || {};
  const price = firstNumber(listing.price, result?.price_eur, result?.price);
  const size = firstNumber(listing.size, result?.size_mq, result?.size);
  const priceM2 = firstNumber(listing.priceByArea, result?.price_by_area);
  const bathrooms = firstNumber(listing.bathrooms, result?.bathrooms);
  const finalUnits = firstNumber(door.estimatedFinalUnits, result?.estimated_final_units);
  const newUnits = firstNumber(door.newUnitsCreated, result?.new_units_created);
  const criticalFlags = [];
  const warningFlags = [];

  if (price === null || price <= 0) criticalFlags.push('missing_or_invalid_price');
  if (size === null || size <= 0) criticalFlags.push('missing_or_invalid_surface');

  // This broad ceiling is deliberately conservative: a 700 sqm duplex can be
  // real, while an 8,500 sqm record classified as a flat is almost certainly a
  // scrape/unit error and would dominate every area-based estimate.
  if (size !== null && size > 1500) criticalFlags.push('implausible_surface');
  else if (size !== null && size > 600) warningFlags.push('unusually_large_surface');

  if (bathrooms !== null && bathrooms > 20) criticalFlags.push('implausible_bathroom_count');
  else if (bathrooms !== null && bathrooms > 8) warningFlags.push('unusually_high_bathroom_count');
  if (bathrooms === null) warningFlags.push('missing_bathroom_count');

  if (priceM2 !== null && (priceM2 < 500 || priceM2 > 30000)) {
    criticalFlags.push('implausible_price_per_sqm');
  }

  if (price !== null && price > 0 && size !== null && size > 0 && priceM2 !== null && priceM2 > 0) {
    const derivedPriceM2 = price / size;
    const mismatch = Math.abs(priceM2 - derivedPriceM2) / derivedPriceM2;
    if (mismatch > 0.15) criticalFlags.push('price_per_sqm_inconsistent');
    else if (mismatch > 0.05) warningFlags.push('price_per_sqm_rounding_mismatch');
  }

  if (size !== null && size > 0 && finalUnits !== null) {
    const physicalMaximum = Math.max(1, Math.floor(size / 28));
    if (finalUnits < 1 || finalUnits > physicalMaximum) criticalFlags.push('impossible_final_unit_count');
  }
  if (newUnits !== null && (newUnits < 0 || (finalUnits !== null && newUnits > Math.max(0, finalUnits - 1)))) {
    criticalFlags.push('impossible_new_unit_count');
  }

  const hasPlan = result?.has_plan === true || listing.hasPlan === true ||
    (Array.isArray(result?.floor_plans) && result.floor_plans.length > 0) ||
    (Array.isArray(listing.floor_plans) && listing.floor_plans.length > 0);
  if (!hasPlan) warningFlags.push('missing_floor_plan');

  const address = result?.address || listing.address || result?.source_row?.address;
  if (!String(address || '').trim()) warningFlags.push('missing_address');

  const valid = criticalFlags.length === 0;
  return {
    version: DATA_QUALITY_GATE_VERSION,
    status: valid ? 'pass' : 'review',
    valid,
    score: Math.max(0, 100 - (criticalFlags.length * 40) - (warningFlags.length * 5)),
    critical_flags: criticalFlags,
    warning_flags: warningFlags,
    checked_values: {
      price_eur: price,
      size_mq: size,
      price_per_sqm: priceM2,
      bathrooms,
      estimated_final_units: finalUnits,
      new_units_created: newUnits,
    },
  };
}
