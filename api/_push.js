import { requireAuthenticatedUser, requireSameOrigin, noStore } from './_auth.js';
import { enforceRateLimit } from './_rate-limit.js';

// Registering and revoking the browsers an investor wants to be notified on.
//
// Reads run with the investor's own access token, so row-level security is the
// boundary. Writes run with the service role, because claiming an endpoint can
// mean taking it away from the account that used the same browser before, and
// that is not something one investor may do to another's row through a policy.
// Every write is therefore pinned to the session's own user id here, and the
// table grants no insert, update or delete to `authenticated` at all.

// A push endpoint is a URL this server will later make POST requests to, which
// makes it an SSRF vector if it is taken at face value. Two gates: the address
// must be public https, and the host must belong to a push service we know.
// Adding a browser vendor is a deliberate change to this list.
const KNOWN_PUSH_HOSTS = [
  'android.googleapis.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
  'push.apple.com',
];

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i,
];

export function isAllowedPushEndpoint(value) {
  const raw = String(value || '');
  if (!raw || raw.length > 1000) return false;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) return false;
  return KNOWN_PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
}

// Base64url of the raw P-256 point and of the 16-byte auth secret. Checked
// here so a malformed subscription is refused at registration rather than
// failing silently at every send.
export function parseSubscription(body = {}) {
  const endpoint = String(body.endpoint || '').trim();
  const p256dh = String(body.keys?.p256dh || '').trim();
  const auth = String(body.keys?.auth || '').trim();

  if (!isAllowedPushEndpoint(endpoint)) return { error: 'Endpoint di notifica non valido' };
  if (!/^[A-Za-z0-9_-]{86,88}$/.test(p256dh)) return { error: 'Chiave del dispositivo non valida' };
  if (!/^[A-Za-z0-9_-]{22,24}$/.test(auth)) return { error: 'Chiave del dispositivo non valida' };

  return { endpoint, p256dh, auth, deviceLabel: deviceLabel(body.device_label) };
}

/**
 * A short, coarse label so an investor can tell two devices apart in the
 * account page. Never the full user agent: that is a fingerprint, and it would
 * be stored next to an identified user.
 */
export function deviceLabel(value) {
  const raw = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!raw) return null;
  return raw.slice(0, 40);
}

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service access is not configured');
  return { url, key };
}

async function serviceRest(pathname, options = {}) {
  const { url, key } = serviceConfig();
  const result = await fetch(url + '/rest/v1/' + pathname, {
    ...options,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const text = await result.text();
  if (!result.ok) {
    const error = new Error('Push subscription store failed: ' + result.status);
    error.status = result.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function readSubscriptions(userId, accessToken) {
  const { url } = serviceConfig();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const query = new URLSearchParams({
    select: 'id,device_label,created_at,last_delivered_at',
    user_id: 'eq.' + userId,
    disabled_at: 'is.null',
    order: 'created_at.desc',
  });
  const result = await fetch(url + '/rest/v1/investor_push_subscriptions?' + query, {
    headers: { apikey: key, Authorization: 'Bearer ' + accessToken },
  });
  if (!result.ok) throw new Error('Push subscription read failed: ' + result.status);
  return result.json();
}

async function claimEndpoint(userId, { endpoint, p256dh, auth, deviceLabel: label }) {
  // One endpoint, one owner: whoever is signed in on that browser now. The
  // previous owner's row is removed rather than left to receive notifications
  // for an account that no longer uses this device.
  await serviceRest('investor_push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  const [row] = await serviceRest('investor_push_subscriptions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      device_label: label,
      last_seen_at: new Date().toISOString(),
    }),
  }) || [];
  return row || null;
}

async function revokeEndpoint(userId, endpoint) {
  const query = new URLSearchParams({
    user_id: 'eq.' + userId,
    endpoint: 'eq.' + endpoint,
  });
  const rows = await serviceRest('investor_push_subscriptions?' + query, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(rows) && rows.length > 0;
}

export default async function handler(request, response) {
  noStore(response);
  response.setHeader('Vary', 'Cookie');

  const session = await requireAuthenticatedUser(request, response);
  if (!session) return;

  try {
    if (request.method === 'GET') {
      const subscriptions = await readSubscriptions(session.user.id, session.accessToken);
      return response.status(200).json({
        // The public key is not a secret: the browser needs it to create a
        // subscription that only this server can send to.
        vapid_public_key: process.env.TORIUM_VAPID_PUBLIC_KEY || null,
        subscriptions,
      });
    }

    if (request.method === 'POST') {
      if (!requireSameOrigin(request, response)) return;
      if (!await enforceRateLimit(request, response, 'push_register', session.user.id)) return;

      const parsed = parseSubscription(request.body);
      if (parsed.error) return response.status(400).json({ error: parsed.error });

      const row = await claimEndpoint(session.user.id, parsed);
      if (!row) return response.status(500).json({ error: 'Registrazione non riuscita' });
      return response.status(201).json({
        subscription: {
          id: row.id,
          device_label: row.device_label,
          created_at: row.created_at,
          last_delivered_at: row.last_delivered_at,
        },
      });
    }

    if (request.method === 'DELETE') {
      if (!requireSameOrigin(request, response)) return;
      if (!await enforceRateLimit(request, response, 'push_register', session.user.id)) return;

      const endpoint = String(request.body?.endpoint || '').trim();
      if (!endpoint) return response.status(400).json({ error: 'Endpoint mancante' });
      const removed = await revokeEndpoint(session.user.id, endpoint);
      return response.status(removed ? 200 : 404).json({ removed });
    }
  } catch (error) {
    console.error('Push subscription API failed:', error);
    return response.status(500).json({ error: 'Notifiche non disponibili' });
  }

  response.setHeader('Allow', 'GET, POST, DELETE');
  return response.status(405).json({ error: 'Method not allowed' });
}
