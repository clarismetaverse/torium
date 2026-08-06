import test from 'node:test';
import assert from 'node:assert/strict';
import { combineRunOutputs, rescoreCombinedResults } from '../lib/combine-run-outputs.js';

test('combines neutral and legacy results, deduplicates, and preserves provenance', () => {
  const combined = combineRunOutputs([
    {
      runId: 'neutral-run',
      output: {
        city: 'Milano',
        search_strategy: 'neutral_fractionability',
        scraped_count: 20,
        eligible_count: 8,
        results: [
          { listing_index: 4, ranking_score: 99, door_engine: { doorScore: 72 }, listing: { propertyCode: 'A', price: 100 } },
          { listing_index: 5, listing: { propertyCode: 'B', price: 200 } },
        ],
      },
    },
    {
      runId: 'legacy-run',
      output: {
        city: 'Milano',
        search_strategy: 'legacy_low_price_m2',
        scraped_count: 30,
        eligible_count: 10,
        results: [
          { listing_index: 1, listing: { propertyCode: 'B', price: 200 } },
          { listing_index: 2, listing: { propertyCode: 'C', price: 300 } },
        ],
      },
    },
  ]);

  assert.equal(combined.results.length, 3);
  assert.deepEqual(combined.merge_summary, {
    input_result_count: 4,
    duplicates_removed: 1,
    unique_result_count: 3,
  });
  assert.equal(combined.scraped_count, 50);
  assert.equal(combined.eligible_count, 18);
  assert.deepEqual(combined.results[1].origin_run_ids, ['neutral-run', 'legacy-run']);
  assert.deepEqual(combined.results[1].origin_search_strategies, ['neutral_fractionability', 'legacy_low_price_m2']);
  assert.deepEqual(combined.results.map((result) => result.listing_index), [0, 1, 2]);
  assert.equal(combined.results[0].source_ranking_score, 99);
  assert.equal(combined.results[0].ranking_score, 99);

  const rescored = rescoreCombinedResults(combined, (result) => ({
    doorScore: result.listing.price === 100 ? 72 : 50,
    doorScoreReasons: ['physical_only'],
  }));
  assert.equal(rescored.results[0].source_ranking_score, 99);
  assert.equal(rescored.results[0].ranking_score, 72);
  assert.deepEqual(rescored.results[0].door_engine.doorScoreReasons, ['physical_only']);
});
