// Composes the investor alert digest.
//
// Vendor-independent on purpose: this turns alert rows into a subject, an HTML
// body and a plain-text body. Whichever provider carries it is somebody else's
// problem, which keeps the wording testable and makes swapping providers a
// configuration change rather than a rewrite.
//
// Email client constraints drive the markup: table layout, inline styles, no
// external images. Listing thumbnails are portal-hosted, so including them
// would both leak open rates to the portal and break whenever a portal rotates
// its CDN paths.

const EURO = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('it-IT');

// Number(null) is 0 and Number('') is 0, so a missing value would render as a
// real and absurd price. An investor must be able to tell "we do not know" from
// "it costs nothing".
function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatEuro(value) {
  const number = numeric(value);
  return number === null ? '—' : EURO.format(number);
}

function formatSize(value) {
  const number = numeric(value);
  return number === null ? '—' : `${NUMBER.format(number)} m²`;
}

function formatPercent(value) {
  const number = numeric(value);
  return number === null ? '—' : `${number.toFixed(1).replace('.', ',')}%`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only ever link to a portal we scrape or back to TORIUM. An alert row is
// written by TORIUM, but a URL that reached it from a scraped page is still
// untrusted input, and a digest is exactly where a bad link would be clicked.
export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const allowed = ['idealista.it', 'immobiliare.it'];
    return allowed.some((suffix) => host === suffix || host.endsWith('.' + suffix))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function digestSubject(alerts, { zoneLabels = new Map() } = {}) {
  const count = alerts.length;
  if (count === 0) return 'TORIUM · nessuna novità oggi';

  const zones = [...new Set(alerts.map((alert) => zoneLabels.get(alert.zone_id) || alert.neighborhood).filter(Boolean))];
  const noun = count === 1 ? 'nuova opportunità' : 'nuove opportunità';
  if (zones.length === 1) return `TORIUM · ${count} ${noun} a ${zones[0]}`;
  if (zones.length === 2) return `TORIUM · ${count} ${noun} fra ${zones[0]} e ${zones[1]}`;
  return `TORIUM · ${count} ${noun} da frazionare`;
}

function alertRowHtml(alert, { zoneLabels, siteOrigin }) {
  const zone = zoneLabels.get(alert.zone_id) || alert.neighborhood || 'Zona non indicata';
  const portalUrl = safeExternalUrl(alert.source_url);
  const toriumUrl = alert.run_id
    ? `${siteOrigin}/home?run=${encodeURIComponent('supabase:' + alert.run_id)}`
    : `${siteOrigin}/home`;

  const metrics = [
    ['Prezzo', formatEuro(alert.price_eur)],
    ['Superficie', formatSize(alert.size_mq)],
    ['€/m²', formatEuro(alert.price_by_area)],
    ['Door Score', Number.isFinite(Number(alert.door_score)) ? String(alert.door_score) : '—'],
    ['ROI base', formatPercent(alert.roi_base_pct)],
  ];

  return `
        <tr>
          <td style="padding:18px 0;border-bottom:1px solid #e6e3dd;">
            <div style="font:600 16px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1a17;">
              ${escapeHtml(alert.title || 'Immobile senza titolo')}
            </div>
            <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b665d;margin-top:4px;">
              ${escapeHtml(zone)}
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
              <tr>
                ${metrics.map(([label, value]) => `<td style="padding-right:22px;">
                  <div style="font:400 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#8a847a;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(label)}</div>
                  <div style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1a17;">${escapeHtml(value)}</div>
                </td>`).join('')}
              </tr>
            </table>
            <div style="margin-top:14px;font:500 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;">
              <a href="${escapeHtml(toriumUrl)}" style="color:#1b1a17;text-decoration:underline;">Apri in TORIUM</a>
              ${portalUrl ? `<span style="color:#c8c3ba;padding:0 8px;">·</span><a href="${escapeHtml(portalUrl)}" style="color:#6b665d;text-decoration:underline;">Annuncio originale</a>` : ''}
            </div>
          </td>
        </tr>`;
}

function alertRowText(alert, { zoneLabels, siteOrigin }) {
  const zone = zoneLabels.get(alert.zone_id) || alert.neighborhood || 'Zona non indicata';
  const portalUrl = safeExternalUrl(alert.source_url);
  const lines = [
    `• ${alert.title || 'Immobile senza titolo'}`,
    `  ${zone}`,
    `  ${formatEuro(alert.price_eur)} · ${formatSize(alert.size_mq)} · ${formatEuro(alert.price_by_area)}/m²`,
    `  Door Score ${alert.door_score ?? '—'} · ROI base ${formatPercent(alert.roi_base_pct)}`,
    `  TORIUM: ${siteOrigin}/home${alert.run_id ? '?run=' + encodeURIComponent('supabase:' + alert.run_id) : ''}`,
  ];
  if (portalUrl) lines.push(`  Annuncio: ${portalUrl}`);
  return lines.join('\n');
}

/**
 * @returns {{ subject: string, html: string, text: string, alert_count: number }}
 */
export function composeInvestorDigest(alerts = [], {
  siteOrigin = 'https://torium-nu.vercel.app',
  zoneLabels = new Map(),
  excludedWithoutZone = 0,
} = {}) {
  const origin = String(siteOrigin).replace(/\/+$/, '');
  const context = { zoneLabels, siteOrigin: origin };
  const count = alerts.length;
  const heading = count === 1
    ? '1 nuova opportunità in linea con i tuoi criteri'
    : `${count} nuove opportunità in linea con i tuoi criteri`;

  // Stated plainly rather than hidden: an investor should know the digest is a
  // filtered view, not the whole market.
  const caveat = excludedWithoutZone > 0
    ? `<p style="font:400 12px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#8a847a;margin:18px 0 0;">
         ${excludedWithoutZone} ${excludedWithoutZone === 1 ? 'immobile è stato escluso perché privo' : 'immobili sono stati esclusi perché privi'} di zona rilevabile. Puoi vederli in TORIUM senza il filtro per zona.
       </p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TORIUM</title></head>
<body style="margin:0;padding:0;background:#faf8f5;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#faf8f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e6e3dd;border-radius:14px;padding:32px;">
        <tr><td>
          <div style="font:700 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.16em;color:#1b1a17;">TORIUM</div>
          <h1 style="font:600 21px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1a17;margin:16px 0 0;">${escapeHtml(heading)}</h1>
        </td></tr>
        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            ${alerts.map((alert) => alertRowHtml(alert, context)).join('')}
          </table>
          ${caveat}
        </td></tr>
        <tr><td style="padding-top:26px;">
          <p style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#8a847a;margin:0;">
            Ricevi questo messaggio perché hai salvato criteri di ricerca in TORIUM.
            <a href="${escapeHtml(origin)}/account" style="color:#6b665d;">Modifica i criteri o disattiva gli avvisi</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // null marks a block that does not apply; '' is a deliberate blank line, so
  // the two cannot be filtered with the same test.
  const text = [
    'TORIUM',
    '',
    heading,
    '',
    alerts.length ? alerts.map((alert) => alertRowText(alert, context)).join('\n\n') : null,
    alerts.length ? '' : null,
    excludedWithoutZone > 0
      ? `${excludedWithoutZone} ${excludedWithoutZone === 1 ? 'immobile escluso perché privo' : 'immobili esclusi perché privi'} di zona rilevabile.`
      : null,
    excludedWithoutZone > 0 ? '' : null,
    `Modifica i criteri o disattiva gli avvisi: ${origin}/account`,
  ].filter((block) => block !== null).join('\n');

  return {
    subject: digestSubject(alerts, { zoneLabels }),
    html,
    text,
    alert_count: count,
  };
}
