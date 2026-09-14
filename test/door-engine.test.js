import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDoorEngine } from '../lib/door-engine.js';

const PROFILE = JSON.parse(readFileSync(
  new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url), 'utf8'));

function listing(overrides = {}) {
  return {
    size: 150,
    price: 600000,
    bathrooms: 1,
    hasPlan: false,
    description: 'appartamento',
    renovation_features: {},
    ...overrides,
  };
}

const physical = (overrides) => runDoorEngine(listing(overrides), PROFILE, { includeEconomicSignals: false });

test('an apartment too small to make a second unit cannot be divided', () => {
  const result = physical({ size: 55 });
  assert.equal(result.fractioningFeasible, false);
  assert.equal(result.doorScore, 0);
  assert.ok(result.doorScoreReasons.includes('surface_cannot_create_a_second_unit'));
});

test('zero means undividable, not merely undocumented', () => {
  // A flat that can be split but whose listing shows nothing about how is a
  // different case from one that cannot be split, and must not score the same.
  const undocumented = physical({ size: 150, hasPlan: false });
  assert.equal(undocumented.fractioningFeasible, true);
  assert.ok(undocumented.doorScore > 0, 'a feasible apartment scores above zero');
  assert.ok(undocumented.doorScore < physical({ size: 150, hasPlan: true }).doorScore);
});

test('the score rises only with evidence of the division itself', () => {
  const bare = physical({});
  const withPlan = physical({ hasPlan: true });
  const withBoth = physical({ hasPlan: true, description: 'con doppio ingresso' });

  assert.ok(withPlan.doorScore > bare.doorScore);
  assert.ok(withBoth.doorScore > withPlan.doorScore);
  assert.ok(withBoth.doorScoreReasons.includes('double_entrance_signal'));
});

test('bathrooms no longer move the score', () => {
  // Measured on the run of 22 August 2026, the bathroom bonus fired on 513
  // properties averaging -18.2 per cent modelled ROI against -6.8 per cent for
  // the ones it skipped. It reads luxury, not plumbing for a second unit.
  const one = physical({ bathrooms: 1 });
  const three = physical({ bathrooms: 3 });
  const six = physical({ bathrooms: 6 });

  assert.equal(one.doorScore, three.doorScore);
  assert.equal(three.doorScore, six.doorScore);
  assert.equal(one.doorScoreReasons.some((reason) => reason.includes('bathroom')), false);
});

test('surface above the minimum is not worth points to every property the search returns', () => {
  // The search already filters for large apartments, so this fired on 770 of
  // 770 and was worth 20 points to all of them.
  const result = physical({ size: 300 });
  assert.equal(result.doorScoreReasons.includes('surface_above_minimum'), false);
  assert.equal(result.doorScoreReasons.includes('new_units_created'), false);
  assert.equal(result.doorScoreReasons.includes('multiple_final_units_possible_by_surface'), false);
});

test('more doors do not mean a higher score', () => {
  // How many units fit is a fact about the surface, reported separately. It is
  // not evidence that the division is real, and it was worth up to 42 points.
  const two = physical({ size: 100 });
  const seven = physical({ size: 320 });
  assert.ok(seven.estimatedFinalUnits > two.estimatedFinalUnits);
  assert.equal(seven.doorScore, two.doorScore);
});

test('the score says what it is, and what it is not', () => {
  const result = physical({ hasPlan: true });
  assert.equal(result.doorScoreMeaning, 'physical_feasibility_only');
  assert.equal(result.scoringMode, 'physical_feasibility_v2');
});

test('the economic strategy still adds its own signals on top', () => {
  const neutral = runDoorEngine(listing({ hasPlan: true, status: 'renew' }), PROFILE,
    { includeEconomicSignals: false });
  const economic = runDoorEngine(listing({ hasPlan: true, status: 'renew' }), PROFILE,
    { includeEconomicSignals: true });

  assert.ok(economic.doorScore > neutral.doorScore);
  assert.equal(economic.scoringMode, 'legacy_physical_plus_economic_v2');
});

test('the structural facts are still reported, just not scored', () => {
  const result = physical({ size: 150 });
  assert.equal(typeof result.estimatedFinalUnits, 'number');
  assert.equal(typeof result.newUnitsCreated, 'number');
  assert.ok(result.saleableAreaMq > 0);
  assert.ok(Array.isArray(result.plannedUnitMix));
});
