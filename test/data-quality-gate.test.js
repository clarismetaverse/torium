import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDataQuality } from '../lib/data-quality-gate.js';

test('plausible listing passes even when optional evidence is missing', () => {
  const quality = evaluateDataQuality({
    address: 'Via Esempio 10, Milano',
    listing: { price: 459000, size: 126, priceByArea: 3643, bathrooms: 2 },
    door_engine: { estimatedFinalUnits: 3, newUnitsCreated: 2 },
  });
  assert.equal(quality.valid, true);
  assert.equal(quality.status, 'pass');
  assert.deepEqual(quality.critical_flags, []);
  assert.ok(quality.warning_flags.includes('missing_floor_plan'));
});

test('corrupted surface and bathroom counts are sent to review', () => {
  const quality = evaluateDataQuality({
    listing: { price: 7300000, size: 8500, priceByArea: 859, bathrooms: 82 },
    door_engine: { estimatedFinalUnits: 195, newUnitsCreated: 194 },
  });
  assert.equal(quality.valid, false);
  assert.ok(quality.critical_flags.includes('implausible_surface'));
  assert.ok(quality.critical_flags.includes('implausible_bathroom_count'));
});

test('price per sqm must agree with price divided by surface', () => {
  const quality = evaluateDataQuality({
    listing: { price: 500000, size: 100, priceByArea: 9000, bathrooms: 2, hasPlan: true },
  });
  assert.equal(quality.valid, false);
  assert.ok(quality.critical_flags.includes('price_per_sqm_inconsistent'));
});

test('impossible unit plans fail the quality gate', () => {
  const quality = evaluateDataQuality({
    listing: { price: 500000, size: 100, priceByArea: 5000, bathrooms: 2, hasPlan: true },
    door_engine: { estimatedFinalUnits: 5, newUnitsCreated: 7 },
  });
  assert.equal(quality.valid, false);
  assert.ok(quality.critical_flags.includes('impossible_final_unit_count'));
  assert.ok(quality.critical_flags.includes('impossible_new_unit_count'));
});

test('large but plausible duplex is warned rather than blocked', () => {
  const quality = evaluateDataQuality({
    address: 'Corso Esempio 1, Milano',
    listing: { price: 3000000, size: 700, priceByArea: 4286, bathrooms: 2, hasPlan: true },
    door_engine: { estimatedFinalUnits: 16, newUnitsCreated: 15 },
  });
  assert.equal(quality.valid, true);
  assert.ok(quality.warning_flags.includes('unusually_large_surface'));
});
