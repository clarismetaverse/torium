import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
dotenv.config({ path: join(repositoryRoot, '.env.production.local') });
dotenv.config({ path: join(repositoryRoot, '.env.local') });
dotenv.config({ path: join(repositoryRoot, '.env') });

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const listing = {
  rowId: 8832,
  runId: '1787534155085-villaSardegnaRenovation-villa_dynamic_market',
  sourceChannel: 'idealista',
  sourceListingId: '36347807',
  sourceUrl: 'https://www.idealista.it/immobile/36347807/',
  title: 'Villa Gallura · Portobello di Gallura',
  location: 'Portobello di Gallura, Aglientu',
};

const renderDirectory = 'C:\\Users\\feder\\Documents\\nanobanana_generated\\gallura';
const bucket = 'torium-renewals';

const styles = [
  {
    id: 'a1_quiet_luxury',
    suffix: 'a1_quiet_luxury',
    name: 'Quiet Mediterranean Luxury',
    subtitle: 'Luce, pietra e legni chiari per un lusso mediterraneo discreto.',
  },
  {
    id: 'a2_organic_icon',
    suffix: 'a2_organic_icon',
    name: 'Organic Mediterranean Icon',
    subtitle: 'Materia, artigianato e forme organiche in dialogo con il paesaggio.',
  },
  {
    id: 'a3_private_estate_hnwi',
    suffix: 'a3_private_estate_hnwi',
    name: 'Private Estate HNWI',
    subtitle: 'Privacy, rappresentanza e comfort per una residenza internazionale.',
  },
];

const views = [
  {
    id: 'v1',
    name: 'Living',
    room: 'living_room',
    filePrefix: 'v1_soggiorno',
    originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/0a/5e/cd/822667752.jpg',
  },
  {
    id: 'v2',
    name: 'Cucina',
    room: 'kitchen',
    filePrefix: 'v2_cucina',
    originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/66/b2/29/822667755.jpg',
  },
  {
    id: 'v3',
    name: 'Scala e zona giorno',
    room: 'living_room',
    filePrefix: 'v3_scala',
    originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/b0/a0/a8/822667756.jpg',
  },
  {
    id: 'v4',
    name: 'Esterno e piscina',
    room: 'exterior',
    filePrefix: 'v4_esterno',
    originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/e3/af/36/822667744.jpg',
  },
];

function headers(extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function request(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: headers(options.headers),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${pathname}\n${body}`);
  return body ? JSON.parse(body) : null;
}

async function upsert(table, rows, conflict) {
  return request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  });
}

function encodeStoragePath(pathname) {
  return pathname.split('/').map(encodeURIComponent).join('/');
}

async function uploadImage(localPath, storagePath) {
  const data = await readFile(localPath);
  await request(`/storage/v1/object/${bucket}/${encodeStoragePath(storagePath)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'max-age=31536000',
      'x-upsert': 'true',
    },
    body: data,
  });
  return {
    size: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

const listingRows = await request(
  `/rest/v1/triage_source_listings?id=eq.${listing.rowId}&select=id,run_id,source_channel,source_listing_id,source_url,title&limit=1`,
);
const source = listingRows?.[0];
if (
  !source
  || source.run_id !== listing.runId
  || source.source_channel !== listing.sourceChannel
  || String(source.source_listing_id) !== listing.sourceListingId
) {
  throw new Error('The expected Gallura source listing was not found; refusing to seed mismatched media');
}

for (let styleIndex = 0; styleIndex < styles.length; styleIndex += 1) {
  const style = styles[styleIndex];
  const externalId = `gallura-${listing.sourceListingId}-${style.id}-v1`;
  const projects = await upsert('virtual_renewals', [{
    external_id: externalId,
    source_listing_row_id: listing.rowId,
    run_id: listing.runId,
    source_channel: listing.sourceChannel,
    source_listing_id: listing.sourceListingId,
    source_url: listing.sourceUrl,
    style_id: style.id,
    title: listing.title,
    subtitle: style.subtitle,
    narrative: `${style.name}: concept di valorizzazione virtuale basato sulle fotografie reali dell'immobile.`,
    location_label: listing.location,
    status: 'published',
    version: 1,
    generation_provider: 'Claude skill / Nano Banana',
    prompt_version: 'gallura-v1',
    sort_order: styleIndex + 1,
    metadata: { demo: true, listing_match: 'geometry_verified', floor_plan_available: false },
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }], 'external_id');
  const project = projects[0];
  const assets = [];

  for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
    const view = views[viewIndex];
    const localPath = join(renderDirectory, `${view.filePrefix}__${style.suffix}.jpg`);
    await stat(localPath);
    const storagePath = `${externalId}/${basename(localPath)}`;
    const uploaded = await uploadImage(localPath, storagePath);
    const baseOrder = viewIndex * 20;

    assets.push({
      renewal_id: project.id,
      asset_key: `${view.id}.original`,
      asset_kind: 'original',
      view_id: view.id,
      view_name: view.name,
      room_type: view.room,
      layout_type: 'original',
      sort_order: baseOrder + 10,
      source_url: view.originalUrl,
      upload_status: 'ready',
      caption: `${view.name} · stato attuale`,
      alt_text: `${listing.title}, ${view.name}, fotografia originale`,
      is_cover: false,
      metadata: { portal: 'idealista', matched_to_renewal: true },
      updated_at: new Date().toISOString(),
    });
    assets.push({
      renewal_id: project.id,
      asset_key: `${view.id}.renewal`,
      asset_kind: 'renewal',
      view_id: view.id,
      view_name: view.name,
      room_type: view.room,
      layout_type: viewIndex === 0 ? 'hero' : 'landscape',
      sort_order: baseOrder + 20,
      storage_bucket: bucket,
      storage_path: storagePath,
      upload_status: 'ready',
      mime_type: 'image/jpeg',
      size_bytes: uploaded.size,
      content_sha256: uploaded.sha256,
      caption: `${view.name} · ${style.name}`,
      alt_text: `${listing.title}, ${view.name}, proposta ${style.name}`,
      is_cover: viewIndex === 0,
      metadata: { generated: true, style_id: style.id },
      updated_at: new Date().toISOString(),
    });
  }

  await upsert('virtual_renewal_assets', assets, 'renewal_id,asset_key');
  console.log(`Seeded ${externalId}: ${assets.length} assets`);
}

console.log('Gallura renewal seed complete');

