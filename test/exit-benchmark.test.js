import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExitBenchmarks,
  citywideSizePremium,
  classifyCondition,
  classifySizeBand,
  MINIMUM_SAMPLE,
} from '../lib/exit-benchmark.js';

function listing(overrides = {}) {
  return {
    neighborhood: 'Navigli - Darsena',
    size_mq: 50,
    price_eur: 350000,
    queried_condition: 'good',
    status: 'good',
    ...overrides,
  };
}

function many(count, overrides = {}) {
  return Array.from({ length: count }, (_unused, index) => listing({
    ...overrides,
    // Distinct prices, because identical ones are how a relisting looks and the
    // builder is entitled to treat them as one property.
    price_eur: (overrides.price_eur ?? 350000) + (index * 1000),
    source_listing_id: [
      overrides.source_listing_id ?? 'fixture',
      overrides.neighborhood ?? 'navigli',
      overrides.size_mq ?? 50,
      overrides.queried_condition ?? 'good',
      index,
    ].join('-'),
  }));
}

test('size bands follow the units a fractioning project creates', () => {
  assert.equal(classifySizeBand(35), 'monolocale');
  assert.equal(classifySizeBand(45), 'bilocale');
  assert.equal(classifySizeBand(75), 'trilocale');
  assert.equal(classifySizeBand(150), 'large');
  assert.equal(classifySizeBand(0), null);
  assert.equal(classifySizeBand('abc'), null);
});

test('condition comes from the query that found the listing', () => {
  // The scrape asked Idealista for one market or the other, which is more
  // reliable than reading an agent's prose.
  assert.equal(classifyCondition({ queried_condition: 'renew' }), 'to_renovate');
  assert.equal(classifyCondition({ queried_condition: 'good' }), 'renovated');
  assert.equal(classifyCondition({ queried_condition: 'newDevelopment' }), 'renovated');
});

test('without a query tag the listing status is used, and silence stays unknown', () => {
  assert.equal(classifyCondition({ status: 'renew' }), 'to_renovate');
  assert.equal(classifyCondition({ status: 'excellent' }), 'renovated');
  assert.equal(classifyCondition({}), 'unknown');
});

test('a segment under the sample floor is reported, not published', () => {
  const benchmark = buildExitBenchmarks(many(MINIMUM_SAMPLE - 1));
  const zone = benchmark.zones.find((entry) => entry.zone_id === 'Navigli - Darsena');
  assert.equal(zone.bands.bilocale.renovated.count, MINIMUM_SAMPLE - 1);
  assert.equal(zone.bands.bilocale.renovated.usable, false);
  assert.equal(zone.exit_eur_mq.bilocale, null,
    'an unusable segment must not become an exit price');
});

test('the size premium is measured against large units in the same zone', () => {
  const benchmark = buildExitBenchmarks([
    // 50 sqm renovated at 8,000/sqm
    ...many(10, { size_mq: 50, price_eur: 400000 }),
    // 150 sqm renovated at 6,000/sqm
    ...many(10, { size_mq: 150, price_eur: 900000 }),
  ]);
  const zone = benchmark.zones.find((entry) => entry.zone_id === 'Navigli - Darsena');

  assert.equal(zone.bands.bilocale.renovated.usable, true);
  assert.equal(zone.bands.large.renovated.usable, true);
  // Roughly 8,000 / 6,000, allowing for the spread the fixture adds.
  assert.ok(zone.size_premium.bilocale_over_large > 1.3
    && zone.size_premium.bilocale_over_large < 1.4,
  'premium was ' + zone.size_premium.bilocale_over_large);
  assert.equal(zone.exit_eur_mq.bilocale.eur_mq, zone.bands.bilocale.renovated.median_eur_mq);
  assert.equal(zone.exit_eur_mq.bilocale.measured_at, 'neighbourhood',
    'a price this area measured itself must not be reported as borrowed');
});

test('the renovation premium separates what we sell from what we buy', () => {
  const benchmark = buildExitBenchmarks([
    ...many(10, { size_mq: 50, price_eur: 400000, queried_condition: 'good', status: 'good' }),
    ...many(10, { size_mq: 50, price_eur: 300000, queried_condition: 'renew', status: 'renew' }),
  ]);
  const zone = benchmark.zones.find((entry) => entry.zone_id === 'Navigli - Darsena');

  assert.ok(zone.bands.bilocale.renovation_premium > 1.3);
  assert.notEqual(
    zone.bands.bilocale.renovated.median_eur_mq,
    zone.bands.bilocale.to_renovate.median_eur_mq,
    'the two markets must never collapse into one number');
});

test('implausible prices are counted out rather than allowed to move a median', () => {
  const benchmark = buildExitBenchmarks([
    ...many(10, { size_mq: 50, price_eur: 400000 }),
    listing({ size_mq: 50, price_eur: 20000 }),      // 400 EUR/sqm
    listing({ size_mq: 50, price_eur: 2000000 }),    // 40,000 EUR/sqm
  ]);
  assert.equal(benchmark.coverage.rejected.implausible_price, 2);
  assert.equal(benchmark.coverage.listings_used, 10);
});

test('a listing whose zone cannot be resolved is rejected, never guessed', () => {
  const benchmark = buildExitBenchmarks([
    listing({ neighborhood: 'Somewhere In Another City', district: null, address: null }),
  ]);
  assert.equal(benchmark.coverage.rejected.no_zone, 1);
  assert.equal(benchmark.zones.length, 0);
});

test('a query and a listing that disagree about condition are counted', () => {
  const benchmark = buildExitBenchmarks([
    ...many(9, { queried_condition: 'good', status: 'renew' }),
  ]);
  assert.equal(benchmark.coverage.condition_conflicts, 9,
    'a high conflict rate means the condition filter is not working');
});

test('the citywide premium pools zones instead of trusting a thin one', () => {
  const benchmark = buildExitBenchmarks([
    ...many(10, { neighborhood: 'Navigli - Darsena', size_mq: 50, price_eur: 400000 }),
    ...many(10, { neighborhood: 'Navigli - Darsena', size_mq: 150, price_eur: 900000 }),
    ...many(10, { neighborhood: 'Baggio', size_mq: 50, price_eur: 200000 }),
    ...many(10, { neighborhood: 'Baggio', size_mq: 150, price_eur: 480000 }),
  ]);
  const premium = citywideSizePremium(benchmark);
  assert.equal(premium.zones_contributing.bilocale, 2);
  assert.ok(premium.bilocale_over_large > 1.2, 'pooled premium was ' + premium.bilocale_over_large);
});

test('the same apartment listed twice counts once', () => {
  // Eight identical rows at one price is how a relisting, an overlapping query
  // and a development published unit by unit all look. Counted separately they
  // drag a thin median onto whatever that one property costs, which is exactly
  // what happened to San Siro in the first real measurement.
  const twin = listing({ size_mq: 50, price_eur: 97500, source_listing_id: 'x-1' });
  const benchmark = buildExitBenchmarks([
    ...many(10, { size_mq: 50, price_eur: 400000 }),
    twin,
    { ...twin },
    { ...twin, source_listing_id: 'x-2' },
  ]);

  assert.equal(benchmark.coverage.rejected.duplicate, 2,
    'the second and third copies are the same flat by id or by price and size');
  assert.equal(benchmark.coverage.listings_used, 11);
});

test('areas are measured by neighbourhood, because the zone gives the wrong sign', () => {
  // Two neighbourhoods of one canonical zone, priced differently. Pooled into
  // the zone they would produce a single misleading median; kept apart they
  // produce the two real ones. This is the difference that flipped the measured
  // size premium from 0.88 to 1.06 on production data.
  const benchmark = buildExitBenchmarks([
    ...many(10, { neighborhood: 'Navigli - Darsena', size_mq: 50, price_eur: 400000 }),
    ...many(10, { neighborhood: 'Bocconi', size_mq: 50, price_eur: 250000 }),
  ]);

  const ids = benchmark.zones.map((zone) => zone.zone_id).sort();
  assert.deepEqual(ids, ['Bocconi', 'Navigli - Darsena']);
  assert.equal(benchmark.zones.every((zone) => zone.area_level === 'neighbourhood'), true);
  assert.equal(benchmark.zones.every((zone) => zone.canonical_zone_id === 'navigli'), true,
    'the canonical zone is still recorded, it just no longer decides the bucket');
  assert.notEqual(
    benchmark.zones[0].bands.bilocale.renovated.median_eur_mq,
    benchmark.zones[1].bands.bilocale.renovated.median_eur_mq);
});

test('a listing outside Milan is still refused, however it names its area', () => {
  const benchmark = buildExitBenchmarks([
    ...many(10, { neighborhood: 'Trastevere', district: null, address: null }),
  ]);
  assert.equal(benchmark.coverage.rejected.no_zone, 10);
  assert.equal(benchmark.zones.length, 0);
});

test('a thin neighbourhood borrows its zone price and says so', () => {
  // Four listings on one street cannot set a price. The zone they belong to
  // can, and the reader is told which of the two they are looking at.
  const benchmark = buildExitBenchmarks([
    ...many(4, { neighborhood: 'Navigli - Darsena', size_mq: 50, price_eur: 400000 }),
    ...many(10, { neighborhood: 'Bocconi', size_mq: 50, price_eur: 300000 }),
  ]);

  const thin = benchmark.zones.find((zone) => zone.zone_id === 'Navigli - Darsena');
  const measured = benchmark.zones.find((zone) => zone.zone_id === 'Bocconi');

  assert.equal(thin.bands.bilocale.renovated.usable, false);
  assert.equal(thin.exit_eur_mq.bilocale.measured_at, 'zone');
  assert.equal(measured.exit_eur_mq.bilocale.measured_at, 'neighbourhood');
  assert.equal(thin.size_premium.bilocale_over_large, null,
    'a premium must never mix a neighbourhood numerator with a zone denominator');
});
