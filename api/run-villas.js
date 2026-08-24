import { runMassiveTriage } from '../pipelines/triage-multisource-massive.js';
import { resolveVillaGeoProfile, resolveVillaIntent } from '../lib/villa-search-profiles.js';

export const maxDuration = 300;

let activeVillaRun = null;

export function resolveVillaRunRequest(body = {}) {
  const geo = resolveVillaGeoProfile(body.area || 'como');
  const intent = resolveVillaIntent(body.intent || 'renovation');
  const numericLimit = Number(body.limit ?? 250);
  const limit = Number.isFinite(numericLimit) ? Math.max(20, Math.min(2000, Math.floor(numericLimit))) : 250;
  return { geo, intent, limit };
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Cross-origin request denied' });
  if (activeVillaRun) return response.status(409).json({ error: 'Una run ville è già in corso su questa istanza' });

  let requestConfig;
  try {
    requestConfig = resolveVillaRunRequest(request.body);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }

  const { geo, intent, limit } = requestConfig;
  const baseSearchName = `villa${geo.id[0].toUpperCase()}${geo.id.slice(1)}${intent.id[0].toUpperCase()}${intent.id.slice(1)}`;
  activeVillaRun = runMassiveTriage({
    baseSearchName,
    searchStrategy: 'villa_dynamic_market',
    useCase: 'villa',
    villaArea: geo.id,
    villaIntent: intent.id,
    sources: 'idealista,immobiliare',
    runMode: 'serious',
    requestedAreas: [geo.requestedArea],
    maxItemsPerQuery: limit,
    maxItemsPerSource: limit,
    maxTotalRawListings: limit * 2,
    topPrescoreLimit: limit * 2,
    minSize: intent.id === 'tourism' ? 120 : 140,
  });

  try {
    const output = await activeVillaRun;
    return response.status(200).json({
      ok: true,
      run_id: output.run_id,
      search_name: output.search_name,
      use_case: output.use_case,
      investment_intent: output.investment_intent,
      area: geo.id,
      requested_limit_per_source: limit,
      raw_source_count: output.raw_source_count,
      raw_source_counts_by_channel: output.raw_source_counts_by_channel,
      dynamic_comparable_count: output.dynamic_comparable_count,
      eligible_count: output.eligible_count,
    });
  } catch (error) {
    console.error('Frontend villa run failed:', error);
    return response.status(500).json({ error: error.message || 'Villa run failed' });
  } finally {
    activeVillaRun = null;
  }
}
