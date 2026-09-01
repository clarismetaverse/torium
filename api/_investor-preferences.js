import { requireAuthenticatedUser, isSameOrigin } from './_auth.js';
import { MILAN_CANONICAL_ZONES } from '../lib/milan-area-taxonomy.js';

const ALLOWED_ZONE_IDS = new Set(MILAN_CANONICAL_ZONES.map((zone) => zone.id));
const NUMERIC_FIELDS = {
  min_price_eur: { min: 0, max: 100000000 },
  max_price_eur: { min: 0, max: 100000000 },
  min_size_mq: { min: 1, max: 10000 },
  max_size_mq: { min: 1, max: 10000 },
  max_price_per_sqm_eur: { min: 1, max: 1000000 },
  min_door_score: { min: 0, max: 100 },
  min_roi_base_pct: { min: -100, max: 1000 },
};

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase persistence is not configured');
  return { url, key };
}

function serviceHeaders(extra = {}) {
  const { key } = serviceConfig();
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function nullableNumber(value, field) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  const bounds = NUMERIC_FIELDS[field];
  if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error('Invalid value for ' + field);
  }
  return field === 'min_roi_base_pct' ? Math.round(parsed * 100) / 100 : Math.round(parsed);
}

export function normalizePreferences(input = {}) {
  const neighborhoodIds = [...new Set(
    (Array.isArray(input.neighborhood_ids) ? input.neighborhood_ids : [])
      .map(String)
      .filter((id) => ALLOWED_ZONE_IDS.has(id)),
  )];
  if (neighborhoodIds.length > 32) throw new Error('Too many neighborhoods');

  const result = { neighborhood_ids: neighborhoodIds };
  for (const field of Object.keys(NUMERIC_FIELDS)) {
    result[field] = nullableNumber(input[field], field);
  }
  if (result.min_price_eur !== null && result.max_price_eur !== null
    && result.min_price_eur > result.max_price_eur) {
    throw new Error('Minimum price cannot exceed maximum price');
  }
  if (result.min_size_mq !== null && result.max_size_mq !== null
    && result.min_size_mq > result.max_size_mq) {
    throw new Error('Minimum size cannot exceed maximum size');
  }
  return result;
}

async function readPreferences(userId) {
  const { url } = serviceConfig();
  const query = new URLSearchParams({
    select: 'user_id,neighborhood_ids,min_price_eur,max_price_eur,min_size_mq,max_size_mq,max_price_per_sqm_eur,min_door_score,min_roi_base_pct,updated_at',
    user_id: 'eq.' + userId,
    limit: '1',
  });
  const result = await fetch(url + '/rest/v1/investor_alert_preferences?' + query, {
    headers: serviceHeaders(),
  });
  if (!result.ok) throw new Error(await result.text());
  return (await result.json())[0] || null;
}

async function upsertPreferences(userId, preferences) {
  const { url } = serviceConfig();
  const result = await fetch(url + '/rest/v1/investor_alert_preferences?on_conflict=user_id', {
    method: 'POST',
    headers: serviceHeaders({
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify({
      user_id: userId,
      ...preferences,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!result.ok) throw new Error(await result.text());
  return (await result.json())[0] || null;
}

export default async function handler(request, response) {
  const session = await requireAuthenticatedUser(request, response);
  if (!session) return;

  try {
    if (request.method === 'GET') {
      return response.status(200).json({
        zones: MILAN_CANONICAL_ZONES.map(({ id, name }) => ({ id, name })),
        preferences: await readPreferences(session.user.id),
      });
    }

    if (request.method === 'PUT') {
      if (!isSameOrigin(request)) {
        return response.status(403).json({ error: 'Invalid request origin' });
      }
      const preferences = normalizePreferences(request.body);
      const saved = await upsertPreferences(session.user.id, preferences);
      return response.status(200).json({ preferences: saved });
    }
  } catch (error) {
    const status = /^Invalid|^Minimum|^Too many/.test(error.message) ? 400 : 500;
    return response.status(status).json({ error: error.message });
  }

  response.setHeader('Allow', 'GET, PUT');
  return response.status(405).json({ error: 'Method not allowed' });
}
