// What a push notification says.
//
// Composition only: this file knows nothing about VAPID, endpoints or the
// database, exactly as investor-digest.js knows nothing about Resend. It turns
// the alerts one investor matched in one run into the few words a phone can
// show on a locked screen.
//
// A notification is not a small email. It is read in one glance, out of
// context, possibly hours later, and the only question it has to answer is
// whether this is worth opening now. So it carries the decision (how many,
// where, from what price) and never the whole listing.

const PAYLOAD_LIMIT_BYTES = 3000;

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatEuro(value) {
  const amount = numeric(value);
  if (amount === null) return null;
  if (amount >= 1000000) {
    const millions = amount / 1000000;
    return `${millions.toFixed(millions >= 10 ? 1 : 2).replace('.', ',').replace(/,?0+$/, '')} mln €`;
  }
  return `${Math.round(amount / 1000)}k €`;
}

function zoneOf(alert, zoneLabels) {
  return zoneLabels.get(alert.zone_id) || alert.neighborhood || null;
}

function zoneSummary(alerts, zoneLabels) {
  const zones = [...new Set(alerts.map((alert) => zoneOf(alert, zoneLabels)).filter(Boolean))];
  if (zones.length === 0) return null;
  if (zones.length === 1) return zones[0];
  if (zones.length === 2) return `${zones[0]} e ${zones[1]}`;
  return `${zones[0]}, ${zones[1]} e altre ${zones.length - 2}`;
}

function singleBody(alert) {
  const parts = [
    numeric(alert.size_mq) === null ? null : `${Math.round(numeric(alert.size_mq))} m²`,
    formatEuro(alert.price_eur),
    numeric(alert.roi_base_pct) === null ? null : `ROI ${Math.round(numeric(alert.roi_base_pct))}%`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * Composes the notification for one investor and one reconciliation run.
 *
 * Returns null when there is nothing to say. A push that says "no news" is a
 * reason to turn notifications off, so silence is a feature.
 *
 * @returns {{ title: string, body: string, tag: string, url: string, alert_count: number, payload: string } | null}
 */
export function composeInvestorPush(alerts = [], {
  zoneLabels = new Map(),
  runId = null,
  profileName = null,
} = {}) {
  const usable = alerts.filter(Boolean);
  if (usable.length === 0) return null;

  // Highest Door Score first: if only one apartment fits in the notification,
  // it should be the one the engine rated best.
  const ranked = [...usable].sort((left, right) => (numeric(right.door_score) ?? -1) - (numeric(left.door_score) ?? -1));
  const best = ranked[0];
  const count = ranked.length;
  const zone = zoneSummary(ranked, zoneLabels);

  let title;
  let body;
  if (count === 1) {
    title = zone ? `Nuovo immobile a ${zone}` : 'Nuovo immobile da frazionare';
    body = singleBody(best) || (best.title || 'Apri per i dettagli');
  } else {
    title = `${count} nuovi immobili da frazionare`;
    const cheapest = ranked
      .map((alert) => numeric(alert.price_eur))
      .filter((price) => price !== null)
      .sort((left, right) => left - right)[0];
    body = [zone, cheapest === undefined ? null : `da ${formatEuro(cheapest)}`]
      .filter(Boolean).join(' · ') || 'Apri per vedere i dettagli';
  }

  if (profileName) title = `${title} · ${profileName}`;

  // One notification per run replaces the previous one on the device rather
  // than stacking: an investor who left the phone in a drawer should come back
  // to the current picture, not to ten obsolete cards.
  const tag = 'torium-alerts';
  const url = count === 1 && best.run_id
    ? `/home?run=${encodeURIComponent('supabase:' + best.run_id)}`
    : '/account#alertsCard';

  const notification = {
    title,
    body,
    tag,
    url,
    alert_count: count,
    run_id: runId,
  };

  // The push services reject an oversized payload outright, so the composer
  // guarantees the size rather than discovering it at send time.
  let payload = JSON.stringify(notification);
  if (Buffer.byteLength(payload, 'utf8') > PAYLOAD_LIMIT_BYTES) {
    notification.body = body.slice(0, 120);
    notification.title = title.slice(0, 80);
    payload = JSON.stringify(notification);
  }

  return { ...notification, payload };
}

export { PAYLOAD_LIMIT_BYTES };
