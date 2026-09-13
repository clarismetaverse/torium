import { requireAuthenticatedUser, requireSameOrigin } from './_auth.js';
import { enforceRateLimit } from './_rate-limit.js';
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

const MAX_PROFILES = 8;
const PROFILE_SELECT = 'id,user_id,name,is_active,neighborhood_ids,min_price_eur,max_price_eur,min_size_mq,max_size_mq,max_price_per_sqm_eur,min_door_score,min_roi_base_pct,updated_at';

// A profile name is shown back to the investor and is the only way to tell two
// profiles apart, so it is required, bounded, and stripped of control
// characters rather than silently defaulted.
export function normalizeProfileName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name) throw new Error('Invalid profile name');
  if (name.length > 60) throw new Error('Invalid profile name');
  return name;
}

export function profileId(value) {
  const id = String(value ?? '').trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function readProfiles(userId, accessToken) {
  const { url } = apiConfig();
  const query = new URLSearchParams({
    select: PROFILE_SELECT,
    user_id: 'eq.' + userId,
    order: 'name.asc',
  });
  const result = await fetch(url + '/rest/v1/investor_alert_preferences?' + query, {
    headers: userHeaders(accessToken),
  });
  if (!result.ok) throw new Error('Profile read failed');
  return result.json();
}

async function createProfile(userId, accessToken, name, preferences) {
  const existing = await readProfiles(userId, accessToken);
  // A cap keeps one investor from turning the reconciliation pass into a
  // per-investor fan-out of arbitrary size.
  if (existing.length >= MAX_PROFILES) throw new Error('Too many profiles');

  const { url } = apiConfig();
  const result = await fetch(url + '/rest/v1/investor_alert_preferences?select=' + PROFILE_SELECT, {
    method: 'POST',
    headers: userHeaders(accessToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({ user_id: userId, name, ...preferences }),
  });
  if (result.status === 409) throw new Error('Invalid duplicate profile name');
  if (!result.ok) throw new Error('Profile create failed');
  return (await result.json())[0] || null;
}

// The id and the user filter are both applied. The user filter is not the
// security boundary - row-level security is - but it keeps a mistyped id from
// silently addressing nothing.
async function updateProfile(userId, accessToken, id, name, preferences) {
  const { url } = apiConfig();
  const query = new URLSearchParams({ id: 'eq.' + id, user_id: 'eq.' + userId, select: PROFILE_SELECT });
  const result = await fetch(url + '/rest/v1/investor_alert_preferences?' + query, {
    method: 'PATCH',
    headers: userHeaders(accessToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({ name, ...preferences, updated_at: new Date().toISOString() }),
  });
  if (result.status === 409) throw new Error('Invalid duplicate profile name');
  if (!result.ok) throw new Error('Profile update failed');
  return (await result.json())[0] || null;
}

async function deleteProfile(userId, accessToken, id) {
  const { url } = apiConfig();
  const query = new URLSearchParams({ id: 'eq.' + id, user_id: 'eq.' + userId, select: 'id' });
  const result = await fetch(url + '/rest/v1/investor_alert_preferences?' + query, {
    method: 'DELETE',
    headers: userHeaders(accessToken, { Prefer: 'return=representation' }),
  });
  if (!result.ok) throw new Error('Profile delete failed');
  return (await result.json()).length > 0;
}

export default async function handler(request, response) {
  const session = await requireAuthenticatedUser(request, response);
  if (!session) return;

  try {
    if (request.method === 'GET') {
      const profiles = await readProfiles(session.user.id, session.accessToken);
      return response.status(200).json({
        zones: MILAN_CANONICAL_ZONES.map(({ id, name }) => ({ id, name })),
        profiles,
        // Kept so an older cached page keeps rendering while the new one rolls
        // out, rather than showing an investor an empty form.
        preferences: profiles[0] || null,
      });
    }

    if (!requireSameOrigin(request, response)) return;

    if (request.method === 'PUT') {
      if (!await enforceRateLimit(request, response, 'preferences_write', session.user.id)) return;
      const id = profileId(request.body?.id);
      const name = normalizeProfileName(request.body?.name);
      const preferences = normalizePreferences(request.body);
      const saved = id
        ? await updateProfile(session.user.id, session.accessToken, id, name, preferences)
        : await createProfile(session.user.id, session.accessToken, name, preferences);
      if (!saved) return response.status(404).json({ error: 'Profilo non trovato' });
      return response.status(200).json({ profile: saved, preferences: saved });
    }

    if (request.method === 'DELETE') {
      const id = profileId(request.query?.id);
      if (!id) return response.status(400).json({ error: 'Profilo non valido' });
      const removed = await deleteProfile(session.user.id, session.accessToken, id);
      if (!removed) return response.status(404).json({ error: 'Profilo non trovato' });
      return response.status(200).json({ deleted: id });
    }
  } catch (error) {
    const invalidInput = /^Invalid|^Minimum|^Too many/.test(error.message);
    if (!invalidInput) console.error('Investor preferences API failed:', error.message);
    return response.status(invalidInput ? 400 : 500).json({
      error: invalidInput ? error.message : 'Preferenze non disponibili',
    });
  }

  response.setHeader('Allow', 'GET, PUT, DELETE');
  return response.status(405).json({ error: 'Method not allowed' });
}
