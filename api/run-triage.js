import crypto from 'node:crypto';
import { runMassiveTriage } from '../pipelines/triage-multisource-massive.js';

export const maxDuration = 300;

let activeRun = null;

function sameValue(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestPin(request) {
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
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

  const configuredPin = process.env.TORIUM_RUN_PIN;
  if (!configuredPin) return response.status(503).json({ error: 'Run control is not configured' });
  if (!sameValue(requestPin(request), configuredPin)) return response.status(401).json({ error: 'PIN non valido' });
  if (activeRun) return response.status(409).json({ error: 'Una run e gia in corso su questa istanza' });

  const strategy = request.body?.strategy || 'neutral_fractionability';
  if (strategy !== 'neutral_fractionability') {
    return response.status(400).json({ error: 'Only neutral_fractionability is enabled from the frontend' });
  }

  activeRun = runMassiveTriage({
    baseSearchName: 'milanoFractioningMassive',
    searchStrategy: strategy,
    sources: 'idealista',
  });

  try {
    const output = await activeRun;
    return response.status(200).json({
      ok: true,
      run_id: output.run_id,
      search_name: output.search_name,
      search_strategy: output.search_strategy,
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
