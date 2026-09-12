import { requireAuthenticatedUser, isSameOrigin } from './_auth.js';

// Reading and acknowledging an investor's own alerts.
//
// Every query runs with the investor's own access token, so the row-level
// security policy is what actually restricts the result set. The handler adds
// a user_id filter as well, but that filter is a convenience for the query
// planner rather than the security boundary: if the policy were removed, this
// endpoint would stop returning other people's rows because Postgres says so,
// not because this file remembered to ask.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const ALERT_FIELDS = [
  'property_key', 'run_id', 'source_channel', 'source_url', 'title',
  'zone_id', 'neighborhood', 'price_eur', 'size_mq', 'price_by_area',
  'door_score', 'roi_base_pct', 'matched_at', 'seen_at', 'dismissed_at',
].join(',');

function apiConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase API is not configured');
  return { url, key };
}

function userHeaders(accessToken, extra = {}) {
  const { key } = apiConfig();
  return {
    apikey: key,
    Authorization: 'Bearer ' + accessToken,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(parsed));
}

export function parseAcknowledgement(body = {}) {
  const propertyKey = String(body.property_key || '').trim();
  const action = String(body.action || '').trim();
  if (!propertyKey || propertyKey.length > 400) return { error: 'property_key non valido' };
  if (!['seen', 'dismissed'].includes(action)) return { error: 'Azione non valida' };
  // Only the two acknowledgement timestamps are writable. Nothing an investor
  // sends can change what the alert says about the property.
  const patch = action === 'seen'
    ? { seen_at: new Date().toISOString() }
    : { dismissed_at: new Date().toISOString(), seen_at: new Date().toISOString() };
  return { propertyKey, action, patch };
}

async function readAlerts(userId, accessToken, { limit, includeDismissed }) {
  const { url } = apiConfig();
  const query = new URLSearchParams({
    select: ALERT_FIELDS,
    user_id: 'eq.' + userId,
    order: 'matched_at.desc',
    limit: String(limit),
  });
  if (!includeDismissed) query.append('dismissed_at', 'is.null');

  const result = await fetch(url + '/rest/v1/investor_alerts?' + query, {
    headers: userHeaders(accessToken, { Prefer: 'count=exact' }),
  });
  if (!result.ok) throw new Error('Alert read failed: ' + result.status);
  return result.json();
}

async function acknowledgeAlert(userId, accessToken, propertyKey, patch) {
  const { url } = apiConfig();
  const query = new URLSearchParams({
    user_id: 'eq.' + userId,
    property_key: 'eq.' + propertyKey,
  });
  const result = await fetch(url + '/rest/v1/investor_alerts?' + query, {
    method: 'PATCH',
    headers: userHeaders(accessToken, { Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  if (!result.ok) throw new Error('Alert update failed: ' + result.status);
  return (await result.json())[0] || null;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Cookie');

  const session = await requireAuthenticatedUser(request, response);
  if (!session) return;

  try {
    if (request.method === 'GET') {
      const alerts = await readAlerts(session.user.id, session.accessToken, {
        limit: parseLimit(request.query?.limit),
        includeDismissed: request.query?.include_dismissed === 'true',
      });
      return response.status(200).json({
        alerts,
        unseen_count: alerts.filter((alert) => !alert.seen_at).length,
      });
    }

    if (request.method === 'PATCH') {
      if (!isSameOrigin(request)) {
        return response.status(403).json({ error: 'Invalid request origin' });
      }
      const parsed = parseAcknowledgement(request.body);
      if (parsed.error) return response.status(400).json({ error: parsed.error });

      const updated = await acknowledgeAlert(
        session.user.id,
        session.accessToken,
        parsed.propertyKey,
        parsed.patch,
      );
      if (!updated) return response.status(404).json({ error: 'Avviso non trovato' });
      return response.status(200).json({ alert: updated });
    }
  } catch (error) {
    console.error('Investor alerts API failed:', error);
    return response.status(500).json({ error: 'Avvisi non disponibili' });
  }

  response.setHeader('Allow', 'GET, PATCH');
  return response.status(405).json({ error: 'Method not allowed' });
}
