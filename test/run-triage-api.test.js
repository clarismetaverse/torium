import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/run-triage.js';
import { buildIdealistaQueries } from '../pipelines/triage-multisource-massive.js';

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

test('Idealista scout targets the requested Milan location ID', () => {
  const [query] = buildIdealistaQueries(['corso-san-gottardo']);
  assert.equal(query.source_area_enforced, true);
  assert.equal(query.payload.location, '0-EU-IT-MI-01-001-135-05-004');
  assert.equal(query.query_area, 'corso-san-gottardo');
  assert.equal(query.payload.maxItems, 20);
});
