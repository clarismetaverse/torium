# TORIUM technical infrastructure overview

**Version:** 1.0
**Verified:** 2026-09-04
**Repository:** `clarismetaverse/torium`
**Production application:** `https://torium-nu.vercel.app`
**Supabase project ref:** `wboeyszksqtcjnaiiofe`

## 1. Purpose and scope

TORIUM is an internal real-estate intelligence system. It collects listing observations, normalizes multiple portal formats, applies deterministic screening and valuation logic, stores replayable results, and presents opportunities to operators and invited investors.

The implemented product currently has four domain surfaces:

1. **Milano fractioning:** apartment sourcing, physical fractionability, deterministic exit estimates and ROI.
2. **Villa discovery:** Como, Toscana and Sardegna searches for renovation or tourism-oriented opportunities.
3. **Virtual renewals:** editorial before/after galleries linked to real source listings.
4. **Investor access:** invite-only authentication and preference capture for a future notification engine.

The system is decision support. It is not a legal opinion, technical feasibility certification, tax calculation, bankable appraisal, transaction AVM, or autonomous investment decision-maker.

## 2. State legend

This documentation uses the following labels:

| Label | Meaning |
| --- | --- |
| **Production** | Present in the current Vercel production deployment or live Supabase schema. |
| **Working tree** | Implemented and tested locally but not yet included in the production deployment. |
| **Target** | Direction or design not yet fully implemented and validated. |
| **Legacy** | Retained for compatibility or historical comparison; not the preferred path. |

The distinction matters because the live database can be ahead of the deployed frontend. On 2026-09-04 the authentication hardening migrations are live in Supabase, while the matching Vercel code remains in the working tree pending release.

## 3. System context

```text
Idealista actor          Immobiliare.it actor
      \                        /
       \                      /
              Apify
                |
        source-specific payloads
                |
        TORIUM source adapters
                |
        normalized observations
                |
   quality gate + pre-triage + dedupe
                |
     +----------+-----------+
     |                      |
Door/fractioning       Villa opportunity
engine + valuation     engine + comparables
     |                      |
     +----------+-----------+
                |
       Supabase/PostgreSQL
     tables + Auth + Storage
                |
        Vercel Functions API
                |
      static HTML/JavaScript UI
                |
 operator/admin       invited investor
```

External generation agents use a separate server-to-server channel to publish virtual-renewal metadata and obtain signed upload URLs. Large image binaries travel directly to Supabase Storage, not through Vercel Functions.

## 4. Technology stack

| Layer | Current technology | Notes |
| --- | --- | --- |
| UI | Static HTML, CSS and vanilla JavaScript | No frontend framework or build step. |
| HTTP/API | Vercel Node.js Functions | Project runtime is Node.js 24.x; configured long operations have a 300-second ceiling. |
| Hosting | Vercel | GitHub-connected production deployment from `main`. |
| Database | Supabase Postgres | Primary persistence and relational source of truth. |
| Identity | Supabase Auth | Email/password, invite and recovery flows. |
| Object storage | Supabase Storage | Two private buckets for listing cache and renewals. |
| Scraping | Apify Actors | Idealista and Immobiliare.it adapters; actor IDs are configurable. |
| AI | OpenAI-compatible generation paths | Older GPT pipelines remain; deterministic valuation is the supported frontend mode. |
| Tests | Node built-in test runner | Repository suite uses `node --test --test-isolation=none` (to keep CI/local runs stable on restricted contexts). |
| Configuration | JSON profiles + environment variables | Investor, valuation, geography and run settings. |

The package has a deliberately small runtime dependency surface. `dotenv` is currently the only npm dependency, but it is declared as `latest`; pinning it and adding a lockfile policy is technical debt.

## 5. Repository topology

| Path | Responsibility |
| --- | --- |
| `api/` | Vercel Functions, authentication helpers and server-side Supabase access. |
| `public/` | Static product pages and browser-side behavior. |
| `pipelines/` | End-to-end scrape, triage and optional GPT analysis flows. |
| `scrapers/` | Direct Apify clients and source-specific scrape entry points. |
| `lib/` | Pure or mostly-pure domain modules: normalization, identity, scoring, valuation, assets and persistence. |
| `config/` | Search definitions, investor profiles and valuation assumptions. |
| `supabase/migrations/` | Additive SQL migrations present in this checkout. |
| `scripts/` | Operator tools for invites, replay, locations and renewal publication. |
| `test/` | Unit, contract and API-level tests. |
| `docs/` | Architecture, state, experiments, runbooks and roadmap. |
| `outputs/`, `triage-outputs/` | Legacy/local JSON outputs used as fallback or test inputs. |

## 6. Current runtime domains

### 6.1 Milano fractioning

The preferred experiment is `neutral_fractionability`. It uses `mostRecent` for Idealista and removes economic spread and price-per-square-metre signals from the physical Door Score. The legacy `legacy_low_price_m2` strategy remains replayable for comparison.

The main pipeline:

```text
query construction
  -> actor execution / existing dataset
  -> source adapter
  -> area validation
  -> source observation enrichment
  -> quality/pre-triage
  -> conservative deduplication
  -> Door Score
  -> deterministic zone/unit valuation
  -> underwriting
  -> Supabase
  -> ROI-ranked frontend
```

The present frontend launch endpoint supports a maximum request of 5,000 observations per source. This is a request bound, not proof that the whole operation is durable at that scale.

### 6.2 Villa discovery

Villa runs share the acquisition and normalization infrastructure but use their own:

- geographic profiles;
- candidate/comparable query roles;
- data-quality thresholds;
- opportunity score;
- dynamic asking-price benchmark.

The villa benchmark is the median EUR/sqm of current asking-price comparables in the same run. It uses a local bucket with at least four comparables, otherwise the run-wide geography. It is not renovation ROI or an AVM.

### 6.3 Virtual renewals

The renewals domain connects a real listing to a versioned style and an ordered asset rail. Supported asset kinds include `original`, `renewal`, `floor_plan`, `material` and `detail`.

Publication is late-bound:

```text
draft/processing project
        +
pending asset uploads
        |
        v
all required assets ready
        +
project status published
        |
        v
authenticated renewal feed
```

### 6.4 Investor access and preferences

Identity and authorization are separate:

- Supabase Auth proves identity.
- `torium_memberships` grants application access and defines `admin` or `investor`.
- Missing or suspended memberships fail closed.
- Investor preferences are owned by `auth.uid()` and enforced by RLS.
- Run initiation and valuation require `admin`.

The working-tree implementation stores sessions in HttpOnly cookies. Production cookies are Secure and use the `__Host-` prefix. The browser never receives the service-role key.

## 7. Data ownership and trust boundaries

### 7.1 Trusted server boundary

Only server code may use:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `APIFY_TOKEN`;
- `TORIUM_RENEWAL_AGENT_KEY`;
- asset-token signing secret;
- actor run and dataset details;
- raw source payloads containing contact or operational metadata.

### 7.2 Browser boundary

The browser receives:

- sanitized listing/result payloads;
- authenticated account/session summaries;
- investor-owned preferences;
- HMAC-scoped listing asset tokens;
- short-lived signed Storage URLs;
- no raw service credentials.

### 7.3 Source data

Portal data is untrusted input. The pipeline validates:

- source channel and listing identity;
- allowed URL hosts;
- numeric price and surface plausibility;
- media type, byte size and redirects;
- area consistency when the source query cannot enforce it;
- cross-source matches using multiple physical signals.

### 7.4 Human validation

Floor plans, descriptions, prices and portal labels are evidence, not proof. Condominium rules, planning compliance, cadastral state, structural feasibility, systems, tax treatment and sale values require professional review.

## 8. Current persistence model

The live public schema contains 12 tables:

- `triage_runs`;
- `triage_properties`;
- `triage_source_listings`;
- `milan_idealista_locations`;
- `triage_property_notes`;
- `triage_listing_assets`;
- `renewal_styles`;
- `virtual_renewals`;
- `virtual_renewal_assets`;
- `investor_alert_preferences`;
- `torium_memberships`;
- `torium_auth_events`.

On 2026-09-04 the live row counts were respectively 6, 2,966, 659, 0, 0, 64, 4, 4, 32, 0, 0 and 0. Row counts are observational and will change.

The current model is run-centric. A major target change is stable global property identity plus run-scoped revisions, so notes and history no longer depend on `run_id + listing_index`.

## 9. Deployment topology

The Vercel project is `torium`, project ID `prj_iUNYNTe87Yq5TSButgwBL6FYOe6O`, team ID `team_NyJzt1O0AJ9BHWshNKf1uBex`.

The production deployment inspected on 2026-09-04:

- deployment `dpl_GN845jsDyS5pyY7cWBBdLSFqPY9v`;
- state `READY`;
- Git ref `main`;
- commit `6bbb260e7e8ce48cff74e7f38122fd7a84af4930`;
- commit message `Consolidate functions for Vercel Hobby`;
- 11 Node.js Functions;
- production alias `torium-nu.vercel.app`.

The application stays below the Vercel Hobby function limit by multiplexing logical endpoints through `api/account.js` and `api/triage.js`, with rewrites preserving stable external URLs.

## 10. Reliability model: current versus target

### Current

- A run request holds a Vercel HTTP invocation open until completion.
- A module-global promise rejects a second run only within the same warm function instance.
- Villa source queries run in parallel; apartment queries are substantially sequential.
- Results are persisted after processing.
- Local JSON remains a fallback for some read paths.

### Consequences

- Serverless instance globals are not distributed locks.
- A 300-second function limit can terminate a large run.
- A retry can duplicate work without a durable idempotency key.
- A process interruption can leave an incomplete operational picture.
- Two instances can start overlapping runs despite the local guard.
- Publication is not yet revision-atomic.

### Target

```text
POST start -> 202 + durable run UUID
                 |
                 v
queued -> sourcing -> normalizing -> deduplicating
       -> valuating -> publishing -> completed
                 |
                 +-> failed / cancelled / warning
```

Target execution requires database-backed leases, idempotency keys, heartbeat/expiry, per-source state, retry policy, cancellation and atomic revision publication. Maximum active complete runs: two; a third queues.

## 11. Observability

Implemented observability is mainly:

- structured console output;
- run summary fields;
- query payload and query error capture;
- source and stage counts;
- data-quality flags;
- minimal authentication audit events;
- Vercel build/runtime logs;
- Supabase database advisors.

Missing:

- durable run-state timelines;
- metrics and alert thresholds;
- distributed traces;
- per-source latency and cost history;
- notification-delivery telemetry;
- object-retention cleanup telemetry;
- model/actor drift alarms;
- automated daily health checks.

## 12. Critical invariants

1. Missing or hidden price is `null`, never zero.
2. Physical fractionability is independent from price and ROI in neutral mode.
3. A cross-source merge preserves both prices, URLs and provenance.
4. A listing cannot enter ROI ranking if required financial inputs fail the quality gate.
5. Raw payloads and service credentials never reach the browser.
6. Every user requires an active application membership in addition to Auth.
7. Investor preferences are readable and writable only by their owner.
8. Renewal projects are visible only after explicit publication.
9. Signed asset URLs are temporary; storage buckets remain private.
10. Asking-price benchmarks are labeled as asking prices, not transactions.
11. A failed or partial future revision must never replace the last complete published revision.

## 13. Known architectural debt

- Run-centric identity and notes tied to array/listing indexes.
- No durable job orchestration or global concurrency control.
- No atomic staging/publication revision.
- Partial local migration history: early production migrations are visible remotely but absent from this checkout.
- Duplicate legacy indexes in Supabase.
- Two legacy SQL functions have mutable `search_path` advisor warnings.
- `milan_idealista_locations` is empty in production.
- Deterministic valuation uses provisional asking-price macrozone benchmarks.
- Purchase costs are a single 12% assumption rather than a transaction-specific tax/notary/brokerage model.
- No time/holding/financing/contingency model by current product decision.
- No notification matcher, outbox or delivery channel.
- No custom SMTP/MFA production completion for the new Auth release.
- `dotenv` is unpinned.
- Static frontend files are large and contain substantial embedded logic.

## 14. Source-of-truth hierarchy

When evidence conflicts, use this order:

1. live production database/deployment state;
2. executable code and SQL migrations;
3. tests and fixtures;
4. current-state documents;
5. roadmap and target architecture;
6. historical notes and legacy README text.

The specialist documents linked from [docs/README.md](README.md) expand every subsystem and should be updated with any material implementation change.
