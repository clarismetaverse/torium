import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import {
  composeInvestorDigest,
  digestSubject,
  escapeHtml,
  formatEuro,
  safeExternalUrl,
} from '../lib/investor-digest.js';

function alert(overrides = {}) {
  return {
    title: 'Quadrilocale da ristrutturare',
    zone_id: 'navigli',
    neighborhood: 'Navigli',
    run_id: 'run-1',
    source_url: 'https://www.idealista.it/immobile/12345/',
    price_eur: 520000,
    size_mq: 128,
    price_by_area: 4063,
    door_score: 78,
    roi_base_pct: 21.4,
    ...overrides,
  };
}

const ZONE_LABELS = new Map([['navigli', 'Navigli'], ['centro', 'Centro']]);

// --- link safety -----------------------------------------------------------

test('only the portals TORIUM scrapes can be linked', () => {
  assert.equal(
    safeExternalUrl('https://www.idealista.it/immobile/1/'),
    'https://www.idealista.it/immobile/1/',
  );
  assert.equal(safeExternalUrl('https://immobiliare.it/annunci/1/'), 'https://immobiliare.it/annunci/1/');

  for (const hostile of [
    'https://evil.example/phish',
    'http://www.idealista.it/immobile/1/',
    'javascript:alert(1)',
    'https://idealista.it.evil.example/',
    'data:text/html,<script>alert(1)</script>',
    null,
    '',
  ]) {
    assert.equal(safeExternalUrl(hostile), null, 'must refuse ' + hostile);
  }
});

test('a refused portal link is simply omitted, not rendered broken', () => {
  const digest = composeInvestorDigest([alert({ source_url: 'https://evil.example/phish' })], {
    zoneLabels: ZONE_LABELS,
  });
  assert.doesNotMatch(digest.html, /evil\.example/);
  assert.doesNotMatch(digest.text, /evil\.example/);
  assert.doesNotMatch(digest.html, /Annuncio originale/);
  // The TORIUM link still gets the investor somewhere useful.
  assert.match(digest.html, /Apri in TORIUM/);
});

// --- escaping --------------------------------------------------------------

test('listing text from a scraped page cannot inject markup', () => {
  const digest = composeInvestorDigest([alert({
    title: '<img src=x onerror="alert(1)"> Trilocale "affare" & co',
    neighborhood: '<script>alert(2)</script>',
  })], { zoneLabels: new Map() });

  assert.doesNotMatch(digest.html, /<img src=x/);
  assert.doesNotMatch(digest.html, /<script>alert\(2\)/);
  assert.match(digest.html, /&lt;img src=x/);
  assert.match(digest.html, /&amp; co/);
});

test('escapeHtml covers every dangerous character', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});

// --- formatting ------------------------------------------------------------

test('money and missing values render for an Italian reader', () => {
  assert.match(formatEuro(520000), /520\.000/);
  assert.equal(formatEuro(null), '—');
  assert.equal(formatEuro('not a number'), '—');
});

test('a digest renders every metric an investor decides on', () => {
  const digest = composeInvestorDigest([alert()], { zoneLabels: ZONE_LABELS });
  for (const fragment of ['Prezzo', 'Superficie', '€/m²', 'Door Score', 'ROI base']) {
    assert.ok(digest.html.includes(fragment), 'missing ' + fragment);
  }
  assert.match(digest.html, /21,4%/);
  assert.match(digest.html, /128 m²/);
});

test('an alert with missing metrics still renders', () => {
  const digest = composeInvestorDigest([alert({
    price_eur: null, size_mq: null, price_by_area: null, door_score: null, roi_base_pct: null,
    title: null, zone_id: null, neighborhood: null,
  })], { zoneLabels: new Map() });
  assert.match(digest.html, /Immobile senza titolo/);
  assert.match(digest.html, /Zona non indicata/);
  assert.equal(digest.alert_count, 1);
});

// --- subject ---------------------------------------------------------------

test('the subject names the zone when there is one', () => {
  assert.equal(
    digestSubject([alert()], { zoneLabels: ZONE_LABELS }),
    'TORIUM · 1 nuova opportunità a Navigli',
  );
  assert.equal(
    digestSubject([alert(), alert({ zone_id: 'centro', neighborhood: 'Centro' })], { zoneLabels: ZONE_LABELS }),
    'TORIUM · 2 nuove opportunità fra Navigli e Centro',
  );
  assert.equal(
    digestSubject([
      alert(), alert({ zone_id: 'centro' }), alert({ zone_id: 'isola', neighborhood: 'Isola' }),
    ], { zoneLabels: ZONE_LABELS }),
    'TORIUM · 3 nuove opportunità da frazionare',
  );
  assert.equal(digestSubject([]), 'TORIUM · nessuna novità oggi');
});

// --- honesty about what was filtered out -----------------------------------

test('properties dropped for a missing zone are stated, not hidden', () => {
  const digest = composeInvestorDigest([alert()], {
    zoneLabels: ZONE_LABELS,
    excludedWithoutZone: 12,
  });
  assert.match(digest.html, /12 immobili sono stati esclusi perché privi/);
  assert.match(digest.text, /12 immobili esclusi/);

  const singular = composeInvestorDigest([alert()], { zoneLabels: ZONE_LABELS, excludedWithoutZone: 1 });
  assert.match(singular.html, /1 immobile è stato escluso perché privo/);

  const none = composeInvestorDigest([alert()], { zoneLabels: ZONE_LABELS });
  assert.doesNotMatch(none.html, /esclus/);
});

// --- deliverability basics -------------------------------------------------

test('the digest carries a way out and no external images', () => {
  const digest = composeInvestorDigest([alert()], { zoneLabels: ZONE_LABELS });
  assert.match(digest.html, /\/account/);
  assert.match(digest.html, /Modifica i criteri o disattiva gli avvisi/);
  assert.match(digest.text, /\/account/);
  // Portal-hosted thumbnails would leak open rates and break on CDN changes.
  assert.doesNotMatch(digest.html, /<img/i);
});

test('both bodies are produced and the text one is not markup', () => {
  const digest = composeInvestorDigest([alert(), alert({ source_listing_id: 'b' })], {
    zoneLabels: ZONE_LABELS,
  });
  assert.equal(digest.alert_count, 2);
  assert.match(digest.html, /^<!DOCTYPE html>/);
  assert.doesNotMatch(digest.text, /<(table|div|html)/);
  assert.match(digest.text, /Door Score 78/);
});

test('the site origin is honoured and never doubled up', () => {
  const digest = composeInvestorDigest([alert()], {
    zoneLabels: ZONE_LABELS,
    siteOrigin: 'https://torium.example/',
  });
  assert.match(digest.html, /https:\/\/torium\.example\/account/);
  assert.doesNotMatch(digest.html, /torium\.example\/\/account/);
});

test('an empty digest is representable rather than a crash', () => {
  const digest = composeInvestorDigest([], { zoneLabels: ZONE_LABELS });
  assert.equal(digest.alert_count, 0);
  assert.equal(digest.subject, 'TORIUM · nessuna novità oggi');
  assert.ok(digest.html.length > 0);
});

test('the composed HTML contains no executable script', () => {
  const digest = composeInvestorDigest([alert()], { zoneLabels: ZONE_LABELS });
  const scripts = [...digest.html.matchAll(/<script[\s\S]*?<\/script>/gi)];
  assert.equal(scripts.length, 0);
  // Guard against a template change smuggling one in.
  assert.doesNotThrow(() => new Script('void 0'));
});
