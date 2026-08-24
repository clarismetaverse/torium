import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import renewalsHandler from '../api/renewals.js';
import {
  isRenewalAgentAuthorized,
  normalizePortalUrl,
  normalizeRenewalAsset,
  normalizeRenewalProject,
  normalizeRenewalStyle,
  normalizeRenewalUpload,
  RENEWAL_BUCKET,
} from '../lib/renewals.js';

const page = await fs.readFile(new URL('../public/renewals.html', import.meta.url), 'utf8');
const migration = await fs.readFile(new URL('../supabase/migrations/20260824170000_create_virtual_renewals.sql', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

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

test('renewal contract validates listing portals, styles, projects and mixed media', () => {
  assert.equal(normalizePortalUrl('https://www.idealista.it/immobile/123/', 'idealista'), 'https://www.idealista.it/immobile/123/');
  assert.equal(normalizePortalUrl('https://evil.example/immobile/123/', 'idealista'), null);
  assert.ok(normalizeRenewalStyle({ id: 'a1_quiet_luxury', name: 'Quiet Luxury' }).value);
  assert.ok(normalizeRenewalProject({ external_id: 'gallura-villa-001', status: 'published' }).value);
  assert.ok(normalizeRenewalAsset({
    asset_key: 'v1-original',
    asset_kind: 'original',
    source_url: 'https://img4.idealista.it/image.jpg',
    layout_type: 'original',
  }).value);
  assert.equal(normalizeRenewalAsset({ asset_key: 'bad', asset_kind: 'renewal' }).value.source_url, null);
});

test('signed upload request uses a private versioned path and rejects oversized assets', () => {
  const upload = normalizeRenewalUpload({
    external_id: 'gallura-villa-001',
    asset_key: 'v1-a1',
    asset_kind: 'renewal',
    mime_type: 'image/jpeg',
    size_bytes: 8_000_000,
  });
  assert.equal(upload.value.storage_path.startsWith('gallura-villa-001/v1-a1/'), true);
  assert.equal(upload.value.storage_path.endsWith('.jpg'), true);
  assert.match(normalizeRenewalUpload({
    external_id: 'gallura-villa-001',
    asset_key: 'v1-a1',
    mime_type: 'image/jpeg',
    size_bytes: 20_000_000,
  }).error, /size_bytes/);
});

test('agent write authorization uses a dedicated bearer secret', () => {
  const secret = 'renewal-agent-key-with-more-than-32-characters';
  assert.equal(isRenewalAgentAuthorized({ headers: { authorization: `Bearer ${secret}` } }, secret), true);
  assert.equal(isRenewalAgentAuthorized({ headers: { authorization: 'Bearer wrong' } }, secret), false);
});

test('renewal endpoint exposes only its supported methods before database access', async () => {
  const renewalResponse = responseRecorder();
  await renewalsHandler({ method: 'DELETE', headers: {}, query: {}, body: {} }, renewalResponse);
  assert.equal(renewalResponse.statusCode, 405);
  assert.equal(renewalResponse.headers.Allow, 'GET, POST, PATCH');
});

test('renewal schema is private, RLS protected, and models projects, styles and ordered assets', () => {
  assert.match(migration, /create table if not exists public\.renewal_styles/);
  assert.match(migration, /create table if not exists public\.virtual_renewals/);
  assert.match(migration, /source_listing_row_id bigint references public\.triage_source_listings/);
  assert.match(migration, /create table if not exists public\.virtual_renewal_assets/);
  assert.match(migration, /asset_kind in \('renewal', 'original', 'floor_plan', 'material', 'detail'\)/);
  assert.match(migration, /alter table public\.virtual_renewals enable row level security/);
  assert.match(migration, /revoke all on table public\.virtual_renewal_assets from anon, authenticated/);
  assert.match(migration, /'torium-renewals',[\s\S]*false,/);
  assert.equal(RENEWAL_BUCKET, 'torium-renewals');
});

test('independent renewal view renders DB-controlled mixed horizontal sequences', () => {
  assert.match(page, /TORIUM IMAGINE/);
  assert.match(page, /fetch\('\/api\/renewals'/);
  assert.match(page, /Stato attuale/);
  assert.match(page, /Planimetria/);
  assert.match(page, /class="rail"/);
  assert.match(page, /project\.assets/);
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('renewal APIs run in the Italian Vercel region', () => {
  assert.deepEqual(vercelConfig.functions['api/renewals.js'].regions, ['fra1']);
});
