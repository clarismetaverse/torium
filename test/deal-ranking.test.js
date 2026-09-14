import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCandidates,
  buildAreaBuyReferences,
  dealRankingScore,
  exitReferenceFor,
  UNASSESSABLE_SCORE,
} from '../lib/deal-ranking.js';
import { resolveSearchStrategy } from '../lib/search-strategies.js';
import { scoreValuedResult, sourceCandidateOrder, sortValuedResults } from '../lib/valuation-runner.js';

const DEAL = resolveSearchStrategy('deal_quality');
const NEUTRAL = resolveSearchStrategy('neutral_fractionability');
const LEGACY = resolveSearchStrategy('legacy_low_price_m2');

function candidate(overrides = {}) {
  return {
    neighborhood: 'Cimiano',
    size_mq: 150,
    price_eur: 150 * 3000,
    estimated_final_units: 3,
    ...overrides,
  };
}

const BENCHMARK = {
  zones: [{
    zone_id: 'Cimiano',
    exit_eur_mq: {
      monolocale: null,
      bilocale: { eur_mq: 4516, measured_at: 'neighbourhood', sample: 6 },
      trilocale: { eur_mq: 4000, measured_at: 'zone', sample: 9 },
    },
  }, {
    zone_id: 'Isola',
    exit_eur_mq: {
      monolocale: null,
      bilocale: null,
      trilocale: { eur_mq: 6225, measured_at: 'zone', sample: 11 },
    },
  }],
};

test('an area speaks for itself only once enough of it has been seen', () => {
  const references = buildAreaBuyReferences([
    ...Array.from({ length: 4 }, (_u, index) => candidate({ price_eur: 150 * (3000 + index * 100) })),
    candidate({ neighborhood: 'Isola', price_eur: 150 * 6000 }),
  ]);

  assert.equal(references.get('Cimiano').buy_eur_mq, 3150);
  assert.equal(references.get('Isola').buy_eur_mq, null, 'one listing is not a market');
  assert.equal(references.get('Isola').sample, 1);
});

test('the buy reference ignores the same implausible prices the exit benchmark does', () => {
  const references = buildAreaBuyReferences([
    ...Array.from({ length: 4 }, (_u, index) => candidate({ price_eur: 150 * (3000 + index * 100) })),
    candidate({ price_eur: 150 * 400 }),
    candidate({ price_eur: 150 * 40000 }),
  ]);
  assert.equal(references.get('Cimiano').sample, 4);
});

test('the exit price falls through the bands rather than reporting nothing', () => {
  assert.equal(exitReferenceFor('Cimiano', BENCHMARK).exit_band, 'bilocale');
  assert.equal(exitReferenceFor('Isola', BENCHMARK).exit_band, 'trilocale');
  assert.equal(exitReferenceFor('Baggio', BENCHMARK), null);
  assert.equal(exitReferenceFor('Cimiano', null), null);
});

test('break-even sits at fifty, so the score reads as margin', () => {
  assert.equal(dealRankingScore({ status: 'assessed', margin: 0 }), 50);
  assert.equal(dealRankingScore({ status: 'assessed', margin: 0.2 }), 70);
  assert.equal(dealRankingScore({ status: 'assessed', margin: -0.3 }), 20);
});

test('an unmeasurable area is not scored as a bad deal', () => {
  assert.equal(dealRankingScore({ status: 'unassessable', margin: null }), UNASSESSABLE_SCORE);
  assert.equal(dealRankingScore(null), UNASSESSABLE_SCORE);
  assert.ok(UNASSESSABLE_SCORE < 50, 'it ranks below anything that covers its costs');
  assert.ok(UNASSESSABLE_SCORE > dealRankingScore({ status: 'assessed', margin: -0.3 }),
    'and above anything that plainly does not');
});

test('a cheaper property in the same area outranks a dearer one', () => {
  const pool = [
    ...Array.from({ length: 4 }, (_u, index) => candidate({ price_eur: 150 * (4000 + index * 100) })),
    candidate({ price_eur: 150 * 2600 }),
  ];
  const assessed = assessCandidates(pool, { benchmark: BENCHMARK });
  const cheapest = assessed[assessed.length - 1];
  const dearest = assessed[3];

  assert.equal(cheapest.assessment.status, 'assessed');
  assert.ok(cheapest.assessment.discount_to_area_pct > 0);
  assert.ok(dealRankingScore(cheapest.assessment) > dealRankingScore(dearest.assessment));
});

test('a property in an area with no exit price is reported, not scored away', () => {
  const pool = Array.from({ length: 5 }, (_u, index) =>
    candidate({ neighborhood: 'Baggio', price_eur: 150 * (2000 + index * 100) }));
  const assessed = assessCandidates(pool, { benchmark: BENCHMARK });

  assert.equal(assessed[0].assessment.status, 'unassessable');
  assert.deepEqual(assessed[0].assessment.missing, ['area_exit_benchmark']);
  assert.ok(dealRankingScore(assessed[0].assessment) < 50,
    'unproven, so it cannot outrank anything shown to cover its costs');
  assert.ok(dealRankingScore(assessed[0].assessment) > 0,
    'but it is not scored away either');
});

// --- the ranking the runner applies -----------------------------------------

test('the deal arm ranks on the assessment, not on the door score', () => {
  const feasible = { doorScore: 10, fractioningFeasible: true };
  const good = scoreValuedResult(DEAL, feasible, {}, {}, { status: 'assessed', margin: 0.25 });
  const bad = scoreValuedResult(DEAL, { doorScore: 90, fractioningFeasible: true }, {}, {},
    { status: 'assessed', margin: -0.2 });

  assert.equal(good, 75);
  assert.equal(bad, 30);
  assert.ok(good > bad, 'the lower door score wins when the deal is better');
});

test('an apartment that cannot be divided is not ranked at all', () => {
  const score = scoreValuedResult(DEAL, { doorScore: 0, fractioningFeasible: false }, {}, {},
    { status: 'assessed', margin: 0.9 });
  assert.equal(score, 0, 'feasibility is the gate, however good the price looks');
});

test('the deal arm reads the whole pool before choosing what to value', () => {
  // Its order cannot be expressed in SQL, so it asks for a stable one and
  // ranks afterwards rather than letting the database pick the shortlist.
  assert.equal(sourceCandidateOrder(DEAL), 'id.asc');
});

test('the experiment and its control are untouched', () => {
  // docs/UNBIASED_SEARCH_EXPERIMENT.md: the neutral arm is deliberately blind
  // to price and ROI. Editing it would make every run before this change
  // incomparable with every run after it.
  assert.equal(sourceCandidateOrder(NEUTRAL), 'door_score.desc.nullslast');
  assert.equal(scoreValuedResult(NEUTRAL, { doorScore: 60 }, { spread_base_eur: 900000 }, {}), 60);
  assert.equal(scoreValuedResult(NEUTRAL, { doorScore: 60 }, { spread_base_eur: -100000 }, {}), 60);
  assert.match(sourceCandidateOrder(LEGACY), /price_by_area\.asc/);
});

test('ties keep source order, as in the other arms', () => {
  const first = { listing_index: 0, ranking_score: 50 };
  const second = { listing_index: 1, ranking_score: 50 };
  assert.deepEqual(sortValuedResults([second, first], DEAL), [first, second]);
});

test('a name from the other portal still finds its zone price', () => {
  // Idealista calls it "Navigli - Porta Genova", Immobiliare "Navigli -
  // Darsena". The benchmark can only be keyed in one vocabulary, and keyed in
  // Idealista's it priced 52 per cent of Idealista's neighbourhoods against 16
  // per cent of Immobiliare's - the larger source. Both resolve to the same
  // canonical zone, which is what the fallback uses.
  const benchmark = {
    zones: [{
      zone_id: 'Navigli - Porta Genova',
      canonical_zone_id: 'genova-ticinese',
      exit_eur_mq: { monolocale: null, bilocale: { eur_mq: 6709, measured_at: 'zone', sample: 9 }, trilocale: null },
    }],
  };

  assert.equal(exitReferenceFor('Navigli - Porta Genova', benchmark)?.exit_eur_mq, 6709);
  assert.equal(exitReferenceFor('Navigli - Darsena', benchmark), null,
    'the other portal name is not a key');
  assert.equal(exitReferenceFor('Navigli - Darsena', benchmark, 'genova-ticinese')?.exit_eur_mq, 6709,
    'but its canonical zone is');
});

test('a street price is never lent to another street', () => {
  // A price measured on one neighbourhood describes that neighbourhood. Only a
  // zone-level median may stand in for a name the benchmark does not know.
  const benchmark = {
    zones: [{
      zone_id: 'Isola',
      canonical_zone_id: 'cenisio-sarpi-isola',
      exit_eur_mq: { monolocale: null, bilocale: { eur_mq: 6225, measured_at: 'neighbourhood', sample: 11 }, trilocale: null },
    }],
  };
  assert.equal(exitReferenceFor('Paolo Sarpi', benchmark, 'cenisio-sarpi-isola'), null);
});

test('a missing exit price does not erase the discount that is known', () => {
  // On a 397-property run, 106 of the 179 properties the assessment could not
  // complete were missing only the exit price. Their modelled returns ran from
  // -68 to +73 per cent, and every one of them carried the same score.
  const pool = [
    ...Array.from({ length: 5 }, (_u, index) =>
      candidate({ neighborhood: 'Baggio', price_eur: 150 * (3000 + index * 100) })),
    candidate({ neighborhood: 'Baggio', price_eur: 150 * 2000 }),
  ];
  const assessed = assessCandidates(pool, { benchmark: BENCHMARK });
  const cheap = assessed[assessed.length - 1].assessment;
  const dear = assessed[3].assessment;

  assert.equal(cheap.status, 'unassessable');
  assert.deepEqual(cheap.missing, ['area_exit_benchmark']);
  assert.ok(cheap.discount_to_area_pct > 30, 'the discount is still reported');
  assert.ok(dealRankingScore(cheap) > dealRankingScore(dear),
    'and it orders them');
});

test('nothing unproven outranks a property shown to cover its costs', () => {
  const brilliantButUnproven = { status: 'unassessable', discount_to_area_pct: 95, margin: null };
  const barelyProven = { status: 'assessed', margin: 0 };
  assert.ok(dealRankingScore(brilliantButUnproven) < dealRankingScore(barelyProven));
  assert.ok(dealRankingScore(brilliantButUnproven) > 0);
});

test('an assessment with no discount at all keeps the neutral position', () => {
  assert.equal(dealRankingScore({ status: 'unassessable', discount_to_area_pct: null }), UNASSESSABLE_SCORE);
  assert.equal(dealRankingScore(null), UNASSESSABLE_SCORE);
});
