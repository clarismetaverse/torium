import test from 'node:test';
import assert from 'node:assert/strict';
import pushHandler, { isAllowedPushEndpoint, parseSubscription, deviceLabel } from '../api/_push.js';
import accountHandler from '../api/account.js';
import { resetFallbackWindows } from '../api/_rate-limit.js';

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.c2lnbmF0dXJlLXBsYWNlaG9sZGVy';
const MEMBER = { id: 'member-1', email: 'member@example.test' };
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dR4nd0mT0k3n';
const P256DH = 'B'.repeat(87);
const AUTH = 'C'.repeat(22);

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    query: {},
    body: {},
    ...overrides,
    headers: {
      host: 'torium.test',
      'x-forwarded-proto': 'https',
      origin: 'https://torium.test',
      'sec-fetch-site': 'same-origin',
      cookie: 'torium_access_token=' + ACCESS_TOKEN,
      ...(overrides.headers || {}),
    },
  };
}

function installStub({ activeMembership = true, subscriptions = [] } = {}) {
  const originalFetch = globalThis.fetch;
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TORIUM_VAPID_PUBLIC_KEY: process.env.TORIUM_VAPID_PUBLIC_KEY,
  };
  process.env.SUPABASE_URL = 'https://project.test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.TORIUM_VAPID_PUBLIC_KEY = 'BPublicKeyForTests';

  const calls = [];
  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url, method, headers: init.headers || {}, body: init.body });
    if (url.includes('/auth/v1/user')) {
      const auth = init.headers?.Authorization || '';
      return auth.includes(ACCESS_TOKEN) ? json(200, MEMBER) : json(401, {});
    }
    if (url.includes('/rest/v1/torium_memberships')) {
      return json(200, activeMembership ? [{ user_id: MEMBER.id, role: 'investor', status: 'active' }] : []);
    }
    if (url.includes('/rest/v1/rpc/torium_rate_limit_hit')) return json(200, { allowed: true });
    if (url.includes('/rest/v1/investor_push_subscriptions')) {
      if (method === 'POST') {
        return json(201, [{
          id: 'sub-1', device_label: 'Android', created_at: '2026-09-13T10:00:00Z', last_delivered_at: null,
        }]);
      }
      if (method === 'DELETE') return json(200, [{ id: 'sub-1' }]);
      return json(200, subscriptions);
    }
    return json(404, {});
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetFallbackWindows();
    },
  };
}

// --- endpoint validation ---------------------------------------------------

test('a push endpoint must be https and belong to a known push service', () => {
  assert.equal(isAllowedPushEndpoint(ENDPOINT), true);
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/abc'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
});

test('an endpoint pointing back into the infrastructure is refused', () => {
  // The server makes POST requests to whatever is stored here, so an
  // unchecked endpoint is a way to aim it at something internal.
  for (const hostile of [
    'https://localhost/push',
    'https://127.0.0.1/push',
    'https://10.0.0.5/push',
    'https://192.168.1.10/push',
    'https://169.254.169.254/latest/meta-data',
    'https://vault.internal/push',
    'https://attacker.example.com/push',
    'https://fcm.googleapis.com.attacker.example/push',
    'https://user:pass@fcm.googleapis.com/push',
  ]) {
    assert.equal(isAllowedPushEndpoint(hostile), false, hostile + ' must be refused');
  }
});

test('device keys are checked for shape before they are stored', () => {
  assert.equal(parseSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }).error, undefined);
  assert.ok(parseSubscription({ endpoint: ENDPOINT, keys: { p256dh: 'short', auth: AUTH } }).error);
  assert.ok(parseSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: 'short' } }).error);
  assert.ok(parseSubscription({ endpoint: 'https://attacker.example/x', keys: { p256dh: P256DH, auth: AUTH } }).error);
});

test('the device label is short and stripped of control characters', () => {
  assert.equal(deviceLabel('iPhone'), 'iPhone');
  assert.equal(deviceLabel('i\u0000Phone\u001b'), 'iPhone');
  assert.equal(deviceLabel('x'.repeat(200)).length, 40);
  assert.equal(deviceLabel(''), null);
});

// --- endpoint behaviour ----------------------------------------------------

test('an anonymous caller gets no VAPID key and no device list', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await pushHandler(request({ headers: { cookie: '' } }), response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.body?.vapid_public_key, undefined);
  } finally {
    stub.restore();
  }
});

test('a member without an active membership cannot register a device', async () => {
  const stub = installStub({ activeMembership: false });
  try {
    const response = responseRecorder();
    await pushHandler(request({
      method: 'POST',
      body: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } },
    }), response);
    assert.equal(response.statusCode, 403);
    assert.equal(stub.calls.some((call) => call.method === 'POST'
      && call.url.includes('investor_push_subscriptions')), false);
  } finally {
    stub.restore();
  }
});

test('registering claims the endpoint for the signed-in account', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await pushHandler(request({
      method: 'POST',
      body: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, device_label: 'Android' },
    }), response);

    assert.equal(response.statusCode, 201);
    // The endpoint is freed from any previous owner before it is claimed:
    // one browser, one account.
    const deleted = stub.calls.find((call) => call.method === 'DELETE'
      && call.url.includes('investor_push_subscriptions'));
    assert.ok(deleted, 'the endpoint is released before being claimed');
    const written = stub.calls.find((call) => call.method === 'POST'
      && call.url.includes('investor_push_subscriptions'));
    assert.equal(JSON.parse(written.body).user_id, MEMBER.id,
      'the row is pinned to the session, never to a user id from the request');
  } finally {
    stub.restore();
  }
});

test('a cross-origin registration is refused', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await pushHandler(request({
      method: 'POST',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } },
    }), response);
    assert.equal(response.statusCode, 403);
  } finally {
    stub.restore();
  }
});

test('a malformed subscription is refused before it reaches the database', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await pushHandler(request({
      method: 'POST',
      body: { endpoint: 'https://169.254.169.254/latest', keys: { p256dh: P256DH, auth: AUTH } },
    }), response);
    assert.equal(response.statusCode, 400);
    assert.equal(stub.calls.some((call) => call.url.includes('investor_push_subscriptions')), false);
  } finally {
    stub.restore();
  }
});

test('revoking a device is scoped to the caller', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await pushHandler(request({ method: 'DELETE', body: { endpoint: ENDPOINT } }), response);
    assert.equal(response.statusCode, 200);
    const deleted = stub.calls.find((call) => call.method === 'DELETE'
      && call.url.includes('investor_push_subscriptions'));
    assert.ok(deleted.url.includes('user_id=eq.' + MEMBER.id),
      'a delete may never be issued without the session user id');
  } finally {
    stub.restore();
  }
});

test('the push resource is reachable through the account function', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await accountHandler(request({ query: { resource: 'push' } }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.vapid_public_key, 'BPublicKeyForTests');
  } finally {
    stub.restore();
  }
});

test('the response is never cached, because it names the investor devices', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await pushHandler(request(), response);
    assert.match(String(response.headers['Cache-Control']), /no-store/);
    assert.match(String(response.headers['Cache-Control']), /private/);
  } finally {
    stub.restore();
  }
});
