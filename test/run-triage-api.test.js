import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { resolveRequestedLimit } from '../api/run-triage.js';
import { buildIdealistaQueries, resolveMassiveRunConfig } from '../pipelines/triage-multisource-massive.js';

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('run endpoint rejects non-POST requests', async () => {
  const response = responseRecorder();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 405);
});

test('run endpoint requires same-origin', async () => {
  const crossOrigin = responseRecorder();
  await handler({ method: 'POST', headers: { origin: 'https://attacker.example', host: 'torium.example' }, body: {} }, crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
});

test('serious run limit defaults to 600 and supports up to 5000', () => {
  assert.equal(resolveRequestedLimit(undefined), 600);
  assert.equal(resolveRequestedLimit(4000), 4000);
  assert.equal(resolveRequestedLimit(5000), 5000);
  assert.equal(resolveRequestedLimit(6000), 5000);
  assert.equal(resolveRequestedLimit('invalid'), 600);
});

test('multisource configuration can enforce an independent quota per portal', () => {
  const config = resolveMassiveRunConfig({
    runMode: 'serious',
    requestedAreas: ['Milano'],
    maxItemsPerQuery: 1000,
    maxItemsPerSource: 1000,
    maxTotalRawListings: 2000,
  }, {});
  assert.equal(config.maxItemsPerQuery, 1000);
  assert.equal(config.maxItemsPerSource, 1000);
  assert.equal(config.maxTotalRawListings, 2000);
});

test('Idealista scout targets the requested Milan location ID', () => {
  const [query] = buildIdealistaQueries(['corso-san-gottardo']);
  assert.equal(query.source_area_enforced, true);
  assert.equal(query.payload.location, '0-EU-IT-MI-01-001-135-05-004');
  assert.equal(query.query_area, 'corso-san-gottardo');
  assert.equal(query.payload.maxItems, 20);
});

test('serious Milan profile expands the sample without a neighborhood filter', () => {
  const config = resolveMassiveRunConfig({
    runMode: 'serious',
    requestedAreas: ['Milano'],
    maxItemsPerQuery: 600,
    maxTotalRawListings: 600,
    topPrescoreLimit: 600,
    minSize: 100,
    idealistaCondition: ['renew'],
  }, {});

  assert.deepEqual(config.requestedAreas, ['Milano']);
  assert.equal(config.maxItemsPerQuery, 600);
  assert.equal(config.maxTotalRawListings, 600);
  assert.equal(config.topPrescoreLimit, 600);
  assert.equal(config.minSize, 100);
  assert.deepEqual(config.idealistaCondition, ['renew']);
});
