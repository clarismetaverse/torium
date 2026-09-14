#!/usr/bin/env node
// Collects the market TORIUM sells into.
//
//   node scripts/collect-exit-market.js --dry-run
//   node scripts/collect-exit-market.js --out data/exit-market-2026-09.json
//   node scripts/collect-exit-market.js --segments exitSmallRenovatedMilan --max-items 100
//
// Every run of the actor costs credits, so --dry-run prints exactly what would
// be requested and stops. Nothing here writes to Supabase: this is measurement
// input, not product data, and it stays a file until somebody has looked at it.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runIdealistaScraper, searches } from '../scrapers/idealista/client.js';
import { normalizeSourceListing } from '../lib/source-normalizers.js';

const DEFAULT_SEGMENTS = [
  'exitSmallRenovatedMilan',
  'exitSmallToRenovateMilan',
  'exitMidRenovatedMilan',
  'exitLargeRenovatedMilan',
];

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 || index === process.argv.length - 1 ? fallback : process.argv[index + 1];
}

const dryRun = process.argv.includes('--dry-run');
const outputPath = argument('--out', `data/exit-market-${new Date().toISOString().slice(0, 10)}.json`);
const maxItems = Number(argument('--max-items', '0')) || null;
const segments = (argument('--segments') || DEFAULT_SEGMENTS.join(',')).split(',').map((name) => name.trim());

for (const segment of segments) {
  if (!searches[segment]) {
    console.error(`Unknown segment: ${segment}`);
    console.error(`Available: ${Object.keys(searches).join(', ')}`);
    process.exit(1);
  }
}

// The condition the query asked for travels with every listing it returned.
// That is more reliable than reading an agent's prose later, and it is what
// separates "what we sell" from "what we buy" in the benchmark.
function queriedCondition(input) {
  const conditions = Array.isArray(input.condition) ? input.condition : [];
  if (conditions.includes('renew')) return 'renew';
  if (conditions.includes('good') || conditions.includes('newDevelopment')) return 'good';
  return null;
}

async function collect() {
  const collected = [];
  const perSegment = [];

  for (const segment of segments) {
    const input = { ...searches[segment], ...(maxItems ? { maxItems } : {}) };
    const condition = queriedCondition(input);

    if (dryRun) {
      console.log(`\n${segment} (condition=${condition ?? 'any'}):`);
      console.log(JSON.stringify(input, null, 2));
      perSegment.push({ segment, requested: input.maxItems, returned: null, condition });
      continue;
    }

    process.stderr.write(`${segment}: requesting up to ${input.maxItems} listings...\n`);
    const raw = await runIdealistaScraper(input);
    const items = Array.isArray(raw) ? raw : [];

    for (const item of items) {
      const normalized = normalizeSourceListing(item, {
        source_channel: 'idealista',
        query_name: segment,
        query_municipality: input.location,
      });
      collected.push({
        segment,
        queried_condition: condition,
        canonical_zone_id: normalized.canonical_zone_id,
        neighborhood: normalized.neighborhood,
        district: normalized.district,
        area_label: normalized.area_label,
        size_mq: normalized.size_mq,
        price_eur: normalized.price_eur,
        price_by_area: normalized.price_by_area,
        status: normalized.property_condition,
        rooms: normalized.rooms,
        source_listing_id: normalized.source_listing_id,
      });
    }

    perSegment.push({ segment, requested: input.maxItems, returned: items.length, condition });
    process.stderr.write(`${segment}: ${items.length} listings\n`);
  }

  return { collected, perSegment };
}

const { collected, perSegment } = await collect();

if (dryRun) {
  console.log('\nDry run: nothing was requested and no credits were spent.');
  console.log(`Segments that would run: ${segments.length}`);
  process.exit(0);
}

const payload = {
  collected_at: new Date().toISOString(),
  city: process.env.TORIUM_CITY || 'Milano',
  segments: perSegment,
  listings: collected,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

console.log(`\n${collected.length} listings written to ${outputPath}`);
for (const entry of perSegment) {
  console.log(`  ${entry.segment.padEnd(28)} ${String(entry.returned).padStart(4)} listings`);
}
console.log('\nNext: node scripts/build-exit-benchmark.js ' + outputPath);
