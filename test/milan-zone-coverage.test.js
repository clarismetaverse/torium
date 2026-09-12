import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MILAN_CANONICAL_ZONES, resolveMilanCanonicalZone } from '../lib/milan-area-taxonomy.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/milan-production-neighborhoods.json', import.meta.url),
  'utf8',
));

test('every neighbourhood label seen in production resolves to a canonical zone', () => {
  // Investor alerts filter by canonical zone. A label that stops resolving does
  // not raise an error - it silently drops those properties out of every zone
  // filter, so the coverage is asserted rather than assumed.
  const unresolved = fixture.labels.filter((label) => !resolveMilanCanonicalZone(label));
  assert.deepEqual(unresolved, [], 'unresolved labels would be invisible to zone filters');
});

test('the production label set is broad enough to be a meaningful guard', () => {
  assert.ok(fixture.labels.length >= 150, 'fixture should cover the observed corpus');
  const zonesHit = new Set(fixture.labels.map((label) => resolveMilanCanonicalZone(label).id));
  // If a large share of zones were never exercised the guard would be weak.
  assert.ok(
    zonesHit.size >= MILAN_CANONICAL_ZONES.length * 0.75,
    `only ${zonesHit.size} of ${MILAN_CANONICAL_ZONES.length} zones are exercised`,
  );
});

test('canonical zone ids are unique and stable in shape', () => {
  const ids = MILAN_CANONICAL_ZONES.map((zone) => zone.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate zone id');
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id + ' is not a stable slug');
});

test('no alias is claimed by two different zones', () => {
  // A duplicated alias would make resolution depend on declaration order, and
  // an investor would silently get another zone's properties.
  const owners = new Map();
  const collisions = [];
  for (const zone of MILAN_CANONICAL_ZONES) {
    for (const alias of zone.aliases) {
      const key = alias.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (owners.has(key) && owners.get(key) !== zone.id) {
        collisions.push(`${alias}: ${owners.get(key)} vs ${zone.id}`);
      }
      owners.set(key, zone.id);
    }
  }
  assert.deepEqual(collisions, []);
});
