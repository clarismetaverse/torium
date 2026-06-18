function deepFindFirstNumber(value, keys) {
  if (!value || typeof value !== 'object') return null;

  for (const [key, currentValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (keys.some((candidate) => normalizedKey.includes(candidate))) {
      const number = parseNumericValue(currentValue);
      if (number !== null) return number;
    }
  }

  for (const currentValue of Object.values(value)) {
    if (currentValue && typeof currentValue === 'object') {
      const nested = deepFindFirstNumber(currentValue, keys);
      if (nested !== null) return nested;
    }
  }

  return null;
}

function parseNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const cleaned = value
    .replace(/€/g, '')
    .replace(/mq/g, '')
    .replace(/m²/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();

  const match = cleaned.match(/\d+(\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function textIncludesAny(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.some((term) => lower.includes(term));
}

export function extractListingBasics(listing) {
  const text = JSON.stringify(listing || {}).toLowerCase();

  return {
    price: deepFindFirstNumber(listing, ['price', 'prezzo']),
    surfaceMq: deepFindFirstNumber(listing, ['surface', 'size', 'superficie', 'mq', 'm2']),
    rooms: deepFindFirstNumber(listing, ['rooms', 'locali']),
    bathrooms: deepFindFirstNumber(listing, ['bathrooms', 'bagni']),
    hasFloorPlan: textIncludesAny(text, ['floorplan', 'floor_plan', 'planimetria', 'plan']) || Boolean(listing?.plan),
    doubleEntranceSignal: textIncludesAny(text, ['doppio ingresso', 'due ingressi', 'ingressi separati']),
    renovationSignal: textIncludesAny(text, ['da ristrutturare', 'ristrutturare', 'renew', 'da rifare']),
    priceReductionSignal: textIncludesAny(text, ['ribasso', 'riduzione prezzo', 'price reduction']),
  };
}

export function runDoorEngine(listing, investorProfile) {
  const basics = extractListingBasics(listing);

  const targetUnitMq = investorProfile.target_unit_types?.bilocale?.target_mq || 45;
  const existingUnits = investorProfile.default_existing_units || 1;
  const costPerNewUnit = investorProfile.cost_per_new_unit_eur || 20000;
  const purchaseCostRate = investorProfile.purchase_cost_rate || 0;

  const surfaceMq = basics.surfaceMq;
  const price = basics.price;

  const estimatedFinalUnits = surfaceMq ? Math.max(1, Math.floor(surfaceMq / targetUnitMq)) : null;
  const newUnitsCreated = estimatedFinalUnits !== null ? Math.max(0, estimatedFinalUnits - existingUnits) : null;
  const transformationCost = newUnitsCreated !== null ? newUnitsCreated * costPerNewUnit : null;
  const purchaseCosts = price !== null ? Math.round(price * purchaseCostRate) : null;
  const estimatedProjectCost = price !== null && transformationCost !== null
    ? price + purchaseCosts + transformationCost
    : null;

  let doorScore = 0;
  const reasons = [];

  if (surfaceMq && surfaceMq >= investorProfile.minimum_surface_mq) {
    doorScore += 20;
    reasons.push('surface_above_minimum');
  }

  if (estimatedFinalUnits && estimatedFinalUnits >= 2) {
    doorScore += Math.min(30, estimatedFinalUnits * 8);
    reasons.push('multiple_final_units_possible_by_surface');
  }

  if (newUnitsCreated && newUnitsCreated >= 1) {
    doorScore += Math.min(20, newUnitsCreated * 10);
    reasons.push('new_units_created');
  }

  if (basics.bathrooms && basics.bathrooms >= 2) {
    doorScore += 10;
    reasons.push('two_or_more_bathrooms');
  }

  if (basics.hasFloorPlan) {
    doorScore += 10;
    reasons.push('floor_plan_available');
  }

  if (basics.doubleEntranceSignal) {
    doorScore += 10;
    reasons.push('double_entrance_signal');
  }

  if (basics.renovationSignal) {
    doorScore += 5;
    reasons.push('renovation_signal');
  }

  if (basics.priceReductionSignal) {
    doorScore += 5;
    reasons.push('price_reduction_signal');
  }

  doorScore = Math.min(100, Math.round(doorScore));

  return {
    basics,
    investorProfileId: investorProfile.id,
    targetUnitMq,
    existingUnits,
    estimatedFinalUnits,
    newUnitsCreated,
    costPerNewUnit,
    transformationCost,
    purchaseCostRate,
    purchaseCosts,
    estimatedProjectCost,
    doorScore,
    doorScoreReasons: reasons,
  };
}
