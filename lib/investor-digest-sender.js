// Delivery of the investor digest through Resend.
//
// This is the only file that knows an email provider exists. Composition lives
// in investor-digest.js and takes no provider argument, so swapping Resend for
// another sender is a change here and nowhere else.
//
// Nothing in this file logs a recipient address, a subject or a body. A digest
// says which apartments an identified investor is being shown, which is both
// personal data and commercially sensitive; the delivery ledger records an
// outcome and a provider message id, never the message.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'TORIUM <noreply@notifiche.taurum.cloud>';

export class DigestDeliveryError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'DigestDeliveryError';
    this.retryable = retryable;
    this.status = status;
  }
}

function senderAddress() {
  return process.env.TORIUM_DIGEST_FROM || DEFAULT_FROM;
}

/**
 * A 4xx from the provider means this message will never be accepted - a bad
 * address, an unverified domain - so retrying it wastes a send and, on some
 * providers, hurts reputation. A 429 or 5xx is transient. The caller uses this
 * distinction to decide between "failed" and "try again later".
 */
function classify(status) {
  if (status === 429) return { retryable: true, reason: 'rate_limited' };
  if (status >= 500) return { retryable: true, reason: 'provider_unavailable' };
  if (status === 401 || status === 403) return { retryable: false, reason: 'credentials_rejected' };
  if (status === 422) return { retryable: false, reason: 'rejected_by_provider' };
  return { retryable: false, reason: 'rejected' };
}

export async function sendInvestorDigest({
  to,
  digest,
  from = senderAddress(),
  apiKey = process.env.RESEND_API_KEY,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new DigestDeliveryError('RESEND_API_KEY is not configured', { retryable: false });
  if (!to) throw new DigestDeliveryError('A recipient is required', { retryable: false });
  if (!digest?.subject || !digest?.html) {
    throw new DigestDeliveryError('A composed digest is required', { retryable: false });
  }
  // An empty digest is a decision not to send, not a message with no content.
  if (digest.alert_count === 0) {
    return { status: 'skipped', reason: 'no_alerts', provider_message_id: null };
  }

  let response;
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
      }),
    });
  } catch (error) {
    // A transport failure says nothing about the message, so it is retryable.
    throw new DigestDeliveryError('Digest transport failed', { retryable: true });
  }

  if (!response.ok) {
    const { retryable, reason } = classify(response.status);
    throw new DigestDeliveryError('Digest rejected: ' + reason, { retryable, status: response.status });
  }

  const body = await response.json().catch(() => ({}));
  return {
    status: 'sent',
    reason: null,
    provider_message_id: body?.id || null,
  };
}

/**
 * Sends one digest per investor for a given day.
 *
 * Idempotency is the unique constraint on (user_id, channel, digest_date): the
 * ledger row is claimed BEFORE the send, so two workers starting at once cannot
 * both send. The loser of the race sees the conflict and skips rather than
 * producing a second copy in the investor's inbox - a duplicate here is not a
 * wasted row, it is a second email.
 */
export async function deliverInvestorDigests({
  store,
  compose,
  send = sendInvestorDigest,
  digestDate = new Date().toISOString().slice(0, 10),
  logger = console,
} = {}) {
  if (!store) throw new Error('A digest store is required');
  if (!compose) throw new Error('A digest composer is required');

  const summary = { digest_date: digestDate, considered: 0, sent: 0, skipped: 0, failed: 0, results: [] };
  const recipients = await store.investorsWithPendingAlerts(digestDate);

  for (const recipient of recipients) {
    summary.considered += 1;
    const record = (status, extra = {}) => {
      summary.results.push({ user_id: recipient.user_id, status, ...extra });
      summary[status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'skipped'] += 1;
    };

    // Claim first: the ledger is the lock.
    const claimed = await store.claimDigest({
      userId: recipient.user_id,
      channel: 'email',
      digestDate,
      alertCount: recipient.alerts.length,
    });
    if (!claimed) {
      record('skipped', { reason: 'already_claimed' });
      continue;
    }

    try {
      const digest = compose(recipient.alerts, { excludedWithoutZone: recipient.excluded_without_zone || 0 });
      const outcome = await send({ to: recipient.email, digest });

      await store.completeDigest({
        userId: recipient.user_id,
        channel: 'email',
        digestDate,
        status: outcome.status,
        providerMessageId: outcome.provider_message_id,
      });
      if (outcome.status === 'sent') {
        await store.markAlertsDelivered(recipient.user_id, recipient.alerts.map((alert) => alert.property_key));
      }
      record(outcome.status, outcome.reason ? { reason: outcome.reason } : {});
    } catch (error) {
      // The reason is recorded, never the message or the address.
      const reason = error instanceof DigestDeliveryError ? error.message : 'delivery_failed';
      await store.completeDigest({
        userId: recipient.user_id,
        channel: 'email',
        digestDate,
        status: 'failed',
        error: reason,
      }).catch(() => {});
      logger.error('Digest delivery failed for one investor:', reason);
      record('failed', { reason, retryable: error?.retryable === true });
    }
  }

  return summary;
}
