import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/run-valuation.js';

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

test('valuation endpoint rejects non-POST requests', async () => {
  const response = responseRecorder();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 405);
});

test('valuation endpoint requires same-origin', async () => {
  const crossOrigin = responseRecorder();
  await handler({ method: 'POST', headers: { origin: 'https://attacker.example', host: 'torium.example' }, body: {} }, crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
});

test('frontend valuation endpoint permits deterministic mode only', async () => {
  const response = responseRecorder();
  await handler({
    method: 'POST',
    headers: { host: 'torium.example' },
    body: { run_id: 'valid-run', mode: 'ai' },
  }, response);
  assert.equal(response.statusCode, 401);
});
