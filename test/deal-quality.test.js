import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessDealQuality,
  breakEvenSpread,
  rankByDealQuality,
  DEFAULT_COSTS,
} from '../lib/deal-quality.js';

// Cimiano on the run of 22 August 2026: the one neighbourhood of fourteen whose
// spread cleared its own break-even at asking prices.
const CIMIANO = { buy_eur_mq: 2861, exit_eur_mq: 4516, exit_measured_at: 'neighbourhood', exit_sample: 6 };
// Sarpi: a good address where the spread does not cover the works.
const SARPI = { buy_eur_mq: 6800, exit_eur_mq: 7911, exit_measured_at: 'zone', exit_sample: 5 };

test('the break-even spread is higher in cheap areas, not lower', () => {
  // The works cost the same euros wherever the flat is, so they are a larger
  // share of a cheap purchase. A single citywide threshold gets this backwards.
  const cheap = breakEvenSpread({ purchaseEurMq: 2861, unitCount: 3, saleableAreaMq: 138 });
  const dear = breakEvenSpread({ purchaseEurMq: 6800, unitCount: 3, saleableAreaMq: 138 });
  assert.ok(cheap > dear, `cheap ${cheap} should need more than dear ${dear}`);
  assert.ok(cheap > 1.4 && cheap < 1.55, 'cheap area break-even was ' + cheap);
  assert.ok(dear > 1.3 && dear < 1.4, 'dear area break-even was ' + dear);
});

test('a property bought at the neighbourhood price is reported as such', () => {
  const result = assessDealQuality(
    { price_eur: 2861 * 150, size_mq: 150, estimated_final_units: 3 }, CIMIANO);
  assert.equal(result.status, 'assessed');
  assert.equal(result.discount_to_area_pct, 0);
});

test('a discount to the neighbourhood is what moves the margin', () => {
  const atArea = assessDealQuality(
    { price_eur: 2861 * 150, size_mq: 150, estimated_final_units: 3 }, CIMIANO);
  const discounted = assessDealQuality(
    { price_eur: 2861 * 150 * 0.75, size_mq: 150, estimated_final_units: 3 }, CIMIANO);

  assert.ok(discounted.discount_to_area_pct > 24 && discounted.discount_to_area_pct < 26);
  assert.ok(discounted.margin > atArea.margin);
  assert.equal(discounted.verdict, 'works');
});

test('a good address with a thin spread does not pass', () => {
  const result = assessDealQuality(
    { price_eur: 6800 * 150, size_mq: 150, estimated_final_units: 3 }, SARPI);
  assert.equal(result.verdict, 'no');
  assert.ok(result.spread < result.break_even_spread);
});

test('the verdict is three words, and marginal is its own word', () => {
  const verdicts = new Set();
  // Cimiano tolerates paying a little over the area price and still works, so
  // reaching "no" there takes a real overpayment.
  for (const factor of [0.6, 0.75, 0.85, 1.05, 1.3]) {
    verdicts.add(assessDealQuality(
      { price_eur: 2861 * 150 * factor, size_mq: 150, estimated_final_units: 3 }, CIMIANO).verdict);
  }
  assert.ok(verdicts.has('works'));
  assert.ok(verdicts.has('no'));
  assert.ok([...verdicts].every((verdict) => ['works', 'marginal', 'no'].includes(verdict)));
});

test('a deal that cannot be assessed is not a deal that failed', () => {
  const noExit = assessDealQuality(
    { price_eur: 400000, size_mq: 150, estimated_final_units: 3 },
    { buy_eur_mq: 2861 });
  assert.equal(noExit.status, 'unassessable');
  assert.deepEqual(noExit.missing, ['area_exit_benchmark']);
  assert.equal(noExit.verdict, 'unknown');
  assert.equal(noExit.margin, null);

  const noPrice = assessDealQuality({ size_mq: 150 }, CIMIANO);
  assert.ok(noPrice.missing.includes('purchase_price_or_surface'));
});

test('a borrowed exit price is flagged as borrowed', () => {
  const own = assessDealQuality(
    { price_eur: 400000, size_mq: 150, estimated_final_units: 3 }, CIMIANO);
  const borrowed = assessDealQuality(
    { price_eur: 400000, size_mq: 150, estimated_final_units: 3 }, SARPI);
  assert.equal(own.exit_measured_at, 'neighbourhood');
  assert.equal(borrowed.exit_measured_at, 'zone');
});

test('ranking ignores how divisible a property is', () => {
  // Two properties, identical economics, very different unit counts. The one
  // with more doors must not win on that account.
  const manyDoors = {
    id: 'many',
    assessment: assessDealQuality(
      { price_eur: 2861 * 300 * 0.8, size_mq: 300, estimated_final_units: 7 }, CIMIANO),
  };
  const fewDoors = {
    id: 'few',
    assessment: assessDealQuality(
      { price_eur: 2861 * 120 * 0.6, size_mq: 120, estimated_final_units: 2 }, CIMIANO),
  };
  const unassessable = { id: 'unknown', assessment: assessDealQuality({}, {}) };

  const ranked = rankByDealQuality([manyDoors, fewDoors, unassessable]);
  assert.deepEqual(ranked.map((entry) => entry.id), ['few', 'many'],
    'the deeper discount wins, whatever the door count');
  assert.equal(ranked.length, 2, 'an unassessable property is not ranked at all');
});

test('the cost assumptions are the ones the underwriting already uses', () => {
  assert.equal(DEFAULT_COSTS.purchaseCostRate, 0.12);
  assert.equal(DEFAULT_COSTS.sellingCostRate, 0.03);
  assert.equal(DEFAULT_COSTS.costPerFinalUnitEur, 25000);
  assert.equal(DEFAULT_COSTS.saleableAreaRatio, 0.92);
});
