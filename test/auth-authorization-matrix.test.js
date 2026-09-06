import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import sessionHandler from '../api/_auth-session.js';
import passwordHandler from '../api/_auth-password.js';
import preferencesHandler from '../api/_investor-preferences.js';
import accountHandler from '../api/account.js';
import runTriageHandler from '../api/run-triage.js';
import runValuationHandler from '../api/run-valuation.js';
import { isRenewalAgentAuthorized } from '../lib/renewals.js';
import { resetFallbackWindows } from '../api/_rate-limit.js';
import {
  ACTIVE_ADMIN,
  ACTIVE_INVESTOR,
  NO_MEMBERSHIP,
  SUSPENDED_MEMBER,
  applyTestEnv,
  browserRequest,
  installSupabaseStub,
  responseRecorder,
  sessionCookie,
  stubFor,
} from './helpers/auth-harness.js';

const restoreEnv = applyTestEnv();

test.beforeEach(() => resetFallbackWindows());
test.after(() => restoreEnv());

function authenticatedRequest(account, overrides = {}) {
  return browserRequest({
    ...overrides,
    headers: { cookie: sessionCookie(account.token), ...(overrides.headers || {}) },
  });
}

// --- unauthenticated -------------------------------------------------------

test('unauthenticated session probe is refused and never cacheable', async () => {
  const stub = installSupabaseStub(stubFor());
  try {
    const response = responseRecorder();
    await sessionHandler(browserRequest({ method: 'GET' }), response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.authenticated, false);
    assert.equal(response.headers['Cache-Control'], 'no-store, private');
  } finally {
    stub.restore();
  }
});

test('an expired or forged access token without a usable refresh token is rejected', async () => {
  const stub = installSupabaseStub({ ...stubFor(ACTIVE_INVESTOR), refresh: null });
  try {
    const response = responseRecorder();
    await sessionHandler(authenticatedRequest({ token: 'expired-token-000000000000000000000000' }, { method: 'GET' }), response);
    assert.equal(response.statusCode, 401);
  } finally {
    stub.restore();
  }
});

test('protected product endpoints refuse an anonymous caller', async () => {
  const stub = installSupabaseStub(stubFor());
  try {
    const response = responseRecorder();
    await preferencesHandler(browserRequest({ method: 'GET' }), response);
    assert.equal(response.statusCode, 401);
  } finally {
    stub.restore();
  }
});

// --- login -----------------------------------------------------------------

test('a valid credential for an active member establishes an HttpOnly session', async () => {
  const stub = installSupabaseStub({
    ...stubFor(ACTIVE_INVESTOR),
    password: {
      email: ACTIVE_INVESTOR.user.email,
      password: 'correct-horse-battery',
      token: ACTIVE_INVESTOR.token,
      user: ACTIVE_INVESTOR.user,
    },
  });
  try {
    const response = responseRecorder();
    await sessionHandler(browserRequest({
      method: 'POST',
      body: { email: ACTIVE_INVESTOR.user.email, password: 'correct-horse-battery' },
    }), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.role, 'investor');
    const cookies = response.cookies();
    assert.ok(cookies.some((cookie) => cookie.includes('HttpOnly')));
    assert.ok(cookies.every((cookie) => cookie.includes('SameSite=Lax')));
    assert.ok(cookies.some((cookie) => cookie.includes('torium_access_token')));
    // The raw tokens must never be echoed into the JSON body.
    assert.equal(JSON.stringify(response.body).includes(ACTIVE_INVESTOR.token), false);
  } finally {
    stub.restore();
  }
});

test('a wrong password returns a generic failure and is audited without the address', async () => {
  const stub = installSupabaseStub({
    ...stubFor(ACTIVE_INVESTOR),
    password: { email: ACTIVE_INVESTOR.user.email, password: 'correct-horse-battery', token: ACTIVE_INVESTOR.token, user: ACTIVE_INVESTOR.user },
  });
  try {
    const response = responseRecorder();
    await sessionHandler(browserRequest({
      method: 'POST',
      body: { email: ACTIVE_INVESTOR.user.email, password: 'wrong-password-value' },
    }), response);

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, 'Email or password not valid');
    const audit = stub.callsTo('/rest/v1/torium_auth_events');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].body.event_type, 'login_failed');
    assert.equal(audit[0].body.user_id, null);
    assert.equal(JSON.stringify(audit[0].body).includes(ACTIVE_INVESTOR.user.email), false);
    assert.match(audit[0].body.metadata.subject, /^[0-9a-f]{32}$/);
  } finally {
    stub.restore();
  }
});

test('login is rate limited before the credential reaches Supabase', async () => {
  const stub = installSupabaseStub({
    ...stubFor(ACTIVE_INVESTOR),
    rateLimit: false,
    password: { email: ACTIVE_INVESTOR.user.email, password: 'correct-horse-battery', token: ACTIVE_INVESTOR.token, user: ACTIVE_INVESTOR.user },
  });
  try {
    const response = responseRecorder();
    await sessionHandler(browserRequest({
      method: 'POST',
      body: { email: ACTIVE_INVESTOR.user.email, password: 'correct-horse-battery' },
    }), response);

    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['Retry-After'], '120');
    assert.equal(stub.callsTo('grant_type=password').length, 0);
  } finally {
    stub.restore();
  }
});

test('cross-origin login attempts are refused', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const response = responseRecorder();
    await sessionHandler(browserRequest({
      method: 'POST',
      body: { email: 'x@example.test', password: 'y' },
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    }), response);
    assert.equal(response.statusCode, 403);
  } finally {
    stub.restore();
  }
});

test('a mutation carrying no origin evidence at all is refused', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const response = responseRecorder();
    const request = browserRequest({ method: 'POST', body: { email: 'x@example.test', password: 'y' } });
    delete request.headers.origin;
    delete request.headers['sec-fetch-site'];
    await sessionHandler(request, response);
    assert.equal(response.statusCode, 403);
  } finally {
    stub.restore();
  }
});

// --- membership states -----------------------------------------------------

test('an authenticated user without a membership is denied and told to wait', async () => {
  const stub = installSupabaseStub({
    ...stubFor(NO_MEMBERSHIP),
    password: { email: NO_MEMBERSHIP.user.email, password: 'correct-horse-battery', token: NO_MEMBERSHIP.token, user: NO_MEMBERSHIP.user },
  });
  try {
    const response = responseRecorder();
    await sessionHandler(browserRequest({
      method: 'POST',
      body: { email: NO_MEMBERSHIP.user.email, password: 'correct-horse-battery' },
    }), response);

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, 'membership_inactive');
    assert.equal(response.cookies().length, 0, 'no session cookie may be issued');
    assert.equal(stub.callsTo('/auth/v1/logout').length, 1, 'the upstream session is revoked');
  } finally {
    stub.restore();
  }
});

test('a suspended membership is denied on product endpoints and signed out', async () => {
  const stub = installSupabaseStub(stubFor(SUSPENDED_MEMBER));
  try {
    const response = responseRecorder();
    await preferencesHandler(authenticatedRequest(SUSPENDED_MEMBER, { method: 'GET' }), response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, 'membership_inactive');
    assert.ok(response.cookies().every((cookie) => cookie.includes('Max-Age=0')));
  } finally {
    stub.restore();
  }
});

test('a missing membership is denied on product endpoints', async () => {
  const stub = installSupabaseStub(stubFor(NO_MEMBERSHIP));
  try {
    const response = responseRecorder();
    await preferencesHandler(authenticatedRequest(NO_MEMBERSHIP, { method: 'GET' }), response);
    assert.equal(response.statusCode, 403);
  } finally {
    stub.restore();
  }
});

// --- role matrix -----------------------------------------------------------

test('an active investor reads its own preferences through the user JWT', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const response = responseRecorder();
    await preferencesHandler(authenticatedRequest(ACTIVE_INVESTOR, { method: 'GET' }), response);

    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray(response.body.zones));
    const [read] = stub.callsTo('/rest/v1/investor_alert_preferences');
    assert.ok(read, 'preferences are read from PostgREST');
    // RLS must stay authoritative: the read carries the member's own token,
    // never the service-role key.
    assert.equal(read.headers.Authorization, 'Bearer ' + ACTIVE_INVESTOR.token);
    assert.equal(read.headers.apikey.includes('service-role'), false);
  } finally {
    stub.restore();
  }
});

test('an active investor cannot start an expensive run', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    for (const handler of [runTriageHandler, runValuationHandler]) {
      const response = responseRecorder();
      await handler(authenticatedRequest(ACTIVE_INVESTOR, {
        method: 'POST',
        body: { strategy: 'neutral_fractionability', run_id: 'run-1' },
      }), response);
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error, 'Insufficient permissions');
    }
  } finally {
    stub.restore();
  }
});

test('an active admin passes the run guard and reaches request validation', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_ADMIN));
  try {
    const response = responseRecorder();
    await runValuationHandler(authenticatedRequest(ACTIVE_ADMIN, {
      method: 'POST',
      body: { run_id: 'run-1', mode: 'ai' },
    }), response);
    // 400 proves the admin cleared authentication, membership and role.
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /deterministic/);
  } finally {
    stub.restore();
  }
});

test('a suspended member cannot start an expensive run', async () => {
  const stub = installSupabaseStub(stubFor(SUSPENDED_MEMBER));
  try {
    const response = responseRecorder();
    await runTriageHandler(authenticatedRequest(SUSPENDED_MEMBER, {
      method: 'POST',
      body: { strategy: 'neutral_fractionability' },
    }), response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, 'membership_inactive');
  } finally {
    stub.restore();
  }
});

// --- recovery, invite and password lifecycle -------------------------------

test('password recovery answers identically for known and unknown addresses', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const known = responseRecorder();
    await passwordHandler(browserRequest({ method: 'POST', body: { action: 'request', email: ACTIVE_INVESTOR.user.email } }), known);
    resetFallbackWindows();
    const unknown = responseRecorder();
    await passwordHandler(browserRequest({ method: 'POST', body: { action: 'request', email: 'nobody@example.test' } }), unknown);
    resetFallbackWindows();
    const malformed = responseRecorder();
    await passwordHandler(browserRequest({ method: 'POST', body: { action: 'request', email: 'not-an-address' } }), malformed);

    assert.equal(known.statusCode, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.deepEqual(known.body, malformed.body);
  } finally {
    stub.restore();
  }
});

test('an upstream recovery failure still returns the generic answer', async () => {
  const stub = installSupabaseStub({ ...stubFor(ACTIVE_INVESTOR), recoverStatus: 429 });
  try {
    const response = responseRecorder();
    await passwordHandler(browserRequest({ method: 'POST', body: { action: 'request', email: ACTIVE_INVESTOR.user.email } }), response);
    assert.equal(response.statusCode, 200, 'an upstream 429 must not become an enumeration oracle');
    assert.equal(response.body.ok, true);
  } finally {
    stub.restore();
  }
});

test('the self-service invite uses the service role and grants no membership', async () => {
  const stub = installSupabaseStub(stubFor());
  try {
    const response = responseRecorder();
    await passwordHandler(browserRequest({ method: 'POST', body: { action: 'invite', email: 'candidate@example.test' } }), response);

    assert.equal(response.statusCode, 200);
    const [invite] = stub.callsTo('/auth/v1/invite');
    assert.ok(invite, 'the invite reaches the GoTrue admin endpoint');
    assert.equal(invite.headers.Authorization, 'Bearer test-service-role-key');
    assert.equal(invite.url.includes('redirect_to=https%3A%2F%2Ftorium.test%2Fset-password'), true);
    // Invite-first: a self-service request must never activate access.
    const membershipWrites = stub.calls.filter((call) => call.url.includes('torium_memberships') && call.method !== 'GET');
    assert.equal(membershipWrites.length, 0);
  } finally {
    stub.restore();
  }
});

test('an invited account without a membership may still set its password', async () => {
  const stub = installSupabaseStub(stubFor(NO_MEMBERSHIP));
  try {
    const adopt = responseRecorder();
    await passwordHandler(browserRequest({
      method: 'POST',
      body: {
        action: 'adopt',
        type: 'invite',
        access_token: NO_MEMBERSHIP.token,
        refresh_token: 'refresh-token-value-000000',
        expires_in: 3600,
      },
    }), adopt);
    assert.equal(adopt.statusCode, 200);

    const update = responseRecorder();
    await passwordHandler(authenticatedRequest(NO_MEMBERSHIP, {
      method: 'PUT',
      body: { password: 'a-sufficiently-long-password' },
    }), update);

    assert.equal(update.statusCode, 200);
    assert.equal(update.body.reauthenticate, true);
    assert.equal(stub.callsTo('logout?scope=global').length, 1, 'every device session is revoked');
    assert.ok(update.cookies().every((cookie) => cookie.includes('Max-Age=0')));
  } finally {
    stub.restore();
  }
});

test('a short password is refused before it reaches Supabase', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const response = responseRecorder();
    await passwordHandler(authenticatedRequest(ACTIVE_INVESTOR, { method: 'PUT', body: { password: 'short' } }), response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /12/);
    assert.equal(stub.calls.filter((call) => call.method === 'PUT' && call.url.includes('/auth/v1/user')).length, 0);
  } finally {
    stub.restore();
  }
});

// --- logout ----------------------------------------------------------------

test('logout revokes the session globally and clears every auth cookie', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const response = responseRecorder();
    await sessionHandler(authenticatedRequest(ACTIVE_INVESTOR, { method: 'DELETE' }), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.authenticated, false);
    assert.equal(stub.callsTo('logout?scope=global').length, 1);
    const cookies = response.cookies();
    assert.equal(cookies.length, 4);
    assert.ok(cookies.every((cookie) => cookie.includes('Max-Age=0')));
    assert.ok(cookies.some((cookie) => cookie.startsWith('__Host-torium_access_token')));
  } finally {
    stub.restore();
  }
});

// --- publisher separation --------------------------------------------------

test('the renewal publisher credential is separate from human authentication', () => {
  const agentKey = 'renewal-agent-key-with-enough-entropy-0001';
  const memberRequest = authenticatedRequest(ACTIVE_ADMIN, { method: 'POST' });

  // A signed-in admin browser session is not a publisher credential.
  assert.equal(isRenewalAgentAuthorized(memberRequest, agentKey), false);
  // The publisher bearer is accepted only as an exact match.
  assert.equal(isRenewalAgentAuthorized({ headers: { authorization: 'Bearer ' + agentKey } }, agentKey), true);
  assert.equal(isRenewalAgentAuthorized({ headers: { authorization: 'Bearer ' + agentKey + 'x' } }, agentKey), false);
  // A weak or absent key disables the publisher entirely.
  assert.equal(isRenewalAgentAuthorized({ headers: { authorization: 'Bearer short' } }, 'short'), false);
  assert.equal(isRenewalAgentAuthorized({ headers: {} }, agentKey), false);
});

// --- caching ---------------------------------------------------------------

test('authenticated API responses are never marked publicly cacheable', async () => {
  const stub = installSupabaseStub(stubFor(ACTIVE_INVESTOR));
  try {
    const response = responseRecorder();
    await preferencesHandler(authenticatedRequest(ACTIVE_INVESTOR, { method: 'GET' }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store, private');
    assert.equal(response.headers.Vary, 'Cookie');
  } finally {
    stub.restore();
  }
});

test('no API handler emits a shared-cache directive', async () => {
  const files = (await readdir(new URL('../api/', import.meta.url))).filter((name) => name.endsWith('.js'));
  for (const name of files) {
    const source = await readFile(new URL('../api/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /Cache-Control['"],\s*['"][^'"]*\bpublic\b/,
      name + ' must not place an authenticated response in a shared cache',
    );
    assert.doesNotMatch(source, /s-maxage/, name + ' must not set a shared-cache lifetime');
  }
});

// --- account multiplexer ---------------------------------------------------

test('the account multiplexer rejects an unknown resource', async () => {
  const response = responseRecorder();
  await accountHandler(browserRequest({ method: 'GET', query: { resource: 'anything-else' } }), response);
  assert.equal(response.statusCode, 404);
});
