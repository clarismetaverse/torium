import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImmobiliareQueries,
  dedupeListings,
  enrichWithPreScore,
  sourceAreaMatches,
} from '../pipelines/triage-multisource-massive.js';
import { listingMatchesAnyArea, normalizeSourceListing } from '../lib/source-normalizers.js';
import { resolveSearchStrategy } from '../lib/search-strategies.js';
import { dedupeValuationCandidates } from '../lib/valuation-runner.js';
import { readFile } from 'node:fs/promises';

test('neutral Immobiliare query uses the structured actor schema without price ordering', () => {
  const [query] = buildImmobiliareQueries(['Milano'], resolveSearchStrategy('neutral_fractionability'));
  assert.equal(query.actor, 'immobiliare-structured');
  assert.equal(query.actor_id, 'igolaizola~immobiliare-it-scraper');
  assert.equal(query.payload.sortType, 'mostRecent');
  assert.equal(query.payload.propertyCondition, 'toBeRenovated');
  assert.deepEqual(query.payload.locations, ['Milano']);
  assert.equal(query.payload.area, undefined);
});

test('area matching treats URL slugs and readable neighborhood names as equivalent', () => {
  assert.equal(listingMatchesAnyArea({ neighborhood: 'Corso San Gottardo', city: 'Milano' }, ['corso-san-gottardo']), true);
});

test('Immobiliare location validation does not trust an inferred city without source evidence', () => {
  const missingEvidence = normalizeSourceListing({ title: 'Grande appartamento', price: 500000, size: 130 }, {
    source_channel: 'immobiliare',
    query_municipality: 'Milano',
  });
  assert.equal(missingEvidence.location_is_inferred, true);
  assert.equal(sourceAreaMatches(missingEvidence, missingEvidence.raw_listing, 'Milano'), false);

  const withEvidence = normalizeSourceListing({ title: 'Grande appartamento a Milano', price: 500000, size: 130 }, {
    source_channel: 'immobiliare',
    query_municipality: 'Milano',
  });
  assert.equal(sourceAreaMatches(withEvidence, withEvidence.raw_listing, 'Milano'), true);
});

test('cross-source dedupe merges the same address, price, size and floor', () => {
  const base = { address: 'Via Roma, 10', price_eur: 500000, size_mq: 120, floor: '2', door_score: 70 };
  const deduped = dedupeListings([
    { ...base, source_channel: 'idealista', source_key: 'i-1' },
    { ...base, source_channel: 'immobiliare', source_key: 'm-1', door_score: 75 },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].source_channel, 'immobiliare');
  assert.deepEqual(deduped[0].origin_source_channels.sort(), ['idealista', 'immobiliare']);
  assert.deepEqual(deduped[0].origin_source_urls, []);
});

test('valuation consumes one candidate per canonical property', () => {
  const candidates = dedupeValuationCandidates([
    { id: 1, canonical_source_key: 'property:via roma 10:500000:120:2' },
    { id: 2, canonical_source_key: 'property:via roma 10:500000:120:2' },
    { id: 3, canonical_source_key: 'property:via verdi 5:450000:110:1' },
  ]);
  assert.deepEqual(candidates.map((item) => item.id), [1, 3]);
});

test('pipeline quality gate excludes on-request prices before valuation', async () => {
  const profile = JSON.parse(await readFile(new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url), 'utf8'));
  const normalized = normalizeSourceListing({
    id: 123456790,
    title: 'Appartamento',
    price: { raw: null, value: 'Prezzo su richiesta', isHidden: true },
    topology: { surface: { size: 140 }, rooms: '4', bathrooms: '2', typology: { name: 'Appartamento' } },
    geography: { municipality: { name: 'Milano' }, microzone: { name: 'Isola' }, street: 'Via Esempio, 10' },
    analytics: { propertyStatus: 'Da ristrutturare', microzone: 'Isola' },
    media: { images: [], floorPlans: [] },
  }, { source_channel: 'immobiliare' });
  const enriched = enrichWithPreScore(normalized, profile);

  assert.equal(enriched.price_eur, null);
  assert.equal(enriched.data_quality.valid, false);
  assert.equal(enriched.pre_triage_excluded, true);
  assert.match(enriched.pre_triage_exclusion_reason, /data_quality:missing_or_invalid_price/);
});
