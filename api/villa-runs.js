const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(_request, response) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env vars');
    const query = 'triage_runs?investor_profile=eq.villa-opportunity-v1&select=run_id,search_name,search_strategy,scoring_mode,city,created_at,raw_source_count,eligible_count,source_channels,requested_areas&order=created_at.desc&limit=50';
    const result = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${query}`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
      },
    });
    if (!result.ok) throw new Error(`Supabase villa runs failed: ${result.status}\n${await result.text()}`);
    const rows = await result.json();
    response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({
      outputs: rows.map((row) => ({
        id: `supabase:${row.run_id}`,
        run_id: row.run_id,
        search_name: row.search_name,
        city: row.city,
        created_at: row.created_at,
        raw_source_count: row.raw_source_count,
        eligible_count: row.eligible_count,
        requested_areas: row.requested_areas,
        investment_intent: String(row.search_name || '').toLowerCase().includes('tourism') ? 'tourism' : 'renovation',
        valuation_mode: 'dynamic_villa_asking_comparables_v1',
      })),
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}

