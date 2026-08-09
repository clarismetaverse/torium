import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import handler, { isSameOrigin, normalizeNote, parseNoteTarget } from '../api/property-note.js';

const propertyPage = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');

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

test('property note target accepts a Supabase run and listing index', () => {
  assert.deepEqual(parseNoteTarget({ run_id: 'supabase:run-123', listing_index: 61 }), {
    runId: 'run-123',
    listingIndex: 61,
  });
  assert.match(parseNoteTarget({ run_id: '../bad', listing_index: 1 }).error, /run_id/);
  assert.match(parseNoteTarget({ run_id: 'run-123', listing_index: -1 }).error, /listing_index/);
});

test('property note text is normalized and length-limited', () => {
  assert.deepEqual(normalizeNote('  prima riga\r\nseconda riga  '), { note: 'prima riga\nseconda riga' });
  assert.match(normalizeNote('x'.repeat(4001)).error, /4000/);
  assert.match(normalizeNote(null).error, /testo/);
});

test('property note writes require an explicit same-origin request', () => {
  assert.equal(isSameOrigin({ headers: { origin: 'https://torium.example', host: 'torium.example' } }), true);
  assert.equal(isSameOrigin({ headers: { origin: 'https://attacker.example', host: 'torium.example' } }), false);
  assert.equal(isSameOrigin({ headers: { host: 'torium.example' } }), false);
});

test('property note endpoint rejects unsupported methods before database access', async () => {
  const response = responseRecorder();
  await handler({ method: 'DELETE', headers: {}, query: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET, POST');
});

test('property note endpoint validates target before database access', async () => {
  const response = responseRecorder();
  await handler({ method: 'GET', headers: {}, query: { run_id: 'bad/run', listing_index: 1 } }, response);
  assert.equal(response.statusCode, 400);
});

test('property page exposes an unauthenticated Supabase-backed note editor', () => {
  assert.match(propertyPage, /Note sull'operazione/);
  assert.match(propertyPage, /id="propertyNote"/);
  assert.match(propertyPage, /fetch\('\/api\/property-note'/);
  assert.match(propertyPage, /method:'POST'/);
  assert.doesNotMatch(propertyPage, /propertyNote[\s\S]{0,800}Authorization/);
});
