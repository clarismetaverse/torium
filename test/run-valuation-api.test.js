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

test('valuation endpoint requires same-origin and a valid PIN', async () => {
  const previousPin = process.env.TORIUM_RUN_PIN;
  process.env.TORIUM_RUN_PIN = 'test-pin';
  try {
    const crossOrigin = responseRecorder();
    await handler({ method: 'POST', headers: { origin: 'https://attacker.example', host: 'torium.example' }, body: {} }, crossOrigin);
    assert.equal(crossOrigin.statusCode, 403);
    const wrongPin = responseRecorder();
    await handler({ method: 'POST', headers: { host: 'torium.example', authorization: 'Bearer wrong' }, body: {} }, wrongPin);
    assert.equal(wrongPin.statusCode, 401);
  } finally {
    if (previousPin === undefined) delete process.env.TORIUM_RUN_PIN;
    else process.env.TORIUM_RUN_PIN = previousPin;
  }
});

test('frontend valuation endpoint permits deterministic mode only', async () => {
  const previousPin = process.env.TORIUM_RUN_PIN;
  process.env.TORIUM_RUN_PIN = 'test-pin';
  try {
    const response = responseRecorder();
    await handler({
      method: 'POST',
      headers: { host: 'torium.example', authorization: 'Bearer test-pin' },
      body: { run_id: 'valid-run', mode: 'ai' },
    }, response);
    assert.equal(response.statusCode, 400);
  } finally {
    if (previousPin === undefined) delete process.env.TORIUM_RUN_PIN;
    else process.env.TORIUM_RUN_PIN = previousPin;
  }
});
