import { createHash } from 'node:crypto';
import { isSameOrigin } from './property-note.js';
import {
  LISTING_ASSET_BUCKET,
  LISTING_ASSET_RETENTION_DAYS,
  MAX_LISTING_ASSET_BYTES,
  listingAssetExtension,
  listingAssetKey,
  normalizeListingAssetUrl,
  verifyListingAssetToken,
} from '../lib/listing-assets.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FETCH_TIMEOUT_MS = 15_000;
const SIGNED_URL_SECONDS = 10 * 60;

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
    ...extra,
  };
}

async function supabaseRest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing Supabase env vars');
  const result = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
    ...options,
    headers: serviceHeaders(options.headers),
  });
  const body = await result.text();
  if (!result.ok) throw new Error(`Supabase asset metadata failed: ${result.status}\n${body}`);
  return body ? JSON.parse(body) : null;
}

function encodeStoragePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function createSignedUrl(storagePath, { download = false } = {}) {
  const result = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/sign/${LISTING_ASSET_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
    },
  );
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`Supabase signed URL failed: ${result.status}`);
  const raw = body.signedUrl || body.signedURL || body.url;
  if (!raw) throw new Error('Supabase signed URL missing');
  const signedUrl = raw.startsWith('http') ? raw : `${SUPABASE_URL.replace(/\/$/, '')}${raw}`;
  if (!download) return signedUrl;
  const separator = signedUrl.includes('?') ? '&' : '?';
  return `${signedUrl}${separator}download=torium-asset`;
}

async function downloadSourceAsset(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const result = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5',
        'User-Agent': 'Mozilla/5.0 (compatible; TORIUM-Asset-Cache/1.0)',
      },
    });
    if (!result.ok) throw new Error(`Sorgente immagine non disponibile (${result.status})`);
    if (!normalizeListingAssetUrl(result.url)) throw new Error('Redirect asset non consentito');
    const mimeType = String(result.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const extension = listingAssetExtension(mimeType);
    if (!extension) throw new Error('Formato immagine non supportato');
    const declaredSize = Number(result.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_LISTING_ASSET_BYTES) throw new Error('Immagine oltre il limite di 10 MB');
    const bytes = Buffer.from(await result.arrayBuffer());
    if (bytes.length > MAX_LISTING_ASSET_BYTES) throw new Error('Immagine oltre il limite di 10 MB');
    return { bytes, mimeType, extension, finalUrl: result.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadAsset(storagePath, bytes, mimeType) {
  const result = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${LISTING_ASSET_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': mimeType, 'cache-control': '86400', 'x-upsert': 'false' }),
      body: bytes,
    },
  );
  if (result.status === 409) return;
  if (!result.ok) throw new Error(`Supabase Storage upload failed: ${result.status}`);
}

async function updateMetadata(payload) {
  await supabaseRest('triage_listing_assets?on_conflict=run_id,asset_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([payload]),
  });
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!isSameOrigin(request)) return response.status(403).json({ error: 'Cross-origin request denied' });

  const verified = verifyListingAssetToken(request.body?.token);
  if (verified.error) return response.status(400).json({ error: verified.error });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return response.status(503).json({ error: 'Cache media non configurata' });

  const { run_id: runId, url: sourceUrl, type: assetType } = verified.value;
  const assetKey = listingAssetKey(sourceUrl);
  const sourceHost = new URL(sourceUrl).hostname;

  try {
    const rows = await supabaseRest(
      `triage_listing_assets?run_id=eq.${encodeURIComponent(runId)}&asset_key=eq.${assetKey}&select=storage_path,cache_status,mime_type,size_bytes&limit=1`,
    );
    if (rows?.[0]?.cache_status === 'cached' && rows[0].storage_path) {
      await supabaseRest(`triage_listing_assets?run_id=eq.${encodeURIComponent(runId)}&asset_key=eq.${assetKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_accessed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      return response.status(200).json({
        cached: true,
        signed_url: await createSignedUrl(rows[0].storage_path),
        download_url: await createSignedUrl(rows[0].storage_path, { download: true }),
        expires_in: SIGNED_URL_SECONDS,
      });
    }

    const downloaded = await downloadSourceAsset(sourceUrl);
    const storagePath = `${assetKey.slice(0, 2)}/${assetKey}.${downloaded.extension}`;
    await uploadAsset(storagePath, downloaded.bytes, downloaded.mimeType);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LISTING_ASSET_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await updateMetadata({
      run_id: runId,
      asset_key: assetKey,
      asset_type: assetType,
      source_url: sourceUrl,
      source_host: sourceHost,
      storage_path: storagePath,
      cache_status: 'cached',
      mime_type: downloaded.mimeType,
      size_bytes: downloaded.bytes.length,
      content_sha256: createHash('sha256').update(downloaded.bytes).digest('hex'),
      cached_at: now.toISOString(),
      last_accessed_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      last_error: null,
      updated_at: now.toISOString(),
    });
    return response.status(200).json({
      cached: false,
      signed_url: await createSignedUrl(storagePath),
      download_url: await createSignedUrl(storagePath, { download: true }),
      expires_in: SIGNED_URL_SECONDS,
    });
  } catch (error) {
    console.error('Listing asset cache failed:', error);
    try {
      await updateMetadata({
        run_id: runId,
        asset_key: assetKey,
        asset_type: assetType,
        source_url: sourceUrl,
        source_host: sourceHost,
        cache_status: 'failed',
        last_error: String(error.message || error).slice(0, 500),
        updated_at: new Date().toISOString(),
      });
    } catch {}
    return response.status(502).json({ error: 'Immagine sorgente non disponibile; riprova più tardi' });
  }
}
