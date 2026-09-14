import { runMassiveTriage } from '../pipelines/triage-multisource-massive.js';
import { MILAN_IDEALISTA_AREA_NAMES } from '../lib/milan-idealista-locations.js';
import { MILAN_IMMOBILIARE_AREAS } from '../lib/milan-immobiliare-areas.js';
import { isSameOrigin, requireRole } from './_auth.js';

export const maxDuration = 300;

let activeRun = null;

/**
 * Where a serious Milan run looks, and how its budget is divided.
 *
 * Each mapped neighbourhood is asked for by name, and one city-wide query keeps
 * the unmapped rest of Milan in view. This used to request only "Milano", which
 * resolves to no Idealista location id, so every query collapsed into the same
 * broad sweep - and a broad sweep ordered by recency follows listing density,
 * which follows price. On the run of 22 August 2026 that spent 33 slots on
 * Città Studi at -20.9 per cent average modelled ROI, 23 on Sempione at -32.6
 * and 15 on Moscova at -52.3, while Chiesa Rossa got 11 at +49.6 and Cimiano -
 * the one neighbourhood whose measured spread cleared its own break-even - got
 * five.
 *
 * The queries run in parallel, so naming thirteen areas instead of one costs
 * requests rather than wall-clock time inside the function's 300-second limit.
 */
export function seriousProfileOptions(requestedLimit, sourceCount = 1) {
  // Idealista is asked for the neighbourhoods whose location ids are known,
  // Immobiliare for its own macrozones, and both keep one city-wide query so
  // whatever neither list covers is still seen.
  const idealistaAreas = [...MILAN_IDEALISTA_AREA_NAMES, 'Milano'];
  const immobiliareAreas = [...MILAN_IMMOBILIARE_AREAS, 'Milano'];
  // The budget is divided by whichever source asks for more places, so neither
  // portal is given a per-query quota larger than its share of the run.
  const areas = idealistaAreas.length >= immobiliareAreas.length ? idealistaAreas : immobiliareAreas;
  return {
    runMode: 'serious',
    requestedAreas: idealistaAreas,
    requestedAreasBySource: {
      idealista: idealistaAreas,
      immobiliare: immobiliareAreas,
    },
    // The same total, divided, rather than the whole budget granted to each.
    // The floor keeps a small run from asking for a handful of listings per
    // area, where nothing can be compared with anything.
    maxItemsPerQuery: Math.max(20, Math.ceil(requestedLimit / areas.length)),
    maxItemsPerSource: requestedLimit,
    maxTotalRawListings: requestedLimit * sourceCount,
    topPrescoreLimit: requestedLimit * sourceCount,
    minSize: 100,
    idealistaCondition: ['renew'],
  };
}

export function resolveRequestedLimit(value, fallback = 600, maximum = 5000) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(numeric)));
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Cross-origin request denied' });
  if (!await requireRole(request, response, 'admin')) return;

  if (activeRun) return response.status(409).json({ error: 'Una run e gia in corso su questa istanza' });

  const strategy = request.body?.strategy || 'neutral_fractionability';
  if (strategy !== 'neutral_fractionability') {
    return response.status(400).json({ error: 'Only neutral_fractionability is enabled from the frontend' });
  }

  const profile = request.body?.profile || 'scout';
  if (!['scout', 'milano_broad', 'milano_multisource'].includes(profile)) {
    return response.status(400).json({ error: 'Profilo run non valido' });
  }

  const requestedLimit = resolveRequestedLimit(request.body?.limit);

  const seriousProfile = profile === 'milano_broad' || profile === 'milano_multisource';
  const sourceCount = profile === 'milano_multisource' ? 2 : 1;
  const profileOptions = seriousProfile ? seriousProfileOptions(requestedLimit, sourceCount) : {};

  activeRun = runMassiveTriage({
    baseSearchName: profile === 'milano_multisource' ? 'milanoFractioningMultisource' : profile === 'milano_broad' ? 'milanoFractioningSerious' : 'milanoFractioningMassive',
    searchStrategy: strategy,
    sources: profile === 'milano_multisource' ? 'idealista,immobiliare' : 'idealista',
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
      requested_limit_per_source: requestedLimit,
      requested_areas: output.requested_areas,
      raw_source_count: output.raw_source_count,
      raw_source_counts_by_channel: output.raw_source_counts_by_channel,
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

