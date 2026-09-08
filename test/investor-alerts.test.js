import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertRowFromProperty,
  hasUsablePreferences,
  matchesPreferences,
  propertyAlertKey,
  propertyZoneId,
  selectAlertsForInvestor,
} from '../lib/investor-alerts.js';

function property(overrides = {}) {
  return {
    run_id: 'run-1',
    listing_index: 3,
    source_channel: 'idealista',
    source_listing_id: '12345',
    source_url: 'https://www.idealista.it/immobile/12345/',
    title: 'Quadrilocale da ristrutturare',
    neighborhood: 'Navigli',
    price_eur: 500000,
    size_mq: 120,
    price_by_area: 4167,
    door_score: 72,
    roi_base_pct: 18.5,
    ...overrides,
  };
}

// --- identity --------------------------------------------------------------

test('the portal listing id is the durable alert identity', () => {
  const { key, stable } = propertyAlertKey(property());
  assert.equal(key, 'v1:idealista:id:12345');
  assert.equal(stable, true);

  // The same apartment seen in a later run keeps the same key, so the investor
  // is not alerted twice.
  const laterRun = propertyAlertKey(property({ run_id: 'run-9', listing_index: 41 }));
  assert.equal(laterRun.key, key);
});

test('the canonical URL is the fallback identity, normalised', () => {
  const withoutId = property({ source_listing_id: null });
  const { key, stable } = propertyAlertKey(withoutId);
  assert.equal(key, 'v1:idealista:url:https://www.idealista.it/immobile/12345');
  assert.equal(stable, true);

  // Tracking parameters and a trailing slash must not fork the identity.
  const noisy = propertyAlertKey(property({
    source_listing_id: null,
    source_url: 'https://www.idealista.it/immobile/12345?utm_source=newsletter#gallery',
  }));
  assert.equal(noisy.key, key);
});

test('a property with no portal identity is flagged as unstable', () => {
  const { key, stable } = propertyAlertKey(property({ source_listing_id: null, source_url: null }));
  assert.equal(key, 'v1:run:run-1:3');
  assert.equal(stable, false, 'the caller must know this key will not survive a re-run');
});

test('a property with no identity at all yields no key', () => {
  assert.equal(propertyAlertKey({}).key, null);
});

// --- zone resolution -------------------------------------------------------

test('free-text neighbourhoods resolve to the canonical zone', () => {
  assert.equal(propertyZoneId(property({ neighborhood: 'Navigli' })), 'navigli');
  assert.equal(propertyZoneId(property({ neighborhood: 'naviglio pavese' })), 'navigli');
  assert.equal(propertyZoneId(property({ neighborhood: null, district: 'Isola' })), 'cenisio-sarpi-isola');
  assert.equal(propertyZoneId(property({ neighborhood: 'Nowhere In Particular', district: null, address: null, title: null }), 'nothing to resolve'), null);
});

// --- filters ---------------------------------------------------------------

test('a property inside every filter matches', () => {
  const verdict = matchesPreferences(property(), {
    neighborhood_ids: ['navigli', 'centro'],
    min_price_eur: 300000,
    max_price_eur: 700000,
    min_size_mq: 100,
    max_price_per_sqm_eur: 5000,
    min_door_score: 70,
    min_roi_base_pct: 15,
  });
  assert.deepEqual(verdict.rejected, []);
  assert.equal(verdict.matched, true);
  assert.equal(verdict.zone_id, 'navigli');
});

test('each filter rejects for its own reason', () => {
  const cases = [
    [{ neighborhood_ids: ['centro'] }, 'zone_not_selected'],
    [{ min_price_eur: 600000 }, 'price_below_minimum'],
    [{ max_price_eur: 400000 }, 'price_above_maximum'],
    [{ min_size_mq: 200 }, 'size_below_minimum'],
    [{ max_size_mq: 100 }, 'size_above_maximum'],
    [{ max_price_per_sqm_eur: 3000 }, 'price_per_sqm_above_maximum'],
    [{ min_door_score: 90 }, 'door_score_below_minimum'],
    [{ min_roi_base_pct: 25 }, 'roi_below_minimum'],
  ];
  for (const [preferences, reason] of cases) {
    const verdict = matchesPreferences(property(), preferences);
    assert.equal(verdict.matched, false, reason);
    assert.ok(verdict.rejected.includes(reason), 'expected ' + reason + ', got ' + verdict.rejected.join());
  }
});

test('an unevaluable filter rejects rather than passing the property through', () => {
  // A filter the investor set is a promise. Alerting on a property TORIUM
  // cannot check against that filter would break it silently.
  assert.ok(matchesPreferences(property({ price_eur: null }), { max_price_eur: 600000 })
    .rejected.includes('price_unknown'));
  assert.ok(matchesPreferences(property({ neighborhood: null, district: null, address: null, title: null }), { neighborhood_ids: ['navigli'] })
    .rejected.includes('zone_unknown'));
  assert.ok(matchesPreferences(property({ door_score: null }), { min_door_score: 50 })
    .rejected.includes('door_score_unknown'));
  assert.ok(matchesPreferences(property({ roi_base_pct: null }), { min_roi_base_pct: 5 })
    .rejected.includes('roi_unknown'));
});

test('a filter the investor did not set never rejects', () => {
  const bare = { run_id: 'r', listing_index: 0, source_channel: 'idealista', source_listing_id: '1' };
  assert.equal(matchesPreferences(bare, { min_door_score: 0 }).matched, false, 'door score is unknown here');
  assert.equal(matchesPreferences(bare, {}).matched, true, 'no filters means nothing to fail');
});

test('price per square metre falls back to price over surface', () => {
  const verdict = matchesPreferences(
    property({ price_by_area: null, price_eur: 400000, size_mq: 100 }),
    { max_price_per_sqm_eur: 4500 },
  );
  assert.equal(verdict.matched, true);
});

// --- subscription intent ---------------------------------------------------

test('an investor with no saved filter is not subscribed to everything', () => {
  assert.equal(hasUsablePreferences({}), false);
  assert.equal(hasUsablePreferences({ neighborhood_ids: [] }), false);
  assert.equal(hasUsablePreferences({ neighborhood_ids: ['navigli'] }), true);
  assert.equal(hasUsablePreferences({ min_door_score: 60 }), true);
  // Zero is a real threshold, not an absent one.
  assert.equal(hasUsablePreferences({ min_roi_base_pct: 0 }), true);
});

test('an empty preference set produces no alerts at all', () => {
  const result = selectAlertsForInvestor([property()], {}, { userId: 'u1' });
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.rejectionCounts, { no_preferences_set: 1 });
});

// --- selection -------------------------------------------------------------

test('selection skips properties the investor was already alerted about', () => {
  const properties = [
    property({ source_listing_id: '1' }),
    property({ source_listing_id: '2' }),
    property({ source_listing_id: '3' }),
  ];
  const result = selectAlertsForInvestor(properties, { min_door_score: 50 }, {
    userId: 'u1',
    alreadyAlerted: new Set(['v1:idealista:id:2']),
  });

  assert.deepEqual(result.matches.map((m) => m.source_listing_id), ['1', '3']);
  assert.equal(result.rejectionCounts.already_alerted, 1);
});

test('the same property appearing twice in one batch is alerted once', () => {
  const duplicated = [property({ source_listing_id: '7' }), property({ source_listing_id: '7' })];
  const result = selectAlertsForInvestor(duplicated, { min_door_score: 50 }, { userId: 'u1' });
  assert.equal(result.matches.length, 1);
  assert.equal(result.rejectionCounts.already_alerted, 1);
});

test('matches are ordered best first and capped', () => {
  const properties = [
    property({ source_listing_id: 'a', door_score: 55 }),
    property({ source_listing_id: 'b', door_score: 91 }),
    property({ source_listing_id: 'c', door_score: 73 }),
  ];
  const all = selectAlertsForInvestor(properties, { min_door_score: 50 }, { userId: 'u1' });
  assert.deepEqual(all.matches.map((m) => m.source_listing_id), ['b', 'c', 'a']);
  assert.equal(all.truncated, false);

  const capped = selectAlertsForInvestor(properties, { min_door_score: 50 }, { userId: 'u1', limit: 2 });
  assert.equal(capped.matches.length, 2);
  assert.equal(capped.truncated, true);
});

test('rejection reasons are counted so the gap stays visible', () => {
  const properties = [
    property({ source_listing_id: '1', price_eur: 100000 }),
    property({ source_listing_id: '2', price_eur: null }),
    property({ source_listing_id: '3', price_eur: 500000 }),
  ];
  const result = selectAlertsForInvestor(properties, { min_price_eur: 300000 }, { userId: 'u1' });
  assert.equal(result.matches.length, 1);
  assert.equal(result.inspected, 3);
  assert.equal(result.rejectionCounts.price_below_minimum, 1);
  assert.equal(result.rejectionCounts.price_unknown, 1);
});

// --- persisted shape -------------------------------------------------------

test('the alert row carries a self-contained snapshot', () => {
  const row = alertRowFromProperty(property(), { userId: 'u1', zoneId: 'navigli' });
  assert.equal(row.user_id, 'u1');
  assert.equal(row.property_key, 'v1:idealista:id:12345');
  assert.equal(row.property_key_is_stable, true);
  assert.equal(row.zone_id, 'navigli');
  assert.equal(row.price_eur, 500000);
  assert.equal(row.door_score, 72);
  assert.equal(row.source_url, 'https://www.idealista.it/immobile/12345/');
  // The digest renders from this row alone, without re-reading the run.
  for (const field of ['title', 'size_mq', 'price_by_area', 'roi_base_pct', 'thumbnail_url']) {
    assert.ok(field in row, 'missing ' + field);
  }
});
