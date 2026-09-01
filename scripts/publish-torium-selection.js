import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
dotenv.config({ path: join(repositoryRoot, '.env.production.local') });

const apiBase = String(
  process.env.TORIUM_RENEWAL_API_URL || 'https://torium-nu.vercel.app/api/renewals',
).replace(/\/$/, '');
const agentKey = process.env.TORIUM_RENEWAL_AGENT_KEY;
const selectionDirectory = process.env.TORIUM_SELECTION_DIR
  || 'C:\\Users\\feder\\Downloads\\ToriumSelection';

if (!agentKey || agentKey.length < 32) {
  throw new Error('Missing or invalid TORIUM_RENEWAL_AGENT_KEY');
}

const project = {
  external_id: 'gallura-36347807-a4_california_midcentury-v1',
  listing: {
    source_listing_row_id: 8832,
    source_channel: 'idealista',
    source_listing_id: '36347807',
  },
  style: {
    id: 'a4_california_midcentury',
    name: 'California Mid-Century Mediterranean',
    description: 'Modernismo californiano, legni caldi, ottone e accenti cromatici in dialogo con la pietra gallurese.',
    palette: {
      mood: 'california_midcentury',
      accent: 'deep_blue',
      materials: ['walnut', 'brass', 'stone'],
    },
  },
  title: 'Villa Gallura · Portobello di Gallura',
  subtitle: 'California Mid-Century Mediterranean',
  narrative: 'Un concept caldo e materico che combina modernismo californiano e identità mediterranea.',
  location_label: 'Portobello di Gallura, Aglientu',
  status: 'processing',
  version: 1,
  sort_order: 4,
  generation_provider: 'Claude skill / Nano Banana',
  prompt_version: 'gallura-a4-v1',
  metadata: {
    demo: true,
    listing_match: 'geometry_verified',
    original_images: 'aligned_crops',
    floor_plan_available: false,
    source_directory: 'ToriumSelection',
  },
};

const views = [
  { id: 'v1', slug: 'soggiorno', name: 'Soggiorno', room: 'living_room' },
  { id: 'v2', slug: 'cucina', name: 'Cucina', room: 'kitchen' },
  { id: 'v3', slug: 'sala', name: 'Sala', room: 'dining_room' },
  { id: 'v4', slug: 'esterno-piscina', name: 'Esterno e piscina', room: 'exterior' },
];

async function api(pathname = '', options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${agentKey}`, ...options.headers },
  });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

function filePath(kind, slug) {
  const folder = kind === 'original' ? 'GalluraOriginal' : 'GalluraVirtual';
  return join(selectionDirectory, folder, `${slug}.jpg`);
}

async function assertInputs() {
  for (const view of views) {
    await access(filePath('original', view.slug));
    await access(filePath('renewal', view.slug));
  }
}

async function uploadAsset({ kind, view, sortOrder, isCover = false }) {
  const localPath = filePath(kind, view.slug);
  const data = await readFile(localPath);
  const assetKey = `${view.id}.${kind}`;
  const issued = await api('?action=upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      external_id: project.external_id,
      asset_key: assetKey,
      asset_kind: kind,
      mime_type: 'image/jpeg',
      size_bytes: data.byteLength,
      view_id: view.id,
      view_name: view.name,
      room_type: view.room,
      layout_type: kind === 'original' ? 'original' : isCover ? 'hero' : 'landscape',
      sort_order: sortOrder,
      caption: kind === 'original'
        ? `${view.name} · stato attuale`
        : `${view.name} · ${project.style.name}`,
      alt_text: kind === 'original'
        ? `Villa Gallura, ${view.name}, fotografia dello stato attuale`
        : `Villa Gallura, ${view.name}, proposta ${project.style.name}`,
      is_cover: kind === 'renewal' && isCover,
      content_sha256: createHash('sha256').update(data).digest('hex'),
      metadata: {
        paired_view_id: view.id,
        generated: kind === 'renewal',
        aligned_crop: kind === 'original',
        source_filename: basename(localPath),
        style_id: project.style.id,
      },
    }),
  });

  const uploaded = await fetch(issued.upload.url, {
    method: issued.upload.method,
    headers: issued.upload.headers,
    body: data,
  });
  if (!uploaded.ok) {
    throw new Error(`Upload ${assetKey} failed: ${uploaded.status} ${await uploaded.text()}`);
  }
  return { asset_key: assetKey, upload_status: 'ready' };
}

await assertInputs();
await api('', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(project),
});

const patches = [];
for (let index = 0; index < views.length; index += 1) {
  const view = views[index];
  patches.push(await uploadAsset({ kind: 'original', view, sortOrder: index * 20 + 10 }));
  patches.push(await uploadAsset({
    kind: 'renewal',
    view,
    sortOrder: index * 20 + 20,
    isCover: index === 0,
  }));
}

await api(`?external_id=${encodeURIComponent(project.external_id)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    external_id: project.external_id,
    status: 'published',
    asset_patches: patches,
  }),
});

console.log(`Published ${project.external_id}: ${patches.length} assets across ${views.length} paired views.`);
console.log(`Feed: https://torium-nu.vercel.app/renewals?project=${encodeURIComponent(project.external_id)}`);
