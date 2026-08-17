import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateUnderwriting,
  summarizeRoi,
  underwritingFromResult,
} from '../lib/financial-underwriting.js';

test('calculates the agreed project costs and low/base/high ROI scenarios', () => {
  const result = calculateUnderwriting({
    purchasePriceEur: 397000,
    finalUnits: 3,
    exitValues: { low: 795000, base: 890000, high: 985000 },
  });

  assert.deepEqual(result.costs, {
    purchasePriceEur: 397000,
    purchaseCostsEur: 47640,
    transformationCostEur: 75000,
    projectCostEur: 519640,
    finalUnits: 3,
    newUnitsCreated: 2,
  });
  assert.equal(result.assumptions.costPerFinalUnitEur, 25000);
  assert.equal(result.assumptions.sellingCostRate, 0.03);
  assert.equal(result.scenarios.base.sellingCostEur, 26700);
  assert.equal(result.scenarios.base.totalCostEur, 546340);
  assert.equal(result.scenarios.base.profitLossEur, 343660);
  assert.equal(result.scenarios.base.roiPct, 62.9);
  assert.equal(result.scenarios.low.roiPct, 46.28);
  assert.equal(result.scenarios.high.roiPct, 79.36);
  assert.equal(result.status, 'complete');
});

test('re-underwrites legacy door fields using all final units and sums their valuations', () => {
  const valued = underwritingFromResult({
    listing: { price: 200000 },
    door_engine: {
      estimatedFinalUnits: 2,
      newUnitsCreated: 1,
      costPerNewUnit: 20000,
      transformationCost: 20000,
      estimatedProjectCost: 244000,
    },
    gpt_analysis: {
      final_unit_plan: [
        { sale_value_low_eur: 140000, sale_value_base_eur: 150000, sale_value_high_eur: 160000 },
        { sale_value_low_eur: 150000, sale_value_base_eur: 165000, sale_value_high_eur: 180000 },
      ],
    },
  });
  assert.equal(valued.scenarios.base.exitValueEur, 315000);
  assert.equal(valued.costs.transformationCostEur, 50000);
  assert.equal(valued.costs.finalUnits, 2);
  assert.equal(valued.scenarios.base.sellingCostEur, 9450);
  assert.equal(valued.scenarios.base.totalCostEur, 283450);
  assert.equal(valued.scenarios.base.profitLossEur, 31550);
  assert.equal(valued.scenarios.base.roiPct, 11.13);

  const unvalued = calculateUnderwriting({ purchasePriceEur: 200000, finalUnits: 2 });
  assert.equal(unvalued.costs.projectCostEur, 274000);
  assert.equal(unvalued.scenarios.base.exitValueEur, null);
  assert.equal(unvalued.scenarios.base.profitLossEur, null);
  assert.equal(unvalued.scenarios.base.roiPct, null);
  assert.equal(unvalued.status, 'missing_exit_valuation');
});

test('ROI summary excludes properties without a valuation', () => {
  const summary = summarizeRoi([
    { scenarios: { base: { roiPct: 10 } } },
    { scenarios: { base: { roiPct: null } } },
    { scenarios: { base: { roiPct: 30 } } },
    { scenarios: { base: { roiPct: 20 } } },
  ]);
  assert.deepEqual(summary, {
    valuedCount: 3,
    averageBaseRoiPct: 20,
    medianBaseRoiPct: 20,
  });
});

test('Viale Umbria example charges four final units at EUR 25,000 each', () => {
  const result = calculateUnderwriting({
    purchasePriceEur: 730000,
    finalUnits: 4,
    exitValues: { base: 1420000 },
  });

  assert.equal(result.costs.transformationCostEur, 100000);
  assert.equal(result.costs.projectCostEur, 917600);
  assert.equal(result.scenarios.base.sellingCostEur, 42600);
  assert.equal(result.scenarios.base.totalCostEur, 960200);
  assert.equal(result.scenarios.base.profitLossEur, 459800);
  assert.equal(result.scenarios.base.roiPct, 47.89);
});

test('charges trilocali at EUR 30,000 and smaller unit types at EUR 25,000', () => {
  const result = calculateUnderwriting({
    purchasePriceEur: 500000,
    finalUnitPlan: [
      { unit_type: 'bilocale' },
      { unit_type: 'monolocale' },
      { unit_type: 'trilocale' },
      { unit_type: 'trilocale' },
    ],
  });

  assert.equal(result.costs.finalUnits, 4);
  assert.equal(result.costs.transformationCostEur, 110000);
  assert.equal(result.assumptions.costPerFinalUnitEur, 25000);
  assert.equal(result.assumptions.costPerTrilocaleEur, 30000);
});
