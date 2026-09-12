import { runValuationFromSupabase } from '../lib/valuation-runner.js';
import { reconcileInvestorAlerts, supabaseAlertStore } from '../lib/investor-alert-reconciler.js';
import { isSameOrigin, requireRole } from './_auth.js';

export const maxDuration = 300;

let activeValuation = null;

/**
 * Investor alerts are reconciled from triage_properties, which only carries
 * Door Score and ROI once a valuation has written them - so this is the point
 * where a run becomes alertable.
 *
 * The pass is awaited rather than left to run after the response, because work
 * started but not awaited in a serverless function is not guaranteed to finish.
 *
 * It never fails the request. A valuation is the expensive, hard-to-repeat
 * part; alerts are idempotent and can be reconciled again from the same run at
 * no cost, so a failure here is reported and left for later rather than
 * discarding a completed valuation.
 */
export async function reconcileAlertsForRun(runId, {
  reconcile = reconcileInvestorAlerts,
  store = supabaseAlertStore,
  logger = console,
} = {}) {
  try {
    const summary = await reconcile({ store: store(), runId });
    return {
      status: 'ok',
      investors_considered: summary.investors_considered,
      properties_inspected: summary.properties_inspected,
      alerts_created: summary.alerts_created,
    };
  } catch (error) {
    logger.error('Investor alert reconciliation failed:', error.message);
    return { status: 'failed', retryable: true };
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Cross-origin request denied' });
  if (!await requireRole(request, response, 'admin')) return;

  const runId = String(request.body?.run_id || '').trim();
  if (!runId || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(runId)) {
    return response.status(400).json({ error: 'run_id non valido' });
  }

  // Reconciling alerts for a run that already has a valuation costs nothing and
  // repeats safely, so it is exposed on its own. Without it, recovering from a
  // failed reconciliation - or alerting a newly onboarded investor about an
  // existing run - would mean paying for the whole valuation again.
  if (request.body?.action === 'reconcile_alerts') {
    const alerts = await reconcileAlertsForRun(runId);
    const status = alerts.status === 'ok' ? 200 : 503;
    return response.status(status).json({ run_id: runId, investor_alerts: alerts });
  }

  if (activeValuation) return response.status(409).json({ error: 'Una valuation e gia in corso su questa istanza' });

  const requestedLimit = Number(request.body?.limit ?? 5000);
  const limit = Math.max(1, Math.min(5000, Number.isFinite(requestedLimit) ? requestedLimit : 5000));
  const valuationMode = String(request.body?.mode || 'deterministic').toLowerCase();
  if (valuationMode !== 'deterministic') {
    return response.status(400).json({ error: 'Only deterministic valuation is enabled from the frontend' });
  }

  const runtimeOidcToken = Array.isArray(request.headers['x-vercel-oidc-token'])
    ? request.headers['x-vercel-oidc-token'][0]
    : request.headers['x-vercel-oidc-token'];
  activeValuation = runValuationFromSupabase({
    runId,
    limit,
    valuationMode,
    env: runtimeOidcToken
      ? { ...process.env, VERCEL_OIDC_TOKEN: runtimeOidcToken }
      : process.env,
  });
  try {
    const valuation = await activeValuation;
    const investorAlerts = await reconcileAlertsForRun(runId);
    return response.status(200).json({ ...valuation, investor_alerts: investorAlerts });
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
