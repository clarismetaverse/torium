import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import alertsHandler, { parseAcknowledgement, parseLimit } from '../api/_investor-alerts.js';
import accountHandler from '../api/account.js';

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.c2lnbmF0dXJlLXBsYWNlaG9sZGVy';
const MEMBER = { id: 'member-1', email: 'member@example.test' };

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
      cookie: 'torium_access_token=' + ACCESS_TOKEN,
      ...(overrides.headers || {}),
    },
  };
}

function installStub({ activeMembership = true, alerts = [], patchResult = [] } = {}) {
  const originalFetch = globalThis.fetch;
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = 'https://project.test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  const calls = [];
  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: String(init.method || 'GET').toUpperCase(), headers: init.headers || {} });
    if (url.includes('/auth/v1/user')) {
      const auth = init.headers?.Authorization || '';
      return auth.includes(ACCESS_TOKEN) ? json(200, MEMBER) : json(401, {});
    }
    if (url.includes('/rest/v1/torium_memberships')) {
      return json(200, activeMembership ? [{ user_id: MEMBER.id, role: 'investor', status: 'active' }] : []);
    }
    if (url.includes('/rest/v1/investor_alerts')) {
      const method = String(init.method || 'GET').toUpperCase();
      return json(200, method === 'PATCH' ? patchResult : alerts);
    }
    if (url.includes('/auth/v1/logout')) return json(204, {});
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
    },
  };
}

const ALERT = {
  property_key: 'v1:idealista:id:12345',
  title: 'Quadrilocale da ristrutturare',
  neighborhood: 'Navigli',
  price_eur: 520000,
  door_score: 78,
  matched_at: '2026-09-12T08:00:00Z',
  seen_at: null,
  dismissed_at: null,
};

// --- input validation ------------------------------------------------------

test('the page size is bounded', () => {
  assert.equal(parseLimit(undefined), 25);
  assert.equal(parseLimit('10'), 10);
  assert.equal(parseLimit('99999'), 100);
  assert.equal(parseLimit('-1'), 25);
  assert.equal(parseLimit('abc'), 25);
});

test('only the two acknowledgement timestamps are writable', () => {
  const seen = parseAcknowledgement({ property_key: 'v1:a', action: 'seen' });
  assert.deepEqual(Object.keys(seen.patch), ['seen_at']);

  const dismissed = parseAcknowledgement({ property_key: 'v1:a', action: 'dismissed' });
  assert.deepEqual(Object.keys(dismissed.patch).sort(), ['dismissed_at', 'seen_at']);

  // Nothing the investor sends can rewrite what the alert says.
  const hostile = parseAcknowledgement({
    property_key: 'v1:a', action: 'seen', price_eur: 1, title: 'hacked', user_id: 'someone-else',
  });
  assert.deepEqual(Object.keys(hostile.patch), ['seen_at']);
});

test('malformed acknowledgements are refused', () => {
  assert.match(parseAcknowledgement({ action: 'seen' }).error, /property_key/);
  assert.match(parseAcknowledgement({ property_key: 'v1:a', action: 'delete' }).error, /Azione/);
  assert.match(parseAcknowledgement({ property_key: 'x'.repeat(500), action: 'seen' }).error, /property_key/);
});

// --- authorization ---------------------------------------------------------

test('an anonymous caller gets nothing', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    const anonymous = request();
    delete anonymous.headers.cookie;
    await alertsHandler(anonymous, response);
    assert.equal(response.statusCode, 401);
  } finally {
    stub.restore();
  }
});

test('an authenticated user without an active membership gets nothing', async () => {
  const stub = installStub({ activeMembership: false });
  try {
    const response = responseRecorder();
    await alertsHandler(request(), response);
    assert.equal(response.statusCode, 403);
  } finally {
    stub.restore();
  }
});

test('alerts are read with the investor token so RLS is the boundary', async () => {
  const stub = installStub({ alerts: [ALERT] });
  try {
    const response = responseRecorder();
    await alertsHandler(request(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.alerts.length, 1);
    assert.equal(response.body.unseen_count, 1);

    const read = stub.calls.find((call) => call.url.includes('investor_alerts'));
    assert.equal(read.headers.Authorization, 'Bearer ' + ACCESS_TOKEN);
    assert.equal(String(read.headers.apikey).includes('service-role'), false);
    assert.ok(read.url.includes('user_id=eq.' + MEMBER.id));
  } finally {
    stub.restore();
  }
});

test('dismissed alerts are hidden unless asked for', async () => {
  const stub = installStub({ alerts: [] });
  try {
    await alertsHandler(request(), responseRecorder());
    const defaultRead = stub.calls.find((call) => call.url.includes('investor_alerts'));
    assert.ok(defaultRead.url.includes('dismissed_at=is.null'));
  } finally {
    stub.restore();
  }

  const second = installStub({ alerts: [] });
  try {
    await alertsHandler(request({ query: { include_dismissed: 'true' } }), responseRecorder());
    const fullRead = second.calls.find((call) => call.url.includes('investor_alerts'));
    assert.equal(fullRead.url.includes('dismissed_at=is.null'), false);
  } finally {
    second.restore();
  }
});

// --- acknowledgement -------------------------------------------------------

test('an alert can be marked seen', async () => {
  const stub = installStub({ patchResult: [{ ...ALERT, seen_at: '2026-09-12T09:00:00Z' }] });
  try {
    const response = responseRecorder();
    await alertsHandler(request({
      method: 'PATCH',
      body: { property_key: ALERT.property_key, action: 'seen' },
    }), response);

    assert.equal(response.statusCode, 200);
    assert.ok(response.body.alert.seen_at);
    const patch = stub.calls.find((call) => call.method === 'PATCH');
    assert.ok(patch.url.includes('user_id=eq.' + MEMBER.id));
    assert.ok(patch.url.includes('property_key=eq.'));
  } finally {
    stub.restore();
  }
});

test('acknowledging somebody else\'s alert finds nothing', async () => {
  const stub = installStub({ patchResult: [] });
  try {
    const response = responseRecorder();
    await alertsHandler(request({
      method: 'PATCH',
      body: { property_key: 'v1:idealista:id:not-mine', action: 'seen' },
    }), response);
    assert.equal(response.statusCode, 404);
  } finally {
    stub.restore();
  }
});

test('a cross-origin acknowledgement is refused', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await alertsHandler(request({
      method: 'PATCH',
      body: { property_key: ALERT.property_key, action: 'seen' },
      headers: { origin: 'https://attacker.example' },
    }), response);
    assert.equal(response.statusCode, 403);
  } finally {
    stub.restore();
  }
});

test('unsupported methods are refused', async () => {
  const stub = installStub();
  try {
    const response = responseRecorder();
    await alertsHandler(request({ method: 'DELETE' }), response);
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'GET, PATCH');
  } finally {
    stub.restore();
  }
});

// --- caching ---------------------------------------------------------------

test('the alert list is never publicly cacheable', async () => {
  const stub = installStub({ alerts: [ALERT] });
  try {
    const response = responseRecorder();
    await alertsHandler(request(), response);
    assert.equal(response.headers['Cache-Control'], 'no-store, private');
    assert.equal(response.headers.Vary, 'Cookie');
  } finally {
    stub.restore();
  }
});

// --- routing and page wiring ----------------------------------------------

test('the account multiplexer exposes the alerts resource', async () => {
  const stub = installStub({ alerts: [] });
  try {
    const response = responseRecorder();
    await accountHandler(request({ query: { resource: 'alerts' } }), response);
    assert.equal(response.statusCode, 200, 'alerts must route through /api/account');
  } finally {
    stub.restore();
  }

  const unknown = responseRecorder();
  await accountHandler(request({ query: { resource: 'nope' } }), unknown);
  assert.equal(unknown.statusCode, 404);
});

test('the rewrite exists and no new serverless function was added', async () => {
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrite = vercel.rewrites.find((entry) => entry.source === '/api/investor-alerts');
  assert.ok(rewrite, 'the public path must be rewritten');
  assert.equal(rewrite.destination, '/api/account?resource=alerts');

  // Vercel Hobby caps the deployment; the handler is underscore-prefixed so it
  // is multiplexed rather than deployed as its own function.
  const { readdir } = await import('node:fs/promises');
  const routed = (await readdir(new URL('../api/', import.meta.url)))
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'));
  assert.ok(routed.length <= 12, 'function budget exceeded: ' + routed.length);
});

test('the account page renders alerts and parses', async () => {
  const html = await readFile(new URL('../public/account.html', import.meta.url), 'utf8');
  assert.match(html, /id="alertsList"/);
  assert.match(html, /id="alertsBadge"/);
  assert.match(html, /\/api\/investor-alerts/);
  // The claim that notifications do not exist yet had to go.
  assert.doesNotMatch(html, /non sono ancora attive/);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const source of scripts) assert.doesNotThrow(() => new Script(source));
});

test('the rendered alert links are restricted to the scraped portals', async () => {
  const html = await readFile(new URL('../public/account.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];
  // Evaluate the guard alone: the surrounding page script touches the DOM on
  // load, and this test is about the allowlist, not the page lifecycle.
  const source = script.match(/const safeUrl=[\s\S]*?catch\{return null\}\};/);
  assert.ok(source, 'the page must define a link guard');

  const context = { URL };
  new Script(source[0] + ';globalThis.__safeUrl=safeUrl;').runInNewContext(context, { timeout: 2000 });
  const safeUrl = context.__safeUrl;
  assert.equal(safeUrl('https://www.idealista.it/immobile/1/'), 'https://www.idealista.it/immobile/1/');
  for (const hostile of ['https://evil.example', 'http://www.idealista.it/x', 'javascript:alert(1)', 'https://idealista.it.evil.example/']) {
    assert.equal(safeUrl(hostile), null, 'must refuse ' + hostile);
  }
});
