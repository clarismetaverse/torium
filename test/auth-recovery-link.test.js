import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import passwordHandler from '../api/_auth-password.js';

// A Supabase access token is a JWT; a Supabase refresh token is a short opaque
// string. Current GoTrue issues 12-character refresh tokens.
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.c2lnbmF0dXJlLXBsYWNlaG9sZGVy';
const REFRESH_TOKEN = 'kzxq7hbzvxbn';
const MEMBER = { id: 'member-1', email: 'member@example.test' };

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookies() {
      const raw = this.headers['Set-Cookie'];
      return Array.isArray(raw) ? raw : raw ? [raw] : [];
    },
  };
}

function request(body) {
  return {
    method: 'POST',
    query: {},
    body,
    headers: {
      host: 'torium.test',
      'x-forwarded-proto': 'https',
      origin: 'https://torium.test',
    },
  };
}

function installSupabaseStub({ activeMembership = true } = {}) {
  const originalFetch = globalThis.fetch;
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = 'https://project.test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) {
      const auth = init.headers?.Authorization || '';
      return auth.includes(ACCESS_TOKEN) ? json(200, MEMBER) : json(401, { msg: 'invalid token' });
    }
    if (url.includes('/rest/v1/torium_memberships')) {
      return json(200, activeMembership ? [{ user_id: MEMBER.id, role: 'investor', status: 'active' }] : []);
    }
    if (url.includes('/rest/v1/torium_auth_events')) return json(201, {});
    return json(404, { msg: 'unstubbed ' + url });
  };

  return () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('a 12-character Supabase refresh token is accepted', async () => {
  // Regression: the guard required 20+ characters, so every real recovery and
  // invite link was rejected with a 400 before Supabase was ever consulted.
  const restore = installSupabaseStub();
  try {
    const response = responseRecorder();
    await passwordHandler(request({
      action: 'adopt',
      type: 'recovery',
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 3600,
    }), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.mode, 'recovery');
    const cookies = response.cookies();
    assert.ok(cookies.some((cookie) => cookie.includes('torium_refresh_token')));
    assert.ok(cookies.every((cookie) => cookie.includes('HttpOnly')));
  } finally {
    restore();
  }
});

test('an invite link is adopted the same way', async () => {
  const restore = installSupabaseStub();
  try {
    const response = responseRecorder();
    await passwordHandler(request({
      action: 'adopt',
      type: 'invite',
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.mode, 'invite');
  } finally {
    restore();
  }
});

test('malformed link payloads are still refused', async () => {
  const restore = installSupabaseStub();
  try {
    const rejected = [
      ['unsupported type', { type: 'signup', access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN }],
      ['access token is not a JWT', { type: 'recovery', access_token: 'not-a-jwt-at-all-but-long-enough', refresh_token: REFRESH_TOKEN }],
      ['refresh token too short', { type: 'recovery', access_token: ACCESS_TOKEN, refresh_token: 'short' }],
      ['refresh token absurdly long', { type: 'recovery', access_token: ACCESS_TOKEN, refresh_token: 'x'.repeat(600) }],
    ];
    for (const [label, body] of rejected) {
      const response = responseRecorder();
      await passwordHandler(request({ action: 'adopt', ...body }), response);
      assert.equal(response.statusCode, 400, label);
    }
  } finally {
    restore();
  }
});

test('an account without an active membership may still adopt the link', async () => {
  // Password lifecycle is Supabase identity, not TORIUM authorization. An
  // invited account has to be able to set its password before an operator
  // grants access; product data stays denied until then, which every other
  // endpoint asserts separately.
  const restore = installSupabaseStub({ activeMembership: false });
  try {
    const response = responseRecorder();
    await passwordHandler(request({
      action: 'adopt',
      type: 'recovery',
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    }), response);
    assert.equal(response.statusCode, 200);
    assert.ok(response.cookies().some((cookie) => cookie.includes('torium_access_token')));
  } finally {
    restore();
  }
});

test('a link whose token Supabase rejects is refused', async () => {
  const restore = installSupabaseStub();
  try {
    const response = responseRecorder();
    await passwordHandler(request({
      action: 'adopt',
      type: 'recovery',
      access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvdGhlciJ9.bm90LXRoZS1yaWdodC1vbmU',
      refresh_token: REFRESH_TOKEN,
    }), response);
    assert.equal(response.statusCode, 403);
  } finally {
    restore();
  }
});

// --- the guard must not eat the token before /set-password sees it ----------

function fakeLocation(pathname, hash = '', search = '') {
  return { pathname, search, hash, replaced: [], replace(url) { this.replaced.push(url); } };
}

async function runAuthClient(location, fetchImpl) {
  const source = await readFile(new URL('../public/auth-client.js', import.meta.url), 'utf8');
  const context = {
    location,
    URLSearchParams,
    Promise,
    JSON,
    console,
    encodeURIComponent,
    setTimeout,
    document: {
      documentElement: { classList: { add() {}, remove() {} }, dataset: {} },
      head: { append() {} },
      createElement: () => ({}),
      addEventListener() {},
    },
  };
  context.window = context;
  context.globalThis = context;
  context.fetch = fetchImpl;
  vm.createContext(context);
  vm.runInContext(source, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('a recovery link landing on a protected page is forwarded to /set-password', async () => {
  // GoTrue falls back to the Site URL when redirect_to is not allowlisted, so
  // the one-time token arrives on /home rather than /set-password.
  const fragment = 'access_token=' + ACCESS_TOKEN + '&refresh_token=' + REFRESH_TOKEN + '&expires_in=3600&type=recovery';
  const location = fakeLocation('/home', '#' + fragment);
  let probes = 0;
  await runAuthClient(location, async () => { probes += 1; return { ok: false, status: 401, json: async () => ({}) }; });

  assert.equal(location.replaced[0], '/set-password#' + fragment);
  assert.equal(probes, 0, 'the guard must not run before the token is forwarded');
});

test('an expired link is forwarded so the page can explain it', async () => {
  const fragment = 'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  const location = fakeLocation('/home', '#' + fragment);
  await runAuthClient(location, async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal(location.replaced[0], '/set-password#' + fragment);
});

test('an ordinary protected page visit still goes to login', async () => {
  const location = fakeLocation('/home', '#top', '?run=abc');
  await runAuthClient(location, async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal(location.replaced[0], '/login?next=' + encodeURIComponent('/home?run=abc#top'));
});
