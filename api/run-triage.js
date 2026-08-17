import { runMassiveTriage } from '../pipelines/triage-multisource-massive.js';

export const maxDuration = 300;

let activeRun = null;

export function resolveRequestedLimit(value, fallback = 600, maximum = 2000) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(numeric)));
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

  if (activeRun) return response.status(409).json({ error: 'Una run e gia in corso su questa istanza' });

  const strategy = request.body?.strategy || 'neutral_fractionability';
  if (strategy !== 'neutral_fractionability') {
    return response.status(400).json({ error: 'Only neutral_fractionability is enabled from the frontend' });
  }

  const profile = request.body?.profile || 'scout';
  if (!['scout', 'milano_broad'].includes(profile)) {
    return response.status(400).json({ error: 'Profilo run non valido' });
  }

  const requestedLimit = resolveRequestedLimit(request.body?.limit);

  const profileOptions = profile === 'milano_broad'
    ? {
        runMode: 'serious',
        requestedAreas: ['Milano'],
        maxItemsPerQuery: requestedLimit,
        maxTotalRawListings: requestedLimit,
        topPrescoreLimit: requestedLimit,
        minSize: 100,
        idealistaCondition: ['renew'],
      }
    : {};

  activeRun = runMassiveTriage({
    baseSearchName: profile === 'milano_broad' ? 'milanoFractioningSerious' : 'milanoFractioningMassive',
    searchStrategy: strategy,
    sources: 'idealista',
    ...profileOptions,
  });

  try {
    const output = await activeRun;
    return response.status(200).json({
      ok: true,
      run_id: output.run_id,
      search_name: output.search_name,
      search_strategy: output.search_strategy,
      profile,
      requested_limit: requestedLimit,
      requested_areas: output.requested_areas,
      raw_source_count: output.raw_source_count,
      eligible_count: output.eligible_count,
      pre_scored_count: output.pre_scored_count,
    });
  } catch (error) {
    console.error('Frontend triage run failed:', error);
    return response.status(500).json({ error: error.message || 'Run failed' });
  } finally {
    activeRun = null;
  }
}
