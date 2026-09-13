import { createHmac, timingSafeEqual } from 'node:crypto';

const LEGACY_ACCESS_COOKIE = 'torium_access_token';
const LEGACY_REFRESH_COOKIE = 'torium_refresh_token';
const HOST_ACCESS_COOKIE = '__Host-torium_access_token';
const HOST_REFRESH_COOKIE = '__Host-torium_refresh_token';
const ALLOWED_ROLES = new Set(['admin', 'investor']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function authConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !apiKey) throw new Error('Supabase auth is not configured');
  return { url, apiKey };
}

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase service access is not configured');
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
  return requestOrigin(request) || process.env.TORIUM_SITE_ORIGIN || process.env.SITE_URL || 'https://taurum.cloud';
}

// Fails closed. Browsers always attach Origin to fetch-driven mutations, so a
// request carrying neither Origin nor Referer nor an explicit same-origin
// Sec-Fetch-Site is not a first-party browser call and must be refused.
export function isSameOrigin(request) {
  const expected = requestOrigin(request);
  if (!expected) return false;
  const fetchSite = String(headerValue(request, 'sec-fetch-site') || '').toLowerCase();
  if (fetchSite && !['same-origin', 'same-site'].includes(fetchSite)) return false;
  const supplied = headerValue(request, 'origin') || headerValue(request, 'referer');
  if (!supplied) return fetchSite === 'same-origin';
  try {
    return new URL(supplied).origin === expected;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request, response) {
  if (!MUTATING_METHODS.has(String(request?.method || '').toUpperCase())) return true;
  if (isSameOrigin(request)) return true;
  response.status(403).json({ error: 'Invalid request origin' });
  return false;
}

// Authenticated payloads must never enter a shared CDN cache. Vary on Cookie so
// no intermediary keyed on the request can reuse one member's body for another.
export function noStore(response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Cookie');
}

// Stable pseudonymous identifier for audit and rate-limit keys. Raw addresses
// and email addresses are never persisted.
export function pseudonymize(value) {
  const secret = process.env.TORIUM_AUTH_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const normalized = String(value || '').trim().toLowerCase();
  if (!secret || !normalized) return null;
  return createHmac('sha256', secret).update(normalized).digest('hex').slice(0, 32);
}

export function clientAddress(request) {
  const forwarded = String(headerValue(request, 'x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || headerValue(request, 'x-real-ip') || null;
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

// GoTrue admin endpoints (invite, admin user management) reject the publishable
// key: they require the service-role bearer, which stays server-only.
export async function adminAuthRequest(path, init = {}) {
  const { url, serviceKey } = serviceConfig();
  return fetch(url + '/auth/v1/' + path, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
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

// Supabase has already validated the token upstream; this only reads the
// assurance level so admin surfaces can require a second factor once MFA
// enrolment is offered to operators.
export function assuranceLevel(accessToken) {
  const segments = String(accessToken || '').split('.');
  if (segments.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return typeof payload.aal === 'string' ? payload.aal : null;
  } catch {
    return null;
  }
}

export function adminMfaRequired() {
  return String(process.env.TORIUM_REQUIRE_ADMIN_MFA || '').toLowerCase() === 'true';
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

// Audit rows carry an event type, an optional user id and pseudonymous context
// only. Never a password, token, email address or raw IP address.
export async function recordAuthEvent(userId, eventType, metadata = {}) {
  if (!eventType) return;
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
        user_id: userId || null,
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

// Sends the Supabase invitation only. Membership stays inactive on purpose:
// TORIUM is invite-first, so an operator activates access separately and a
// self-service request can never grant itself product access.
export async function requestInvite(email, redirectTo) {
  const query = redirectTo ? '?redirect_to=' + encodeURIComponent(redirectTo) : '';
  const response = await adminAuthRequest('invite' + query, {
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
  noStore(response);
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
    response.status(403).json({ error: 'TORIUM membership is not active', code: 'membership_inactive' });
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
  if (session.membership.role !== requiredRole) {
    response.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  if (requiredRole === 'admin' && adminMfaRequired() && assuranceLevel(session.accessToken) !== 'aal2') {
    response.status(403).json({ error: 'Multi-factor authentication required', code: 'mfa_required' });
    return null;
  }
  return session;
}

export async function revokeSession(accessToken, scope = 'global') {
  if (!accessToken) return;
  await authRequest('logout?scope=' + encodeURIComponent(scope), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}

export function timingSafeMatch(supplied, expected) {
  const left = Buffer.from(String(supplied || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
