import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePropertyIdentity } from '../lib/property-identity.js';

function listing(overrides = {}) {
  return {
    source_channel: 'idealista',
    source_listing_id: 'i-1',
    address: { street: 'Via Mac Mahon', house_number: '43', formatted: 'Via Mac Mahon, 43' },
    location: { latitude: 45.4901, longitude: 9.1642 },
    asking_price: { status: 'known', amount_eur: 459000 },
    surface: { value_sqm: 126 },
    floor: { raw: 'en', normalized: 'Ammezzato' },
    property_type: 'Appartamento',
    ...overrides,
  };
}

test('same source listing ID is an exact identity match', () => {
  const result = comparePropertyIdentity(listing(), listing());
  assert.equal(result.classification, 'exact_source_identity');
  assert.equal(result.confidence, 1);
});

test('cross-source matching accepts portal floor aliases with otherwise exact evidence', () => {
  const other = listing({
    source_channel: 'immobiliare',
    source_listing_id: '130962354',
    location: { latitude: 45.49011, longitude: 9.16421 },
    floor: { raw: 'R', normalized: 'Piano rialzato' },
  });
  const result = comparePropertyIdentity(listing(), other);
  assert.equal(result.classification, 'probable_cross_source_match');
  assert.equal(result.auto_merge_eligible, true);
  assert.equal(result.signals.floor_compatible, true);
});

test('same building and surface do not merge when floors identify different apartments', () => {
  const floorFive = listing({
    source_listing_id: 'i-floor-5',
    address: { street: 'Via Emilio Cornalia', house_number: '19' },
    floor: { raw: '5' },
    asking_price: { status: 'known', amount_eur: 850000 },
    surface: { value_sqm: 120 },
  });
  const floorFour = listing({
    source_channel: 'immobiliare',
    source_listing_id: 'm-floor-4',
    address: { street: 'Via Emilio Cornalia', house_number: '19' },
    floor: { raw: '4' },
    asking_price: { status: 'known', amount_eur: 795000 },
    surface: { value_sqm: 120 },
  });
  const result = comparePropertyIdentity(floorFive, floorFour);
  assert.equal(result.classification, 'distinct');
  assert.ok(result.blockers.includes('different_floor'));
});

test('missing exact address remains uncertain even with strong physical similarity', () => {
  const withoutAddress = listing({
    source_channel: 'immobiliare',
    source_listing_id: 'm-no-address',
    address: { street: null, house_number: null },
    location: { latitude: 45.49011, longitude: 9.16421 },
    floor: { raw: 'R' },
  });
  const result = comparePropertyIdentity(listing(), withoutAddress);
  assert.equal(result.classification, 'uncertain_cross_source_match');
  assert.equal(result.auto_merge_eligible, false);
});

test('different civic numbers block a merge despite nearby coordinates', () => {
  const other = listing({
    source_channel: 'immobiliare',
    source_listing_id: 'm-other-civic',
    address: { street: 'Via Mac Mahon', house_number: '45' },
    location: { latitude: 45.49011, longitude: 9.16421 },
    floor: { raw: 'R' },
  });
  const result = comparePropertyIdentity(listing(), other);
  assert.equal(result.classification, 'distinct');
  assert.ok(result.blockers.includes('different_house_number'));
});

// The asking price is the product's output, not an input to identity. These
// tests pin that down: the same pair must be classified identically whatever
// the two portals are asking, because a cross-portal spread is precisely the
// thing TORIUM exists to surface.
function withPrice(base, amount) {
  return { ...base, asking_price: { status: 'known', amount_eur: amount } };
}

test('a cross-portal pair is classified the same whatever the two prices are', () => {
  const left = listing();
  const right = listing({
    source_channel: 'immobiliare',
    source_listing_id: '130962354',
    location: { latitude: 45.49011, longitude: 9.16421 },
    floor: { raw: 'R', normalized: 'Piano rialzato' },
  });

  const agreeing = comparePropertyIdentity(withPrice(left, 459000), withPrice(right, 459000));
  const diverging = comparePropertyIdentity(withPrice(left, 459000), withPrice(right, 389000));
  const unpriced = comparePropertyIdentity(
    { ...left, asking_price: { status: 'unknown', amount_eur: null } },
    { ...right, asking_price: { status: 'unknown', amount_eur: null } },
  );

  assert.equal(agreeing.classification, 'probable_cross_source_match');
  assert.equal(diverging.classification, 'probable_cross_source_match');
  assert.equal(unpriced.classification, 'probable_cross_source_match');
  assert.equal(diverging.confidence, agreeing.confidence);
  assert.equal(unpriced.confidence, agreeing.confidence);
});

test('the price spread is still measured and reported on a merged pair', () => {
  const result = comparePropertyIdentity(
    withPrice(listing(), 459000),
    withPrice(listing({
      source_channel: 'immobiliare',
      source_listing_id: '130962354',
      location: { latitude: 45.49011, longitude: 9.16421 },
      floor: { raw: 'R' },
    }), 389000),
  );
  assert.equal(result.auto_merge_eligible, true);
  assert.ok(result.signals.price_delta_pct > 0);
  assert.equal(result.signals.price_influenced_score, false);
});

test('agreeing prices cannot rescue a pair with weak physical evidence', () => {
  const vague = {
    source_channel: 'immobiliare',
    source_listing_id: 'm-vague',
    address: { street: null, house_number: null },
    location: { latitude: 45.4909, longitude: 9.1648 },
    surface: { value_sqm: 118 },
    floor: { raw: null },
    property_type: 'Appartamento',
  };
  const identicalPrice = comparePropertyIdentity(withPrice(listing(), 459000), withPrice(vague, 459000));
  const differentPrice = comparePropertyIdentity(withPrice(listing(), 459000), withPrice(vague, 610000));
  assert.equal(identicalPrice.auto_merge_eligible, false);
  assert.equal(identicalPrice.classification, differentPrice.classification);
  assert.equal(identicalPrice.confidence, differentPrice.confidence);
});

test('two listings on the same portal never merge automatically', () => {
  // Same address, same floor, same surface, same portal: far more likely two
  // units in one building than one unit listed twice.
  const first = listing({ source_listing_id: 'i-unit-a' });
  const second = listing({ source_listing_id: null, location: { latitude: 45.49011, longitude: 9.16421 } });
  const result = comparePropertyIdentity(first, second);
  assert.equal(result.auto_merge_eligible, false);
  assert.notEqual(result.classification, 'probable_cross_source_match');
});

// Production listings carry the address as one free-text line, in whatever
// shape the portal publishes. These cases are taken from the run of
// 22 August 2026.
function portalListing(channel, id, address, overrides = {}) {
  return {
    source_channel: channel,
    source_listing_id: id,
    address,
    price_eur: 620000,
    size_mq: 102,
    floor: '3° piano',
    latitude: 45.4901,
    longitude: 9.1642,
    ...overrides,
  };
}

test('the same address written in two portal styles identifies one apartment', () => {
  const result = comparePropertyIdentity(
    portalListing('idealista', 'i-leghe', 'Viale Monza, 17'),
    portalListing('immobiliare', 'm-leghe', 'Viale Monza, 17, 20125 Milano MI, Italia', {
      price_eur: 580000,
      latitude: 45.49014,
      longitude: 9.16425,
    }),
  );
  assert.equal(result.signals.street_match, true);
  assert.equal(result.signals.civic_match, true);
  assert.equal(result.auto_merge_eligible, true);
});

test('a civic number in the address line separates neighbours on one street', () => {
  const result = comparePropertyIdentity(
    portalListing('idealista', 'i-38', 'Via Domenichino 38'),
    portalListing('immobiliare', 'm-44', 'Via Domenichino, 44'),
  );
  assert.equal(result.signals.street_match, true);
  assert.equal(result.signals.civic_match, false);
  assert.ok(result.blockers.includes('different_house_number'));
});

test('a number inside a street name is not read as a civic number', () => {
  const result = comparePropertyIdentity(
    portalListing('idealista', 'i-xxv', 'Viale 20 Settembre'),
    portalListing('immobiliare', 'm-xxv', 'Viale 20 Settembre'),
  );
  assert.equal(result.signals.street_match, true);
  assert.equal(result.signals.civic_match, false);
});

test('a floor only one portal states leaves the pair uncertain', () => {
  // At a single civic number the floor is what distinguishes one apartment
  // from the one above it, so an unstated floor is not evidence of sameness.
  const result = comparePropertyIdentity(
    portalListing('idealista', 'i-sempione', 'Corso Sempione, 23', { floor: null }),
    portalListing('immobiliare', 'm-sempione', 'Corso Sempione, 23'),
  );
  assert.equal(result.auto_merge_eligible, false);
  assert.equal(result.classification, 'uncertain_cross_source_match');
});
