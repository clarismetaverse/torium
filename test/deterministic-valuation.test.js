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
    doorEngine: {
      estimatedFinalUnits: 5,
      doorScore: 89,
      planningVersion: 'max_doors_residual_studio_v2',
      plannedUnitMix: Array.from({ length: 5 }, () => ({
        unit_type: 'bilocale',
        estimated_size_mq: 41.4,
      })),
    },
  });

  assert.equal(valuation.valuation_profile_version, 'milan_city_exit_v3_provisional_2026_07');
  assert.equal(valuation.final_unit_plan.length, 5);
  assert.equal(valuation.final_unit_plan[0].estimated_size_mq, 41.4);
  assert.equal(valuation.total_sale_value_low_eur, 1350000);
  assert.equal(valuation.total_sale_value_base_eur, 1500000);
  assert.equal(valuation.total_sale_value_high_eur, 1650000);
  assert.equal(valuation.valuation_assumptions.saleable_area_ratio, 0.92);
  assert.equal(valuation.valuation_assumptions.unit_mix_planning_version, 'max_doors_residual_studio_v2');
});

test('values a residual monolocale separately from the 40 sqm bilocali', () => {
  const valuation = buildDeterministicValuation({
    profileSet,
    sourceRow: { query_area: 'corso-san-gottardo' },
    listing: { size: 120, hasPlan: true },
    doorEngine: {
      estimatedFinalUnits: 3,
      newUnitsCreated: 2,
      planningVersion: 'max_doors_residual_studio_v2',
      residualStudioIncluded: true,
      plannedUnitMix: [
        { unit_type: 'bilocale', estimated_size_mq: 40 },
        { unit_type: 'bilocale', estimated_size_mq: 40 },
        { unit_type: 'monolocale', estimated_size_mq: 30.4 },
      ],
    },
  });

  assert.deepEqual(valuation.final_unit_plan.map((unit) => unit.unit_type), ['bilocale', 'bilocale', 'monolocale']);
  assert.deepEqual(valuation.final_unit_plan.map((unit) => unit.estimated_size_mq), [40, 40, 30.4]);
  assert.equal(valuation.total_sale_value_base_eur, 800000);
  assert.ok(valuation.red_flags.some((flag) => flag.includes('28 sqm')));
});

test('does not invent a valuation outside configured microzones', () => {
  assert.throws(() => resolveMicrozoneProfile(profileSet, { query_area: 'unknown-area' }, {}), /No deterministic valuation profile/);
});

test('resolves every provisional Milan macrozone benchmark', () => {
  const cityProfiles = profileSet.microzones.filter((profile) => !['corso-san-gottardo', 'milano-citywide-fallback'].includes(profile.id));
  assert.equal(cityProfiles.length, 18);
  for (const profile of cityProfiles) {
    const resolved = resolveMicrozoneProfile(profileSet, { area_label: profile.name }, {});
    assert.equal(resolved.id, profile.id);
    assert.ok(resolved.base_exit_eur_mq > 3000);
    assert.ok(resolved.market_sentiment?.label);
  }
});

test('uses a low-confidence Milan fallback only when no macrozone matches', () => {
  const valuation = buildDeterministicValuation({
    profileSet,
    sourceRow: { query_area: 'Milano', area_label: 'Etichetta futura non mappata' },
    listing: { size: 120, hasPlan: false },
    doorEngine: { estimatedFinalUnits: 3, newUnitsCreated: 2 },
  });
  assert.equal(valuation.valuation_microzone_id, 'milano-citywide-fallback');
  assert.equal(valuation.valuation_confidence, 'low');
  assert.ok(valuation.red_flags.some((flag) => flag.includes('fallback')));
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
