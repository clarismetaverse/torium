import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { planFinalUnitMix } from '../lib/unit-mix-planner.js';

const investorProfile = JSON.parse(await fs.readFile(
  new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url),
  'utf8',
));

test('keeps a sellable residual as one monolocale', () => {
  const plan = planFinalUnitMix(120, investorProfile);

  assert.equal(plan.saleableAreaMq, 110.4);
  assert.equal(plan.residualStudioIncluded, true);
  assert.deepEqual(plan.plannedUnitMix, [
    { unit_type: 'bilocale', estimated_size_mq: 40, planning_role: 'primary_unit' },
    { unit_type: 'bilocale', estimated_size_mq: 40, planning_role: 'primary_unit' },
    { unit_type: 'monolocale', estimated_size_mq: 30.4, planning_role: 'residual_unit' },
  ]);
});

test('redistributes a residual below 28 sqm across the bilocali', () => {
  const plan = planFinalUnitMix(225, investorProfile);

  assert.equal(plan.saleableAreaMq, 207);
  assert.equal(plan.residualStudioIncluded, false);
  assert.equal(plan.plannedUnitMix.length, 5);
  assert.deepEqual(plan.plannedUnitMix.map((unit) => unit.estimated_size_mq), [41.4, 41.4, 41.4, 41.4, 41.4]);
});

test('does not claim a split below one bilocale plus one conservative studio', () => {
  const plan = planFinalUnitMix(70, investorProfile);

  assert.equal(plan.saleableAreaMq, 64.4);
  assert.equal(plan.residualStudioIncluded, false);
  assert.deepEqual(plan.plannedUnitMix, [
    { unit_type: 'existing_unit', estimated_size_mq: 64.4, planning_role: 'not_fractioned' },
  ]);
});
