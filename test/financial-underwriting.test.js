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
    newUnitsCreated: 2,
    exitValues: { low: 795000, base: 890000, high: 985000 },
  });

  assert.deepEqual(result.costs, {
    purchasePriceEur: 397000,
    purchaseCostsEur: 47640,
    transformationCostEur: 40000,
    projectCostEur: 484640,
    newUnitsCreated: 2,
  });
  assert.equal(result.scenarios.base.profitLossEur, 405360);
  assert.equal(result.scenarios.base.roiPct, 83.64);
  assert.equal(result.scenarios.low.roiPct, 64.04);
  assert.equal(result.scenarios.high.roiPct, 103.24);
  assert.equal(result.status, 'complete');
});

test('sums final-unit valuations and does not convert missing exits into zero', () => {
  const valued = underwritingFromResult({
    listing: { price: 200000 },
    door_engine: { newUnitsCreated: 1 },
    gpt_analysis: {
      final_unit_plan: [
        { sale_value_low_eur: 140000, sale_value_base_eur: 150000, sale_value_high_eur: 160000 },
        { sale_value_low_eur: 150000, sale_value_base_eur: 165000, sale_value_high_eur: 180000 },
      ],
    },
  });
  assert.equal(valued.scenarios.base.exitValueEur, 315000);
  assert.equal(valued.scenarios.base.profitLossEur, 71000);
  assert.equal(valued.scenarios.base.roiPct, 29.1);

  const unvalued = calculateUnderwriting({ purchasePriceEur: 200000, newUnitsCreated: 1 });
  assert.equal(unvalued.costs.projectCostEur, 244000);
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
