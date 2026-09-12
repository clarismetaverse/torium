import test from 'node:test';
import assert from 'node:assert/strict';
import { composeForDigest, deliverWeeklyDigests, weekStartDate } from '../lib/investor-digest-schedule.js';

// --- the week key ----------------------------------------------------------

test('the week key is the Monday of the ISO week, in UTC', () => {
  // Monday itself maps to itself.
  assert.equal(weekStartDate(new Date('2026-09-14T09:00:00Z')), '2026-09-14');
  // Every other weekday maps back to that Monday.
  assert.equal(weekStartDate(new Date('2026-09-16T23:59:59Z')), '2026-09-14');
  assert.equal(weekStartDate(new Date('2026-09-18T06:00:00Z')), '2026-09-14');
  // Sunday belongs to the week that began six days earlier, not to a new one.
  assert.equal(weekStartDate(new Date('2026-09-20T22:00:00Z')), '2026-09-14');
  // The next Monday starts a new week.
  assert.equal(weekStartDate(new Date('2026-09-21T00:00:01Z')), '2026-09-21');
});

test('the week key does not drift across a month or a year boundary', () => {
  assert.equal(weekStartDate(new Date('2026-10-01T12:00:00Z')), '2026-09-28');
  assert.equal(weekStartDate(new Date('2027-01-01T12:00:00Z')), '2026-12-28');
});

test('a late Sunday and the following early Monday fall in different weeks', () => {
  // Two servers minutes apart across midnight must not disagree about which
  // week a send belongs to; UTC is what keeps them consistent.
  assert.notEqual(
    weekStartDate(new Date('2026-09-20T23:59:00Z')),
    weekStartDate(new Date('2026-09-21T00:01:00Z')),
  );
});

// --- composition -----------------------------------------------------------

test('the digest renders canonical zone names, not raw labels', () => {
  const digest = composeForDigest([{
    title: 'Trilocale', zone_id: 'navigli', neighborhood: 'naviglio pavese',
    price_eur: 400000, size_mq: 120, door_score: 70, roi_base_pct: 22,
    source_url: 'https://www.idealista.it/immobile/1/', run_id: 'run-1',
  }]);
  assert.match(digest.html, /Navigli/);
  assert.equal(digest.alert_count, 1);
  assert.match(digest.subject, /Navigli/);
});

// --- the weekly guarantee --------------------------------------------------

function fakeStore(recipients) {
  const claims = new Set();
  const sent = [];
  return {
    claims, sent,
    async investorsWithPendingAlerts() { return recipients; },
    async claimDigest({ userId, channel, digestDate }) {
      const key = [userId, channel, digestDate].join('|');
      if (claims.has(key)) return false;   // models the unique constraint
      claims.add(key);
      return true;
    },
    async completeDigest() {},
    async markAlertsDelivered(userId, keys) { sent.push({ userId, keys }); },
  };
}

const RECIPIENT = {
  user_id: 'investor-1',
  email: 'investor@example.test',
  alerts: [{ property_key: 'v1:a', title: 'Trilocale', price_eur: 400000, roi_base_pct: 22 }],
};

test('a second reconciliation in the same week sends nothing', async () => {
  // This is what makes the weekly cadence work without a scheduler: the pass
  // can hang off every reconciliation, and the ledger allows one send a week.
  const store = fakeStore([RECIPIENT]);
  let sends = 0;
  const send = async () => { sends += 1; return { status: 'sent', provider_message_id: 'm1' }; };

  const monday = await deliverWeeklyDigests({ store, send, now: new Date('2026-09-14T08:00:00Z') });
  const thursday = await deliverWeeklyDigests({ store, send, now: new Date('2026-09-17T08:00:00Z') });

  assert.equal(monday.sent, 1, 'the first pass of the week delivers');
  assert.equal(sends, 1, 'the provider is called once a week, not once a run');
  assert.equal(thursday.skipped, 1, 'the week was already claimed');
  assert.equal(thursday.results[0].reason, 'already_claimed');
  assert.equal(store.claims.size, 1, 'one claim for the whole week');
});

test('the following week is a new claim', async () => {
  const store = fakeStore([RECIPIENT]);
  const send = async () => ({ status: 'sent', provider_message_id: 'm1' });
  await deliverWeeklyDigests({ store, send, now: new Date('2026-09-14T08:00:00Z') });
  await deliverWeeklyDigests({ store, send, now: new Date('2026-09-21T08:00:00Z') });
  assert.equal(store.claims.size, 2, 'each week is claimed separately');
});

test('an investor with no undelivered alerts is not considered', async () => {
  const store = fakeStore([]);
  const summary = await deliverWeeklyDigests({ store, now: new Date('2026-09-14T08:00:00Z') });
  assert.equal(summary.considered, 0);
  assert.equal(summary.sent, 0);
  assert.equal(store.claims.size, 0, 'no week is claimed when there is nothing to send');
});
