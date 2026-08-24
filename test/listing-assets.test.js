import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import assetHandler, { resolveSupabaseStorageUrl } from '../api/listing-asset.js';
import { compactDashboardOutput, redactOutput } from '../api/output.js';
import {
  extractSourceListingAssets,
  listingAssetExtension,
  normalizeListingAssetUrl,
  signListingAssetToken,
  verifyListingAssetToken,
} from '../lib/listing-assets.js';

const propertyPage = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const listingAssetApi = await fs.readFile(new URL('../api/listing-asset.js', import.meta.url), 'utf8');
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

test('asset URLs only allow HTTPS Idealista and Immobiliare media hosts', () => {
  assert.equal(normalizeListingAssetUrl('https://img4.idealista.it/blur/WEB_DETAIL/0/id.pro.it.image.master/aa.jpg'), 'https://img4.idealista.it/blur/WEB_DETAIL/0/id.pro.it.image.master/aa.jpg');
  assert.equal(normalizeListingAssetUrl('https://pwm.im-cdn.it/image/123.jpg'), 'https://pwm.im-cdn.it/image/123.jpg');
  assert.equal(normalizeListingAssetUrl('https://fake-im-cdn.it/image/123.jpg'), null);
  assert.equal(normalizeListingAssetUrl('http://pwm.im-cdn.it/image/123.jpg'), null);
  assert.equal(normalizeListingAssetUrl('javascript:alert(1)'), null);
});

test('asset tokens are signed, expire, and reject tampering', () => {
  const secret = 'test-secret-with-enough-entropy';
  const token = signListingAssetToken({
    run_id: 'run-123',
    url: 'https://pwm.im-cdn.it/image/123.jpg',
    type: 'photo',
  }, { secret, ttlSeconds: 60 });
  assert.ok(token);
  assert.deepEqual(verifyListingAssetToken(token, { secret }).value, {
    run_id: 'run-123',
    url: 'https://pwm.im-cdn.it/image/123.jpg',
    type: 'photo',
  });
  assert.match(verifyListingAssetToken(`${token}x`, { secret }).error, /non valido/);
  assert.match(verifyListingAssetToken(token, { secret, now: Math.floor(Date.now() / 1000) + 61 }).error, /scaduto/);
});

test('asset extraction stores photo and floor-plan source links without duplicates', () => {
  const assets = extractSourceListingAssets({
    thumbnail_url: 'https://pwm.im-cdn.it/image/photo.jpg',
    raw_listing: {
      photos: ['https://pwm.im-cdn.it/image/photo.jpg'],
      floor_plans: [{ url: 'https://img4.idealista.it/plan.jpg' }],
    },
  });
  assert.equal(assets.length, 2);
  assert.deepEqual(assets.map((asset) => asset.asset_type), ['photo', 'floor_plan']);
  assert.ok(assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.asset_key)));
  assert.equal(listingAssetExtension('image/svg+xml'), null);
  assert.equal(listingAssetExtension('image/webp; charset=binary'), 'webp');
});

test('public output adds a signed on-demand token to listing media', () => {
  const previousSecret = process.env.TORIUM_ASSET_TOKEN_SECRET;
  process.env.TORIUM_ASSET_TOKEN_SECRET = 'public-output-test-secret';
  try {
    const output = redactOutput({
      run_id: 'run-123',
      results: [{ listing_index: 0, photos: [{ url: 'https://pwm.im-cdn.it/image/photo.jpg' }] }],
    });
    assert.ok(output.results[0].photos[0].asset_token);
    assert.equal(verifyListingAssetToken(output.results[0].photos[0].asset_token, { secret: process.env.TORIUM_ASSET_TOKEN_SECRET }).value.run_id, 'run-123');
  } finally {
    if (previousSecret === undefined) delete process.env.TORIUM_ASSET_TOKEN_SECRET;
    else process.env.TORIUM_ASSET_TOKEN_SECRET = previousSecret;
  }
});

test('compact output keeps bounded media only when explicitly requested', () => {
  const photos = Array.from({ length: 25 }, (_, index) => ({ url: `https://pwm.im-cdn.it/image/${index}.jpg`, asset_token: `token-${index}` }));
  const floorPlans = Array.from({ length: 8 }, (_, index) => ({ url: `https://pwm.im-cdn.it/plan/${index}.jpg`, asset_token: `plan-${index}` }));
  const output = { results: [{ photos, floor_plans: floorPlans, listing: { photos, floor_plans: floorPlans } }] };
  assert.equal(compactDashboardOutput(output).results[0].photos, undefined);
  const withMedia = compactDashboardOutput(output, { includeMedia: true });
  assert.equal(withMedia.results[0].photos.length, 20);
  assert.equal(withMedia.results[0].floor_plans.length, 6);
  assert.equal(withMedia.results[0].listing.photos, undefined);
});

test('listing asset endpoint rejects unsupported and cross-origin requests before fetching', async () => {
  const unsupported = responseRecorder();
  await assetHandler({ method: 'GET', headers: {}, body: {} }, unsupported);
  assert.equal(unsupported.statusCode, 405);
  assert.equal(unsupported.headers.Allow, 'POST');

  const crossOrigin = responseRecorder();
  await assetHandler({ method: 'POST', headers: { origin: 'https://bad.example', host: 'torium.example' }, body: { token: 'x' } }, crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
});

test('Supabase relative signed paths keep the required Storage API prefix', () => {
  const base = 'https://project.supabase.co';
  const tokenPath = '/object/sign/torium-listing-assets/run/photo.jpg?token=test';
  assert.equal(
    resolveSupabaseStorageUrl(tokenPath, base),
    `${base}/storage/v1${tokenPath}`,
  );
  assert.equal(
    resolveSupabaseStorageUrl(`/storage/v1${tokenPath}`, base),
    `${base}/storage/v1${tokenPath}`,
  );
  assert.equal(
    resolveSupabaseStorageUrl('https://cdn.example/photo.jpg', base),
    'https://cdn.example/photo.jpg',
  );
});

test('listing asset downloader runs near the Italian source CDNs', () => {
  assert.deepEqual(vercelConfig.functions['api/listing-asset.js'].regions, ['fra1']);
  assert.equal(vercelConfig.functions['api/listing-asset.js'].maxDuration, 30);
  assert.match(listingAssetApi, /https:\/\/wsrv\.nl\//);
  assert.match(listingAssetApi, /successfulAttempt\?\.proxied/);
});

test('property page requests and downloads media only on interaction', () => {
  assert.match(propertyPage, /fetch\('\/api\/listing-asset'/);
  assert.match(propertyPage, /function resolveAsset\(/);
  assert.match(propertyPage, /id="lightboxDownload"/);
  assert.match(propertyPage, /cache privata TORIUM/);
});
