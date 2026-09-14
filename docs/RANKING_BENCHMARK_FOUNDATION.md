# Ranking and benchmark foundation — 2026-09-14

## Scope and release status

Independent implementation on `codex/ranking-benchmark-foundation`, based on
`origin/main` at `eb19231`. No merge or cherry-pick of Claude PR #34.
This is a tested experimental foundation, **not a production rollout**.
The next task is the benchmark mini-scraper; this change does not collect or
publish a fabricated benchmark. Existing production data has not been rewritten.

## Five-point acceptance record

1. **Version isolation — implemented.** Historical `legacy_low_price_m2` and
   `neutral_fractionability` engine outputs are unchanged. New opt-in strategy:
   `deal_quality_v2`, physical scoring mode `physical_evidence_v2`.
2. **Economic consistency — implemented.** Per-unit exits and break-even use
   shared underwriting; mono/bilo EUR 25,000, trilo EUR 30,000 per FINAL unit.
3. **Collection budget/deadline — implemented, mocked integration verified.**
   `balanced_v2` allocates every source query, including variants/fallbacks;
   bounded workers and explicit partial status. No claim of live actor validation.
4. **Benchmark quality — implemented and tested.** Identity, condition, room
   type, size band, freshness, sample thresholds and source-price preservation.
5. **Same-pool comparison — implemented/tested with synthetic fixtures.**
   **Real canary remains pending:** no usable local/process APIFY_TOKEN; an
   authenticated production environment pull from Vercel returned an empty token.
   This does not prove the deployed application lacks its runtime credential.

## Strategies and ranking stages

Historical strategies retain their existing scoring modes, bonuses and tie rules.
`deal_quality_v2` uses mostRecent retrieval and evidence-only acquisition scoring:
surface split screen 10, plan 30, second entrance 30, double exposure 15,
multiple bathrooms 15 (maximum 100). These are provisional evidence weights,
not learned probabilities or confirmation of technical/legal feasibility.
The engine labels technical/legal feasibility `not_verified`.

The acquisition shortlist is still an evidence shortlist. The subsequent
valuation stage fetches the whole eligible source pool before economic sorting,
up to 10,000 rows; larger pools fail rather than silently rank an incomplete pool.
It removes nonfractionable surface plans, then ranks assessed cases by actual
base ROI, and places unassessable cases in a separate final group with null ROI.
A negative assessed ROI can precede an unknown ROI: unknown does not mean zero.
No old door-score cutoff and no AI valuation are allowed for v2.
The public run endpoint still accepts only neutral_fractionability; no new
ranking has been silently enabled on the frontend.

## Formulas and financial caveats

For each actual planned final unit i, use its area Ai and matching asking
reference Pi. Exit = sum(Ai * Pi). Areas already incorporate the planner's loss
factor; do not apply another 0.92.

- Purchase overhead: existing shared assumption, currently 12% of acquisition.
- Transformation: sum of final-unit costs (25k mono/bilo, 30k trilo).
- Project cost = purchase + purchase overhead + transformation.
- Selling cost = 3% of scenario exit.
- Profit = exit - project cost - selling cost.
- ROI = profit / (project cost + selling cost), using shared underwriting.
- Break-even exit = project cost / 0.97.
- Break-even EUR/m2 = break-even exit / sum(Ai).

No new holding, contingency, financing, income/corporate tax or project-duration
assumptions have been inserted. Therefore this is modelled operation ROI, not
investor net return or annualized return. Quantile scenarios describe asking
observations, not probabilities or achieved sale prices. The exact underwriting
object used for ranking is reused for persistence to avoid rounding divergence.

## Benchmark input contract

`buildAskingBenchmark(observations, {minimumSample:8,maxAgeDays:90,now})` accepts
normalized observations with:

```json
{
  "source": "idealista",
  "source_listing_id": "example-id",
  "city": "Milano",
  "neighborhood": "Isola",
  "rooms": 2,
  "size_mq": 46,
  "price_eur": 276000,
  "condition": "renovated",
  "renovation_verified": true,
  "observed_at": "2026-09-13T12:00:00Z"
}
```

This example is synthetic, not a market quote. Condition must come from evidence
in the listing/review, not simply the scraper query filter. Good condition is
not equivalent to renovated. Contradictory query/listing conditions are rejected.
Rooms must be explicit: area alone never identifies a bilocale or trilocale.

Segments: exact normalized city + neighborhood + unit type + size band
(`under40`, `40to59`, `60to89`, `90plus`) + condition. Each planned unit needs
its own fresh renovated segment. No broad city fallback, arbitrary appreciation,
bilocale-to-trilocale substitution or hidden quality multiplier.

Latest observation per source ID wins; ambiguous same-timestamp observations
are quarantined. Distinct source IDs are NOT removed merely because price and
area match. Cross-portal counting as one home requires both
`identity_confirmed:true` and `canonical_property_id` from upstream identity
validation. Both observations/prices remain available; the lower asking EUR/m2
is used for the confirmed duplicate's segment statistic.

Output includes p25/median/p75, sample count, actual configurable usability
threshold, oldest observation, rejected counts, source observations, version
and input hash. Stale, malformed or non-monotonic quantiles fail closed.
Absence of confirmed identity can still leave cross-portal duplicates; address,
floor, amenities, commercial-area comparability and atypical outliers require
further validation in the next collector task. These are not AVM confidence bounds.

## Collection controls

Set `TORIUM_QUERY_BUDGET_MODE=balanced_v2` (CLI default remains legacy).
For every source, quotas sum exactly to maxItemsPerSource. A budget smaller than
the number of source queries fails clearly. No implicit minimum of 20/query.
Total budget must cover the declared per-source budget for all selected sources.
Quota is raw source capacity, not a guarantee of that many unique eligible homes.
Duplicates, area filtering, thin supply and failure reduce yield. No adaptive
refill, query retry, new zone mappings or mini-scraper is included.

`TORIUM_QUERY_CONCURRENCY` defaults to 2 (allowed 1–4).
`TORIUM_QUERY_DEADLINE_MS` defaults to 210000. Requests and polling are abortable;
started actors receive server-side timeouts and only actors started by this
invocation can receive cleanup aborts. Unknown start IDs rely on server timeout.
Cleanup has a separate 10-second request timeout. Active run guard is per process,
not a distributed lock. Supabase persistence is not covered by the query deadline.
Large production workloads ultimately need durable background orchestration.

The frontend run endpoint selects bounded collection, returns collection_status
and query_errors. Partial results are explicitly recorded; if no rows were
collected and errors occurred, the call fails. Query payloads contain run IDs
and per-query statuses. `actor_cleanup` records attempted cleanup outcomes.
An empty successful actor response is distinct from an aborted query.
Villa execution is unchanged and does not use this fractioning executor.

Apify API references: [start and timeout](https://docs.apify.com/api/v2/actors-runs-post),
[abort owned run](https://docs.apify.com/api/v2/actor-run-abort-post).

## Persistence and safe operation

No schema migration required. Existing search_strategy/scoring_mode on runs
identify the strategy. Query diagnostics stay in run raw_output. Assessment,
benchmark version/hash, per-unit references and `ranking_basis:modelled_roi_pct`
are retained in each triage_properties.raw_result. Persisted ranking_score is
the actual base ROI for v2 (may be negative), not a 0–100 confidence score.
Unknown exits and ROI remain null.

Existing valuation replacement behavior is not redesigned: rerunning valuation
replaces the run's property rows. Use a NEW run ID; do not relabel old runs to v2.
Atomic/versioned publication remains a future persistence improvement.

## Reproducible commands (PowerShell)

```powershell
npm test
node --test test/ranking-foundation.test.js
node scripts/check-ranking-pipeline.mjs
node scripts/compare-ranking-pool.js normalized-pool.json reviewed-benchmark.json 2026-09-14T12:00:00Z

# Payload inspection only: no actor calls or database writes.
$env:TORIUM_DRY_RUN='true'
$env:TORIUM_SEARCH_STRATEGY='deal_quality_v2'
$env:TORIUM_QUERY_BUDGET_MODE='balanced_v2'
$env:TORIUM_MASSIVE_SOURCES='idealista,immobiliare'
$env:TORIUM_MASSIVE_AREAS='Milano'
$env:TORIUM_MASSIVE_MAX_ITEMS_PER_SOURCE='10'
$env:TORIUM_MASSIVE_MAX_TOTAL_RAW_LISTINGS='20'
node pipelines/triage-multisource-massive.js rankingFoundationCanary
```

When the Apify credential is available, use the JS runMassiveTriage API with
`persist:false`, small fixed budgets and `onCollected` to capture normalized
rows locally; feed those identical rows into compare-ranking-pool. Do not remove
DRY_RUN from the CLI example and assume it is non-persistent: default CLI saves.
For v2 valuation, provide a reviewed benchmark through options.benchmark or
TORIUM_EXIT_BENCHMARK_PATH. A missing benchmark fails explicitly.

## Verification evidence

- 288 complete historical engine-output comparisons against eb19231: zero changes.
- 16 new tests: costs/break-even, benchmark dedup and quality, same-pool ranking,
  exact quotas, bounded concurrency, deadline and cleanup, process isolation,
  persisted links/ROI/null unknown exits using mocked HTTP.
- Full suite: 357 tests passed, zero failures (Node 24.18).
- Live actor canary and production smoke/build/deploy are **not completed**.

## Next task (separate)

Build the small benchmark collector around the configured actors, verify their
actual room/condition/geography fields, collect a balanced controlled sample,
review normalization/identity/renovation evidence, and measure coverage before
promoting this opt-in strategy. Do not interpret eight samples as sufficient
validation of a market model by itself.
