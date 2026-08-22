import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MILAN_CANONICAL_ZONES,
  resolveMilanCanonicalZone,
} from '../lib/milan-area-taxonomy.js';
import { normalizeSourceListing } from '../lib/source-normalizers.js';

test('Milan taxonomy exposes the 32 Immobiliare-style canonical zones', () => {
  assert.equal(MILAN_CANONICAL_ZONES.length, 32);
  assert.equal(new Set(MILAN_CANONICAL_ZONES.map((zone) => zone.id)).size, 32);
});

test('source-specific neighborhood labels resolve to a common zone', () => {
  assert.equal(resolveMilanCanonicalZone('NoLo - Brianza - Pasteur')?.name, 'Pasteur - Rovereto');
  assert.equal(resolveMilanCanonicalZone('San Vittore - Washington')?.name, 'Solari - Washington');
  assert.equal(resolveMilanCanonicalZone('Portello - Tre Torri')?.name, 'Fiera - Sempione - CityLife - Portello');
  assert.equal(resolveMilanCanonicalZone('Corso San Gottardo')?.name, 'Navigli');
  assert.equal(resolveMilanCanonicalZone('Soderini')?.name, 'Napoli - Soderini');
});

test('normalization keeps source detail while exposing canonical area_label', () => {
  const normalized = normalizeSourceListing({
    id: 'imm-1',
    city: 'Milano',
    neighborhood: 'NoLo - Brianza - Pasteur',
    title: 'Appartamento da ristrutturare',
    price: 590000,
    size: 125,
  }, { source_channel: 'immobiliare', query_municipality: 'Milano' });

  assert.equal(normalized.area_label, 'Pasteur - Rovereto');
  assert.equal(normalized.canonical_zone_id, 'pasteur-rovereto');
  assert.equal(normalized.source_area_label, 'NoLo - Brianza - Pasteur');
  assert.equal(normalized.neighborhood, 'NoLo - Brianza - Pasteur');
  assert.equal(normalized.raw_listing.neighborhood, 'NoLo - Brianza - Pasteur');
});
