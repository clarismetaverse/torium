# TORIUM operations, testing and runbook

**Version:** 1.0
**Verified:** 2026-09-04

## 1. Operating principles

1. Replay before spending on new actor runs.
2. Start with a small canary and scale only after reconciliation.
3. Never use production source data as an implicit schema contract.
4. Keep raw source observations and derived outputs distinguishable.
5. Do not publish a run with unknown count mismatches.
6. Never expose raw payloads or service credentials to the browser.
7. Treat every source, model and configuration change as a versioned experiment.
8. Do not treat a 5,000-item request limit as a reliability guarantee.
9. Preserve the last complete published result during failures.
10. Record the exact deployed commit and applied migration versions.

## 2. Local prerequisites

- Node.js compatible with production Node 24.x;
- npm;
- repository checkout;
- appropriate environment file outside version control;
- Supabase project access;
- Apify token only for real scraping;
- OpenAI credentials only for optional legacy GPT flows;
- Vercel CLI/account only for build or deployment operations.

Minimum environment for read/replay tasks:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Hardened Auth also needs:

```text
SUPABASE_PUBLISHABLE_KEY
```

Real source runs need:

```text
APIFY_TOKEN
```

Never commit `.env` files containing credentials. Inspect variable names, not values, in logs and documentation.

## 3. Install and baseline validation

```powershell
npm install
npm test
```

Target full-suite baseline at the time of this document: **138 passing tests**.

`npm test` is wired to `node --test --test-isolation=none` to avoid process-spawn restrictions on restricted execution contexts.

Syntax checks for directly modified JavaScript:

```powershell
node --check api/run-triage.js
node --check pipelines/triage-multisource-massive.js
node --check lib/door-engine.js
```

Production-equivalent Vercel build:

```powershell
vercel build --prod
```

Review generated function count after every new API file. The current production deployment has 11 Node.js Functions and the active Hobby limit has constrained the API topology.

## 4. Test map

| Area | Tests |
| --- | --- |
| Search strategies | `search-strategies.test.js` |
| Unit planning | `unit-mix-planner.test.js` |
| Door/financial consistency | `financial-underwriting.test.js` |
| Deterministic valuation | `deterministic-valuation.test.js`, `valuation-runner.test.js` |
| Data quality | `data-quality-gate.test.js`, `property-data-quality-ui.test.js` |
| Immobiliare adaptation | `immobiliare-integration.test.js`, `normalized-listing-v1.test.js` |
| Identity/dedup/source offers | `property-identity.test.js`, `source-offers.test.js`, `combine-run-outputs.test.js` |
| Public redaction | `public-listing-identity.test.js` |
| Notes | `property-note-api.test.js` |
| Listing media cache | `listing-assets.test.js` |
| Renewals | `renewals.test.js` |
| Villa domain | `villa-opportunity-engine.test.js`, `villa-search-profiles.test.js`, `villas-frontend.test.js` |
| Run APIs | `run-triage-api.test.js`, `run-valuation-api.test.js`, `run-villas-api.test.js` |
| Auth/preferences | `investor-auth-preferences.test.js` |
| UI controls | `home-controls.test.js` |

Tests are necessary but not sufficient. Actor behavior, serverless timeouts, Vercel rewrites, Supabase RLS and browser flows require integration checks.

## 5. Dry-run and query validation

Before a real actor run:

```powershell
$env:TORIUM_DRY_RUN='true'
$env:TORIUM_SEARCH_STRATEGY='neutral_fractionability'
$env:TORIUM_MASSIVE_SOURCES='idealista,immobiliare'
npm run triage:massive
```

Inspect:

- actor ID and selected adapter;
- every final query payload;
- geographic areas/tiles;
- source ordering;
- condition and typology filters;
- per-query/per-source/total limits;
- scoring mode;
- generated search name.

Dry run should not require `APIFY_TOKEN`.

## 6. Controlled apartment runs

### 6.1 Neutral single-source

```powershell
$env:TORIUM_SEARCH_STRATEGY='neutral_fractionability'
$env:TORIUM_MASSIVE_SOURCES='idealista'
$env:TORIUM_MASSIVE_AREAS='Milano'
npm run triage:massive
```

Expected:

- Idealista `sortBy=mostRecent`;
- scoring `physical_fractionability_only_v1`;
- no price/EUR-sqm Door Score signals;
- no EUR/sqm tie-break;
- distinct strategy suffix.

### 6.2 Neutral multisource

```powershell
$env:TORIUM_SEARCH_STRATEGY='neutral_fractionability'
$env:TORIUM_MASSIVE_SOURCES='idealista,immobiliare'
$env:TORIUM_MASSIVE_AREAS='Milano'
npm run triage:massive
```

Expected:

- source counts reported separately;
- both adapters pass coverage thresholds;
- cross-source matches preserve both offers and links;
- price-difference summary present;
- hidden/missing prices excluded from valuation;
- no count mismatch.

### 6.3 Legacy benchmark

```powershell
$env:TORIUM_SEARCH_STRATEGY='legacy_low_price_m2'
$env:TORIUM_MASSIVE_SOURCES='idealista'
$env:TORIUM_MASSIVE_AREAS='Milano'
npm run triage:massive
```

Expected:

- Idealista `sortBy=lowestPriceM2`;
- legacy physical-plus-economic scoring;
- lower EUR/sqm tie-break;
- result not mixed with neutral without explicit comparison.

### 6.4 Frontend limits

The admin frontend supports:

- 1–5,000 requested apartment observations per source;
- neutral strategy only;
- Idealista-only or multisource depending on profile.

Scale ladder:

1. replay fixtures/stored run;
2. 100–200 canary;
3. 1,000 per source;
4. 2,500 per source/5,000 total;
5. larger only after durable orchestration.

Do not run 5,000 per source merely because validation accepts it. The current synchronous Function may time out and its module-global lock is instance-local.

## 7. Villa runs

Frontend/API defaults:

- area: Como;
- intent: renovation;
- limit: 250 per source;
- allowed range: 20–2,000 per source;
- sources: Idealista and Immobiliare.

Valid areas:

- `como`;
- `toscana`;
- `sardegna`.

Valid intents:

- `renovation`;
- `tourism`.

Validation:

- candidate and comparable counts separate;
- region filter prevents leakage;
- candidate condition matches intent and geography override;
- dynamic benchmark has plausible observation count;
- confidence and scope are shown;
- no villa result is presented as fractioning ROI.

## 8. Revaluation

The supported frontend valuation mode is `deterministic`.

Request requirements:

- valid run ID;
- 1–5,000 record limit;
- admin membership;
- same-origin request.

After revaluation:

- final-unit count is plausible;
- no-fractioning listings have null fractioning ROI;
- zone match/fallback is explicit;
- valuation profile version is present;
- low/base/high values reconcile with unit values;
- underwriting version is current;
- run-level ROI statistics include only quality-passed records.

## 9. Financial reconciliation

For a sample of top, middle and bottom ranked records manually verify:

```text
purchase costs = purchase price * 0.12
transformation = 25k per final mono/bilocale + 30k per final trilocale
project cost = purchase + purchase costs + transformation
sale cost = scenario exit * 0.03
total cost = project cost + sale cost
profit = exit - total cost
ROI = profit / total cost
```

Red flags:

- transformation cost multiplied by new units instead of final units;
- non-fractioned small apartment receiving fractioning exit;
- missing purchase price becoming zero;
- stale persisted underwriting version overriding current formula;
- low/base/high unit sums not matching total exit;
- asking-price sentiment silently applied as appreciation;
- negative ROI hidden at property level instead of displayed truthfully.

## 10. Supabase validation

After a run:

```sql
select
  run_id,
  search_name,
  search_strategy,
  scoring_mode,
  source_channels,
  requested_areas,
  raw_source_count,
  eligible_count,
  pre_scored_count,
  created_at
from public.triage_runs
order by created_at desc
limit 10;
```

Source reconciliation:

```sql
select
  source_channel,
  count(*) as observations,
  count(*) filter (where pre_triage_excluded is false) as eligible,
  count(*) filter (where price_eur is null or price_eur <= 0) as invalid_price,
  count(*) filter (where has_plan is true) as with_plan
from public.triage_source_listings
where run_id = '<RUN_ID>'
group by source_channel
order by source_channel;
```

Result reconciliation:

```sql
select
  count(*) as properties,
  count(*) filter (where roi_base_pct is not null) as valued,
  count(*) filter (where source_confidence = 'matched_multiple_sources') as multisource,
  min(rank) as min_rank,
  max(rank) as max_rank
from public.triage_properties
where run_id = '<RUN_ID>';
```

Strategy comparison:

```sql
select
  search_strategy,
  count(*) as runs,
  avg(eligible_count) as avg_eligible,
  avg(top_result_roi_base_pct) as avg_top_roi
from public.triage_runs
where city = 'Milano'
group by search_strategy;
```

Do not paste a real run ID from an untrusted source without validating its allowed character format.

## 11. Auth operations

### Invite

```powershell
npm run auth:invite -- investor@example.com investor
npm run auth:invite -- operator@example.com admin
```

Requirements:

- trusted environment;
- server service-role key;
- Site URL and `/set-password` redirect configured;
- custom SMTP before relying on production delivery.

### Auth smoke test

1. unauthenticated `/home` redirects to login;
2. invalid credentials return generic failure;
3. valid Auth user without membership is denied;
4. suspended member is denied;
5. investor can read product/preferences;
6. investor cannot start runs or valuation;
7. admin can start controlled operations;
8. logout clears all cookie variants;
9. recovery response does not enumerate accounts;
10. password change revokes global sessions.

## 12. Renewal publication

1. confirm source listing exists;
2. choose stable external ID and style/version;
3. POST project metadata;
4. request signed upload URL per generated file;
5. binary PUT directly to Storage;
6. PATCH dimensions/hash/caption and ready state;
7. publish project only after every required asset is ready;
8. GET project as authenticated member;
9. verify order, original/renewal pairing, floor plan and signed media;
10. verify unauthenticated read behavior matches the intended deployed Auth release.

Never route base64 images through Vercel Functions.

## 13. Listing asset incident checks

If “requested path is invalid” or media fetch fails:

- verify signed URL normalization includes `/storage/v1`;
- verify bucket/path segments are encoded once;
- verify token run ID and source URL;
- confirm source host allowlist;
- inspect source redirect;
- verify MIME and declared/actual size;
- check whether portal blocked Vercel and fallback proxy was used;
- inspect `triage_listing_assets.cache_status` and `last_error`;
- do not expose the original service error or key to the browser.

## 14. Common failure modes

| Symptom | Likely cause | Safe response |
| --- | --- | --- |
| Run times out near 300 s | synchronous serverless execution too long | preserve prior results; inspect actor/dataset; retry smaller canary; do not loop retries |
| 409 “run already active” | local in-instance promise guard | wait/check logs; remember another instance may still overlap |
| Duplicate concurrent runs | no distributed idempotency/lease | stop automatic starts; identify outputs; keep both for audit; implement durable lock |
| ROI explodes | invalid price/surface, wrong unit mapping or stale formula | block ranking; run quality/reconciliation; revalue only after cause fixed |
| Titles/links/photos disappear | adapter schema drift or sanitizer mismatch | replay stored raw rows; compare coverage by source; do not run more paid jobs |
| Cross-portal false merge | weak address/surface match | unmerge in replay; require floor/civic/geo evidence; label uncertain |
| Missing Auth email | SMTP/redirect configuration | inspect Supabase Auth logs; do not expose account existence |
| User logged in but forbidden | missing/suspended membership | verify server-managed membership |
| Renewal absent | project not published or asset not ready | inspect state; do not bypass late binding |
| Failed Vercel deployment | function count/build error/env gap | inspect build logs; do not promote; use last READY rollback candidate |

## 15. Deployment runbook

1. inspect working tree and branch;
2. identify unrelated changes and preserve them;
3. confirm migration/code ordering;
4. run targeted tests;
5. run full test suite;
6. run production build;
7. review function count and rewrites;
8. apply reviewed additive migrations;
9. run Supabase advisors;
10. push reviewed commit;
11. wait for READY production deployment;
12. verify alias points to expected deployment;
13. smoke-test protected routes and APIs;
14. verify one complete business flow;
15. record commit, deployment and migration versions;
16. retain a known READY rollback candidate.

The user must explicitly authorize deployment or production mutation. Documentation work alone does not imply that authorization.

## 16. Rollback

Application:

- promote the last known READY Vercel deployment;
- do not use destructive Git reset;
- document functionality/schema compatibility.

Database:

- prefer forward-fix additive migrations;
- never hand-edit migration history;
- prepare rollback SQL before high-risk DDL;
- do not drop data-bearing columns until old code is retired and backups verified.

Source runs:

- runs are immutable evidence;
- mark failed/cancelled in the target lifecycle;
- never rewrite a historical source observation to “fix” a newer adapter.

## 17. Scale readiness gates for 4,000–5,000 units

All must pass before describing large runs as production-safe:

- [ ] durable run UUID returned immediately;
- [ ] database idempotency key;
- [ ] source-level actor job state;
- [ ] two global lease slots with heartbeat/expiry;
- [ ] third run queues;
- [ ] retry and cancellation;
- [ ] paginated dataset ingestion;
- [ ] exact stage reconciliation;
- [ ] atomic published revision;
- [ ] frontend pagination/virtualization;
- [ ] load test for 5,000 result rows;
- [ ] measured Supabase query/index plan;
- [ ] timeout and worker-crash fault injection;
- [ ] cost envelope by source and run;
- [ ] progress UI and actionable errors;
- [ ] canary 200 and 1,000 accepted before 5,000.

## 18. Operational metrics target

Per run:

- queue/sourcing/normalization/dedupe/valuation/publication duration;
- raw/normalized/blocked/canonical/eligible/valued/published counts;
- count and rate by source;
- adapter coverage by material field;
- actor cost and dataset size;
- duplicate, uncertain-match and price-mismatch rates;
- valuation coverage and quality failures;
- error and retry counts.

Per application:

- API p50/p95 latency and 4xx/5xx;
- Auth failures and recovery delivery;
- active users and preference saves;
- Storage bytes/egress/cache hit rate;
- renewal publication failures;
- notification match/delivery outcomes;
- Vercel function duration/timeouts;
- Supabase connection/query latency and advisor trend.

## 19. Scheduled maintenance target

- daily: failed runs, Auth delivery failures, asset cache failures;
- weekly: actor schema coverage, source mix, uncertain duplicates, Storage growth;
- monthly: Supabase advisors, index usage, dependency updates, secret inventory;
- quarterly: restore drill, access review, key rotation plan, scoring/backtest report;
- after every actor/model/profile change: canary, reconciliation and version bump.
