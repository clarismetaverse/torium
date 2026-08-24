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

