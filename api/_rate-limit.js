import { clientAddress, pseudonymize } from './_auth.js';

// Two layers of protection.
//
// The durable layer is a Postgres counter shared by every serverless instance,
// so a burst spread across warm instances is still counted once. The in-process
// layer is a per-instance fallback used only when Postgres is unreachable: a
// database outage must not lock every member out of login, but it must not
// silently remove the control either.
const FALLBACK_WINDOWS = new Map();
const FALLBACK_MAX_KEYS = 5000;

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  recovery: { limit: 5, windowSeconds: 900 },
  invite: { limit: 3, windowSeconds: 3600 },
  password_update: { limit: 10, windowSeconds: 900 },
  session_adopt: { limit: 20, windowSeconds: 900 },
  preferences_write: { limit: 60, windowSeconds: 900 },
  push_register: { limit: 20, windowSeconds: 900 },
};

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

export function fallbackConsume(key, limit, windowSeconds, now = Date.now()) {
  const windowMs = windowSeconds * 1000;
  const entry = FALLBACK_WINDOWS.get(key);
  if (!entry || now - entry.startedAt >= windowMs) {
    if (FALLBACK_WINDOWS.size >= FALLBACK_MAX_KEYS) FALLBACK_WINDOWS.clear();
    FALLBACK_WINDOWS.set(key, { startedAt: now, hits: 1 });
    return { allowed: true, retryAfter: windowSeconds };
  }
  entry.hits += 1;
  return {
    allowed: entry.hits <= limit,
    retryAfter: Math.max(1, Math.ceil((entry.startedAt + windowMs - now) / 1000)),
  };
}

export function resetFallbackWindows() {
  FALLBACK_WINDOWS.clear();
}

async function durableConsume(bucket, subject, limit, windowSeconds) {
  const config = serviceConfig();
  if (!config) return null;
  const result = await fetch(config.url + '/rest/v1/rpc/torium_rate_limit_hit', {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: 'Bearer ' + config.serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_bucket: bucket,
      p_subject: subject,
      p_window_seconds: windowSeconds,
      p_max_hits: limit,
    }),
  });
  if (!result.ok) throw new Error('Rate limit backend returned ' + result.status);
  const rows = await result.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || typeof row.allowed !== 'boolean') throw new Error('Rate limit backend returned no verdict');
  return { allowed: row.allowed, retryAfter: Number(row.retry_after) || windowSeconds };
}

// Subjects are always pseudonymous: an IP address or email address is hashed
// before it leaves the function, so the counter table holds no personal data.
export function rateLimitSubject(request, extra) {
  const parts = [pseudonymize(clientAddress(request)) || 'unknown-source'];
  if (extra) {
    const hashed = pseudonymize(extra);
    if (hashed) parts.push(hashed);
  }
  return parts.join(':');
}

export async function consumeRateLimit(bucket, subject, overrides = {}) {
  const preset = RATE_LIMITS[bucket] || { limit: 30, windowSeconds: 900 };
  const limit = overrides.limit ?? preset.limit;
  const windowSeconds = overrides.windowSeconds ?? preset.windowSeconds;
  const key = bucket + ':' + subject;
  try {
    const durable = await durableConsume(bucket, subject, limit, windowSeconds);
    if (durable) return { ...durable, degraded: false };
  } catch (error) {
    console.error('Durable rate limit unavailable, using per-instance fallback', error.message);
  }
  return { ...fallbackConsume(key, limit, windowSeconds), degraded: true };
}

// Returns true when the caller may proceed. On refusal it has already written a
// generic 429 with Retry-After and the caller must return immediately.
export async function enforceRateLimit(request, response, bucket, extra, overrides = {}) {
  const verdict = await consumeRateLimit(bucket, rateLimitSubject(request, extra), overrides);
  if (verdict.allowed) return true;
  response.setHeader('Retry-After', String(verdict.retryAfter));
  response.status(429).json({ error: 'Troppe richieste. Riprova tra qualche minuto.' });
  return false;
}
