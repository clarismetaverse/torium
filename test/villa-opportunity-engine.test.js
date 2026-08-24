import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachDynamicVillaBenchmarks,
  getVillaPreTriageExclusion,
  runVillaOpportunityEngine,
} from '../lib/villa-opportunity-engine.js';

function villa(overrides = {}) {
  return {
    property_type: 'Villa', price_eur: 500000, price_by_area: 2000, size_mq: 250,
    rooms: 7, bathrooms: 3, has_plan: true, city: 'Como',
    listing: {
      propertyType: 'Villa', status: 'renew', size: 250, rooms: 7, bathrooms: 3, hasPlan: true,
      description: 'Villa da ristrutturare con giardino, piscina, garage e vista lago panoramica.',
      features: ['giardino privato', 'piscina', 'garage'], renovation_features: {},
    },
    ...overrides,
  };
}

test('renovation and tourism score the same villa with intent-specific signals', () => {
  const renovation = runVillaOpportunityEngine(villa(), 'renovation');
  const tourism = runVillaOpportunityEngine(villa(), 'tourism');
  assert.ok(renovation.score >= 70);
  assert.ok(tourism.score >= 70);
  assert.ok(renovation.signals.includes('needs_renovation'));
  assert.ok(tourism.signals.includes('pool_present'));
  assert.equal(getVillaPreTriageExclusion(villa(), 'renovation').excluded, false);
});

test('dynamic benchmark comes from current comparable asking prices', () => {
  const candidates = [{ ...villa(), door_score: 60, renovation_features: {} }];
  const comparables = [2500, 3000, 3500, 4000].map((price, index) => ({ price_by_area: price, city: index < 4 ? 'Como' : 'Lecco' }));
  const [scored] = attachDynamicVillaBenchmarks(candidates, comparables);
  const assessment = scored.renovation_features.villa_assessment;
  assert.equal(assessment.benchmark_eur_mq, 3250);
  assert.equal(assessment.comparable_count, 4);
  assert.equal(assessment.asking_discount_to_benchmark_pct, 38.5);
  assert.ok(scored.door_score > 60);
});
