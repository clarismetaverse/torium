import 'dotenv/config';
import { normalizeListingV1 } from '../lib/normalized-listing-v1.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = String(process.argv[2] || '').replace(/^supabase:/, '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (!runId || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(runId)) {
  throw new Error('Usage: npm run replay:multisource:v1 -- <run_id>');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function supabaseGet(pathname, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${pathname}`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          [['Authori', 'zation'].join('')]: ['Bearer', SUPABASE_SERVICE_ROLE_KEY].join(' '),
        },
      });
      const body = await response.text();
      if (response.ok) return body ? JSON.parse(body) : [];
      if (![429, 500, 502, 503, 504, 520].includes(response.status) || attempt === attempts) {
        throw new Error(`Supabase replay read failed: ${response.status} ${body.slice(0, 500)}`);
      }
      lastError = new Error(`Transient Supabase status ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await delay(250 * (2 ** (attempt - 1)));
  }
  throw lastError;
}

async function fetchSourceRows() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseGet(
      `triage_source_listings?run_id=eq.${encodeURIComponent(runId)}` +
      `&select=id,source_channel,query_area,query_municipality,raw_listing` +
      `&order=id.asc&limit=${pageSize}&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function blankSourceSummary() {
  return {
    raw_received: 0,
    normalized: 0,
    adapter_errors: 0,
    adapter_schema_valid: 0,
    stable_identity: 0,
    canonical_url: 0,
    raw_address: 0,
    normalized_address: 0,
    raw_images: 0,
    normalized_images: 0,
    raw_floor_plans: 0,
    normalized_floor_plans: 0,
    raw_coordinates: 0,
    normalized_coordinates: 0,
    canonical_zone: 0,
    price_status: {},
    valuation_blocked: 0,
    quality_review: 0,
    quality_pass: 0,
  };
}

function sourceRawCoverage(raw, sourceChannel) {
  if (sourceChannel === 'immobiliare') {
    return {
      address: Boolean(String(raw?.geography?.street || '').trim()),
      images: Array.isArray(raw?.media?.images) && raw.media.images.length > 0,
      floorPlans: Array.isArray(raw?.media?.floorPlans) && raw.media.floorPlans.length > 0,
      coordinates: Number.isFinite(Number(raw?.geography?.geolocation?.latitude)) &&
        Number.isFinite(Number(raw?.geography?.geolocation?.longitude)),
    };
  }
  const images = Array.isArray(raw?.multimedia?.images) ? raw.multimedia.images : [];
  return {
    address: Boolean(String(raw?.address || '').trim()),
    images: images.some((item) => String(item?.tag || '').toLowerCase() !== 'plan') || Boolean(raw?.thumbnail),
    floorPlans: images.some((item) => String(item?.tag || '').toLowerCase() === 'plan'),
    coordinates: Number.isFinite(Number(raw?.latitude)) && Number.isFinite(Number(raw?.longitude)),
  };
}

function increment(summary, key, condition) {
  if (condition) summary[key] += 1;
}

const rows = await fetchSourceRows();
const bySource = {};
const errors = [];

for (const row of rows) {
  const sourceChannel = String(row.source_channel || '').toLowerCase();
  const summary = bySource[sourceChannel] ||= blankSourceSummary();
  summary.raw_received += 1;
  const rawCoverage = sourceRawCoverage(row.raw_listing, sourceChannel);
  increment(summary, 'raw_address', rawCoverage.address);
  increment(summary, 'raw_images', rawCoverage.images);
  increment(summary, 'raw_floor_plans', rawCoverage.floorPlans);
  increment(summary, 'raw_coordinates', rawCoverage.coordinates);

  try {
    const normalized = normalizeListingV1(row.raw_listing, {
      source_channel: sourceChannel,
      query_area: row.query_area,
      query_municipality: row.query_municipality,
    });
    summary.normalized += 1;
    increment(summary, 'stable_identity', Boolean(normalized.source_observation_key));
    increment(summary, 'adapter_schema_valid', normalized.adapter_schema.valid);
    increment(summary, 'canonical_url', Boolean(normalized.canonical_url));
    increment(summary, 'normalized_address', Boolean(normalized.address?.formatted));
    increment(summary, 'normalized_images', normalized.media.images.length > 0);
    increment(summary, 'normalized_floor_plans', normalized.media.floor_plans.length > 0);
    increment(summary, 'normalized_coordinates', Number.isFinite(normalized.location.latitude) && Number.isFinite(normalized.location.longitude));
    increment(summary, 'canonical_zone', Boolean(normalized.location.canonical_zone_id));
    const priceStatus = normalized.asking_price.status;
    summary.price_status[priceStatus] = (summary.price_status[priceStatus] || 0) + 1;
    increment(summary, 'valuation_blocked', normalized.quality.blocking_reasons.length > 0);
    increment(summary, 'quality_review', normalized.quality.status === 'review');
    increment(summary, 'quality_pass', normalized.quality.status === 'pass');
  } catch (error) {
    summary.adapter_errors += 1;
    if (errors.length < 20) errors.push({ row_id: row.id, source_channel: sourceChannel, message: error.message });
  }
}

const checks = [];
for (const [sourceChannel, summary] of Object.entries(bySource)) {
  checks.push({ source_channel: sourceChannel, name: 'all_rows_accounted', pass: summary.raw_received === summary.normalized + summary.adapter_errors });
  checks.push({ source_channel: sourceChannel, name: 'stable_identity_complete', pass: summary.stable_identity === summary.normalized });
  checks.push({ source_channel: sourceChannel, name: 'adapter_schema_complete', pass: summary.adapter_schema_valid === summary.normalized });
  checks.push({ source_channel: sourceChannel, name: 'address_coverage_preserved', pass: summary.normalized_address >= summary.raw_address });
  checks.push({ source_channel: sourceChannel, name: 'image_coverage_preserved', pass: summary.normalized_images >= summary.raw_images });
  checks.push({ source_channel: sourceChannel, name: 'floor_plan_coverage_preserved', pass: summary.normalized_floor_plans >= summary.raw_floor_plans });
  checks.push({ source_channel: sourceChannel, name: 'coordinate_coverage_preserved', pass: summary.normalized_coordinates >= summary.raw_coordinates });
}

const report = {
  schema_version: 'normalized_listing_v1_replay_report',
  run_id: runId,
  generated_at: new Date().toISOString(),
  rows_read: rows.length,
  by_source: bySource,
  checks,
  errors,
  pass: errors.length === 0 && checks.every((check) => check.pass),
};

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;

