import {
  isRenewalAgentAuthorized,
  normalizePortalUrl,
  normalizeRenewalAsset,
  normalizeRenewalProject,
  normalizeRenewalStyle,
  RENEWAL_BUCKET,
} from '../lib/renewals.js';

const SIGNED_URL_SECONDS = 60 * 60;

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

export async function renewalRest(pathname, options = {}) {
  const { url } = env();
  const result = await fetch(`${url}/rest/v1/${pathname}`, {
    ...options,
    headers: serviceHeaders(options.headers),
  });
  const body = await result.text();
  if (!result.ok) throw new Error(`Supabase renewals failed: ${result.status}\n${body}`);
  return body ? JSON.parse(body) : null;
}

function resolveStorageUrl(raw) {
  if (!raw) throw new Error('Supabase signed URL missing');
  if (/^https:\/\//i.test(raw)) return raw;
  const { url } = env();
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  if (path.startsWith('/storage/v1/')) return `${url}${path}`;
  if (path.startsWith('/object/')) return `${url}/storage/v1${path}`;
  throw new Error('Supabase signed URL path non valido');
}

function encodeStoragePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

async function signedAssetUrl(asset) {
  if (!asset.storage_path) return asset.source_url;
  const { url } = env();
  const result = await fetch(
    `${url}/storage/v1/object/sign/${RENEWAL_BUCKET}/${encodeStoragePath(asset.storage_path)}`,
    {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
    },
  );
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`Supabase renewal signing failed: ${result.status}`);
  return resolveStorageUrl(body.signedUrl || body.signedURL || body.url);
}

function json(response, status, data) {
  response.status(status).json(data);
}

async function findProject(externalId) {
  const rows = await renewalRest(
    `virtual_renewals?external_id=eq.${encodeURIComponent(externalId)}&select=*&limit=1`,
  );
  return rows?.[0] || null;
}

async function findListing(input = {}, existing = null) {
  if (!input || !Object.keys(input).length) {
    if (!existing?.source_listing_row_id) return null;
    input = { source_listing_row_id: existing.source_listing_row_id };
  }

  let filter;
  if (input.source_listing_row_id !== undefined) {
    const id = Number(input.source_listing_row_id);
    if (!Number.isInteger(id) || id < 1) return null;
    filter = `id=eq.${id}`;
  } else {
    const channel = String(input.source_channel || existing?.source_channel || '').toLowerCase();
    const listingId = String(input.source_listing_id || existing?.source_listing_id || '').trim();
    if (!['idealista', 'immobiliare'].includes(channel) || !listingId || listingId.length > 180) return null;
    const parts = [
      `source_channel=eq.${channel}`,
      `source_listing_id=eq.${encodeURIComponent(listingId)}`,
    ];
    const runId = String(input.run_id || existing?.run_id || '').replace(/^supabase:/, '').trim();
    if (runId) parts.push(`run_id=eq.${encodeURIComponent(runId)}`);
    filter = parts.join('&');
  }

  const rows = await renewalRest(
    `triage_source_listings?${filter}&select=id,run_id,source_channel,source_listing_id,source_url,title,address,city,district,neighborhood,area_label,thumbnail_url,raw_listing&order=created_at.desc&limit=1`,
  );
  const row = rows?.[0];
  if (!row || !normalizePortalUrl(row.source_url, row.source_channel)) return null;
  return row;
}

async function upsertStyle(input, fallbackId) {
  if (input) {
    const normalized = normalizeRenewalStyle(input);
    if (normalized.error) return normalized;
    const rows = await renewalRest('renewal_styles?on_conflict=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([normalized.value]),
    });
    return { value: rows?.[0] };
  }
  if (!fallbackId) return { error: 'style richiesto' };
  const rows = await renewalRest(`renewal_styles?id=eq.${encodeURIComponent(fallbackId)}&select=*&limit=1`);
  return rows?.[0] ? { value: rows[0] } : { error: 'style_id non trovato' };
}

async function upsertAssets(renewalId, assets = [], { partial = false } = {}) {
  if (!Array.isArray(assets) || assets.length > 100) return { error: 'assets non validi' };
  const saved = [];
  for (const input of assets) {
    const normalized = normalizeRenewalAsset(input, { partial });
    if (normalized.error) return normalized;
    let current = null;
    if (partial) {
      const rows = await renewalRest(
        `virtual_renewal_assets?renewal_id=eq.${renewalId}&asset_key=eq.${encodeURIComponent(normalized.value.asset_key)}&select=*&limit=1`,
      );
      current = rows?.[0] || null;
    }
    const row = { ...(current || {}), ...normalized.value, renewal_id: renewalId };
    delete row.id;
    delete row.created_at;
    if (!row.source_url && !row.storage_path) return { error: `asset ${row.asset_key} senza source_url o storage_path` };
    const rows = await renewalRest('virtual_renewal_assets?on_conflict=renewal_id,asset_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([row]),
    });
    saved.push(rows?.[0]);
  }
  return { value: saved };
}

async function writeProject(request, response) {
  if (!process.env.TORIUM_RENEWAL_AGENT_KEY || process.env.TORIUM_RENEWAL_AGENT_KEY.length < 32) {
    return json(response, 503, { error: 'TORIUM_RENEWAL_AGENT_KEY non configurata' });
  }
  if (!isRenewalAgentAuthorized(request)) return json(response, 401, { error: 'Agent key non valida' });

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const externalId = String(body.external_id || request.query.external_id || '').trim();
  const partial = request.method === 'PATCH';
  const existing = externalId ? await findProject(externalId) : null;
  if (partial && !existing) return json(response, 404, { error: 'Renewal non trovato' });

  const projectInput = body.project && typeof body.project === 'object' ? body.project : body;
  if (!projectInput.external_id && externalId) projectInput.external_id = externalId;
  const normalizedProject = normalizeRenewalProject(projectInput, { partial });
  if (normalizedProject.error) return json(response, 400, { error: normalizedProject.error });

  const listing = await findListing(body.listing, existing);
  if (!listing) return json(response, 400, { error: 'Listing sorgente TORIUM non trovato o privo di URL valido' });
  const style = await upsertStyle(body.style, body.style_id || projectInput.style_id || existing?.style_id);
  if (style.error) return json(response, 400, { error: style.error });

  const status = normalizedProject.value.status ?? existing?.status ?? 'draft';
  const row = {
    ...(existing || {}),
    ...normalizedProject.value,
    external_id: normalizedProject.value.external_id || existing.external_id,
    source_listing_row_id: listing.id,
    run_id: listing.run_id,
    source_channel: listing.source_channel,
    source_listing_id: listing.source_listing_id,
    source_url: listing.source_url,
    style_id: style.value.id,
    title: normalizedProject.value.title ?? existing?.title ?? listing.title,
    location_label: normalizedProject.value.location_label ?? existing?.location_label ?? listing.neighborhood ?? listing.district ?? listing.area_label ?? listing.city,
    status,
    published_at: status === 'published' ? (existing?.published_at || new Date().toISOString()) : null,
  };
  delete row.id;
  delete row.created_at;

  const rows = await renewalRest('virtual_renewals?on_conflict=external_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row]),
  });
  const project = rows?.[0];
  const assetInputs = body.assets || body.asset_patches || [];
  const assets = await upsertAssets(project.id, assetInputs, { partial });
  if (assets.error) return json(response, 400, { error: assets.error });

  return json(response, partial ? 200 : 201, { ok: true, project, style: style.value, assets: assets.value });
}

async function readProjects(request, response) {
  const externalId = String(request.query.external_id || '').trim();
  const styleId = String(request.query.style_id || '').trim();
  const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20));
  const filters = ['status=eq.published', 'select=*', 'order=sort_order.asc,published_at.desc', `limit=${limit}`];
  if (externalId) filters.push(`external_id=eq.${encodeURIComponent(externalId)}`);
  if (styleId) filters.push(`style_id=eq.${encodeURIComponent(styleId)}`);
  const projects = await renewalRest(`virtual_renewals?${filters.join('&')}`);
  if (!projects.length) {
    response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return json(response, 200, { count: 0, projects: [] });
  }

  const projectIds = projects.map((project) => project.id).join(',');
  const styleIds = [...new Set(projects.map((project) => project.style_id))].join(',');
  const listingIds = [...new Set(projects.map((project) => project.source_listing_row_id).filter(Boolean))].join(',');
  const [styles, assets, listings] = await Promise.all([
    renewalRest(`renewal_styles?id=in.(${styleIds})&select=id,name,description,palette`),
    renewalRest(`virtual_renewal_assets?renewal_id=in.(${projectIds})&upload_status=eq.ready&select=*&order=sort_order.asc,asset_key.asc`),
    listingIds
      ? renewalRest(`triage_source_listings?id=in.(${listingIds})&select=id,title,address,city,district,neighborhood,area_label,price_eur,size_mq,thumbnail_url,has_plan`)
      : Promise.resolve([]),
  ]);
  const styleMap = new Map(styles.map((style) => [style.id, style]));
  const listingMap = new Map(listings.map((listing) => [listing.id, listing]));
  const assetsByProject = new Map();
  await Promise.all(assets.map(async (asset) => {
    let url = null;
    try {
      url = await signedAssetUrl(asset);
    } catch (error) {
      console.error('Renewal asset unavailable:', asset.id, error);
    }
    if (!url) return;
    const publicAsset = {
      asset_key: asset.asset_key,
      asset_kind: asset.asset_kind,
      view_id: asset.view_id,
      view_name: asset.view_name,
      room_type: asset.room_type,
      layout_type: asset.layout_type,
      sort_order: asset.sort_order,
      caption: asset.caption,
      alt_text: asset.alt_text,
      is_cover: asset.is_cover,
      width: asset.width,
      height: asset.height,
      url,
    };
    const collection = assetsByProject.get(asset.renewal_id) || [];
    collection.push(publicAsset);
    assetsByProject.set(asset.renewal_id, collection);
  }));

  const output = projects.map((project) => ({
    external_id: project.external_id,
    title: project.title,
    subtitle: project.subtitle,
    narrative: project.narrative,
    location_label: project.location_label,
    source_channel: project.source_channel,
    source_listing_id: project.source_listing_id,
    source_url: project.source_url,
    version: project.version,
    published_at: project.published_at,
    style: styleMap.get(project.style_id) || null,
    listing: listingMap.get(project.source_listing_row_id) || null,
    assets: assetsByProject.get(project.id) || [],
  }));
  response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return json(response, 200, { count: output.length, projects: output });
}

export default async function handler(request, response) {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH');
    return json(response, 405, { error: 'Method not allowed' });
  }
  try {
    if (request.method === 'GET') return await readProjects(request, response);
    response.setHeader('Cache-Control', 'no-store');
    return await writeProject(request, response);
  } catch (error) {
    console.error('Renewals API failed:', error);
    return json(response, 500, { error: 'Renewals API non disponibile' });
  }
}
