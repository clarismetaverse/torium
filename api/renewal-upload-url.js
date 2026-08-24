import {
  isRenewalAgentAuthorized,
  normalizeRenewalAsset,
  normalizeRenewalUpload,
  RENEWAL_BUCKET,
} from '../lib/renewals.js';
import { renewalRest } from './renewals.js';

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return { url: url.replace(/\/$/, ''), key };
}

function serviceHeaders(extra = {}) {
  const { key } = env();
  return {
    apikey: key,
    [['Authori', 'zation'].join('')]: ['Bearer', key].join(' '),
    ...extra,
  };
}

function encodeStoragePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function resolveUploadUrl(raw) {
  const { url } = env();
  if (/^https:\/\//i.test(raw || '')) return raw;
  const path = String(raw || '').startsWith('/') ? raw : `/${raw}`;
  if (path.startsWith('/storage/v1/')) return `${url}${path}`;
  if (path.startsWith('/object/')) return `${url}/storage/v1${path}`;
  throw new Error('Supabase signed upload URL missing');
}

export async function createRenewalSignedUpload(storagePath) {
  const { url } = env();
  const result = await fetch(
    `${url}/storage/v1/object/upload/sign/${RENEWAL_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: '{}',
    },
  );
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`Supabase signed upload failed: ${result.status}`);
  const uploadUrl = resolveUploadUrl(body.url || body.signedUrl || body.signedURL);
  const token = body.token || new URL(uploadUrl).searchParams.get('token');
  if (!token) throw new Error('Supabase signed upload token missing');
  return { uploadUrl, token };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.TORIUM_RENEWAL_AGENT_KEY || process.env.TORIUM_RENEWAL_AGENT_KEY.length < 32) {
    return response.status(503).json({ error: 'TORIUM_RENEWAL_AGENT_KEY non configurata' });
  }
  if (!isRenewalAgentAuthorized(request)) return response.status(401).json({ error: 'Agent key non valida' });

  const normalized = normalizeRenewalUpload(request.body);
  if (normalized.error) return response.status(400).json({ error: normalized.error });
  const input = normalized.value;
  try {
    const projects = await renewalRest(
      `virtual_renewals?external_id=eq.${encodeURIComponent(input.external_id)}&select=id&limit=1`,
    );
    const project = projects?.[0];
    if (!project) return response.status(404).json({ error: 'Renewal non trovato: crea prima il progetto' });

    const assetInput = {
      ...request.body,
      asset_key: input.asset_key,
      asset_kind: input.asset_kind,
      storage_path: input.storage_path,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      upload_status: 'pending',
    };
    const asset = normalizeRenewalAsset(assetInput);
    if (asset.error) return response.status(400).json({ error: asset.error });
    const rows = await renewalRest('virtual_renewal_assets?on_conflict=renewal_id,asset_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{ ...asset.value, renewal_id: project.id }]),
    });
    const signed = await createRenewalSignedUpload(input.storage_path);
    return response.status(201).json({
      ok: true,
      asset: rows?.[0],
      upload: {
        method: 'PUT',
        url: signed.uploadUrl,
        token: signed.token,
        headers: {
          'content-type': input.mime_type,
          'cache-control': 'max-age=31536000',
          'x-upsert': 'false',
        },
        expires_in: 7200,
      },
    });
  } catch (error) {
    console.error('Renewal upload URL failed:', error);
    return response.status(500).json({ error: 'Upload renewal non disponibile' });
  }
}
