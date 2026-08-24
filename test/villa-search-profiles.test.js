import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVillaSourceQueries,
  resolveVillaGeoProfile,
  resolveVillaIntent,
} from '../lib/villa-search-profiles.js';

test('Como villa queries use the same radius and native villa filters on both actors', () => {
  const { queries } = buildVillaSourceQueries({
    area: 'como', intent: 'renovation', maxItemsPerSource: 200,
    idealistaActorId: 'idealista', immobiliareActorId: 'immobiliare',
  });
  assert.equal(queries.length, 4);
  const idealista = queries.find((query) => query.source_channel === 'idealista' && query.comparison_role === 'candidate');
  const immobiliare = queries.find((query) => query.source_channel === 'immobiliare' && query.comparison_role === 'candidate');
  assert.deepEqual(idealista.payload.homeType, ['villa', 'detachedHouse', 'semiDetachedHouse', 'countryHouse']);
  assert.deepEqual(idealista.payload.condition, ['renew']);
  assert.deepEqual(idealista.payload.propertyStatus, ['free']);
  assert.equal(immobiliare.payload.propertyType, 'house');
  assert.equal(immobiliare.payload.propertyCondition, 'toBeRenovated');
  assert.equal(idealista.payload.latitude, immobiliare.payload.latitude);
  assert.equal(idealista.payload.distanceKm, 35);
});

test('Tuscany is a reusable tiled geography with region validation', () => {
  const { queries } = buildVillaSourceQueries({
    area: 'toscana', intent: 'tourism', maxItemsPerSource: 400,
    idealistaActorId: 'idealista', immobiliareActorId: 'immobiliare',
  });
  assert.equal(queries.length, 16);
  assert.ok(queries.every((query) => query.region_filter === 'Toscana'));
  assert.ok(queries.filter((query) => query.comparison_role === 'candidate').every((query) => query.payload.maxItems === 100));
  assert.equal(resolveVillaGeoProfile('toscana').city, 'Toscana');
  assert.equal(resolveVillaIntent('tourism').id, 'tourism');
});

test('Sardinia renovation broadens candidates without increasing the source budget', () => {
  const { geo, queries } = buildVillaSourceQueries({
    area: 'sardegna', intent: 'renovation', maxItemsPerSource: 400,
    idealistaActorId: 'idealista', immobiliareActorId: 'immobiliare',
  });
  assert.equal(geo.id, 'sardegna');
  assert.equal(queries.length, 20);
  assert.ok(queries.every((query) => query.region_filter === 'Sardegna'));
  const idealistaCandidates = queries.filter((query) => query.comparison_role === 'candidate' && query.source_channel === 'idealista');
  const immobiliareCandidates = queries.filter((query) => query.comparison_role === 'candidate' && query.source_channel === 'immobiliare');
  assert.equal(idealistaCandidates.length, 4);
  assert.ok(idealistaCandidates.every((query) => query.payload.maxItems === 100));
  assert.ok(idealistaCandidates.every((query) => query.payload.condition.includes('renew') && query.payload.condition.includes('good')));
  assert.equal(immobiliareCandidates.length, 8);
  assert.ok(immobiliareCandidates.every((query) => query.payload.maxItems === 50));
  assert.deepEqual([...new Set(immobiliareCandidates.map((query) => query.payload.propertyCondition))].sort(), ['good', 'toBeRenovated']);
  assert.equal(immobiliareCandidates.reduce((sum, query) => sum + query.payload.maxItems, 0), 400);
  assert.ok(queries.every((query) => query.payload.distanceKm <= 68));
});

test('Sardinia broadening does not change strict renovation searches elsewhere', () => {
  const { queries } = buildVillaSourceQueries({
    area: 'toscana', intent: 'renovation', maxItemsPerSource: 400,
    idealistaActorId: 'idealista', immobiliareActorId: 'immobiliare',
  });
  const candidates = queries.filter((query) => query.comparison_role === 'candidate');
  assert.ok(candidates.filter((query) => query.source_channel === 'idealista').every((query) => query.payload.condition.length === 1 && query.payload.condition[0] === 'renew'));
  assert.ok(candidates.filter((query) => query.source_channel === 'immobiliare').every((query) => query.payload.propertyCondition === 'toBeRenovated'));
});
