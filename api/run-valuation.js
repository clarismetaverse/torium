import crypto from 'node:crypto';
import { runValuationFromSupabase } from '../lib/valuation-runner.js';

export const maxDuration = 300;

let activeValuation = null;

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
  if (activeValuation) return response.status(409).json({ error: 'Una valuation e gia in corso su questa istanza' });

  const runId = String(request.body?.run_id || '').trim();
  if (!runId || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(runId)) {
    return response.status(400).json({ error: 'run_id non valido' });
  }
  const requestedLimit = Number(request.body?.limit ?? 20);
  const limit = Math.max(1, Math.min(20, Number.isFinite(requestedLimit) ? requestedLimit : 20));

  const runtimeOidcToken = Array.isArray(request.headers['x-vercel-oidc-token'])
    ? request.headers['x-vercel-oidc-token'][0]
    : request.headers['x-vercel-oidc-token'];
  activeValuation = runValuationFromSupabase({
    runId,
    limit,
    env: runtimeOidcToken
      ? { ...process.env, VERCEL_OIDC_TOKEN: runtimeOidcToken }
      : process.env,
  });
  try {
    return response.status(200).json(await activeValuation);
  } catch (error) {
    console.error('Frontend valuation failed:', error);
    const message = String(error?.message || 'Valuation failed');
    if (message.includes('customer_verification_required')) {
      return response.status(402).json({
        error: 'Vercel AI Gateway richiede una carta associata al team per sbloccare i crediti AI.',
      });
    }
    return response.status(500).json({ error: message });
  } finally {
    activeValuation = null;
  }
}
