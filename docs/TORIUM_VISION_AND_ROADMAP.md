# TORIUM vision and roadmap

**Version:** 1.0
**Status:** active development
**Last updated:** 2026-09-04

## 1. Vision

TORIUM is a Real Estate Intelligence Operating System: a decision and execution layer that discovers opportunities, converts fragmented evidence into comparable investment cases, accelerates due diligence and learns from actual outcomes.

The first operational domains are residential fractioning, apartment renovation/value-add, villa renovation and tourism acquisition, longer-term hold/rental strategies, virtual renewal communication, and investor matching.

The durable advantage is not “AI scoring” alone. It is a closed information loop:

```text
wide sourcing -> normalized evidence -> rapid screening
-> technical/legal/commercial DD -> execution
-> observed outcome -> calibrated future decisions
```

## 2. Product principles

1. **Reach before opinion.** Cover the market broadly, then rank.
2. **Evidence before precision.** Missing data lowers confidence; it is not invented.
3. **Separate dimensions.** Physical feasibility, economics, legal constraints and sellability remain independently visible.
4. **Output-unit thinking.** Value and liquidity are assessed on what will be produced.
5. **Late binding.** Investor validation and DD create an approved pool; capital allocation binds as late as practical.
6. **Commodified opportunity flow.** Losing one listing should not stop deployment when equivalent approved opportunities exist.
7. **Human accountability.** Qualified people retain technical, legal, tax and investment decisions.
8. **Replayability.** Inputs, assumptions, versions and outputs are auditable.
9. **Operational continuity.** Partial failures never replace a complete published result.
10. **Learning from execution.** Calls, visits, DD, offers, works and exits become training evidence.

## 3. Desired experience

An invited investor should be able to define preferences, receive high-quality opportunities, inspect evidence and provenance, understand ranking and missing data, review scenario economics, see virtual renewals, greenlight a pool without one-to-one capital binding, and follow execution and realized performance.

An operator should be able to run controlled acquisition, compare source/strategy behavior, review normalization and dedup evidence, adjust versioned assumptions without rescraping, assign DD, publish a reviewed revision and monitor pipeline capacity.

## 4. Current baseline

### Production application

- Vercel static frontend plus 11 Node.js Functions;
- Supabase/Postgres persistence;
- Idealista and Immobiliare integrations through Apify;
- apartment and villa run views;
- deterministic unit planning, valuation and underwriting;
- data-quality gate and cross-source price-spread signal;
- private on-demand listing media cache;
- virtual-renewal feed and protected publisher channel;
- production commit on 2026-09-04: `6bbb260`.

### Live database

- triage run, source observation and result tables;
- notes and media cache;
- renewals and styles;
- investor preferences;
- membership and Auth audit tables;
- RLS on every public table;
- Auth/security migrations applied.

### Working tree, not yet production

- hardened invite-only Auth release;
- membership-based admin/investor authorization;
- HttpOnly `__Host-` cookies;
- password invitation/recovery/set flow;
- server-only Auth events;
- admin restrictions for expensive run endpoints;
- this comprehensive documentation.

### Validated but provisional

- neutral fractionability mode;
- residual-studio unit planner;
- per-final-unit transformation costs;
- 12% aggregate purchase costs and 3% selling costs;
- Milano asking-price zone benchmarks;
- villa asking-comparable opportunity benchmark.

### Not implemented

- durable run orchestration;
- stable global property identity;
- atomic result revisions;
- dynamic microzone/unit sellability;
- complete transaction AVM;
- notification matcher/outbox/delivery;
- DD/workflow management;
- investor greenlight/priority/late-binding ledger;
- realized-operation feedback training pipeline.

## 5. Target architecture

```text
SOURCE AND OBSERVATION
Idealista | Immobiliare | agencies | off-market | public data
                         |
                         v
normalized temporal observations + provenance + quality
                         |
                         v
PROPERTY IDENTITY AND HISTORY
canonical property | source memberships | price/media history
                         |
                         v
INTELLIGENCE COMPONENTS
physical | legal | economic | sellability | execution | confidence
                         |
                         v
STRATEGY AND RANKING
fractioning | renovation | hold | rental | villa tourism | luxury
                         |
                         v
DEALFLOW EXECUTION
screening -> greenlight pool -> DD -> allocation -> SPV -> works -> exit
                         |
                         v
OUTCOME LEARNING
feasibility | offer | cost | time | sale/rent | realized ROI
```

## 6. Roadmap

The order is deliberate: first reliable and reproducible infrastructure, then scalable execution and investor workflow, then learning.

### Phase 0 — secure investor foundation

**Goal:** safely release the existing product to invited operators and investors.

Deliverables:

- deploy working-tree Auth hardening;
- configure custom SMTP and Auth redirect URLs;
- invite first admin and test lifecycle;
- verify investor/admin authorization matrix;
- review authenticated output CDN caching;
- rate-limit login, recovery and mutations;
- enable TOTP MFA for admins;
- define session-lifetime policy;
- add browser smoke tests.

Exit:

- intended membership gates all product/API data;
- service role never reaches browser;
- investor cannot start runs;
- invite/login/refresh/logout/recovery succeed;
- no unaccepted high-severity security advisor issue;
- rollback tested.

### Phase 1 — reproducible infrastructure baseline

**Goal:** make code, database and deployment state reproducible.

Deliverables:

- reconstruct the ten early production migrations missing locally;
- bootstrap a clean database from zero;
- generate/update typed schema contract;
- pin dependencies and define lockfile policy;
- close mutable-`search_path` warnings;
- remove duplicate indexes through reviewed migration;
- define environments and secret ownership;
- add CI for syntax, tests, build, function count and migrations;
- record deployment metadata automatically.

Exit:

- clean environment reaches expected schema without dashboard edits;
- migration and production histories reconcile;
- tests/build are required checks;
- advisors run on every DDL release.

### Phase 2 — stable multisource property model

**Goal:** create reliable, durable property identity.

Deliverables:

- finalize `NormalizedListingV1` coverage;
- store temporal source observations;
- introduce canonical property UUIDs;
- add source memberships and match evidence;
- calibrate dedup on labelled positive/negative/uncertain examples;
- preserve price, URL, surface and media conflicts;
- migrate notes/renewals from list index to stable property ID;
- reconcile one canonical set through every stage;
- expose provenance review UI.

Exit:

- zero invalid/hidden-price valuations;
- exact reconciliation;
- no known false merge in labelled set;
- notes survive sorting, revaluation and later runs;
- both portal prices and links survive merge;
- actor drift blocks publication.

### Phase 3 — durable execution for 4,000–5,000 observations

**Goal:** large searches without holding one HTTP request open.

Deliverables:

- durable lifecycle from queued through completed/failed/cancelled;
- immediate `202 + run UUID`;
- source-level run state;
- database idempotency;
- two global lease slots with heartbeat/expiry;
- predictable third-run queue;
- independent source jobs;
- pagination/checkpointing;
- retry, cancellation and stale-worker recovery;
- staged revisions and atomic publication;
- progress API/UI;
- cost/duration telemetry;
- 5,000-row pagination and virtualization.

Preferred candidate: Vercel Workflow, subject to compatibility and interruption tests. Fallback: asynchronous Apify jobs plus Supabase state and callback/worker.

Exit:

- two simultaneous runs finish independently and a third queues;
- crash cannot partially publish;
- idempotency prevents duplicate spend;
- canaries at 200 and 1,000 precede 5,000;
- 5,000 total passes load, cost and reconciliation gates.

### Phase 4 — scoring engine V2

**Goal:** transparent component scores and strategy-specific ranking.

Components:

1. Physical Fractionability
2. Legal/Constraint Confidence
3. Economic Opportunity
4. Output-unit Sellability
5. Execution Complexity
6. Data Confidence

Deliverables:

- versioned component contracts;
- microzone and microzone/unit/size profiles;
- strategy profiles and explicit weights;
- admin assumption editor;
- replay without scraping;
- explanations and sensitivities;
- no hidden universal composite;
- explicit change-of-use/new-build execution risk;
- structured DD questions per missing component.

Exit:

- reproducible component scores;
- price never contaminates physical score;
- every rank explains contributions;
- strategy recomputes without acquisition;
- expert priors are labelled/versioned.

### Phase 5 — financial model V2 and AVM

**Goal:** replace broad placeholders with deal-specific, confidence-scored underwriting.

Deliverables:

- acquisition cost breakdown by transaction/tax regime;
- notary, brokerage, DD and SPV/admin fields;
- renovation budget by scope/material/labor and final unit;
- optional financing, timing, contingency and holding modules;
- commercialization costs;
- current value separate from expected exit-date value;
- time-to-sale and liquidity;
- comparable table and adjustment bridge;
- confidence/data quality;
- sensitivity editor;
- actual-versus-estimate tracking.

AVM progression:

1. asking-price macrozone benchmarks;
2. maintained market dataset/local comparables;
3. professional comparable-sales workflow;
4. complete transaction/time/property/liquidity AVM.

Exit:

- every cost visible and attributable;
- current value never mixed with appreciation;
- asking benchmark never labelled transaction truth;
- realized outcomes backtest versioned estimates.

### Phase 6 — notification engine

**Goal:** match new, quality-passed opportunities to investor preferences.

```text
published revision -> eligibility -> preference match
-> user/property dedupe -> outbox -> email/push -> audit
```

Deliverables:

- match canonical neighborhood, price, size, EUR/sqm, Door Score and ROI;
- idempotent outbox;
- email first and push later;
- quiet hours and consent;
- save/mute controls;
- retry/bounce handling;
- stable property/revision links;
- operator preview and kill switch.

OneSignal is a push candidate, not password recovery. Auth mail stays in Supabase Auth through custom SMTP.

Exit:

- no duplicate user/property/revision notification;
- no blocked/invalid valuation notification;
- suspended users receive nothing;
- delivery and engagement are auditable;
- investor can edit/disable preferences.

### Phase 7 — DD and late-binding dealflow

**Goal:** become an execution system, not only a dashboard.

```text
discovered -> screened -> greenlight pool -> DD in progress
-> investment-ready -> allocated -> offer/acquired
-> works -> sold/held/cancelled
```

Principles:

- greenlight validates technical/legal/business/timing dimensions;
- it is not one-to-one commitment to one property;
- investors may greenlight multiple interchangeable deals;
- first greenlight can grant priority to larger allocation;
- investor provides minimum and automatic maximum allocation;
- oversubscription priority is timestamped and explicit;
- capital binds late, after investment-ready status;
- failed negotiation/DD should not create deployment gaps;
- a rolling pool covers expected fallout and velocity.

Deliverables:

- screening document checklist;
- DD workspaces and professional reports;
- call/visit logs;
- expense ledger and fund working-capital treatment;
- greenlight and priority records;
- minimum/maximum allocation algorithm;
- replacement-pool coverage metric;
- offer/acquisition state;
- dedicated SPV/capital-flow records;
- works milestones and investor updates.

Exit:

- loss of one listing does not stop allocation;
- every capital movement maps to governance;
- DD spend is visible;
- priority/oversubscription are deterministic;
- no AI agent makes a binding offer or legal representation.

### Phase 8 — virtual renewals and procurement

**Goal:** connect design intent, budget references and communication.

Deliverables:

- stable property-linked renewal versions;
- automatic original/render/plan pairing checks;
- design style catalog;
- product/material references with provenance;
- authorized supplier adapters;
- availability, geography, lead time, VAT/shipping;
- room/project budget roll-up;
- snapshot quotes rather than volatile links;
- rights/licensing and retention policy;
- Lovable/dream-home-discovery feed contract.

Exit:

- render card explains product and price date;
- unavailable products do not invalidate historical estimate;
- supplier terms are respected;
- project budget reconciles selections with underwriting.

### Phase 9 — outcome learning

**Goal:** train future ranking on real operational feedback.

Labels:

- contact/response;
- documents obtained;
- plan/condominium/legal feasibility;
- technician assessment;
- duplicate correctness;
- asking/negotiated/offer price;
- offer accepted/rejected;
- renovation scope, cost variance and delay;
- exit/rent price and time;
- realized ROI and loss reasons.

Deliverables:

- event/outcome schema;
- labelled evaluation dataset;
- time-aware splits;
- interpretable baseline models first;
- calibration and ranking metrics;
- bias/drift monitoring;
- champion/challenger releases;
- human override capture;
- model cards and audit.

Exit:

- model beats deterministic baseline out of sample;
- calibration reported alongside rank accuracy;
- backtest prevents time leakage;
- versions reproduce predictions;
- human professionals retain veto on technical/legal claims.

## 7. Cross-cutting security

- custom SMTP and redirect governance;
- MFA for privileged roles;
- least-privilege machine credentials;
- rate limiting and idempotency;
- CSP across product pages;
- audit retention and anomaly alerts;
- membership/access reviews;
- secret rotation;
- backup and restore drills;
- privacy/media licensing;
- no raw portal contacts in investor payloads;
- consent/unsubscribe for notifications;
- threat model for external renewal and future voice/agent integrations.

## 8. Data governance

Every derived result must carry:

- source observation IDs/timestamps;
- adapter/schema version;
- normalization/match version;
- input quality;
- assumption/profile version;
- scoring/valuation version;
- model/prompt version if AI is used;
- publication revision;
- human review state;
- supersession history.

Retention classes distinguish immutable investment evidence, renewable market observations, Auth/security records, preferences, licensed media, generated content and temporary cache.

## 9. Priority order from 2026-09-04

1. Secure Auth production release.
2. Reconstruct migration baseline and add CI.
3. Stable property ID and multisource reconciliation.
4. Durable two-run orchestration and 5,000-result delivery.
5. Component scoring V2.
6. Financial/AVM V2.
7. Investor notification outbox.
8. DD/greenlight/late-binding execution.
9. Procurement-linked renewals.
10. Outcome training.

## 10. Explicit non-goals for the next release

- autonomous legal/technical approval;
- autonomous calls that conceal AI identity;
- autonomous binding offers or allocation;
- confirmed-sale-value claims from asking data;
- synchronous 5,000-per-source runs;
- complex ML before labels exist;
- public self-registration;
- public redistribution of portal media;
- complete crowdfunding compliance/fund administration in the MVP.

## 11. Success measures

Discovery:

- market coverage and source balance;
- duplicate precision;
- time from listing appearance to qualified review;
- share of top results with plan/address/complete price.

Decision quality:

- fractionability confirmation rate;
- DD rejection distribution;
- negotiation spread captured;
- valuation error/calibration;
- top-k precision for investment-ready opportunities.

Execution:

- approved-pool coverage;
- capital idle time;
- deals lost to speed;
- DD cycle time;
- renovation cost/time variance;
- realized ROI/liquidity.

Product:

- active invited investors;
- saved preferences;
- notification open-to-review rate;
- greenlight participation/oversubscription;
- operator hours saved without quality loss.

Reliability:

- successful reconciled runs;
- timeout/retry rate;
- partial publication incidents;
- Auth/security incidents;
- restore success and recovery time.
