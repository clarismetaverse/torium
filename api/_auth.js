const LEGACY_ACCESS_COOKIE = 'torium_access_token';
const LEGACY_REFRESH_COOKIE = 'torium_refresh_token';
const HOST_ACCESS_COOKIE = '__Host-torium_access_token';
const HOST_REFRESH_COOKIE = '__Host-torium_refresh_token';
const ALLOWED_ROLES = new Set(['admin', 'investor']);

function authConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !apiKey) throw new Error('Supabase auth is not configured');
  return { url, apiKey };
}

function serviceConfig() {
  const { url } = authConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Supabase service access is not configured');
  return { url, serviceKey };
}

function isProduction() {
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
}

function primaryCookieNames() {
  return isProduction()
    ? { access: HOST_ACCESS_COOKIE, refresh: HOST_REFRESH_COOKIE }
    : { access: LEGACY_ACCESS_COOKIE, refresh: LEGACY_REFRESH_COOKIE };
}

export function parseCookies(request) {
  const header = String(request?.headers?.cookie || '');
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return null;
    try {
      return [
        decodeURIComponent(part.slice(0, separator).trim()),
        decodeURIComponent(part.slice(separator + 1).trim()),
      ];
    } catch {
      return null;
    }
  }).filter(Boolean));
}

function headerValue(request, name) {
  const value = request?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function requestOrigin(request) {
  const host = headerValue(request, 'x-forwarded-host') || headerValue(request, 'host');
  const protocol = headerValue(request, 'x-forwarded-proto') || (isProduction() ? 'https' : 'http');
  return host ? protocol + '://' + host : null;
}

export function siteOrigin(request) {
  return requestOrigin(request) || process.env.TORIUM_SITE_ORIGIN || process.env.SITE_URL || 'https://torium-nu.vercel.app';
}

export function isSameOrigin(request) {
  const expected = requestOrigin(request);
  if (!expected) return false;
  const fetchSite = String(headerValue(request, 'sec-fetch-site') || '').toLowerCase();
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  const supplied = headerValue(request, 'origin') || headerValue(request, 'referer');
  if (!supplied) return true;
  try {
    return new URL(supplied).origin === expected;
  } catch {
    return false;
  }
}

function serializeCookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value)
    + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge
    + (isProduction() ? '; Secure' : '');
}

function expiredLegacyCookies() {
  if (!isProduction()) return [];
  return [
    serializeCookie(LEGACY_ACCESS_COOKIE, '', 0),
    serializeCookie(LEGACY_REFRESH_COOKIE, '', 0),
  ];
}

export function setAuthCookies(response, session) {
  const names = primaryCookieNames();
  const accessMaxAge = Math.max(60, Number(session.expires_in) || 3600);
  const refreshMaxAge = 60 * 60 * 24 * 30;
  response.setHeader('Set-Cookie', [
    serializeCookie(names.access, session.access_token, accessMaxAge),
    serializeCookie(names.refresh, session.refresh_token, refreshMaxAge),
    ...expiredLegacyCookies(),
  ]);
}

export function clearAuthCookies(response) {
  response.setHeader('Set-Cookie', [
    serializeCookie(HOST_ACCESS_COOKIE, '', 0),
    serializeCookie(HOST_REFRESH_COOKIE, '', 0),
    serializeCookie(LEGACY_ACCESS_COOKIE, '', 0),
    serializeCookie(LEGACY_REFRESH_COOKIE, '', 0),
  ]);
}

export async function authRequest(path, init = {}) {
  const { url, apiKey } = authConfig();
  return fetch(url + '/auth/v1/' + path, {
    ...init,
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export async function userForAccessToken(accessToken) {
  if (!accessToken) return null;
  const response = await authRequest('user', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  return response.ok ? response.json() : null;
}

export async function membershipForUser(userId) {
  if (!userId) return null;
  const { url, serviceKey } = serviceConfig();
  const query = new URLSearchParams({
    select: 'user_id,role,status,created_at,updated_at',
    user_id: 'eq.' + userId,
    limit: '1',
  });
  const response = await fetch(url + '/rest/v1/torium_memberships?' + query, {
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
    },
  });
  if (!response.ok) throw new Error('Unable to verify TORIUM membership');
  const membership = (await response.json())[0] || null;
  if (!membership || membership.status !== 'active' || !ALLOWED_ROLES.has(membership.role)) return null;
  return membership;
}

export async function recordAuthEvent(userId, eventType, metadata = {}) {
  if (!userId) return;
  try {
    const { url, serviceKey } = serviceConfig();
    const response = await fetch(url + '/rest/v1/torium_auth_events', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        event_type: eventType,
        metadata,
      }),
    });
    if (!response.ok) console.error('Auth audit insert failed', response.status);
  } catch (error) {
    console.error('Auth audit insert failed', error);
  }
}

export async function passwordSession(email, password) {
  const response = await authRequest('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error_description || body.msg || 'Invalid email or password');
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

export async function requestPasswordRecovery(email, redirectTo) {
  const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  const response = await authRequest('recover' + query, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.msg || 'Unable to send recovery email');
    error.statusCode = response.status;
    throw error;
  }
}

async function upsertMembershipForUser(userId, role = 'investor') {
  const { url, serviceKey } = serviceConfig();
  const response = await fetch(url + '/rest/v1/torium_memberships?on_conflict=user_id', {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      role: ALLOWED_ROLES.has(role) ? role : 'investor',
      status: 'active',
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error('Unable to activate TORIUM membership');
  }
}

export async function requestInvite(email, redirectTo, role = 'investor') {
  const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  const response = await authRequest('invite' + query, {
    method: 'POST',
    body: JSON.stringify({
      email,
      data: { torium_invite: true },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.msg || body.error_description || 'Unable to send invite email');
    error.statusCode = response.status;
    throw error;
  }
  const userId = body?.id || body?.user?.id || body?.user_id;
  if (userId) {
    await upsertMembershipForUser(userId, role);
  }
  return body;
}

export async function updatePassword(accessToken, password, currentPassword) {
  const payload = { password };
  if (currentPassword) payload.current_password = currentPassword;
  const response = await authRequest('user', {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.msg || body.error_description || 'Unable to update password');
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function tokenFromCookies(cookies, hostName, legacyName) {
  return cookies[hostName] || cookies[legacyName] || null;
}

export async function authenticatedSession(request, response) {
  const cookies = parseCookies(request);
  const accessToken = tokenFromCookies(cookies, HOST_ACCESS_COOKIE, LEGACY_ACCESS_COOKIE);
  const existingUser = await userForAccessToken(accessToken);
  if (existingUser) return { user: existingUser, accessToken };

  const refreshToken = tokenFromCookies(cookies, HOST_REFRESH_COOKIE, LEGACY_REFRESH_COOKIE);
  if (!refreshToken) return null;
  const refreshed = await authRequest('token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!refreshed.ok) {
    clearAuthCookies(response);
    return null;
  }
  const session = await refreshed.json();
  setAuthCookies(response, session);
  return { user: session.user, accessToken: session.access_token };
}

export async function memberSession(request, response) {
  const session = await authenticatedSession(request, response);
  if (!session?.user?.id) return null;
  const membership = await membershipForUser(session.user.id);
  return membership ? { ...session, membership } : null;
}

export async function requireAuthenticatedUser(request, response) {
  try {
    const session = await authenticatedSession(request, response);
    if (!session?.user?.id) {
      response.status(401).json({ error: 'Authentication required' });
      return null;
    }
    const membership = await membershipForUser(session.user.id);
    if (membership) return { ...session, membership };
    await revokeSession(session.accessToken).catch(() => {});
    clearAuthCookies(response);
    response.status(403).json({ error: 'TORIUM membership is not active' });
    return null;
  } catch (error) {
    console.error('Authentication check failed', error);
    response.status(503).json({ error: 'Authentication service unavailable' });
    return null;
  }
}

export async function requireRole(request, response, requiredRole) {
  const session = await requireAuthenticatedUser(request, response);
  if (!session) return null;
  if (session.membership.role === requiredRole) return session;
  response.status(403).json({ error: 'Insufficient permissions' });
  return null;
}

export async function revokeSession(accessToken, scope = 'global') {
  if (!accessToken) return;
  await authRequest('logout?scope=' + encodeURIComponent(scope), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}
