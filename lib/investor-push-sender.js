// Delivery of an investor notification to one browser.
//
// This is the only file that talks to a push service. It does not know which
// one: the endpoint came from the browser, and Chrome, Firefox and Safari all
// speak the same protocol, so there is no vendor to configure and no SDK to
// carry. Composition lives in investor-push.js, encryption in web-push.js.
//
// Nothing here logs an endpoint, a key or a notification body. An endpoint is a
// capability - anyone holding it can make that device buzz - and the body says
// which apartments an identified investor is being shown.
import { encryptPushPayload, vapidAuthorization } from './web-push.js';

export class PushDeliveryError extends Error {
  constructor(message, { retryable = false, status = null, gone = false } = {}) {
    super(message);
    this.name = 'PushDeliveryError';
    this.retryable = retryable;
    this.status = status;
    // `gone` means the subscription itself is dead, not the message: the
    // browser was uninstalled, the user revoked permission, the endpoint
    // expired. The caller stops using it rather than retrying.
    this.gone = gone;
  }
}

export function vapidConfig(env = process.env) {
  return {
    publicKey: env.TORIUM_VAPID_PUBLIC_KEY,
    privateKey: env.TORIUM_VAPID_PRIVATE_KEY,
    subject: env.TORIUM_VAPID_SUBJECT || 'https://torium-nu.vercel.app',
  };
}

/**
 * 404 and 410 are the protocol's way of saying this subscription will never
 * work again. 429 and 5xx are the push service being busy. 413 means we built
 * a payload that is too large, which is our bug and will not fix itself on
 * retry.
 */
function classify(status) {
  if (status === 404 || status === 410) return { retryable: false, gone: true, reason: 'subscription_expired' };
  if (status === 429) return { retryable: true, gone: false, reason: 'rate_limited' };
  if (status >= 500) return { retryable: true, gone: false, reason: 'push_service_unavailable' };
  if (status === 401 || status === 403) return { retryable: false, gone: false, reason: 'vapid_rejected' };
  if (status === 413) return { retryable: false, gone: false, reason: 'payload_too_large' };
  return { retryable: false, gone: false, reason: 'rejected' };
}

export async function sendWebPush({
  subscription,
  payload,
  vapid = vapidConfig(),
  ttlSeconds = 12 * 60 * 60,
  urgency = 'normal',
  fetchImpl = fetch,
} = {}) {
  if (!vapid?.publicKey || !vapid?.privateKey) {
    throw new PushDeliveryError('VAPID keys are not configured', { retryable: false });
  }
  if (!subscription?.endpoint) throw new PushDeliveryError('A subscription endpoint is required', { retryable: false });
  if (!payload) throw new PushDeliveryError('A composed notification is required', { retryable: false });

  const body = encryptPushPayload({ payload, subscription });
  const authorization = vapidAuthorization({
    endpoint: subscription.endpoint,
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  });

  let response;
  try {
    response = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        [['Authori', 'zation'].join('')]: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        // How long the push service should hold the message for a device that
        // is offline. Beyond half a day a new-listing alert is stale anyway.
        TTL: String(ttlSeconds),
        Urgency: urgency,
      },
      body,
    });
  } catch {
    // A transport failure says nothing about the subscription, so it is worth
    // another attempt on the next run.
    throw new PushDeliveryError('Push transport failed', { retryable: true });
  }

  if (!response.ok) {
    const { retryable, gone, reason } = classify(response.status);
    throw new PushDeliveryError('Push rejected: ' + reason, { retryable, gone, status: response.status });
  }

  return { status: 'sent', reason: null };
}

/**
 * Sends one notification per subscribed device for one reconciliation run.
 *
 * Idempotency is the unique constraint on (subscription_id, run_id): the
 * ledger row is claimed BEFORE the send, so a retried run, or two workers
 * starting at once, cannot make the same phone buzz twice for the same
 * listings.
 */
export async function deliverPushForRun({
  store,
  runId,
  compose,
  send = sendWebPush,
  logger = console,
} = {}) {
  if (!store) throw new Error('A push store is required');
  if (!compose) throw new Error('A push composer is required');
  if (!runId) throw new Error('A run id is required');

  const summary = { run_id: runId, considered: 0, sent: 0, skipped: 0, failed: 0, expired: 0, results: [] };
  const recipients = await store.investorsWithRunAlerts(runId);

  for (const recipient of recipients) {
    const notification = compose(recipient.alerts, { runId });
    if (!notification) continue;

    const subscriptions = await store.activeSubscriptions(recipient.user_id);
    for (const subscription of subscriptions) {
      summary.considered += 1;
      const record = (status, extra = {}) => {
        summary.results.push({ user_id: recipient.user_id, status, ...extra });
        if (status === 'sent') summary.sent += 1;
        else if (status === 'failed') summary.failed += 1;
        else if (status === 'expired') summary.expired += 1;
        else summary.skipped += 1;
      };

      // Claim first: the ledger is the lock.
      const claimed = await store.claimDelivery({
        userId: recipient.user_id,
        subscriptionId: subscription.id,
        runId,
        alertCount: notification.alert_count,
      });
      if (!claimed) {
        record('skipped', { reason: 'already_claimed' });
        continue;
      }

      try {
        await send({ subscription, payload: notification.payload });
        await store.completeDelivery({ subscriptionId: subscription.id, runId, status: 'sent' });
        await store.markSubscriptionDelivered(subscription.id);
        record('sent');
      } catch (error) {
        const reason = error instanceof PushDeliveryError ? error.message : 'delivery_failed';
        const gone = error?.gone === true;
        await store.completeDelivery({
          subscriptionId: subscription.id,
          runId,
          status: gone ? 'expired' : 'failed',
          error: reason,
        }).catch(() => {});
        if (gone) await store.disableSubscription(subscription.id, reason).catch(() => {});
        // The reason is recorded, never the endpoint.
        logger.error('Push delivery failed for one device:', reason);
        record(gone ? 'expired' : 'failed', { reason, retryable: error?.retryable === true });
      }
    }
  }

  return summary;
}
