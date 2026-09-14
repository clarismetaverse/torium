import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runDoorEngine } from '../lib/door-engine.js';
import { resolveSearchStrategy, compareShortlistItems } from '../lib/search-strategies.js';
import { prepareInvestmentCandidates, sourceRowToListing } from '../lib/valuation-runner.js';

export function compareRankingPool(rows, profile, benchmark, now = new Date().toISOString()) {
  const identity = r => `${r.source_channel}:${r.source_listing_id || r.source_url || r.id}`;
  const historical = {};
  for (const name of ['legacy_low_price_m2', 'neutral_fractionability']) {
    const strategy = resolveSearchStrategy(name);
    historical[name] = rows.map(row => {
      const listing = sourceRowToListing(row);
      const d = runDoorEngine(listing, profile, { scoringMode: strategy.scoringMode, includeEconomicSignals: strategy.includeEconomicDoorSignals });
      return { source_key: identity(row), door_score: d.doorScore, price_by_area: listing.price / listing.size };
    }).sort((a,b) => compareShortlistItems(a,b,strategy) || a.source_key.localeCompare(b.source_key));
  }
  const assessed = prepareInvestmentCandidates(rows, profile, benchmark, now);
  return { compared_at: now, input_count: rows.length,
    pool_sha256: createHash('sha256').update(JSON.stringify([...rows].sort((a,b)=>identity(a).localeCompare(identity(b))))).digest('hex'),
    benchmark_hash: benchmark?.input_sha256 || null,
    note: 'Historical acquisition score versus new economic assessment: different dimensions, same input pool. No causal performance claim.',
    historical, deal_quality_v2: assessed.map(r=>({ source_key:identity(r), status:r.investment_assessment.status,
      roi_base_pct:r.investment_assessment.ranking_score, missing:r.investment_assessment.missing })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error('Usage: node scripts/compare-ranking-pool.js normalized-pool.json [reviewed-benchmark.json] [as-of-ISO]');
  const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const rows = Array.isArray(input) ? input : input.listings;
  if (!Array.isArray(rows)) throw Error('Expected normalized source rows or {listings: rows}');
  const benchmark = process.argv[3] ? JSON.parse(await fs.readFile(process.argv[3], 'utf8')) : null;
  const profile = JSON.parse(await fs.readFile(new URL('../config/investor-profiles/max-doors-20k.json', import.meta.url)));
  console.log(JSON.stringify(compareRankingPool(rows, profile, benchmark, process.argv[4]), null, 2));
}
