import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVillaRunRequest } from '../api/run-villas.js';

test('villa run request is dynamic across supported area and intent presets', () => {
  const request = resolveVillaRunRequest({ area: 'toscana', intent: 'tourism', limit: 500 });
  assert.equal(request.geo.id, 'toscana');
  assert.equal(request.intent.id, 'tourism');
  assert.equal(request.limit, 500);
});

test('villa run limit is bounded and invalid values fail closed', () => {
  assert.equal(resolveVillaRunRequest({ limit: 99999 }).limit, 2000);
  assert.throws(() => resolveVillaRunRequest({ area: 'italia' }), /Area ville non valida/);
  assert.throws(() => resolveVillaRunRequest({ intent: 'flip' }), /Strategia ville non valida/);
});
