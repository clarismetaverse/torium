import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { comparePropertyIdentity } from '../lib/property-identity.js';
import {
  compareSourceOfferPrices,
  mergeUnifiedProperty,
  summarizePriceDifferences,
} from '../lib/source-offers.js';

function portalListing(source_channel, source_listing_id, price_eur, source_url) {
  const normalized_v1 = {
    source_channel,
    source_listing_id,
    canonical_url: source_url,
    address: { street: 'Via Mac Mahon', house_number: '43', formatted: 'Via Mac Mahon, 43' },
    location: { latitude: 45.4901, longitude: 9.1642 },
    asking_price: { status: 'known', amount_eur: price_eur, price_per_sqm_eur: Math.round(price_eur / 126) },
    surface: { value_sqm: 126 },
    floor: { raw: source_channel === 'idealista' ? 'en' : 'R', normalized: 'Piano rialzato' },
    rooms: 4,
    property_type: 'Appartamento',
  };
  return {
    source_channel,
    source_listing_id,
    source_url,
    price_eur,
    price_by_area: Math.round(price_eur / 126),
    size_mq: 126,
    floor: 'Piano rialzato',
    door_score: 74,
    normalized_v1,
    listing: { normalized_v1, price: price_eur, priceByArea: Math.round(price_eur / 126), size: 126 },
  };
}

test('strong physical identity remains mergeable when portal prices differ', () => {
  const idealista = portalListing('idealista', 'i-43', 520000, 'https://www.idealista.it/immobile/i-43/');
  const immobiliare = portalListing('immobiliare', 'm-43', 495000, 'https://www.immobiliare.it/annunci/m-43/');
  const identity = comparePropertyIdentity(idealista, immobiliare);
  assert.equal(identity.auto_merge_eligible, true);
  assert.equal(identity.signals.strong_physical_identity, true);
  assert.ok(identity.signals.price_delta_pct > 0);
});

test('unified property preserves both prices and links and underwrites conservatively', () => {
  const idealista = portalListing('idealista', 'i-43', 520000, 'https://www.idealista.it/immobile/i-43/');
  const immobiliare = portalListing('immobiliare', 'm-43', 495000, 'https://www.immobiliare.it/annunci/m-43/');
  const unified = mergeUnifiedProperty([idealista, immobiliare]);
  assert.equal(unified.source_offers.length, 2);
  assert.deepEqual(unified.source_offers.map((offer) => offer.asking_price_eur).sort(), [495000, 520000]);
  assert.deepEqual(unified.source_offers.map((offer) => offer.source_url).sort(), [
    'https://www.idealista.it/immobile/i-43/',
    'https://www.immobiliare.it/annunci/m-43/',
  ].sort());
  assert.equal(unified.price_comparison.has_price_difference, true);
  assert.equal(unified.price_comparison.price_difference_eur, 25000);
  assert.equal(unified.price_comparison.underwriting_reference_eur, 520000);
  assert.equal(unified.price_comparison.negotiation_target_eur, 495000);
  assert.equal(unified.price_eur, 520000);
});

test('run price summary counts comparable mismatches', () => {
  const offers = [
    portalListing('idealista', 'i-43', 520000, 'https://www.idealista.it/immobile/i-43/'),
    portalListing('immobiliare', 'm-43', 495000, 'https://www.immobiliare.it/annunci/m-43/'),
  ];
  const comparison = compareSourceOfferPrices(offers.map((listing) => ({
    source_channel: listing.source_channel,
    source_listing_id: listing.source_listing_id,
    source_url: listing.source_url,
    asking_price_eur: listing.price_eur,
    price_status: 'known',
  })));
  const summary = summarizePriceDifferences([{ price_comparison: comparison }]);
  assert.equal(summary.multi_source_property_count, 1);
  assert.equal(summary.different_price_property_count, 1);
  assert.equal(summary.different_price_share_pct, 100);
});

test('frontend exposes both portal offers and the run-level mismatch count', async () => {
  const [detail, home, outputApi] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/home.html', import.meta.url), 'utf8'),
    readFile(new URL('../api/output.js', import.meta.url), 'utf8'),
  ]);
  assert.match(detail, /Prezzi e annunci sui portali/);
  assert.match(detail, /source_offers/);
  assert.match(detail, /prezzo richiesto più alto/);
  assert.match(home, /Prezzi diversi tra portali/);
  assert.doesNotMatch(outputApi, /request\.query\.internal/);
});
