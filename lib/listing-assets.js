import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const LISTING_ASSET_BUCKET = 'torium-listing-assets';
export const MAX_LISTING_ASSET_BYTES = 10 * 1024 * 1024;
export const LISTING_ASSET_RETENTION_DAYS = 90;

const ALLOWED_HOST_SUFFIXES = ['idealista.it', 'im-cdn.it'];
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function listingAssetSecret() {
  return process.env.TORIUM_ASSET_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function normalizeListingAssetUrl(value) {
  if (typeof value !== 'string' || value.length > 3000) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function listingAssetKey(sourceUrl) {
  const normalizedUrl = normalizeListingAssetUrl(sourceUrl);
  if (!normalizedUrl) return null;
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

export function listingAssetExtension(contentType) {
  return MIME_EXTENSIONS.get(String(contentType || '').split(';')[0].trim().toLowerCase()) || null;
}

export function signListingAssetToken(input, { secret = listingAssetSecret(), ttlSeconds = 7 * 24 * 60 * 60 } = {}) {
  const sourceUrl = normalizeListingAssetUrl(input?.url);
  const runId = String(input?.run_id || '').trim();
  const type = input?.type === 'floor_plan' ? 'floor_plan' : input?.type === 'photo' ? 'photo' : null;
  if (!secret || !sourceUrl || !type || !/^[a-zA-Z0-9._:-]{1,180}$/.test(runId)) return null;

  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({ v: 1, run_id: runId, url: sourceUrl, type, iat: now, exp: now + ttlSeconds }));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyListingAssetToken(token, { secret = listingAssetSecret(), now = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret || typeof token !== 'string' || token.length > 6000) return { error: 'Token asset non valido' };
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return { error: 'Token asset non valido' };

  const expected = createHmac('sha256', secret).update(payload).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return { error: 'Token asset non valido' };
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return { error: 'Token asset non valido' };

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    const url = normalizeListingAssetUrl(parsed.url);
    if (parsed.v !== 1 || !url || !['photo', 'floor_plan'].includes(parsed.type)) return { error: 'Token asset non valido' };
    if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(String(parsed.run_id || ''))) return { error: 'Token asset non valido' };
    if (!Number.isInteger(parsed.exp) || parsed.exp < now) return { error: 'Token asset scaduto' };
    return { value: { run_id: parsed.run_id, url, type: parsed.type } };
  } catch {
    return { error: 'Token asset non valido' };
  }
}

function collectAssetUrls(values, type, target, seen, limit) {
  for (const value of values.flat(Infinity)) {
    if (target.length >= limit) return;
    const candidate = typeof value === 'string' ? value : value?.url || value?.thumbnail || value?.hd || value?.sd;
    const url = normalizeListingAssetUrl(candidate);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    target.push({ source_url: url, asset_type: type, asset_key: listingAssetKey(url), source_host: new URL(url).hostname });
  }
}

export function extractSourceListingAssets(item) {
  const result = [];
  const seen = new Set();
  const raw = item?.raw_listing || {};
  const normalized = item?.normalized_v1 || raw?.normalized_v1 || {};
  collectAssetUrls([
    item?.thumbnail_url,
    item?.photos,
    raw?.thumbnail,
    raw?.thumbnail_url,
    raw?.photos,
    raw?.multimedia?.images,
    raw?.media?.images,
    normalized?.media?.images,
  ], 'photo', result, seen, 32);
  collectAssetUrls([
    item?.floor_plans,
    raw?.floor_plans,
    raw?.multimedia?.floor_plans,
    raw?.media?.floorPlans,
    normalized?.media?.floor_plans,
  ], 'floor_plan', result, seen, 40);
  return result;
}
