// Test doubles for the Supabase Auth and PostgREST calls the API layer makes.
// Nothing here contacts a real project: every handler under test talks to this
// router instead, so the whole authorization matrix runs offline.

export const TEST_ENV = {
  SUPABASE_URL: 'https://project.test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  TORIUM_AUTH_HASH_SALT: 'test-hash-salt',
};

export function applyTestEnv(overrides = {}) {
  const previous = {};
  const values = { ...TEST_ENV, ...overrides };
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    cookies() {
      const raw = this.headers['Set-Cookie'];
      return Array.isArray(raw) ? raw : raw ? [raw] : [];
    },
  };
}

export function browserRequest(overrides = {}) {
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
      'x-forwarded-for': '203.0.113.10',
      ...(overrides.headers || {}),
    },
  };
}

export function sessionCookie(accessToken, refreshToken = 'refresh-' + accessToken) {
  return 'torium_access_token=' + accessToken + '; torium_refresh_token=' + refreshToken;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * @param {object} options
 * @param {Record<string, object>} options.users      access token -> Supabase user
 * @param {Record<string, object>} options.memberships user id -> membership row
 * @param {object} options.password                   { email, password, token, user }
 * @param {boolean|object} options.rateLimit          false to deny, or { allowed, retry_after }
 */
export function installSupabaseStub(options = {}) {
  const {
    users = {},
    memberships = {},
    password = null,
    rateLimit = { allowed: true, retry_after: 60 },
    inviteStatus = 200,
    recoverStatus = 200,
    updatePasswordStatus = 200,
    refresh = null,
  } = options;

  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const authorization = headers.Authorization || headers.authorization || '';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, headers, body });

    if (url.includes('/rest/v1/rpc/torium_rate_limit_hit')) {
      if (rateLimit === false) return jsonResponse(200, [{ allowed: false, retry_after: 120 }]);
      return jsonResponse(200, [rateLimit]);
    }

    if (url.includes('/auth/v1/user') && method === 'GET') {
      const token = String(authorization).replace('Bearer ', '');
      const user = users[token];
      return user ? jsonResponse(200, user) : jsonResponse(401, { msg: 'invalid token' });
    }

    if (url.includes('/auth/v1/user') && method === 'PUT') {
      return updatePasswordStatus === 200
        ? jsonResponse(200, { id: 'user-updated' })
        : jsonResponse(updatePasswordStatus, { msg: 'update rejected' });
    }

    if (url.includes('grant_type=password')) {
      if (!password || body.email !== password.email || body.password !== password.password) {
        return jsonResponse(400, { error_description: 'Invalid login credentials' });
      }
      return jsonResponse(200, {
        access_token: password.token,
        refresh_token: 'refresh-' + password.token,
        expires_in: 3600,
        user: password.user,
      });
    }

    if (url.includes('grant_type=refresh_token')) {
      if (!refresh) return jsonResponse(401, { msg: 'invalid refresh token' });
      return jsonResponse(200, refresh);
    }

    if (url.includes('/auth/v1/logout')) return jsonResponse(204, {});
    if (url.includes('/auth/v1/recover')) {
      return recoverStatus === 200
        ? jsonResponse(200, {})
        : jsonResponse(recoverStatus, { msg: 'recovery rejected' });
    }
    if (url.includes('/auth/v1/invite')) {
      return inviteStatus === 200
        ? jsonResponse(200, { id: 'invited-user-id' })
        : jsonResponse(inviteStatus, { msg: 'invite rejected' });
    }

    if (url.includes('/rest/v1/torium_memberships')) {
      const match = /user_id=eq\.([^&]+)/.exec(url);
      const membership = match ? memberships[decodeURIComponent(match[1])] : null;
      return jsonResponse(200, membership ? [membership] : []);
    }

    if (url.includes('/rest/v1/torium_auth_events')) return jsonResponse(201, {});
    if (url.includes('/rest/v1/investor_alert_preferences')) return jsonResponse(200, [{ user_id: 'x' }]);

    return jsonResponse(404, { msg: 'unstubbed ' + method + ' ' + url });
  };

  return {
    calls,
    restore() { globalThis.fetch = originalFetch; },
    callsTo(fragment) { return calls.filter((call) => call.url.includes(fragment)); },
  };
}

export const ACTIVE_INVESTOR = {
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJinvestoriLCJhYWwiOiJhYWwxIn0.c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
  user: { id: 'investor-1', email: 'investor@example.test' },
  membership: { user_id: 'investor-1', role: 'investor', status: 'active' },
};

export const ACTIVE_ADMIN = {
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJadminiLCJhYWwiOiJhYWwxIn0.c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
  user: { id: 'admin-1', email: 'admin@example.test' },
  membership: { user_id: 'admin-1', role: 'admin', status: 'active' },
};

export const SUSPENDED_MEMBER = {
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsuspendediLCJhYWwiOiJhYWwxIn0.c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
  user: { id: 'suspended-1', email: 'suspended@example.test' },
  membership: { user_id: 'suspended-1', role: 'investor', status: 'suspended' },
};

export const NO_MEMBERSHIP = {
  token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJnomemberiLCJhYWwiOiJhYWwxIn0.c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
  user: { id: 'invited-1', email: 'invited@example.test' },
};

export function stubFor(...accounts) {
  const users = {};
  const memberships = {};
  for (const account of accounts) {
    users[account.token] = account.user;
    if (account.membership) memberships[account.user.id] = account.membership;
  }
  return { users, memberships };
}
