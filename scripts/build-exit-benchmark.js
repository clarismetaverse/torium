#!/usr/bin/env node
// Turns collected exit-market listings into the benchmark the valuation should
// be using, and says plainly how far the current assumptions are from it.
//
//   node scripts/build-exit-benchmark.js data/exit-market-2026-09.json
//   node scripts/build-exit-benchmark.js data/exit-market-2026-09.json --out config/valuation-profiles/milan-exit-benchmark-v1.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildExitBenchmarks, citywideSizePremium } from '../lib/exit-benchmark.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/build-exit-benchmark.js <collected.json> [--out <path>]');
  process.exit(1);
}
const outIndex = process.argv.indexOf('--out');
const outputPath = outIndex === -1 ? null : process.argv[outIndex + 1];

const payload = JSON.parse(readFileSync(inputPath, 'utf8'));
const listings = Array.isArray(payload) ? payload : payload.listings || [];
const benchmark = buildExitBenchmarks(listings);
const premium = citywideSizePremium(benchmark);

const { coverage } = benchmark;
console.log(`listings seen ${coverage.listings_seen}, used ${coverage.listings_used}`);
console.log(`rejected: ${Object.entries(coverage.rejected).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`zones with data: ${coverage.zones_with_data}, usable segments: ${coverage.usable_segments}`);
if (coverage.condition_conflicts) {
  console.log(`condition conflicts: ${coverage.condition_conflicts} `
    + '(the query and the listing disagreed; a high rate means the filter is weak)');
}

console.log('\nExit price per square metre, renovated units, by zone:');
console.log('zone                 monoloc.   biloc.   triloc.    large    biloc/large');
for (const zone of benchmark.zones) {
  const cell = (band) => String(band.renovated.usable ? band.renovated.median_eur_mq : '-').padStart(8);
  const premiumCell = zone.size_premium.bilocale_over_large;
  console.log(
    zone.zone_id.padEnd(20)
    + cell(zone.bands.monolocale)
    + cell(zone.bands.bilocale)
    + cell(zone.bands.trilocale)
    + cell(zone.bands.large)
    + (premiumCell === null ? '        -' : ('   x' + premiumCell.toFixed(2)).padStart(9)));
}

console.log('\nWhat a renovation is worth in the market, by zone (renovated / to renovate):');
for (const zone of benchmark.zones) {
  const entries = Object.entries(zone.bands)
    .filter(([, band]) => band.renovation_premium !== null)
    .map(([id, band]) => `${id} x${band.renovation_premium.toFixed(2)}`);
  if (entries.length) console.log(`  ${zone.zone_id.padEnd(20)} ${entries.join('  ')}`);
}

console.log('\nCitywide size premium, pooled across zones:');
console.log(`  monolocale over large  x${premium.monolocale_over_large ?? '-'} `
  + `(${premium.zones_contributing.monolocale} zones)`);
console.log(`  bilocale over large    x${premium.bilocale_over_large ?? '-'} `
  + `(${premium.zones_contributing.bilocale} zones)`);
console.log(`  trilocale over large   x${premium.trilocale_over_large ?? '-'} `
  + `(${premium.zones_contributing.trilocale} zones)`);

console.log('\nThe valuation profile currently assumes:');
console.log('  monolocale x1.06   bilocale x1.04-1.06   trilocale x1.02');
const measured = premium.bilocale_over_large;
if (measured) {
  const assumed = 1.05;
  const factor = measured / assumed;
  console.log(`\nMeasured bilocale premium is ${(factor).toFixed(2)}x the assumed one`
    + ` (${((measured - 1) * 100).toFixed(0)}% against ${((assumed - 1) * 100).toFixed(0)}%).`);
  console.log(factor > 1.5
    ? 'The model is understating the core value driver: it is rejecting deals that work.'
    : factor < 0.8
      ? 'The model is overstating the core value driver: it is accepting deals that do not.'
      : 'The assumption is close enough to the measurement to keep for now.');
}

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ ...benchmark, citywide_size_premium: premium }, null, 2), 'utf8');
  console.log(`\nWritten to ${outputPath}`);
}
