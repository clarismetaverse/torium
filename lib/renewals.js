import { randomUUID, timingSafeEqual } from 'node:crypto';
import { normalizeListingAssetUrl } from './listing-assets.js';

export const RENEWAL_BUCKET = 'torium-renewals';
export const MAX_RENEWAL_ASSET_BYTES = 15 * 1024 * 1024;
export const RENEWAL_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
export const RENEWAL_STATUSES = new Set(['draft', 'processing', 'published', 'failed', 'archived']);
export const RENEWAL_ASSET_KINDS = new Set(['renewal', 'original', 'floor_plan', 'material', 'detail']);
export const RENEWAL_LAYOUT_TYPES = new Set(['hero', 'landscape', 'portrait', 'diptych', 'plan', 'original', 'detail']);

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,179}$/;
const STYLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);

function textValue(value, max, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (value === null && !required) return null;
  const result = String(value || '').replace(/\r\n?/g, '\n').trim();
  if ((required && !result) || result.length > max) return null;
  return result;
}

function finiteInteger(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) return null;
  return result;
}

function objectValue(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

export function isRenewalAgentAuthorized(request, expected = process.env.TORIUM_RENEWAL_AGENT_KEY) {
  if (!expected || expected.length < 32) return false;
  const header = request?.headers?.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizePortalUrl(value, channel) {
  if (typeof value !== 'string' || value.length > 3000) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    const suffix = channel === 'idealista' ? 'idealista.it' : channel === 'immobiliare' ? 'immobiliare.it' : null;
    if (!suffix || parsed.protocol !== 'https:' || (hostname !== suffix && !hostname.endsWith(`.${suffix}`))) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeRenewalStyle(input = {}) {
  const id = textValue(input.id, 64, { required: true });
  const name = textValue(input.name, 120, { required: true });
  if (!id || !STYLE_ID_PATTERN.test(id)) return { error: 'style.id non valido' };
  if (!name) return { error: 'style.name non valido' };
  const description = textValue(input.description, 1000);
  if (input.description !== undefined && description === null) return { error: 'style.description non valida' };
  return {
    value: {
      id,
      name,
      description: description ?? null,
      palette: objectValue(input.palette),
      is_active: input.is_active !== false,
      updated_at: new Date().toISOString(),
    },
  };
}

export function normalizeRenewalProject(input = {}, { partial = false } = {}) {
  const value = {};
  const externalId = textValue(input.external_id, 180, { required: !partial });
  if ((!partial || input.external_id !== undefined) && (!externalId || !ID_PATTERN.test(externalId))) {
    return { error: 'external_id non valido' };
  }
  if (externalId) value.external_id = externalId;

  for (const [source, target, max] of [
    ['title', 'title', 180],
    ['subtitle', 'subtitle', 300],
    ['narrative', 'narrative', 5000],
    ['location_label', 'location_label', 180],
    ['generation_provider', 'generation_provider', 100],
    ['generation_model', 'generation_model', 160],
    ['prompt_version', 'prompt_version', 100],
    ['agent_job_id', 'agent_job_id', 180],
  ]) {
    if (!partial || input[source] !== undefined) {
      const normalized = textValue(input[source], max);
      if (input[source] !== undefined && normalized === null) return { error: `${source} non valido` };
      value[target] = normalized ?? null;
    }
  }

  if (!partial || input.status !== undefined) {
    const status = input.status || 'draft';
    if (!RENEWAL_STATUSES.has(status)) return { error: 'status non valido' };
    value.status = status;
  }
  if (!partial || input.version !== undefined) {
    const version = finiteInteger(input.version, 1, 1_000_000, 1);
    if (version === null) return { error: 'version non valida' };
    value.version = version;
  }
  if (!partial || input.sort_order !== undefined) {
    const sortOrder = finiteInteger(input.sort_order, -1_000_000, 1_000_000, 0);
    if (sortOrder === null) return { error: 'sort_order non valido' };
    value.sort_order = sortOrder;
  }
  if (!partial || input.metadata !== undefined) value.metadata = objectValue(input.metadata);
  value.updated_at = new Date().toISOString();
  return { value };
}

export function normalizeRenewalAsset(input = {}, { partial = false } = {}) {
  const value = {};
  const assetKey = textValue(input.asset_key, 180, { required: !partial });
  if ((!partial || input.asset_key !== undefined) && (!assetKey || !ID_PATTERN.test(assetKey))) {
    return { error: 'asset_key non valido' };
  }
  if (assetKey) value.asset_key = assetKey;

  if (!partial || input.asset_kind !== undefined) {
    const kind = input.asset_kind || 'renewal';
    if (!RENEWAL_ASSET_KINDS.has(kind)) return { error: 'asset_kind non valido' };
    value.asset_kind = kind;
  }
  if (!partial || input.layout_type !== undefined) {
    const layout = input.layout_type || 'landscape';
    if (!RENEWAL_LAYOUT_TYPES.has(layout)) return { error: 'layout_type non valido' };
    value.layout_type = layout;
  }
  for (const [field, max] of [['view_id', 100], ['view_name', 160], ['room_type', 100], ['caption', 500], ['alt_text', 500]]) {
    if (!partial || input[field] !== undefined) {
      const normalized = textValue(input[field], max);
      if (input[field] !== undefined && normalized === null) return { error: `${field} non valido` };
      value[field] = normalized ?? null;
    }
  }
  if (!partial || input.sort_order !== undefined) {
    const sortOrder = finiteInteger(input.sort_order, -1_000_000, 1_000_000, 0);
    if (sortOrder === null) return { error: 'asset sort_order non valido' };
    value.sort_order = sortOrder;
  }
  if (!partial || input.source_url !== undefined) {
    const sourceUrl = input.source_url === null ? null : normalizeListingAssetUrl(input.source_url);
    if (input.source_url && !sourceUrl) return { error: 'asset source_url non valido' };
    value.source_url = sourceUrl;
  }
  if (!partial || input.storage_path !== undefined) {
    const storagePath = textValue(input.storage_path, 600);
    if (input.storage_path !== undefined && input.storage_path !== null && (!storagePath || storagePath.includes('..'))) {
      return { error: 'storage_path non valido' };
    }
    value.storage_path = storagePath ?? null;
    value.storage_bucket = storagePath ? RENEWAL_BUCKET : null;
  }
  if (!partial || input.upload_status !== undefined) {
    const uploadStatus = input.upload_status || 'ready';
    if (!['pending', 'ready', 'failed', 'archived'].includes(uploadStatus)) return { error: 'upload_status non valido' };
    value.upload_status = uploadStatus;
  }
  if (!partial || input.mime_type !== undefined) {
    const mimeType = input.mime_type == null ? null : String(input.mime_type).toLowerCase();
    if (mimeType && !RENEWAL_MIME_TYPES.has(mimeType)) return { error: 'mime_type non valido' };
    value.mime_type = mimeType;
  }
  for (const [field, min, max] of [
    ['size_bytes', 0, MAX_RENEWAL_ASSET_BYTES],
    ['width', 1, 30000],
    ['height', 1, 30000],
  ]) {
    if (!partial || input[field] !== undefined) {
      const normalized = input[field] == null ? null : finiteInteger(input[field], min, max, null);
      if (input[field] != null && normalized === null) return { error: `${field} non valido` };
      value[field] = normalized;
    }
  }
  if (!partial || input.content_sha256 !== undefined) {
    const hash = textValue(input.content_sha256, 64);
    if (hash && !/^[a-f0-9]{64}$/.test(hash)) return { error: 'content_sha256 non valido' };
    value.content_sha256 = hash ?? null;
  }
  if (!partial || input.is_cover !== undefined) value.is_cover = input.is_cover === true;
  if (!partial || input.metadata !== undefined) value.metadata = objectValue(input.metadata);
  value.updated_at = new Date().toISOString();
  return { value };
}

export function normalizeRenewalUpload(input = {}) {
  const externalId = textValue(input.external_id, 180, { required: true });
  const assetKey = textValue(input.asset_key, 180, { required: true });
  const mimeType = String(input.mime_type || '').toLowerCase();
  const sizeBytes = finiteInteger(input.size_bytes, 1, MAX_RENEWAL_ASSET_BYTES, null);
  if (!externalId || !ID_PATTERN.test(externalId)) return { error: 'external_id non valido' };
  if (!assetKey || !ID_PATTERN.test(assetKey)) return { error: 'asset_key non valido' };
  if (!RENEWAL_MIME_TYPES.has(mimeType)) return { error: 'mime_type non valido' };
  if (sizeBytes === null) return { error: `size_bytes deve essere tra 1 e ${MAX_RENEWAL_ASSET_BYTES}` };
  const kind = input.asset_kind || 'renewal';
  if (!RENEWAL_ASSET_KINDS.has(kind)) return { error: 'asset_kind non valido' };
  const extension = MIME_EXTENSIONS.get(mimeType);
  return {
    value: {
      external_id: externalId,
      asset_key: assetKey,
      asset_kind: kind,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      storage_path: `${externalId}/${assetKey}/${randomUUID()}.${extension}`,
    },
  };
}
