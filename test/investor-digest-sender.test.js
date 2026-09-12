import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DigestDeliveryError,
  deliverInvestorDigests,
  sendInvestorDigest,
} from '../lib/investor-digest-sender.js';

const SILENT = { error() {} };
const DIGEST = { subject: 'TORIUM · 3 nuove opportunità', html: '<html></html>', text: 'TORIUM', alert_count: 3 };

function jsonResponse(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// --- the provider call -----------------------------------------------------

test('a digest is posted to the provider with both bodies', async () => {
  const calls = [];
  const result = await sendInvestorDigest({
    to: 'investor@example.test',
    digest: DIGEST,
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { id: 'msg-123' });
    },
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.provider_message_id, 'msg-123');

  const [call] = calls;
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.to, ['investor@example.test']);
  assert.equal(body.subject, DIGEST.subject);
  assert.ok(body.html && body.text, 'both an HTML and a text body must be sent');
});

test('an empty digest is a decision not to send', async () => {
  let called = false;
  const result = await sendInvestorDigest({
    to: 'investor@example.test',
    digest: { ...DIGEST, alert_count: 0 },
    apiKey: 'test-key',
    fetchImpl: async () => { called = true; return jsonResponse(200, {}); },
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no_alerts');
  assert.equal(called, false, 'an empty digest must not reach the provider');
});

test('missing configuration fails before any send', async () => {
  await assert.rejects(
    () => sendInvestorDigest({ to: 'a@b.test', digest: DIGEST, apiKey: '' }),
    /RESEND_API_KEY/,
  );
  await assert.rejects(
    () => sendInvestorDigest({ digest: DIGEST, apiKey: 'k' }),
    /recipient is required/,
  );
  await assert.rejects(
    () => sendInvestorDigest({ to: 'a@b.test', digest: { subject: 'x' }, apiKey: 'k' }),
    /composed digest is required/,
  );
});

// --- what is worth retrying ------------------------------------------------

test('transient provider failures are retryable, permanent ones are not', async () => {
  const cases = [
    [429, true], [500, true], [503, true],
    [401, false], [403, false], [422, false], [400, false],
  ];
  for (const [status, retryable] of cases) {
    const error = await sendInvestorDigest({
      to: 'a@b.test', digest: DIGEST, apiKey: 'k',
      fetchImpl: async () => jsonResponse(status),
    }).catch((caught) => caught);

    assert.ok(error instanceof DigestDeliveryError, 'status ' + status);
    assert.equal(error.retryable, retryable, 'status ' + status + ' retryable should be ' + retryable);
    assert.equal(error.status, status);
  }
});

test('a transport failure is retryable and says nothing about the message', async () => {
  const error = await sendInvestorDigest({
    to: 'investor@example.test', digest: DIGEST, apiKey: 'k',
    fetchImpl: async () => { throw new Error('ECONNRESET to 10.0.0.4'); },
  }).catch((caught) => caught);

  assert.equal(error.retryable, true);
  assert.doesNotMatch(error.message, /ECONNRESET|10\.0\.0\.4/);
});

test('an error never carries the recipient or the digest', async () => {
  const error = await sendInvestorDigest({
    to: 'investor@example.test', digest: DIGEST, apiKey: 'super-secret-key',
    fetchImpl: async () => jsonResponse(422),
  }).catch((caught) => caught);

  const serialized = error.message + JSON.stringify(error);
  assert.doesNotMatch(serialized, /investor@example\.test|super-secret-key|nuove opportunità/);
});

// --- the daily pass --------------------------------------------------------

function fakeStore(recipients = []) {
  const claimed = new Set();
  const completed = [];
  const delivered = [];
  return {
    completed,
    delivered,
    claimed,
    async investorsWithPendingAlerts() { return recipients; },
    async claimDigest({ userId, channel, digestDate }) {
      const key = [userId, channel, digestDate].join('|');
      if (claimed.has(key)) return false;   // models the unique constraint
      claimed.add(key);
      return true;
    },
    async completeDigest(entry) { completed.push(entry); },
    async markAlertsDelivered(userId, keys) { delivered.push({ userId, keys }); },
  };
}

const RECIPIENT = {
  user_id: 'investor-1',
  email: 'investor@example.test',
  alerts: [{ property_key: 'v1:a' }, { property_key: 'v1:b' }],
};

const compose = (alerts) => ({ ...DIGEST, alert_count: alerts.length });

test('a digest is claimed before it is sent, not after', async () => {
  // The ledger row is the lock. Claiming after sending would let two workers
  // both put a copy in the investor's inbox.
  const order = [];
  const store = fakeStore([RECIPIENT]);
  const wrapped = {
    ...store,
    async claimDigest(entry) { order.push('claim'); return store.claimDigest(entry); },
  };

  await deliverInvestorDigests({
    store: wrapped,
    compose,
    send: async () => { order.push('send'); return { status: 'sent', provider_message_id: 'm1' }; },
    digestDate: '2026-09-13',
  });

  assert.deepEqual(order, ['claim', 'send']);
});

test('a second worker on the same day sends nothing', async () => {
  const store = fakeStore([RECIPIENT]);
  let sends = 0;
  const send = async () => { sends += 1; return { status: 'sent', provider_message_id: 'm1' }; };

  const first = await deliverInvestorDigests({ store, compose, send, digestDate: '2026-09-13' });
  const second = await deliverInvestorDigests({ store, compose, send, digestDate: '2026-09-13' });

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
  assert.equal(second.results[0].reason, 'already_claimed');
  assert.equal(sends, 1, 'the investor must receive exactly one email');
});

test('alerts are marked delivered only after a successful send', async () => {
  const store = fakeStore([RECIPIENT]);
  await deliverInvestorDigests({
    store, compose, digestDate: '2026-09-13',
    send: async () => ({ status: 'sent', provider_message_id: 'm1' }),
  });
  assert.deepEqual(store.delivered, [{ userId: 'investor-1', keys: ['v1:a', 'v1:b'] }]);

  const failing = fakeStore([RECIPIENT]);
  await deliverInvestorDigests({
    store: failing, compose, digestDate: '2026-09-13', logger: SILENT,
    send: async () => { throw new DigestDeliveryError('Digest rejected: rate_limited', { retryable: true }); },
  });
  assert.deepEqual(failing.delivered, [], 'a failed send must leave the alerts pending');
});

test('one investor failing does not stop the others', async () => {
  const recipients = [
    RECIPIENT,
    { user_id: 'investor-2', email: 'second@example.test', alerts: [{ property_key: 'v1:c' }] },
  ];
  const store = fakeStore(recipients);

  const summary = await deliverInvestorDigests({
    store, compose, digestDate: '2026-09-13', logger: SILENT,
    send: async ({ to }) => {
      if (to === 'investor@example.test') throw new DigestDeliveryError('Digest rejected: rejected_by_provider');
      return { status: 'sent', provider_message_id: 'm2' };
    },
  });

  assert.equal(summary.considered, 2);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.equal(store.completed.filter((entry) => entry.status === 'failed').length, 1);
});

test('the ledger records an outcome, never the message', async () => {
  const store = fakeStore([RECIPIENT]);
  await deliverInvestorDigests({
    store, compose, digestDate: '2026-09-13',
    send: async () => ({ status: 'sent', provider_message_id: 'm1' }),
  });

  const serialized = JSON.stringify(store.completed);
  assert.doesNotMatch(serialized, /investor@example\.test|<html>|nuove opportunità/);
  assert.match(serialized, /m1/);
});

test('a retryable failure is reported as such so it can be picked up again', async () => {
  const store = fakeStore([RECIPIENT]);
  const summary = await deliverInvestorDigests({
    store, compose, digestDate: '2026-09-13', logger: SILENT,
    send: async () => { throw new DigestDeliveryError('Digest rejected: provider_unavailable', { retryable: true }); },
  });
  assert.equal(summary.results[0].retryable, true);
});

test('the pass refuses to run without its collaborators', async () => {
  await assert.rejects(() => deliverInvestorDigests({ compose }), /store is required/);
  await assert.rejects(() => deliverInvestorDigests({ store: fakeStore() }), /composer is required/);
});
