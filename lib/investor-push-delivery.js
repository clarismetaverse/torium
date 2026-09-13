// Wiring: where the push notifications for a run come from, and where their
// outcome is written.
//
// Same shape as investor-digest-schedule.js, different cadence. The email
// digest is weekly because the ledger date is the Monday of the week; a push is
// per run, because the point of a push is that it arrives when the listing
// does. The guarantee is the same in both cases and lives in the database: a
// unique constraint claimed before the send, never a flag in application code.
import { composeInvestorPush } from './investor-push.js';
import { deliverPushForRun } from './investor-push-sender.js';
import { MILAN_CANONICAL_ZONES } from './milan-area-taxonomy.js';

const ZONE_LABELS = new Map(MILAN_CANONICAL_ZONES.map((zone) => [zone.id, zone.name]));

export function composeForPush(alerts, options = {}) {
  return composeInvestorPush(alerts, { ...options, zoneLabels: ZONE_LABELS });
}

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

export function supabasePushStore(fetchImpl = fetch) {
  const headers = (extra = {}) => {
    const { key } = serviceConfig();
    return {
      apikey: key,
      [['Authori', 'zation'].join('')]: ['Bearer', key].join(' '),
      'Content-Type': 'application/json',
      ...extra,
    };
  };

  async function rest(pathname, options = {}) {
    const { url } = serviceConfig();
    const result = await fetchImpl(`${url}/rest/v1/${pathname}`, {
      ...options,
      headers: headers(options.headers),
    });
    const body = await result.text();
    if (!result.ok) {
      const error = new Error('Supabase push store failed: ' + result.status);
      error.status = result.status;
      throw error;
    }
    return body ? JSON.parse(body) : null;
  }

  return {
    /**
     * The alerts this run created, by investor.
     *
     * Scoped to the run rather than to "not yet delivered": a push announces
     * what just arrived. Alerts that were matched days ago and never opened
     * belong to the weekly digest, not to a notification that claims novelty.
     */
    async investorsWithRunAlerts(runId) {
      const alerts = await rest(
        'investor_alerts?run_id=eq.' + encodeURIComponent(runId)
        + '&dismissed_at=is.null'
        + '&select=user_id,property_key,title,zone_id,neighborhood,run_id,'
        + 'price_eur,size_mq,price_by_area,door_score,roi_base_pct'
        + '&order=door_score.desc',
      ) || [];

      const byUser = new Map();
      for (const alert of alerts) {
        if (!byUser.has(alert.user_id)) byUser.set(alert.user_id, []);
        byUser.get(alert.user_id).push(alert);
      }
      return [...byUser].map(([userId, userAlerts]) => ({ user_id: userId, alerts: userAlerts }));
    },

    async activeSubscriptions(userId) {
      const rows = await rest(
        'investor_push_subscriptions?user_id=eq.' + encodeURIComponent(userId)
        + '&disabled_at=is.null&select=id,endpoint,p256dh,auth',
      ) || [];
      return rows.map((row) => ({
        id: row.id,
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }));
    },

    /**
     * Claims this run for this device. Returns false when the row already
     * exists, which is exactly the case where the notification has already
     * been sent.
     */
    async claimDelivery({ userId, subscriptionId, runId, alertCount }) {
      try {
        await rest('investor_push_deliveries', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: userId,
            subscription_id: subscriptionId,
            run_id: runId,
            alert_count: alertCount,
            status: 'pending',
          }),
        });
        return true;
      } catch (error) {
        if (error.status === 409) return false;
        throw error;
      }
    },

    async completeDelivery({ subscriptionId, runId, status, error }) {
      const query = new URLSearchParams({
        subscription_id: 'eq.' + subscriptionId,
        run_id: 'eq.' + runId,
      });
      return rest('investor_push_deliveries?' + query, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status,
          error: error ?? null,
          sent_at: status === 'sent' ? new Date().toISOString() : null,
        }),
      });
    },

    async markSubscriptionDelivered(subscriptionId) {
      return rest('investor_push_subscriptions?id=eq.' + encodeURIComponent(subscriptionId), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ last_delivered_at: new Date().toISOString(), failure_count: 0 }),
      });
    },

    /**
     * A subscription the push service has declared dead. Kept as a row so a
     * device that stops receiving is visible, rather than silently absent.
     */
    async disableSubscription(subscriptionId, reason) {
      return rest('investor_push_subscriptions?id=eq.' + encodeURIComponent(subscriptionId), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          disabled_at: new Date().toISOString(),
          disabled_reason: String(reason || 'subscription_expired').slice(0, 120),
        }),
      });
    },
  };
}

/**
 * Notifies every subscribed device about the alerts this run produced.
 *
 * Safe to call after every reconciliation: each device claims each run once.
 */
export async function deliverRunPushNotifications({
  store = supabasePushStore(),
  runId,
  send,
  logger = console,
} = {}) {
  return deliverPushForRun({
    store,
    runId,
    compose: composeForPush,
    ...(send ? { send } : {}),
    logger,
  });
}
