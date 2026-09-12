import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInvestorAlerts } from '../lib/investor-alert-reconciler.js';

function property(overrides = {}) {
  return {
    run_id: 'run-1',
    listing_index: 0,
    source_channel: 'idealista',
    source_listing_id: 'a',
    source_url: 'https://www.idealista.it/immobile/a/',
    title: 'Trilocale da ristrutturare',
    neighborhood: 'Navigli',
    price_eur: 500000,
    size_mq: 120,
    price_by_area: 4167,
    door_score: 70,
    roi_base_pct: 15,
    ...overrides,
  };
}

/**
 * In-memory store with the same idempotency guarantee as the database: the
 * unique constraint on (user_id, property_key) is modelled explicitly.
 */
function fakeStore({ investors = [], properties = [], failOn = null } = {}) {
  const alerts = new Map();
  const reconciliations = [];
  return {
    alerts,
    reconciliations,
    async activeInvestors() {
      if (failOn === 'investors') throw new Error('investor lookup failed');
      return investors;
    },
    async propertiesForRun() {
      if (failOn === 'properties') throw new Error('property lookup failed');
      return properties;
    },
    async insertAlerts(rows) {
      const created = [];
      for (const row of rows) {
        const key = row.user_id + '|' + row.property_key;
        if (alerts.has(key)) continue;
        alerts.set(key, row);
        created.push(row);
      }
      return created;
    },
    async recordReconciliation(summary) {
      reconciliations.push(summary);
    },
  };
}

const INVESTOR = {
  user_id: 'investor-1',
  role: 'investor',
  profiles: [{ name: 'Navigli', neighborhood_ids: ['navigli'], min_door_score: 60 }],
};

test('a run produces one alert per matching property', async () => {
  const store = fakeStore({
    investors: [INVESTOR],
    properties: [
      property({ source_listing_id: 'a' }),
      property({ source_listing_id: 'b', door_score: 80 }),
      property({ source_listing_id: 'c', door_score: 20 }),
    ],
  });

  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1' });

  assert.equal(summary.alerts_created, 2);
  assert.equal(summary.properties_inspected, 3);
  assert.equal(summary.investors_considered, 1);
  assert.equal(summary.rejection_counts.door_score_below_minimum, 1);
});

test('running the same pass twice creates nothing the second time', async () => {
  const store = fakeStore({
    investors: [INVESTOR],
    properties: [property({ source_listing_id: 'a' }), property({ source_listing_id: 'b' })],
  });

  const first = await reconcileInvestorAlerts({ store, runId: 'run-1' });
  const second = await reconcileInvestorAlerts({ store, runId: 'run-1' });

  assert.equal(first.alerts_created, 2);
  assert.equal(second.alerts_created, 0, 'the second pass must be a no-op');
  assert.equal(second.rejection_counts.already_alerted, 2);
  assert.equal(store.alerts.size, 2);
});

test('a later run does not re-alert a property already sent', async () => {
  const store = fakeStore({
    investors: [INVESTOR],
    properties: [property({ source_listing_id: 'a' })],
  });
  await reconcileInvestorAlerts({ store, runId: 'run-1' });

  // The same apartment reappears in a new run at a different array position.
  store.propertiesForRun = async () => [property({
    source_listing_id: 'a', run_id: 'run-2', listing_index: 57,
  })];
  const second = await reconcileInvestorAlerts({ store, runId: 'run-2' });

  assert.equal(second.alerts_created, 0);
  assert.equal(store.alerts.size, 1);
});

test('each investor is matched against their own preferences', async () => {
  const store = fakeStore({
    investors: [
      INVESTOR,
      { user_id: 'investor-2', role: 'investor', profiles: [{ name: 'Centro', neighborhood_ids: ['centro'] }] },
      { user_id: 'admin-1', role: 'admin', profiles: [{ name: 'Tutto', min_door_score: 10 }] },
    ],
    properties: [property({ source_listing_id: 'a' })],
  });

  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1' });

  // Navigli investor and the admin both match; the Centro investor does not.
  assert.equal(summary.alerts_created, 2);
  assert.deepEqual(
    [...store.alerts.values()].map((row) => row.user_id).sort(),
    ['admin-1', 'investor-1'],
  );
});

test('an investor with no saved preferences is skipped, not spammed', async () => {
  const store = fakeStore({
    investors: [{ user_id: 'investor-3', role: 'investor', profiles: [{ name: 'Vuoto' }] }],
    properties: [property()],
  });

  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1' });

  assert.equal(summary.alerts_created, 0);
  assert.equal(summary.investors_considered, 0);
  assert.equal(summary.rejection_counts.investor_has_no_preferences, 1);
});

test('the per-investor alert count is capped', async () => {
  const properties = Array.from({ length: 40 }, (unused, index) => property({
    source_listing_id: 'p' + index,
    listing_index: index,
  }));
  const store = fakeStore({ investors: [INVESTOR], properties });

  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1', limitPerInvestor: 5 });

  assert.equal(summary.alerts_created, 5);
  assert.equal(summary.per_investor[0].truncated, true);
});

test('every pass is recorded, including a failed one', async () => {
  const ok = fakeStore({ investors: [INVESTOR], properties: [property()] });
  await reconcileInvestorAlerts({ store: ok, runId: 'run-1' });
  assert.equal(ok.reconciliations.length, 1);
  assert.equal(ok.reconciliations[0].error, undefined);
  assert.ok(ok.reconciliations[0].finished_at);

  const broken = fakeStore({ failOn: 'properties' });
  await assert.rejects(
    () => reconcileInvestorAlerts({ store: broken, runId: 'run-1' }),
    /property lookup failed/,
    'the caller must still see the failure',
  );
  assert.equal(broken.reconciliations.length, 1);
  assert.match(broken.reconciliations[0].error, /property lookup failed/);
});

test('the recorded summary carries counts only, never listing content', async () => {
  const store = fakeStore({ investors: [INVESTOR], properties: [property()] });
  await reconcileInvestorAlerts({ store, runId: 'run-1' });

  const recorded = JSON.stringify(store.reconciliations[0].rejection_counts);
  assert.doesNotMatch(recorded, /Trilocale|idealista\.it|Navigli/);
  for (const value of Object.values(store.reconciliations[0].rejection_counts)) {
    assert.equal(typeof value, 'number');
  }
});

test('a run id is required so a pass cannot silently match nothing', async () => {
  await assert.rejects(
    () => reconcileInvestorAlerts({ store: fakeStore(), runId: '' }),
    /run id is required/,
  );
  await assert.rejects(() => reconcileInvestorAlerts({ runId: 'run-1' }), /store is required/);
});

// --- several profiles per investor -----------------------------------------

test('a property found by two profiles is alerted once', async () => {
  // A yield-led profile and a location-led one overlap. The apartment is still
  // one apartment, so the investor must hear about it once - and the profile
  // that found it first is recorded for context.
  const investor = {
    user_id: 'investor-1',
    role: 'investor',
    profiles: [
      { name: 'Rendimento', min_door_score: 60 },
      { name: 'Posizionamento', neighborhood_ids: ['navigli'] },
    ],
  };
  const store = fakeStore({ investors: [investor], properties: [property({ source_listing_id: 'a' })] });

  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1' });

  assert.equal(summary.alerts_created, 1);
  assert.equal(store.alerts.size, 1);
  assert.equal([...store.alerts.values()][0].matched_profile, 'Rendimento');
  assert.equal(summary.per_investor[0].profiles, 2);
});

test('profiles select different properties without cancelling each other', async () => {
  const investor = {
    user_id: 'investor-1',
    role: 'investor',
    profiles: [
      { name: 'Rendimento', min_door_score: 80 },
      { name: 'Posizionamento', neighborhood_ids: ['navigli'], min_door_score: 50 },
    ],
  };
  const store = fakeStore({
    investors: [investor],
    properties: [
      property({ source_listing_id: 'yield', neighborhood: 'Centro', door_score: 90 }),
      property({ source_listing_id: 'place', neighborhood: 'Navigli', door_score: 55 }),
    ],
  });

  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1' });

  assert.equal(summary.alerts_created, 2, 'neither profile may suppress the other');
  const byProfile = Object.fromEntries(
    [...store.alerts.values()].map((row) => [row.source_listing_id, row.matched_profile]),
  );
  assert.deepEqual(byProfile, { yield: 'Rendimento', place: 'Posizionamento' });
});

test('an investor whose every profile is empty is skipped', async () => {
  const store = fakeStore({
    investors: [{ user_id: 'investor-9', role: 'investor', profiles: [{ name: 'a' }, { name: 'b' }] }],
    properties: [property()],
  });
  const summary = await reconcileInvestorAlerts({ store, runId: 'run-1' });
  assert.equal(summary.alerts_created, 0);
  assert.equal(summary.investors_considered, 0);
  assert.equal(summary.rejection_counts.investor_has_no_preferences, 1);
});
