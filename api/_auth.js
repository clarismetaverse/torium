const ACCESS_COOKIE = 'torium_access_token';
const REFRESH_COOKIE = 'torium_refresh_token';

function config() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY;
  if (!url || !apiKey) throw new Error('Supabase auth is not configured');
  return { url, apiKey };
}

export function parseCookies(request) {
  const header = String(request?.headers?.cookie || '');
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return null;
    return [
      decodeURIComponent(part.slice(0, separator).trim()),
      decodeURIComponent(part.slice(separator + 1).trim()),
    ];
  }).filter(Boolean));
}

export function isSameOrigin(request) {
  const origin = request?.headers?.origin;
  if (!origin) return true;
  const host = request?.headers?.['x-forwarded-host'] || request?.headers?.host;
  const protocol = request?.headers?.['x-forwarded-proto'] || 'https';
  try {
    return new URL(origin).origin === protocol + '://' + host;
  } catch {
    return false;
  }
}

function cookieSecurity() {
  return process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

function serializeCookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value)
    + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge
    + cookieSecurity();
}

export function setAuthCookies(response, session) {
  const accessMaxAge = Math.max(60, Number(session.expires_in) || 3600);
  const refreshMaxAge = 60 * 60 * 24 * 30;
  response.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, session.access_token, accessMaxAge),
    serializeCookie(REFRESH_COOKIE, session.refresh_token, refreshMaxAge),
  ]);
}

export function clearAuthCookies(response) {
  response.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, '', 0),
    serializeCookie(REFRESH_COOKIE, '', 0),
  ]);
}

async function authRequest(path, init = {}) {
  const { url, apiKey } = config();
  return fetch(url + '/auth/v1/' + path, {
    ...init,
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function userForAccessToken(accessToken) {
  if (!accessToken) return null;
  const response = await authRequest('user', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  return response.ok ? response.json() : null;
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

export async function authenticatedSession(request, response) {
  const cookies = parseCookies(request);
  const accessToken = cookies[ACCESS_COOKIE];
  const existingUser = await userForAccessToken(accessToken);
  if (existingUser) return { user: existingUser, accessToken };

  const refreshToken = cookies[REFRESH_COOKIE];
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

export async function requireAuthenticatedUser(request, response) {
  try {
    const session = await authenticatedSession(request, response);
    if (session?.user?.id) return session;
  } catch (error) {
    console.error('Authentication check failed', error);
  }
  response.status(401).json({ error: 'Authentication required' });
  return null;
}

export async function revokeSession(accessToken) {
  if (!accessToken) return;
  await authRequest('logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}
