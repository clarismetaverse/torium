import test from 'node:test';
import assert from 'node:assert/strict';
import { runDoorEngine } from '../lib/door-engine.js';
import { buildStrategySearchName, compareShortlistItems, resolveSearchStrategy } from '../lib/search-strategies.js';

const profile = {
  id: 'test',
  target_unit_types: { bilocale: { target_mq: 45 } },
  default_existing_units: 1,
  cost_per_final_unit_eur: 25000,
  cost_per_trilocale_eur: 30000,
  purchase_cost_rate: 0.12,
  minimum_surface_mq: 90,
};

test('legacy keeps price signals while neutral removes every economic reason', () => {
  const listing = {
    price: 300000,
    surface: 120,
    bathrooms: 2,
    description: 'Da ristrutturare con planimetria e ribasso prezzo',
  };
  const legacy = resolveSearchStrategy('legacy_low_price_m2');
  const neutral = resolveSearchStrategy('neutral_fractionability');
  const legacyResult = runDoorEngine(listing, profile, {
    includeEconomicSignals: legacy.includeEconomicDoorSignals,
    scoringMode: legacy.scoringMode,
  });
  const neutralResult = runDoorEngine(listing, profile, {
    includeEconomicSignals: neutral.includeEconomicDoorSignals,
    scoringMode: neutral.scoringMode,
  });

  assert.ok(legacyResult.doorScoreReasons.includes('strong_price_m2_opportunity'));
  assert.ok(legacyResult.doorScoreReasons.includes('price_reduction_signal'));
  assert.ok(!neutralResult.doorScoreReasons.some((reason) => reason.includes('price_m2') || reason === 'price_reduction_signal'));
  assert.ok(legacyResult.doorScore > neutralResult.doorScore);
  assert.equal(neutralResult.estimatedFinalUnits, 3);
  assert.equal(neutralResult.costPerFinalUnit, 25000);
  assert.equal(neutralResult.transformationCost, 75000);
});

test('neutral does not use price/m2 to break equal physical scores', () => {
  const cheap = { door_score: 50, price_by_area: 2000 };
  const expensive = { door_score: 50, price_by_area: 8000 };
  assert.ok(compareShortlistItems(cheap, expensive, resolveSearchStrategy('legacy_low_price_m2')) < 0);
  assert.equal(compareShortlistItems(cheap, expensive, resolveSearchStrategy('neutral_fractionability')), 0);
});

test('search names are distinct and strategy selection is strict', () => {
  assert.equal(buildStrategySearchName('milanoFractioningMassive', resolveSearchStrategy('legacy_low_price_m2')), 'milanoFractioningMassive-legacy_low_price_m2');
  assert.equal(buildStrategySearchName('milanoFractioningMassive', resolveSearchStrategy('neutral_fractionability')), 'milanoFractioningMassive-neutral_fractionability');
  assert.throws(() => resolveSearchStrategy('unknown'), /Unsupported TORIUM_SEARCH_STRATEGY/);
});
