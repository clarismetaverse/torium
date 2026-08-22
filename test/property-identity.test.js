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


