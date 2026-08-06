import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildDeterministicValuation, resolveMicrozoneProfile } from '../lib/deterministic-valuation.js';

const profileSet = JSON.parse(await fs.readFile(
  new URL('../config/valuation-profiles/milan-microzones-v1.json', import.meta.url),
  'utf8',
));

test('matches Gottardo from the source query even when the broad district is Navigli-Bocconi', () => {
  const profile = resolveMicrozoneProfile(profileSet, {
    query_area: 'corso-san-gottardo',
    district: 'Navigli - Bocconi',
  }, {});
  assert.equal(profile.id, 'corso-san-gottardo');
});

test('builds auditable low/base/high values by output unit without changing physical score', () => {
  const valuation = buildDeterministicValuation({
    profileSet,
    sourceRow: { query_area: 'corso-san-gottardo' },
    listing: { size: 225, hasPlan: true },
    doorEngine: { estimatedFinalUnits: 5, doorScore: 89 },
  });

  assert.equal(valuation.valuation_profile_version, 'milan_microzone_exit_v1_2026_06');
  assert.equal(valuation.final_unit_plan.length, 5);
  assert.equal(valuation.final_unit_plan[0].estimated_size_mq, 41.4);
  assert.equal(valuation.total_sale_value_low_eur, 1350000);
  assert.equal(valuation.total_sale_value_base_eur, 1500000);
  assert.equal(valuation.total_sale_value_high_eur, 1650000);
  assert.equal(valuation.valuation_assumptions.saleable_area_ratio, 0.92);
});

test('does not invent a valuation outside configured microzones', () => {
  assert.throws(() => resolveMicrozoneProfile(profileSet, { query_area: 'unknown-area' }, {}), /No deterministic valuation profile/);
});

test('does not invent fractioning ROI when the project creates no new unit', () => {
  const valuation = buildDeterministicValuation({
    profileSet,
    sourceRow: { query_area: 'corso-san-gottardo' },
    listing: { size: 85, hasPlan: false },
    doorEngine: { estimatedFinalUnits: 1, newUnitsCreated: 0, doorScore: 12 },
  });

  assert.equal(valuation.valuation_applicability, 'not_applicable_no_fractioning');
  assert.equal(valuation.total_sale_value_base_eur, null);
  assert.deepEqual(valuation.final_unit_plan, []);
  assert.equal(valuation.recommended_action, 'monitor');
});
