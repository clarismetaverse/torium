# TORIUM technical state

## 2026-09-14 experimental branch update (not production)

Independent ranking, underwriting benchmark quality and bounded fractioning
collection foundation: [implementation and validation record](RANKING_BENCHMARK_FOUNDATION.md).
Historical engines preserved; deal_quality_v2 is opt-in and not enabled by the
frontend. Real canary awaits a usable Apify credential. No schema migration or
historical data rewrite. The snapshot below describes the earlier deployed state.

**Version:** 1.2
**Snapshot:** 2026-09-06
**Detailed index:** [docs/README.md](README.md)

## Executive status

TORIUM is an operational prototype with real multisource data, deterministic fractioning/valuation, villa discovery, private media handling and virtual renewals. Supabase persistence is active and the Vercel application is live.

The hardened authentication release is now live. The first active admin membership was created on 2026-09-06 and a production login was verified end to end, including return to the requested protected Villas route.

A second Phase 0 hardening change is complete in the working tree and **not yet deployed**. It closes an open redirect on the login return path, stops authenticated API bodies from declaring shared-cache directives, repairs the self-service invite (which could never send, and would have granted membership to any anonymous visitor if naively fixed), adds durable rate limiting, extends the audit vocabulary to failed and denied logins, and replaces static auth assertions with a behavioural authorization matrix. Per-item status is in [TORIUM authentication and authorization](TORIUM_AUTH.md).

## Deployment state

### Vercel production

- project: `torium`;
- domain: `https://torium-nu.vercel.app`;
- Node.js: 24.x;
- production deployment: `dpl_C6GGRUEuuhpbb1US6vPEnFrexu2a`;
- state: READY;
- commit: `e7e3032cac31ad1922e80c59e497ea0b8edd8a86`;
- functions: 11;
- deployment source: GitHub `main`.

### Supabase production

- project ref: `wboeyszksqtcjnaiiofe`;
- dashboard name: `clarismetaverse's Project` (generic legacy name; rename recommended);
- GitHub integration: `clarismetaverse/torium`, working directory `.`;
- 12 public tables, all with RLS enabled;
- 19 live migrations, plus 1 validated but not yet applied;
- Auth hardening migrations applied;
- private listing-assets and renewals buckets;
- security advisor: 0 errors, 3 warnings (2 mutable-`search_path` functions, closed by the pending migration, and leaked-password protection disabled, which needs an operator), 9 informational closed-table notices;
- performance advisor: 10 duplicate-index warnings plus informational unused-index notices.

### Released Auth baseline

Production now includes:

- active membership authorization;
- admin/investor roles;
- HttpOnly `__Host-` session cookies;
- invitation and password recovery;
- Auth audit;
- admin-only run/valuation endpoints;
- refreshed account/login pages;
- comprehensive infrastructure documents.

The release validation recorded before the live deployment was:

- syntax checks passed;
- full tests passed: 138/138;
- production-equivalent Vercel build passed;
- generated Function count: 11.

Validation for the pending hardening change:

- full tests passed: 176/176;
- `vercel build --prod` exit 0;
- generated Function count: 11, unchanged and within the Hobby budget;
- the new migration was executed inside a transaction against production and
  rolled back, proving it applies cleanly and that the limiter denies past its
  threshold; production state was re-verified unchanged afterwards.

The repository was clean at `e7e3032` before this documentation-only update. The production deployment is READY and exposes 11 Functions.

## Product surfaces

| Surface | Current behavior | Main gap |
| --- | --- | --- |
| Milano operations | Source runs, summary, ROI ranking, detail, scenarios, notes and media | stable property IDs and durable orchestration |
| Multisource | Idealista + Immobiliare normalization, conservative match, dual offers and price spread | atomic reconciliation and temporal observations |
| Villas | Como/Toscana/Sardegna, renovation/tourism scores and dynamic asking benchmark | renovation/rental underwriting and stronger geography data |
| Renewals | paired original/render/plan feed, styles, signed upload/publication | stable canonical property link and supplier/procurement references |
| Investor account | production invite-only Auth, active admin membership, preferences, rate limiting and a tested role matrix | custom SMTP, MFA enrolment, investor onboarding, matcher and delivery |

## Main data flow

```text
Apify source jobs
  -> source adapters
  -> normalized listing observations
  -> area and quality validation
  -> pre-triage
  -> conservative dedup/source offers
  -> physical or villa score
  -> deterministic valuation/benchmark
  -> underwriting
  -> Supabase
  -> sanitized authenticated API
  -> static frontend
```

## Current strategy behavior

`legacy_low_price_m2`:

- Idealista ordering: `lowestPriceM2`;
- physical plus economic/spread Door signals;
- lower EUR/sqm tie-break;
- retained as benchmark.

`neutral_fractionability`:

- Idealista ordering: `mostRecent`;
- physical signals only;
- no EUR/sqm tie-break;
- only apartment strategy enabled by the frontend.

`villa_dynamic_market`:

- most-recent source ordering;
- villa-specific opportunity score;
- asking-price comparable adjustment;
- no reuse of fractioning economics.

## Current fractioning assumptions

- gross-to-saleable ratio: 92%;
- bilocale minimum: 40 saleable sqm;
- one residual monolocale allowed from 28 saleable sqm;
- transformation: EUR 25,000 for every final mono/bilocale;
- transformation: EUR 30,000 for every final trilocale;
- purchase costs: 12% aggregate placeholder;
- selling cost: 3% of exit;
- no contingency, holding or financing in the current model;
- Milano exit values: provisional July 2026 asking-price macrozone benchmarks;
- low/base/high: 90%/100%/110% around benchmark, with small-unit multipliers;
- no fractioning ROI when the plan creates no new unit.

## Current quality and identity controls

Implemented:

- explicit missing/invalid-price handling;
- surface, bathrooms and EUR/sqm plausibility checks;
- price/surface consistency check;
- impossible unit-count check;
- floor-plan and address warnings;
- source URL allowlists;
- source-specific media mapping;
- source-key identity;
- conservative cross-source matching;
- hard floor-conflict blocker;
- dual-source price/URL preservation;
- sanitized public/API representation.

Remaining:

- exact end-to-end reconciliation gate;
- schema-drift alarms;
- labelled dedup calibration approval;
- stable canonical UUID;
- source observation history;
- immutable result revisions.

## Security state

Implemented in production:

- Supabase Auth identity;
- active `torium_memberships` authorization;
- `admin` and `investor` roles;
- server-owned HttpOnly cookies;
- refresh rotation;
- same-origin mutation checks;
- password recovery with generic response;
- global logout after password change;
- server-only Auth audit;
- investor preferences through user JWT and forced RLS;
- service role confined to server code;
- product/API guards;
- renewal agent kept as separate machine credential.

Implemented and tested, awaiting review and deployment:

- durable cross-instance rate limiting on login, recovery, invite, password
  update, session adoption and preference writes;
- `no-store, private` plus `Vary: Cookie` on every authenticated API response;
- one fail-closed same-origin check shared by every handler;
- an allowlisted login return path that rejects `/\host`, `//host`, absolute
  URLs and control characters;
- self-service invite through the GoTrue admin endpoint, granting no membership;
- audit coverage for failed and membership-denied logins;
- logout reachable from every protected page;
- an MFA-ready admin guard behind `TORIUM_REQUIRE_ADMIN_MFA`, default off;
- the full investor/admin/denied authorization matrix in automated tests.

Still requiring an operator action in the Supabase or Vercel dashboard:

- configure custom SMTP and verify invite and recovery delivery;
- set the Site URL and the exact redirect allowlist;
- enable leaked-password protection and the password policy;
- define session inactivity and maximum lifetime;
- enrol TOTP factors for admins before enabling the MFA gate;
- run browser end-to-end smoke tests against a preview deployment.

## Reliability and scale state

The UI accepts up to 5,000 apartment observations per source and 2,000 villa observations per source. The execution architecture is still synchronous:

- HTTP waits for completion;
- module-global locks are per warm instance only;
- serverless timeout is 300 seconds;
- no durable idempotency, queue, heartbeat or cancellation;
- publication is not revision-atomic.

Therefore 4,000–5,000 is supported as an experimental request size, not yet as a guaranteed production service level.

Target: durable jobs, two database lease slots, immediate 202 response, per-source state, checkpointing, retry/cancellation and atomic publication.

## Database debt

Priority:

1. reconstruct the first ten remote migrations missing from this checkout;
2. close mutable `search_path` warnings;
3. inspect and remove ten duplicate index pairs safely;
4. test clean bootstrap and restore;
5. populate or retire the empty `milan_idealista_locations` table;
6. add durable run/property/revision entities.

## Frontend debt

- large monolithic static HTML files;
- client-side work over potentially thousands of cards;
- no API versioning or cursor pagination;
- no list virtualization;
- repeated output fetches;
- limited end-to-end coverage;
- CSP only on Auth pages;
- Authenticated read caching needs review.

## Highest-priority next work

0. Configure the VAPID environment and apply `20260913140000_investor_push_subscriptions` so web push can be enabled in production.
1. Finish the remaining Auth operations gate: SMTP, redirect allowlist, leaked-password protection, session limits and MFA enrolment. Rate limiting and the full role matrix are implemented and awaiting deployment.
2. Reconstruct migration baseline and add CI.
3. Complete stable property identity and reconciliation.
   - [ ] Remove the asking price from `canonicalPropertyKey` in `pipelines/triage-multisource-massive.js`. The key is built from address + price + surface + floor, so a portal price change turns one listing into a new property, and two portals asking different prices for the same apartment never share a key. It is the same defect that was removed from `lib/property-identity.js` on 2026-09-13, surviving in the legacy path. Not done yet because the key is persisted as `canonical_source_key`, so changing it needs a plan for existing rows.
4. Implement durable 5,000-result orchestration.
5. Split scoring into physical/legal/economic/sellability/execution/confidence.
6. Expand financial model and progress toward transaction AVM.
7. Implement investor matching and notification outbox.

Full sequencing and exit criteria are in [TORIUM vision and roadmap](TORIUM_VISION_AND_ROADMAP.md).
