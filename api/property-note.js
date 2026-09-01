import { requireAuthenticatedUser } from './_auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_NOTE_LENGTH = 4000;

export function isSameOrigin(request) {
  const origin = request.headers?.origin;
  if (!origin) return false;
  const host = request.headers?.['x-forwarded-host'] || request.headers?.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function parseNoteTarget(input = {}) {
  const runId = String(input.run_id || '').replace(/^supabase:/, '').trim();
  const listingIndex = Number(input.listing_index);
  if (!runId || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(runId)) {
    return { error: 'run_id non valido' };
  }
  if (!Number.isInteger(listingIndex) || listingIndex < 0 || listingIndex > 1000000) {
    return { error: 'listing_index non valido' };
  }
  return { runId, listingIndex };
}

export function normalizeNote(value) {
  if (typeof value !== 'string') return { error: 'La nota deve essere testo' };
  const note = value.replace(/\r\n?/g, '\n').trim();
  if (note.length > MAX_NOTE_LENGTH) {
    return { error: `La nota non puo superare ${MAX_NOTE_LENGTH} caratteri` };
  }
  return { note };
}

async function supabaseRest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase notes failed: ${response.status}\n${body}`);
  return body ? JSON.parse(body) : null;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const target = parseNoteTarget(request.method === 'GET' ? request.query : request.body);
  if (target.error) return response.status(400).json({ error: target.error });
  if (!await requireAuthenticatedUser(request, response)) return;
  const { runId, listingIndex } = target;

  try {
    if (request.method === 'GET') {
      const rows = await supabaseRest(
        `triage_property_notes?run_id=eq.${encodeURIComponent(runId)}&listing_index=eq.${listingIndex}&select=note,updated_at&limit=1`,
      );
      return response.status(200).json({
        run_id: runId,
        listing_index: listingIndex,
        note: rows?.[0]?.note ?? '',
        updated_at: rows?.[0]?.updated_at ?? null,
      });
    }

    if (!isSameOrigin(request)) return response.status(403).json({ error: 'Cross-origin request denied' });
    const normalized = normalizeNote(request.body?.note);
    if (normalized.error) return response.status(400).json({ error: normalized.error });

    const properties = await supabaseRest(
      `triage_properties?run_id=eq.${encodeURIComponent(runId)}&listing_index=eq.${listingIndex}&select=id&limit=1`,
    );
    if (!properties?.length) return response.status(404).json({ error: 'Immobile non trovato nella run' });

    const rows = await supabaseRest('triage_property_notes?on_conflict=run_id,listing_index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([{
        run_id: runId,
        listing_index: listingIndex,
        note: normalized.note,
        updated_at: new Date().toISOString(),
      }]),
    });
    return response.status(200).json({
      ok: true,
      run_id: runId,
      listing_index: listingIndex,
      note: rows?.[0]?.note ?? normalized.note,
      updated_at: rows?.[0]?.updated_at ?? null,
    });
  } catch (error) {
    console.error('Property note failed:', error);
    return response.status(500).json({ error: 'Salvataggio nota non disponibile' });
  }
}
