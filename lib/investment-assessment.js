import { calculateUnderwriting } from './financial-underwriting.js';
import { lookupAskingPrice } from './asking-price-benchmark.js';

export const INVESTMENT_ASSESSMENT_VERSION = 'unit_mix_asking_underwriting_v2';
export function assessInvestment({ listing, doorEngine: door, benchmark, now }) {
  const unknown = reason => ({ version: INVESTMENT_ASSESSMENT_VERSION, status: 'unassessable', missing: [reason], ranking_score: null });
  const units = door.plannedUnitMix || [];
  if (!(door.newUnitsCreated >= 1 && units.length >= 2)) return { ...unknown('surface_split_not_supported'), status: 'not_fractionable' };
  if (!(Number(listing.price) > 0 && Number.isFinite(Number(listing.price)))) return unknown('purchase_price');
  const references = units.map(unit => lookupAskingPrice(benchmark, { city: listing.city || listing.municipality,
    neighborhood: listing.neighborhood, unitType: unit.unit_type, sizeMq: unit.estimated_size_mq, now }));
  if (references.some(r => !r)) return unknown('fresh_renovated_comparables_for_each_unit');
  return assessUnitEconomics({ purchasePriceEur: Number(listing.price), units, references, door, benchmark });
}

export function assessUnitEconomics({ purchasePriceEur, units, references, door = {}, benchmark = {} }) {
  const area = units.reduce((sum, u) => sum + u.estimated_size_mq, 0);
  if (!(purchasePriceEur > 0 && Number.isFinite(purchasePriceEur) && area > 0) || units.length !== references.length
    || !units.length || units.some(u => !(u.estimated_size_mq > 0 && Number.isFinite(u.estimated_size_mq)))) throw Error('Invalid unit economics input');
  const exits = {};
  for (const [scenario, field] of [['low','p25_eur_mq'], ['base','median_eur_mq'], ['high','p75_eur_mq']]) {
    if (references.some(r => !(r?.[field] > 0 && Number.isFinite(r[field])))) throw Error('Invalid unit price reference');
    exits[scenario] = units.reduce((sum, u, i) => sum + u.estimated_size_mq * references[i][field], 0);
  }
  const underwriting = calculateUnderwriting({ purchasePriceEur, finalUnits: units.length, finalUnitPlan: units,
    purchaseCostRate: door.purchaseCostRate, costPerFinalUnitEur: door.costPerFinalUnit, costPerTrilocaleEur: door.costPerTrilocale,
    exitValues: exits });
  const breakEvenExitEur = underwriting.costs.projectCostEur / (1 - underwriting.assumptions.sellingCostRate);
  return { version: INVESTMENT_ASSESSMENT_VERSION, status: 'assessed', price_basis: 'asking_not_achieved', missing: [],
    benchmark_version: benchmark.version || null, benchmark_hash: benchmark.input_sha256 || null,
    break_even_exit_eur: breakEvenExitEur, break_even_eur_mq: breakEvenExitEur / area,
    verdict: underwriting.scenarios.base.profitLossEur >= 0 ? 'covers_modelled_costs' : 'below_modelled_costs',
    ranking_score: underwriting.scenarios.base.roiPct, underwriting, unit_references: references };
}

// Missing evidence is a separate group, never a fabricated return of 25/100.
export function compareInvestments(a, b) {
  const priority = { assessed: 0, unassessable: 1, not_fractionable: 2 };
  const x = a.investment_assessment, y = b.investment_assessment;
  return (priority[x?.status] ?? 1) - (priority[y?.status] ?? 1)
    || (x?.status === 'assessed' && y?.status === 'assessed' ? y.ranking_score - x.ranking_score : 0)
    || String(a.source_key || a.source_listing_id || a.id || '').localeCompare(String(b.source_key || b.source_listing_id || b.id || ''));
}
