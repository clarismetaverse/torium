import test from 'node:test';
import assert from 'node:assert/strict';
import { composeInvestorPush } from '../lib/investor-push.js';
import { deliverPushForRun, PushDeliveryError } from '../lib/investor-push-sender.js';

const ZONES = new Map([['navigli', 'Navigli'], ['porta-romana', 'Porta Romana']]);

function alert(overrides = {}) {
  return {
    property_key: 'idealista:id:1',
    title: 'Appartamento da frazionare',
    zone_id: 'navigli',
    neighborhood: 'Navigli - Darsena',
    run_id: 'run-1',
    price_eur: 650000,
    size_mq: 150,
    price_by_area: 4333,
    door_score: 72,
    roi_base_pct: 21.5,
    ...overrides,
  };
}

test('nothing to say produces no notification', () => {
  assert.equal(composeInvestorPush([], { zoneLabels: ZONES }), null);
  assert.equal(composeInvestorPush(undefined, { zoneLabels: ZONES }), null);
});

test('a single match names the zone and the numbers that decide', () => {
  const push = composeInvestorPush([alert()], { zoneLabels: ZONES, runId: 'run-1' });
  assert.equal(push.title, 'Nuovo immobile a Navigli');
  assert.equal(push.body, '150 m² · 650k € · ROI 22%');
  assert.equal(push.alert_count, 1);
  assert.equal(push.url, '/home?run=supabase%3Arun-1');
});

test('several matches are summarised, not listed', () => {
  const push = composeInvestorPush([
    alert({ price_eur: 650000 }),
    alert({ property_key: 'x2', zone_id: 'porta-romana', price_eur: 480000, door_score: 80 }),
    alert({ property_key: 'x3', zone_id: 'porta-romana', price_eur: 900000, door_score: 60 }),
  ], { zoneLabels: ZONES, runId: 'run-1' });

  assert.equal(push.title, '3 nuovi immobili da frazionare');
  assert.equal(push.body, 'Porta Romana e Navigli · da 480k €');
  assert.equal(push.alert_count, 3);
  assert.equal(push.url, '/account#alertsCard');
});

test('the notification stays within what a push service will carry', () => {
  const push = composeInvestorPush([alert({ title: 'x'.repeat(5000) })], { zoneLabels: ZONES });
  assert.ok(Buffer.byteLength(push.payload, 'utf8') < 3100);
});

test('a missing price or surface is omitted rather than shown as zero', () => {
  const push = composeInvestorPush([alert({ price_eur: null, size_mq: null, roi_base_pct: null })],
    { zoneLabels: ZONES });
  assert.equal(push.body, 'Appartamento da frazionare');
  assert.ok(!push.body.includes('0'));
});

function store({ subscriptions = [{ id: 's1', endpoint: 'https://push.example.net/1', keys: {} }], claims = new Set() } = {}) {
  const calls = { claimed: [], completed: [], disabled: [], delivered: [] };
  return {
    calls,
    async investorsWithRunAlerts() {
      return [{ user_id: 'u1', alerts: [alert()] }];
    },
    async activeSubscriptions() {
      return subscriptions;
    },
    async claimDelivery({ subscriptionId, runId }) {
      const key = `${subscriptionId}:${runId}`;
      if (claims.has(key)) return false;
      claims.add(key);
      calls.claimed.push(key);
      return true;
    },
    async completeDelivery(entry) {
      calls.completed.push(entry);
    },
    async markSubscriptionDelivered(id) {
      calls.delivered.push(id);
    },
    async disableSubscription(id, reason) {
      calls.disabled.push({ id, reason });
    },
  };
}

const quiet = { error() {}, warn() {}, info() {} };

test('a device is notified once per run, however often the run is retried', async () => {
  const claims = new Set();
  const shared = store({ claims });
  let sends = 0;
  const send = async () => { sends += 1; return { status: 'sent' }; };

  const first = await deliverPushForRun({
    store: shared, runId: 'run-1', compose: (alerts) => composeInvestorPush(alerts, { zoneLabels: ZONES }), send, logger: quiet,
  });
  const second = await deliverPushForRun({
    store: shared, runId: 'run-1', compose: (alerts) => composeInvestorPush(alerts, { zoneLabels: ZONES }), send, logger: quiet,
  });

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
  assert.equal(sends, 1, 'the second pass sends nothing');
});

test('the ledger row is claimed before the send, so a crash cannot repeat it', async () => {
  const shared = store();
  const send = async () => { throw new Error('process died mid-send'); };
  await deliverPushForRun({
    store: shared, runId: 'run-1', compose: (alerts) => composeInvestorPush(alerts, { zoneLabels: ZONES }), send, logger: quiet,
  });
  assert.deepEqual(shared.calls.claimed, ['s1:run-1']);
  assert.equal(shared.calls.completed[0].status, 'failed');
});

test('an expired subscription is disabled instead of retried forever', async () => {
  const shared = store();
  const send = async () => {
    throw new PushDeliveryError('Push rejected: subscription_expired', { gone: true, status: 410 });
  };
  const summary = await deliverPushForRun({
    store: shared, runId: 'run-1', compose: (alerts) => composeInvestorPush(alerts, { zoneLabels: ZONES }), send, logger: quiet,
  });

  assert.equal(summary.expired, 1);
  assert.equal(shared.calls.disabled.length, 1);
  assert.equal(shared.calls.completed[0].status, 'expired');
});

test('a push service outage leaves the delivery retryable and the device enabled', async () => {
  const shared = store();
  const send = async () => {
    throw new PushDeliveryError('Push rejected: push_service_unavailable', { retryable: true, status: 503 });
  };
  const summary = await deliverPushForRun({
    store: shared, runId: 'run-1', compose: (alerts) => composeInvestorPush(alerts, { zoneLabels: ZONES }), send, logger: quiet,
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.results[0].retryable, true);
  assert.equal(shared.calls.disabled.length, 0);
});

test('every device of one investor is notified', async () => {
  const shared = store({
    subscriptions: [
      { id: 's1', endpoint: 'https://push.example.net/1', keys: {} },
      { id: 's2', endpoint: 'https://web.push.apple.com/2', keys: {} },
    ],
  });
  const send = async () => ({ status: 'sent' });
  const summary = await deliverPushForRun({
    store: shared, runId: 'run-1', compose: (alerts) => composeInvestorPush(alerts, { zoneLabels: ZONES }), send, logger: quiet,
  });
  assert.equal(summary.sent, 2);
  assert.deepEqual(shared.calls.delivered, ['s1', 's2']);
});
