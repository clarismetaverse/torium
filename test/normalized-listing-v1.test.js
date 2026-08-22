import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  NORMALIZED_LISTING_SCHEMA_VERSION,
  normalizeIdealistaListingV1,
  normalizeImmobiliareListingV1,
  normalizeListingV1,
} from '../lib/normalized-listing-v1.js';

async function fixture(name) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

test('Immobiliare structured adapter maps identity, topology, location and media', async () => {
  const raw = await fixture('immobiliare-structured-known.json');
  const result = normalizeImmobiliareListingV1(raw, { query_municipality: 'Milano' });

  assert.equal(result.schema_version, NORMALIZED_LISTING_SCHEMA_VERSION);
  assert.equal(result.adapter_schema.valid, true);
  assert.equal(result.adapter_version, 'immobiliare_structured_v1');
  assert.equal(result.source_observation_key, 'immobiliare:id:123456789');
  assert.equal(result.canonical_url, 'https://www.immobiliare.it/annunci/123456789/');
  assert.equal(result.display_title, 'Appartamento in Piazzale Esempio, 4');
  assert.deepEqual(result.address, {
    street: 'Piazzale Esempio',
    house_number: '4',
    formatted: 'Piazzale Esempio, 4',
  });
  assert.equal(result.location.canonical_zone_id, 'cenisio-sarpi-isola');
  assert.equal(result.location.latitude, 45.4889);
  assert.equal(result.location.longitude, 9.1913);
  assert.equal(result.location.precision, 'exact');
  assert.equal(result.asking_price.status, 'known');
  assert.equal(result.asking_price.amount_eur, 880000);
  assert.equal(result.surface.value_sqm, 160);
  assert.equal(result.rooms, 5);
  assert.equal(result.bathrooms, 2);
  assert.equal(result.media.images.length, 1);
  assert.equal(result.media.floor_plans.length, 1);
  assert.equal(result.media.has_floor_plan, true);
  assert.equal(result.quality.status, 'pass');
});

test('Immobiliare on-request price remains null and blocks valuation', async () => {
  const raw = await fixture('immobiliare-structured-on-request.json');
  const result = normalizeListingV1(raw, { source_channel: 'immobiliare' });

  assert.equal(result.asking_price.status, 'on_request');
  assert.equal(result.asking_price.amount_eur, null);
  assert.equal(result.asking_price.price_per_sqm_eur, null);
  assert.equal(result.rooms, 5);
  assert.equal(result.quality.status, 'blocked');
  assert.ok(result.quality.blocking_reasons.includes('asking_price_on_request'));
  assert.equal(result.adapter_schema.valid, true);
});

test('Idealista adapter preserves decimal coordinates and separates plans', async () => {
  const raw = await fixture('idealista-structured.json');
  const result = normalizeIdealistaListingV1(raw, { query_municipality: 'Milano' });

  assert.equal(result.source_observation_key, 'idealista:id:35738713');
  assert.equal(result.canonical_url, 'https://www.idealista.it/immobile/35738713/');
  assert.equal(result.location.latitude, 45.4190032);
  assert.equal(result.location.longitude, 9.1943232);
  assert.equal(result.location.canonical_zone_id, 'abbiategrasso-chiesa-rossa');
  assert.equal(result.asking_price.status, 'known');
  assert.equal(result.asking_price.amount_eur, 182000);
  assert.equal(result.media.images.length, 1);
  assert.equal(result.media.floor_plans.length, 1);
  assert.equal(result.media.has_floor_plan, true);
  assert.deepEqual(result.features.sort(), ['hasBoxRoom', 'hasGarden']);
  assert.equal(result.adapter_schema.valid, true);
});

test('Idealista adapter extracts the street from portal-style address titles', async () => {
  const raw = await fixture('idealista-structured.json');
  const result = normalizeIdealistaListingV1({
    ...raw,
    address: 'Quadrilocale in Via Mac Mahon, 43, Cenisio, Milano',
  });
  assert.deepEqual(result.address, { street: 'Via Mac Mahon', house_number: '43', formatted: 'Via Mac Mahon, 43' });
});

test('structured adapter reports schema drift instead of guessing nested values', () => {
  const result = normalizeImmobiliareListingV1({ id: 123, title: 'Appartamento', price: 500000 });
  assert.equal(result.adapter_schema.valid, false);
  assert.deepEqual(result.adapter_schema.issues.sort(), ['analytics', 'geography', 'media', 'price', 'topology'].sort());
  assert.ok(result.quality.blocking_reasons.includes('adapter_schema:topology'));
});

test('source URL allowlist rejects cross-source and insecure URLs', async () => {
  const raw = await fixture('idealista-structured.json');
  assert.equal(normalizeIdealistaListingV1({ ...raw, url: 'http://www.idealista.it/immobile/1/' }).canonical_url, null);
  assert.equal(normalizeIdealistaListingV1({ ...raw, url: 'https://example.com/immobile/1/' }).canonical_url, null);
});

