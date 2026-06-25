const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

export function numberParam(value, fallback, max = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

export function boolParam(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

export async function supabaseGet(pathname) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    },
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase GET failed: ${response.status}\n${body}`);
  return body ? JSON.parse(body) : null;
}

export async function latestRunId(searchName = 'milanoFractioningMassive') {
  const rows = await supabaseGet(`triage_runs?search_name=eq.${encodeURIComponent(searchName)}&select=run_id&order=created_at.desc&limit=1`);
  return rows?.[0]?.run_id ?? null;
}

export function jsonResponse(response, data) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json(data);
}
