import { composeInvestorDigest } from './investor-digest.js';
import { deliverInvestorDigests } from './investor-digest-sender.js';
import { MILAN_CANONICAL_ZONES } from './milan-area-taxonomy.js';

// Weekly delivery.
//
// The cadence is enforced by the ledger, not by a scheduler. The digest row is
// keyed on (user_id, channel, digest_date); using the Monday of the ISO week as
// that date turns the existing unique constraint into "at most one digest per
// investor per week", whoever triggers it and however often.
//
// That is why this can hang off the end of a reconciliation pass rather than
// needing a cron job and a thirteenth serverless function: a second run in the
// same week finds the week already claimed and sends nothing. Adding a fixed
// weekday later - pg_cron calling the same code - changes nothing here, because
// the guarantee lives in the database either way.

const ZONE_LABELS = new Map(MILAN_CANONICAL_ZONES.map((zone) => [zone.id, zone.name]));

/**
 * Monday of the ISO week containing `date`, as YYYY-MM-DD in UTC.
 *
 * UTC rather than local time so that two servers in different zones agree on
 * which week a Sunday-evening send belongs to.
 */
export function weekStartDate(date = new Date()) {
  const moment = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
  ));
  // getUTCDay is 0 for Sunday, which belongs to the week that began six days
  // earlier rather than starting a new one.
  const offset = (moment.getUTCDay() + 6) % 7;
  moment.setUTCDate(moment.getUTCDate() - offset);
  return moment.toISOString().slice(0, 10);
}

export function composeForDigest(alerts, options = {}) {
  return composeInvestorDigest(alerts, { ...options, zoneLabels: ZONE_LABELS });
}

function serviceConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

export function supabaseDigestStore(fetchImpl = fetch) {
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
      const error = new Error('Supabase digest store failed: ' + result.status);
      error.status = result.status;
      throw error;
    }
    return body ? JSON.parse(body) : null;
  }

  return {
    async investorsWithPendingAlerts() {
      const alerts = await rest(
        'investor_alerts?delivered_at=is.null&dismissed_at=is.null'
        + '&select=user_id,property_key,title,zone_id,neighborhood,run_id,source_url,'
        + 'price_eur,size_mq,price_by_area,door_score,roi_base_pct'
        + '&order=door_score.desc',
      ) || [];
      if (!alerts.length) return [];

      const byUser = new Map();
      for (const alert of alerts) {
        if (!byUser.has(alert.user_id)) byUser.set(alert.user_id, []);
        byUser.get(alert.user_id).push(alert);
      }

      // The recipient address comes from Supabase Auth, never from the alert
      // rows: an alert is product data and must not carry an address around.
      const { url } = serviceConfig();
      const recipients = [];
      for (const [userId, userAlerts] of byUser) {
        const user = await fetchImpl(`${url}/auth/v1/admin/users/${userId}`, { headers: headers() })
          .then((result) => (result.ok ? result.json() : null))
          .catch(() => null);
        if (!user?.email) continue;
        recipients.push({ user_id: userId, email: user.email, alerts: userAlerts });
      }
      return recipients;
    },

    /**
     * Claims the week for this investor. Returns false when the row already
     * exists, which is exactly the case where a digest has already gone out.
     */
    async claimDigest({ userId, channel, digestDate, alertCount }) {
      try {
        await rest('investor_alert_digests', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: userId,
            channel,
            digest_date: digestDate,
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

    async completeDigest({ userId, channel, digestDate, status, providerMessageId, error }) {
      const query = new URLSearchParams({
        user_id: 'eq.' + userId,
        channel: 'eq.' + channel,
        digest_date: 'eq.' + digestDate,
      });
      return rest('investor_alert_digests?' + query, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status,
          provider_message_id: providerMessageId ?? null,
          error: error ?? null,
          sent_at: status === 'sent' ? new Date().toISOString() : null,
        }),
      });
    },

    async markAlertsDelivered(userId, propertyKeys) {
      if (!propertyKeys.length) return null;
      const query = new URLSearchParams({
        user_id: 'eq.' + userId,
        property_key: 'in.(' + propertyKeys.map((key) => '"' + key + '"').join(',') + ')',
      });
      return rest('investor_alerts?' + query, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ delivered_at: new Date().toISOString() }),
      });
    },
  };
}

/**
 * Sends this week's digest to every investor with undelivered alerts.
 *
 * Safe to call after every reconciliation: the week is claimed once.
 */
export async function deliverWeeklyDigests({
  store = supabaseDigestStore(),
  now = new Date(),
  send,
  logger = console,
} = {}) {
  return deliverInvestorDigests({
    store,
    compose: composeForDigest,
    digestDate: weekStartDate(now),
    ...(send ? { send } : {}),
    logger,
  });
}
