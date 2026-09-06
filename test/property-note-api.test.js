import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import handler, { normalizeNote, parseNoteTarget } from '../api/property-note.js';
import { isSameOrigin } from '../api/_auth.js';

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
  const site = { host: 'torium.example', 'x-forwarded-proto': 'https' };
  assert.equal(isSameOrigin({ headers: { ...site, origin: 'https://torium.example' } }), true);
  assert.equal(isSameOrigin({ headers: { ...site, origin: 'https://attacker.example' } }), false);
  // The scheme is part of the identity: an http origin is not the site.
  assert.equal(isSameOrigin({ headers: { ...site, origin: 'http://torium.example' } }), false);
  // Fails closed when the caller supplies no origin evidence at all.
  assert.equal(isSameOrigin({ headers: site }), false);
  assert.equal(isSameOrigin({ headers: { ...site, 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isSameOrigin({ headers: { ...site, origin: 'https://torium.example', 'sec-fetch-site': 'cross-site' } }), false);
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
  assert.match(propertyPage, /Note sull[’']operazione/);
  assert.match(propertyPage, /id="propertyNote"/);
  assert.match(propertyPage, /fetch\('\/api\/property-note'/);
  assert.match(propertyPage, /method:'POST'/);
  assert.doesNotMatch(propertyPage, /propertyNote[\s\S]{0,800}Authorization/);
});

test('combined views map notes back to the original Supabase property', () => {
  assert.match(propertyPage, /const originRun=arr\(r\?\.origin_run_ids\)\[0\],sourceIndex=Number\(r\?\.source_listing_index\)/);
  assert.match(propertyPage, /outputId\.startsWith\('combined:'\)/);
  assert.match(propertyPage, /runId:String\(originRun\),listingIndex:sourceIndex/);
});

test('property detail shares the persistent Italian and English switch', () => {
  assert.match(propertyPage, /localStorage\.getItem\('torium-language'\)/);
  assert.match(propertyPage, /id="detailLanguage"/);
  assert.match(propertyPage, /Passa all’italiano/);
  assert.match(propertyPage, /Switch to English/);
  const script = propertyPage.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
