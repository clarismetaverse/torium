import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAlertsForRun } from '../api/run-valuation.js';

const SILENT = { error() {} };

function fakeStore() {
  return () => ({});
}

test('a successful pass reports what it did', async () => {
  const result = await reconcileAlertsForRun('run-1', {
    store: fakeStore(),
    reconcile: async ({ runId }) => {
      assert.equal(runId, 'run-1');
      return { investors_considered: 2, properties_inspected: 770, alerts_created: 28 };
    },
  });

  assert.deepEqual(result, {
    status: 'ok',
    investors_considered: 2,
    properties_inspected: 770,
    alerts_created: 28,
  });
});

test('a failed pass never discards a completed valuation', async () => {
  // The valuation is the expensive, hard-to-repeat part. Alerts are idempotent
  // and can be reconciled again from the same run at no cost, so a failure here
  // must be reported rather than thrown.
  const result = await reconcileAlertsForRun('run-1', {
    store: fakeStore(),
    reconcile: async () => { throw new Error('supabase unreachable'); },
    logger: SILENT,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
});

test('the failure report leaks nothing about the cause', async () => {
  const result = await reconcileAlertsForRun('run-1', {
    store: fakeStore(),
    reconcile: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 while using key sb_secret_abc'); },
    logger: SILENT,
  });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /ECONNREFUSED|10\.0\.0\.5|sb_secret/);
});

test('the pass is awaited, not left running after the response', async () => {
  // Work started but not awaited in a serverless function is not guaranteed to
  // finish, so a fire-and-forget reconciliation would silently do nothing.
  let finished = false;
  await reconcileAlertsForRun('run-1', {
    store: fakeStore(),
    reconcile: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return { investors_considered: 1, properties_inspected: 1, alerts_created: 1 };
    },
  });
  assert.equal(finished, true, 'reconcileAlertsForRun must resolve only once the pass is done');
});

test('the run id is passed through untouched', async () => {
  const seen = [];
  await reconcileAlertsForRun('1787412983325-milanoFractioningMultisource-neutral_fractionability', {
    store: fakeStore(),
    reconcile: async ({ runId }) => {
      seen.push(runId);
      return { investors_considered: 0, properties_inspected: 0, alerts_created: 0 };
    },
  });
  assert.deepEqual(seen, ['1787412983325-milanoFractioningMultisource-neutral_fractionability']);
});
