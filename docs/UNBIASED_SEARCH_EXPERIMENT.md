# Unbiased search experiment

**Status:** controlled experiment, before the scoring/strategy architecture refactor
**Actor verified:** `igolaizola~idealista-scraper`

## Purpose

This experiment measures how much the current shortlist is shaped by price per square meter. It changes only source ordering and pre-score ranking behavior. It does not introduce microzone, sellability, or strategy-profile models.

Set `TORIUM_SEARCH_STRATEGY` to one of:

| Strategy | Idealista `sortBy` | Door Score | Equal-score ordering |
|---|---|---|---|
| `legacy_low_price_m2` | `lowestPriceM2` | Existing physical signals plus price/m² and price-reduction bonuses/penalties | Lowest price/m² first |
| `neutral_fractionability` | `mostRecent` | Physical signals only; price/m², price reductions, resale amenities, furnishing and renovation/spread signals are retained as data but do not affect the score | Stable source order; no price/m² tie-break |

The actor's published input schema supports `mostRecent`, `relevance`, and `lowestPriceM2`; its declared default is `mostRecent`. The neutral mode sets `mostRecent` explicitly so runs remain auditable if the actor default changes.

Known Milan areas are sent to the actor as exact Idealista Location IDs (for example, Gottardo is `0-EU-IT-MI-01-001-135-05-004`). This avoids drawing only the newest city-wide listings and then losing the whole batch in a post-fetch text filter. Unknown areas retain the broad-Milan fallback and post-fetch validation.

The current hard pre-triage filters remain shared by both strategies, including exclusion of renovated/new listings. They are intentionally outside the scope of this experiment.

## Before the first persisted run

Apply:

```text
supabase/migrations/202608030001_add_search_strategy_to_triage_runs.sql
```

This adds nullable `search_strategy` and `scoring_mode` columns so historical rows remain valid.

## Dry runs

PowerShell:

```powershell
$env:TORIUM_DRY_RUN='true'
$env:TORIUM_MASSIVE_SOURCES='idealista'
$env:TORIUM_SEARCH_STRATEGY='legacy_low_price_m2'
npm run triage:massive

$env:TORIUM_SEARCH_STRATEGY='neutral_fractionability'
npm run triage:massive
```

The JSON output includes the strategy, scoring mode, shortlist tie-breaker, distinct search name, and complete final payload for every planned actor query.

## Comparable live runs

Keep every environment variable other than the strategy unchanged. In PowerShell:

```powershell
$env:TORIUM_DRY_RUN='false'
$env:TORIUM_MASSIVE_SOURCES='idealista'
$env:TORIUM_SEARCH_STRATEGY='legacy_low_price_m2'
npm run triage:massive

$env:TORIUM_SEARCH_STRATEGY='neutral_fractionability'
npm run triage:massive
```

Generated search names are `milanoFractioningMassive-legacy_low_price_m2` and `milanoFractioningMassive-neutral_fractionability`.

## Frontend

Persisted runs appear automatically in the existing run selector. The frontend shows the strategy and scoring mode and loads only eligible source listings. Legacy runs keep the price/m² tie-break; neutral runs order by Physical Fractionability Score without reintroducing a price/m² tie-break in the API.

The **Calcola valuation & ROI** action values the selected Supabase run and then reloads it. It uses the same server-side PIN protection as run creation. The frontend enables deterministic valuation only; it does not consume AI credits.

`milan_microzone_exit_v1_2026_06` currently covers Corso San Gottardo / Navigli-Bocconi. Its base EUR/mq is the rounded midpoint of June 2026 asking-price benchmarks from Immobiliare.it and idealista/data. It applies a 92% saleable-area ratio, an explicit output-unit size multiplier, low/base/high multipliers of 0.90/1.00/1.10, and rounds each projected unit to EUR 5,000. Unsupported microzones fail closed rather than inheriting a city-wide guess. These are versioned preliminary asking-price priors, not transaction evidence or a professional appraisal.

AI valuation remains available from the CLI with `TORIUM_VALUATION_MODE=ai`. On Vercel it can authenticate to AI Gateway with deployment OIDC; locally it can use `OPENAI_API_KEY`. It is not the default and must not replace the deterministic inputs silently.

Valuation is deliberately downstream of ranking. For `neutral_fractionability`, the persisted `ranking_score` remains the physical Door Score, equal-score rows keep candidate order, and exit value, spread, ROI, confidence, and recommended action cannot reorder the shortlist. For `legacy_low_price_m2`, the prior economic composite and price/mÂ² tie-break remain available.

CLI valuation:

```powershell
$env:TORIUM_GPT_TRIAGE_LIMIT='20'
npm run triage:gpt:latest -- 1785975759601-milanoFractioningMassive-neutral_fractionability
```

## Supabase validation

The homepage also exposes **Avvia run neutral**. It starts one Idealista scout run inside a Vercel Function, where the sensitive Apify and Supabase credentials remain server-side. The endpoint accepts only `neutral_fractionability`, requires the separate `TORIUM_RUN_PIN`, rejects cross-origin browser requests, and waits for persistence before refreshing the run selector. The PIN is retained only in the browser session.

The Function has a 300-second limit. Keep `TORIUM_APIFY_MAX_WAIT_SECONDS` at or below 240 for frontend-triggered scout runs; normal/deep runs require a durable workflow rather than this endpoint.

Latest runs and persisted modes:

```sql
select run_id, created_at, search_name, search_strategy, scoring_mode,
       raw_source_count, eligible_count, pre_scored_count
from triage_runs
where search_strategy in ('legacy_low_price_m2', 'neutral_fractionability')
order by created_at desc;
```

Distribution comparison for one legacy and one neutral run:

```sql
select r.search_strategy,
       count(*) filter (where not s.pre_triage_excluded) as eligible,
       round(avg(s.price_by_area) filter (where not s.pre_triage_excluded)) as avg_price_m2,
       percentile_cont(0.5) within group (order by s.price_by_area)
         filter (where not s.pre_triage_excluded) as median_price_m2,
       round(avg(s.size_mq) filter (where not s.pre_triage_excluded), 1) as avg_size_mq,
       round(avg(s.bathrooms) filter (where not s.pre_triage_excluded), 1) as avg_bathrooms,
       count(*) filter (where not s.pre_triage_excluded and s.has_plan) as with_plan
from triage_runs r
join triage_source_listings s on s.run_id = r.run_id
where r.run_id in ('LEGACY_RUN_ID', 'NEUTRAL_RUN_ID')
group by r.search_strategy;
```

Candidate overlap:

```sql
with legacy as (
  select canonical_source_key from triage_source_listings
  where run_id = 'LEGACY_RUN_ID' and not pre_triage_excluded
), neutral as (
  select canonical_source_key from triage_source_listings
  where run_id = 'NEUTRAL_RUN_ID' and not pre_triage_excluded
)
select count(*) as overlapping_candidates
from legacy join neutral using (canonical_source_key);
```

## Known limits

- `mostRecent` is neutral with respect to price, but introduces recency ordering.
- The actor notes that very large scrapes may internally use price ordering to pass Idealista's result window.
- Equal physical scores preserve source order rather than adding a new non-price heuristic.
- Existing pre-triage filters still encode the current renovation/spread thesis.
- Door Score remains the current V1 heuristic; this experiment does not create independent economic or sellability scores.
