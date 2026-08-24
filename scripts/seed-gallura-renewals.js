import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const apiBase = String(process.env.TORIUM_RENEWAL_API_URL || 'https://torium-nu.vercel.app/api/renewals').replace(/\/$/, '');
const agentKey = process.env.TORIUM_RENEWAL_AGENT_KEY;
if (!agentKey || agentKey.length < 32) throw new Error('Missing TORIUM_RENEWAL_AGENT_KEY');

const listing = {
  source_listing_row_id: 8832,
  source_channel: 'idealista',
  source_listing_id: '36347807',
};
const renderDirectory = 'C:\\Users\\feder\\Documents\\nanobanana_generated\\gallura';

const styles = [
  { id: 'a1_quiet_luxury', suffix: 'a1_quiet_luxury', name: 'Quiet Mediterranean Luxury', subtitle: 'Luce, pietra e legni chiari per un lusso mediterraneo discreto.' },
  { id: 'a2_organic_icon', suffix: 'a2_organic_icon', name: 'Organic Mediterranean Icon', subtitle: 'Materia, artigianato e forme organiche in dialogo con il paesaggio.' },
  { id: 'a3_private_estate_hnwi', suffix: 'a3_private_estate_hnwi', name: 'Private Estate HNWI', subtitle: 'Privacy, rappresentanza e comfort per una residenza internazionale.' },
];

const views = [
  { id: 'v1', name: 'Living', room: 'living_room', filePrefix: 'v1_soggiorno', originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/0a/5e/cd/822667752.jpg' },
  { id: 'v2', name: 'Cucina', room: 'kitchen', filePrefix: 'v2_cucina', originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/66/b2/29/822667755.jpg' },
  { id: 'v3', name: 'Scala e zona giorno', room: 'living_room', filePrefix: 'v3_scala', originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/b0/a0/a8/822667756.jpg' },
  { id: 'v4', name: 'Esterno e piscina', room: 'exterior', filePrefix: 'v4_esterno', originalUrl: 'https://img4.idealista.it/blur/WEB_DETAIL_TOP-XL-P/0/id.pro.it.image.master/e3/af/36/822667744.jpg' },
];

async function api(pathname = '', options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${agentKey}`, ...options.headers },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

function originalAssets() {
  return views.map((view, index) => ({
    asset_key: `${view.id}.original`,
    asset_kind: 'original',
    view_id: view.id,
    view_name: view.name,
    room_type: view.room,
    layout_type: 'original',
    sort_order: index * 20 + 10,
    source_url: view.originalUrl,
    upload_status: 'ready',
    caption: `${view.name} · stato attuale`,
    alt_text: `Villa Gallura, ${view.name}, fotografia originale`,
    metadata: { portal: 'idealista', matched_to_renewal: true },
  }));
}

async function uploadRenewal(externalId, style, view, index) {
  const localPath = join(renderDirectory, `${view.filePrefix}__${style.suffix}.jpg`);
  const data = await readFile(localPath);
  const assetKey = `${view.id}.renewal`;
  const issued = await api('?action=upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      external_id: externalId,
      asset_key: assetKey,
      asset_kind: 'renewal',
      mime_type: 'image/jpeg',
      size_bytes: data.byteLength,
      view_id: view.id,
      view_name: view.name,
      room_type: view.room,
      layout_type: index === 0 ? 'hero' : 'landscape',
      sort_order: index * 20 + 20,
      caption: `${view.name} · ${style.name}`,
      alt_text: `Villa Gallura, ${view.name}, proposta ${style.name}`,
      is_cover: index === 0,
      content_sha256: createHash('sha256').update(data).digest('hex'),
      metadata: { generated: true, style_id: style.id },
    }),
  });
  const uploaded = await fetch(issued.upload.url, {
    method: issued.upload.method,
    headers: issued.upload.headers,
    body: data,
  });
  if (!uploaded.ok) throw new Error(`Upload ${assetKey} failed: ${uploaded.status} ${await uploaded.text()}`);
  return { asset_key: assetKey, upload_status: 'ready' };
}

for (let styleIndex = 0; styleIndex < styles.length; styleIndex += 1) {
  const style = styles[styleIndex];
  const externalId = `gallura-36347807-${style.id}-v1`;
  await api('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      external_id: externalId,
      listing,
      style_id: style.id,
      title: 'Villa Gallura · Portobello di Gallura',
      subtitle: style.subtitle,
      narrative: `${style.name}: concept di valorizzazione virtuale basato sulle fotografie reali dell'immobile.`,
      location_label: 'Portobello di Gallura, Aglientu',
      status: 'draft',
      version: 1,
      sort_order: styleIndex + 1,
      generation_provider: 'Claude skill / Nano Banana',
      prompt_version: 'gallura-v1',
      metadata: { demo: true, listing_match: 'geometry_verified', floor_plan_available: false },
      assets: originalAssets(),
    }),
  });

  const patches = [];
  for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
    patches.push(await uploadRenewal(externalId, style, views[viewIndex], viewIndex));
  }
  await api(`?external_id=${encodeURIComponent(externalId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ external_id: externalId, status: 'published', asset_patches: patches }),
  });
  console.log(`Published ${externalId}: ${patches.length * 2} assets`);
}

console.log('Gallura renewal seed complete');

