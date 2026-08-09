import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSearchStrategy } from '../lib/search-strategies.js';
import {
  buildCompactRunRawOutput,
  resolveValuationProvider,
  scoreValuedResult,
  sortValuedResults,
  sourceCandidateOrder,
  validateValuation,
} from '../lib/valuation-runner.js';

test('run summary does not duplicate full valuation results or links in raw_output', () => {
  const compact = buildCompactRunRawOutput({
    raw_output: {
      raw_source_count: 600,
      results: [{ description: 'large listing payload' }],
      result_links: [{ url: 'https://example.com' }],
    },
  }, {
    valued_count: 373,
    valuation_model: 'temporary-zone-profile',
  });
  assert.equal(compact.raw_source_count, 600);
  assert.equal(compact.valued_count, 373);
  assert.equal(compact.valuation_model, 'temporary-zone-profile');
  assert.equal('results' in compact, false);
  assert.equal('result_links' in compact, false);
});

test('neutral valuation never orders or scores by price and ROI', () => {
  const neutral = resolveSearchStrategy('neutral_fractionability');
  assert.equal(sourceCandidateOrder(neutral), 'door_score.desc.nullslast');
  const first = {
    listing_index: 0,
    ranking_score: scoreValuedResult(neutral, { doorScore: 60 }, { spread_base_eur: 900000 }, { valuation_confidence: 'high' }),
    listing: { priceByArea: 9000 },
  };
  const second = {
    listing_index: 1,
    ranking_score: scoreValuedResult(neutral, { doorScore: 60 }, { spread_base_eur: -100000 }, { valuation_confidence: 'low' }),
    listing: { priceByArea: 2000 },
  };
  assert.equal(first.ranking_score, 60);
  assert.equal(second.ranking_score, 60);
  assert.deepEqual(sortValuedResults([first, second], neutral), [first, second]);
});

test('legacy valuation preserves economic ranking and price tie-break', () => {
  const legacy = resolveSearchStrategy('legacy_low_price_m2');
  assert.match(sourceCandidateOrder(legacy), /price_by_area\.asc/);
  const stronger = scoreValuedResult(legacy, { doorScore: 50 }, { spread_base_eur: 350000 }, {
    fractioning_confidence: 'high', valuation_confidence: 'high', red_flags: [], recommended_action: 'high_priority_review',
  });
  const weaker = scoreValuedResult(legacy, { doorScore: 50 }, { spread_base_eur: -50000 }, {
    fractioning_confidence: 'low', valuation_confidence: 'low', red_flags: ['one'], recommended_action: 'monitor',
  });
  assert.ok(stronger > weaker);
});

test('valuation payload validation rejects missing and inverted scenarios', () => {
  assert.throws(() => validateValuation({}), /missing positive/);
  assert.throws(() => validateValuation({
    total_sale_value_low_eur: 500000,
    total_sale_value_base_eur: 400000,
    total_sale_value_high_eur: 600000,
    final_unit_plan: [],
  }), /low <= base <= high/);
});

test('Vercel valuation uses AI Gateway OIDC when no direct OpenAI key exists', () => {
  const provider = resolveValuationProvider({ VERCEL_OIDC_TOKEN: 'oidc-token' });
  assert.equal(provider.provider, 'vercel_ai_gateway_oidc');
  assert.equal(provider.endpoint, 'https://ai-gateway.vercel.sh/v1/responses');
  assert.match(provider.model, /^openai\//);
});
