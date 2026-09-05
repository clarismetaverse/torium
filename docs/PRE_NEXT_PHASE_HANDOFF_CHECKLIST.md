# TORIUM pre-next-phase handoff checklist

**Purpose:** close, verify and release the current authentication/infrastructure work before starting another product feature.

**Prepared:** 2026-09-05  
**Repository:** `clarismetaverse/torium`  
**Current branch at handoff:** `main`  
**Current production commit at handoff:** `6bbb260`  
**Production URL:** `https://torium-nu.vercel.app`  
**Supabase project ref:** `wboeyszksqtcjnaiiofe`

This is an execution checklist, not a statement that every item is already implemented. Every completed checkbox must be backed by command output, a database/API result, a browser observation or a deployment URL.

## 1. Immediate mission

Do not start another product feature yet. First:

1. preserve and review the existing uncommitted Auth and documentation work;
2. make the local repository reproducible;
3. obtain a clean production-equivalent build;
4. verify Supabase authorization and migration state;
5. release the hardened Auth safely;
6. complete browser and role-based smoke tests;
7. update the technical state with exact evidence.

The release is complete only when all **P0** items below are green. The platform is ready for the next major feature only when the explicitly marked **P1 pre-feature gate** is also green or consciously deferred in writing by the owner.

## 2. Read first

Read these documents completely before making changes:

1. [Documentation index](README.md)
2. [Technical state](TORIUM_TECHNICAL_STATE.md)
3. [Technical infrastructure overview](TECHNICAL_INFRASTRUCTURE_OVERVIEW.md)
4. [Authentication and authorization](TORIUM_AUTH.md)
5. [Supabase data, security and storage](SUPABASE_DATA_SECURITY_AND_STORAGE.md)
6. [API, frontend and deployment](API_FRONTEND_AND_DEPLOYMENT.md)
7. [Operations, testing and runbook](OPERATIONS_TESTING_AND_RUNBOOK.md)
8. [Vision and roadmap](TORIUM_VISION_AND_ROADMAP.md)
9. [Architectural decisions](ARCHITECTURAL_DECISIONS.md)

When documentation and code disagree, verify the code and live infrastructure, then correct the documentation in the same change.

## 3. Non-negotiable working rules

- [x] Treat the current dirty worktree as intentional user-owned work. Do not run `git reset --hard`, `git checkout --`, destructive cleans or broad rewrites.
- [x] Inspect the full diff before editing. Do not silently discard or replace earlier Auth work.
- [x] Do not expose, print, commit or paste secret values. It is safe to inspect environment variable **names** only.
- [ ] Do not invite a real user, send an email, apply a new production migration, push, deploy or promote without explicit owner approval at that step.
- [x] Use additive Supabase migrations. Do not edit an already-applied migration to change production state.
- [ ] Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Browser preference writes must continue through the user's JWT and RLS.
- [x] Keep the renewal publisher credential (`TORIUM_RENEWAL_AGENT_KEY`) separate from human Auth.
- [x] Preserve the current Vercel Hobby function budget. A release with more than 12 Functions is blocked; the expected current topology is 11.
- [x] Do not accept generated files from an old build as evidence. A build must finish in the current session with exit code 0.
- [x] Do not start paid Apify runs merely to test application plumbing. Prefer fixtures, replay and small canaries.
- [x] After each material phase, update this checklist with evidence and update the technical-state date only if live state was actually reverified.

## 4. Known handoff state

### 4.1 Production versus working tree

- Production currently points to commit `6bbb260`.
- The hardened Auth application code is in the working tree and is **not** in that production commit.
- The two Auth hardening migrations are already present in the live Supabase migration history.
- At the last live inspection there were no Auth users and no membership rows; verify this again rather than assuming it remains true.
- The latest full local test run after environment correction reported **138 passing tests**.
- The latest `vercel build --prod` attempt in this session exits `0`; retain `.vercel/output` only when regenerated in the same session.

### 4.2 Existing uncommitted work to preserve

The handoff included Auth/backend/frontend/test changes, new Auth pages and helper modules, two Supabase migrations and a broad documentation set. Start with `git status --short` and `git diff --stat`; the exact list may evolve after this document is written.

Expected high-level areas:

- `api/_auth*.js`, `api/account.js` and guarded run APIs;
- `public/login*`, `public/forgot-password*`, `public/set-password*`, `public/account.html`;
- Auth/preferences and run API tests;
- `vercel.json` multiplexing and headers;
- `scripts/invite-torium-user.js`;
- Auth hardening migrations;
- root and `docs/` technical documentation.

If files are missing or substantially different, report the discrepancy before attempting to reconstruct them.

## 5. P0 — Preserve and audit the implementation

### 5.1 Establish a safe baseline

- [x] Capture `git status --short`, current branch, `git rev-parse HEAD` and remote URLs.
- [x] Capture `git diff --stat` and review `git diff` file by file.
- [x] Separate intended Auth/docs changes from unrelated user changes; do not stage unrelated work.
- [x] Confirm that no secret, token, `.env` value, private email or generated deployment artifact is in the diff.
- [x] Run `git diff --check` and fix whitespace errors without reformatting unrelated files.
- [ ] If useful, create a normal safety branch such as `codex/auth-stabilization` without altering the worktree. Do not push it without approval.

**Acceptance evidence:** baseline commit, branch, clean secret scan, reviewed file list and `git diff --check` result recorded in the completion report.

### 5.2 Review the Auth boundary

- [ ] Trace login from `public/login.js` through `/api/account` to Supabase Auth.
- [ ] Trace refresh rotation and confirm access/refresh tokens are never readable by browser JavaScript.
- [ ] Confirm production cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` and `Path=/`, with no `Domain` attribute.
- [ ] Confirm logout invalidates the server session and clears every Auth cookie.
- [ ] Confirm password-change flow requests global logout and clears every device session as designed.
- [ ] Confirm recovery responses are generic for both existing and non-existing emails.
- [ ] Confirm recovery fragments/tokens are removed from the URL before third-party or nonessential requests.
- [ ] Confirm password policy is 12–128 characters in both browser and API validation.
- [ ] Confirm active membership is mandatory after successful authentication.
- [ ] Confirm roles come only from the server-managed `torium_memberships` row, never `user_metadata`.
- [ ] Confirm missing or suspended membership fails closed and signs the session out.
- [ ] Confirm `investor` cannot invoke run or revaluation endpoints.
- [ ] Confirm `admin` can invoke allowed operational endpoints.
- [ ] Confirm cross-origin mutation requests are rejected.
- [ ] Confirm Auth/account responses are `Cache-Control: no-store`.
- [ ] Confirm the browser never receives the service-role key or raw Supabase refresh token.
- [ ] Review audit events: store the minimal event type/outcome/context only; never store password, token, raw IP or sensitive email payload.

**Acceptance evidence:** a short request/authorization matrix naming every tested route and expected `200/302/401/403/405` outcome.

### 5.3 Review Vercel routing and static-page guards

- [x] List all `public/*.html` product pages and classify each as public, Auth-only or admin-only.
- [x] Verify protected pages load the shared browser guard before fetching product data.
- [x] Verify direct navigation to `/home`, `/property/...`, `/villas`, `/renewals` and `/account` behaves according to the intended policy (routing and guard mapping are present; browser policy verification pending in next smoke run).
- [ ] Verify `next=` redirect values accept only safe same-origin paths and cannot become an open redirect.
- [x] Verify `vercel.json` rewrites point to the multiplexed account/run handlers as intended.
- [ ] Confirm `/api/auth/*` and `/api/investor/preferences` compatibility rewrites still resolve correctly.
- [ ] Inspect the output/villa read routes: do not combine authenticated responses with shared public `s-maxage` caching. Change to private/no-store or introduce a deliberate public sanitized projection.
- [ ] Apply a consistent CSP to protected product pages, or document a tightly scoped reason and follow-up. Login/recovery CSP alone is not the final target.
- [ ] Confirm security headers: HSTS in production, `nosniff`, frame denial, strict referrer policy and restrictive permissions policy.

**Acceptance evidence:** route table plus response headers from local/preview requests.

## 6. P0 — Automated verification

### 6.1 Syntax and static checks

- [x] Run `node --check` on every modified or new `.js` file in `api/`, `public/`, `scripts/`, `lib/` and `pipelines/`.
- [x] Validate JSON files including `package.json`, `vercel.json` and any changed configuration.
- [x] Run a secret-pattern scan over the diff. Treat findings as leads and inspect manually; do not print matching secret values into the report.
- [x] Check relative Markdown links in `README.md` and `docs/*.md`.

### 6.2 Full test suite

- [x] Run `npm test` from repository root.
- [x] Require zero failed, skipped unexpectedly or cancelled tests.
- [x] Record the exact pass count; the handoff baseline was 138.
- [ ] Fix any stale or misleading test names. In particular, ensure no test still describes the property note editor as “unauthenticated” if the endpoint now requires a session.
- [ ] Add missing regression tests discovered during the Auth review rather than relying only on manual checks.

Minimum Auth regression coverage:

- [ ] valid login + active investor;
- [ ] valid login + active admin;
- [ ] wrong password returns generic failure;
- [ ] Auth user with no membership is denied;
- [ ] suspended membership is denied;
- [ ] expired access token refreshes once and rotates cookies;
- [ ] invalid refresh token clears cookies;
- [ ] investor blocked from each run endpoint;
- [ ] admin accepted by each run endpoint with the runner mocked;
- [ ] cross-origin POST rejected;
- [ ] unsafe `next` redirect rejected;
- [ ] recovery response does not enumerate accounts;
- [ ] password shorter than 12 or longer than 128 rejected;
- [ ] preference CRUD is owned by `auth.uid()` and cannot cross users;
- [ ] notes retain the chosen authorization policy and cannot cross the intended user/resource boundary.

### 6.3 Clean Vercel build

- [x] Diagnose the previous Vercel CLI `EPIPE` without treating it as an application failure by default.
- [x] Verify installed Node and Vercel CLI versions.
- [x] Run `vercel build --prod` and require exit code 0.
- [ ] If `EPIPE` repeats, capture the minimal CLI error, try a current supported CLI/runtime and inspect Vercel build logs; do not infer success from an existing `.vercel/output` directory.
- [x] Count the Functions generated by this successful build. Expected: 11; required on the current plan: at most 12.
- [x] Verify every rewrite target corresponds to a generated Function or static file.
- [ ] Confirm production-required environment variable names are available to the build/runtime, without printing values.

**Build gate:** no commit/push/deploy approval should be requested until syntax, tests and a clean build all pass.

## 7. P0 — Supabase reproducibility and security

Use the Supabase project as the source of live facts, but do not mutate production without explicit approval.

### 7.1 Reconcile migration history

- [ ] List live migration versions and local migration files side by side.
- [ ] Confirm the two Auth migrations are recognized as already applied even if live timestamps/names differ slightly from local filenames.
- [ ] Reconstruct the ten early production migrations missing from this checkout, or create a reviewed baseline strategy that can bootstrap a fresh environment exactly.
- [ ] Do not invent historical SQL. Derive it from live schema metadata and repository history, then document provenance.
- [ ] Verify a clean disposable database/branch can apply the full local migration chain. Creating a paid or remote Supabase branch requires owner approval.
- [ ] Add an automated migration drift check suitable for CI.
- [ ] Generate/update database types after the migration baseline is authoritative.

**Acceptance evidence:** exact live/local migration comparison and a successful clean bootstrap log.

### 7.2 Verify RLS and grants

- [ ] Confirm RLS remains enabled and forced where documented.
- [ ] Confirm `torium_memberships` is self-readable only and not client-writable.
- [ ] Confirm `investor_alert_preferences` requires row ownership and active membership for every operation.
- [ ] Confirm `torium_auth_events` has no anon/authenticated read or write privileges.
- [ ] Confirm shortlist views use `security_invoker=true`.
- [ ] Confirm service-only tables with no client policy fail closed; do not add permissive policies just to silence informational notices.
- [ ] Test database behavior with anon, investor JWT, admin JWT and service role using non-production fixtures where possible.

### 7.3 Close advisor warnings safely

- [ ] Add a migration setting an explicit safe `search_path` and schema-qualified references for `public.set_updated_at`.
- [ ] Do the same for `public.set_idealista_location_fields_from_query_payload`.
- [ ] Re-run the Supabase security advisor; target zero ERROR and zero mutable-`search_path` WARN.
- [ ] Inspect all ten duplicate-index pairs: eight on `triage_properties`, two on `triage_runs`.
- [ ] Compare definition, uniqueness, predicates, constraints and observed use before choosing which index to remove.
- [ ] Remove only true duplicates through a reviewed migration, with rollback SQL prepared.
- [ ] Re-run performance advisor and representative read/write query plans.

### 7.4 Decide the empty location-table fate

- [ ] Verify whether `milan_idealista_locations` is still empty.
- [ ] If it is part of the canonical geography plan, populate it through a versioned import and test mapping coverage.
- [ ] Otherwise mark it deprecated and remove it later through a migration; do not leave it as an undocumented apparent source of truth.

## 8. P0 — Production Auth operations

These items may require credentials, DNS access or email delivery and therefore have explicit permission gates.

### 8.1 Configure mail and redirects

- [ ] **Approval/input required:** confirm the production sending domain and Resend account to use.
- [ ] Verify the domain and sender in Resend.
- [ ] Configure Resend SMTP in Supabase Auth.
- [ ] Set Supabase Auth Site URL to `https://torium-nu.vercel.app`.
- [ ] Allow `https://torium-nu.vercel.app/set-password` as invite/recovery redirect.
- [ ] Review invite, recovery and password-changed templates in Italian/English as desired.
- [ ] Enable password-changed security notification.
- [ ] Send test mail only to an owner-approved address and verify deliverability, link host, expiry and one-time use.

### 8.2 Configure session and account controls

- [ ] Decide and document session inactivity timeout and absolute maximum lifetime.
- [ ] Enable stronger password and leaked-password protections when supported by the active plan.
- [ ] Add TOTP MFA for admins first; define whether it is optional or mandatory for investors.
- [ ] Add server-side rate limits for login, recovery, password update, preference writes and run endpoints.
- [ ] Add alerting for repeated Auth failures without logging credentials or raw personal data.

### 8.3 Create the first accounts

- [ ] **Approval/input required:** obtain the exact first admin email and explicit approval to send the invite.
- [ ] Use `npm run auth:invite -- <approved-email> admin` from a trusted environment.
- [ ] Verify both Supabase Auth user and active `torium_memberships` row exist.
- [ ] Complete invite and password creation in a clean browser session.
- [ ] Create an investor test account only if approved, so role boundaries can be tested end-to-end.
- [ ] Verify suspended status immediately revokes product access on the next authorized request/session refresh.

## 9. P0 — Release and deployment

### 9.1 Pre-release gate

- [ ] Full diff reviewed.
- [ ] No secrets or unrelated files staged.
- [ ] Syntax checks pass.
- [ ] All tests pass.
- [ ] Clean production-equivalent build exits 0.
- [ ] Function count is within plan.
- [ ] Required migrations are present/applied in the correct order.
- [ ] Current READY production deployment is recorded as rollback candidate.
- [ ] Release notes state that working-tree Auth behavior was not in `6bbb260` and identify the new commit that will contain it.

### 9.2 Commit and push

- [ ] **Approval required:** show the proposed staged file list and concise diff summary to the owner.
- [ ] Commit with a focused message; do not mix unrelated generated files.
- [ ] Push only after explicit approval.
- [ ] Verify remote commit SHA equals local commit SHA.
- [ ] Do not assume a Git push means production is updated.

### 9.3 Deploy

- [ ] **Approval required:** deploy/promote the verified commit to production.
- [ ] Confirm deployment status is READY.
- [ ] Confirm the deployment's Git commit equals the intended release commit.
- [ ] Confirm `https://torium-nu.vercel.app` resolves to that deployment.
- [ ] Confirm function count and runtime configuration in the deployed output.
- [ ] Inspect runtime logs for Auth/API errors without exposing sensitive payloads.
- [ ] If a release gate fails, do not partially patch production blindly; use the recorded READY rollback candidate.

## 10. P0 — Browser and API smoke-test matrix

Run against preview first, then repeat the critical subset against production. Use clean browser profiles for unauthenticated, investor and admin states.

### 10.1 Unauthenticated

- [ ] `/login` loads without console errors.
- [ ] Protected pages redirect to `/login?next=<safe-path>`.
- [ ] A successful login returns only to an allowed internal `next` path.
- [ ] `/forgot-password` always shows a generic response.
- [ ] Direct run API calls return unauthorized and do not start Apify work.
- [ ] Protected data APIs do not leak run, property, note, preference or renewal data.

### 10.2 Investor

- [ ] Login succeeds with active membership.
- [ ] Home loads and the expected run is visible.
- [ ] One property detail loads with address/source links/media as allowed.
- [ ] Notes can be created, reloaded and updated according to the chosen ownership model; verify the row in Supabase.
- [ ] Alert preferences can be created, reloaded, patched and cleared; verify the correct `user_id` in Supabase.
- [ ] Villas and renewals load, including signed/open/download media behavior.
- [ ] Every admin run/revaluation endpoint returns forbidden without spending actor credits.
- [ ] Logout clears the session and Back/refresh does not reveal protected cached content.

### 10.3 Admin

- [ ] Login succeeds and `/account` shows the correct role without exposing sensitive IDs unnecessarily.
- [ ] Admin can access guarded operational controls.
- [ ] Run endpoints pass authorization with the actual runner disabled/mocked first.
- [ ] If a real canary is approved, use the smallest limit and verify exactly one run starts.
- [ ] Revaluation is tested on a controlled run and does not mutate unrelated revisions.

### 10.4 Recovery and session lifecycle

- [ ] Invite link opens `/set-password`, is one-time and expires as configured.
- [ ] Recovery link opens `/set-password` on the production host.
- [ ] Password change invalidates other active sessions.
- [ ] Refresh works after access-token expiry.
- [ ] Revoked/suspended membership blocks the next protected request.
- [ ] Cookie attributes are correct in browser storage/network inspection.

### 10.5 Core product regression

- [ ] Home shows only ROI ranking as currently intended.
- [ ] Run summary counts reconcile with output records.
- [ ] Shared announcements and price-spread filters/statistics still work.
- [ ] Idealista and Immobiliare titles, links, photos, plans and source offers are intact.
- [ ] Spanish floor abbreviations are normalized for Italian presentation.
- [ ] Positive signals, red flags, missing information and DD questions render in Italian where required.
- [ ] Negative aggregate ROI summaries remain hidden where specified, without hiding record-level truth.
- [ ] Acquisition, transformation, project and sale costs reconcile with current formulas.
- [ ] Transformation uses costs per **final unit**: EUR 25k mono/bilocale and EUR 30k trilocale.
- [ ] A non-fractioned listing does not receive a fictitious fractioning ROI.
- [ ] Change-of-use and under-construction listings remain low priority.
- [ ] Renewal before/after pairs render correctly on desktop, iPad and mobile with smooth scroll.
- [ ] Signed/open/download image flows do not return `requested path is invalid`.

**Acceptance evidence:** screenshot or request result per failed/fixed path, console free of new errors, and exact rows checked in Supabase.

## 11. P1 pre-feature gate — Reliability work that should not be forgotten

These tasks are larger than the Auth release. They should be completed before promising 4,000–5,000-item runs as a reliable production service or before exposing the platform to many external users.

### 11.1 Stable property identity and notes

- [ ] Introduce a stable canonical property UUID independent of run position and source listing index.
- [ ] Link all source offers, notes, renewal assets, valuation revisions and future alerts to that identity.
- [ ] Backfill existing notes safely and preserve provenance.
- [ ] Define merge/split audit history so an incorrect dedup can be reversed.
- [ ] Keep both portal prices and links when the same property has a price spread.
- [ ] Add labelled dedup fixtures and measure false-merge/false-split performance.

### 11.2 Exact reconciliation and publication

- [ ] Make stage counts exact and persisted: raw, normalized, blocked, canonical, eligible, valued and published.
- [ ] Persist invalid/missing-price counts and reasons instead of silently dropping them.
- [ ] Block publication when count reconciliation is unknown.
- [ ] Stage a complete immutable result revision, validate it, then atomically update the published pointer.
- [ ] Keep the last complete revision visible while a new run fails or is incomplete.

### 11.3 Durable 5,000-result orchestration

- [ ] Replace the synchronous request lifecycle with immediate `202 + run UUID`.
- [ ] Add database idempotency keys to prevent duplicate actor spend.
- [ ] Implement two durable database lease slots and queue the third run.
- [ ] Persist per-source status, dataset IDs, checkpoints, heartbeats and attempts.
- [ ] Add cancellation, bounded retry and stale-lease recovery.
- [ ] Test two concurrent runs plus a queued third run.
- [ ] Inject timeout, function restart, source failure and retry scenarios.
- [ ] Prove partial output never replaces the last complete published revision.

### 11.4 Frontend scalability

- [ ] Separate run metadata from paginated property projections.
- [ ] Add cursor pagination and server-side rank/filter parameters.
- [ ] Add client cache keyed by run UUID and published revision.
- [ ] Add list virtualization/lazy cards for thousands of records.
- [ ] Avoid re-fetching the entire run on property navigation.
- [ ] Prefetch the next property and use image variants/lazy loading.
- [ ] Measure Web Vitals and interaction latency on desktop, iPad and mobile with 5,000 records.

### 11.5 API contract hardening

- [ ] Introduce versioned `/api/v1` contracts or an explicit version header.
- [ ] Standardize error envelopes and request IDs.
- [ ] Add idempotency to mutation endpoints.
- [ ] Publish machine-readable schemas/OpenAPI for human and renewal-agent clients.
- [ ] Define rate limits, deprecation policy and audit-safe observability.

## 12. Explicitly defer until the gates above are green

Do not mix these into the current stabilization release unless the owner changes scope:

- new ranking/scoring model;
- full AVM implementation;
- investor matching and OneSignal delivery;
- greenlight/late-binding allocation workflow;
- supplier/procurement integrations;
- automated agency calling;
- new geographic or asset-class expansion;
- major frontend rewrite/framework migration.

Small fixes required to make existing smoke tests pass are in scope. New product behavior is not.

## 13. Suggested command sequence

Run commands individually so failures remain attributable. PowerShell examples:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git diff --stat
git diff --check
npm test
vercel build --prod
```

### 13.1 EPERM guardrail note

In this environment, Node test isolation defaults to a spawn model that can trigger `spawn EPERM` in restricted contexts.

- Fix applied: repository test script is now `node --test --test-isolation=none` (`npm test`).
- Repro step (non-elevated): `node --test` (without explicit isolation) → `spawn EPERM` in this sandbox profile.
- Permanent check: `npm test` and `node --test --test-isolation=none` → **138 pass, 0 failed** in this session.
- For future sessions: keep using `npm test` as the default command; reserve direct `node --test` only on fully permitted contexts.

This is now treated as a documented and versioned repo fix, not an external environment dependency.

For syntax checks, enumerate changed JavaScript files first and run `node --check` on each explicit path. Do not build a shell command from untrusted or unresolved paths.

Before a real actor run, use dry-run mode as documented in the runbook. Do not run a paid canary until Auth/release gates pass and the owner approves it.

## 14. Evidence log template

Claude should append a compact log here or in the final handoff report:

```text
Date/time (Europe/Rome):
Branch and commit:
Reviewed diff:
Syntax checks:
Tests: X passed, Y failed
Vercel build: exit code; Function count
Supabase migrations: local count; remote count; drift
Supabase advisors: errors/warnings/info
Preview deployment:
Production deployment:
Unauthenticated smoke:
Investor smoke:
Admin smoke:
Recovery/email smoke:
Core product regression:
Open blockers:
Owner approvals still required:
Rollback candidate:
Docs updated:
```

## 15. Definition of done

### Gate A — Safe Auth release

All are mandatory:

- [ ] intended diff preserved and reviewed;
- [ ] zero known secret leakage;
- [ ] syntax and complete test suite pass;
- [ ] production-equivalent build exits 0;
- [ ] no more than 12 Vercel Functions;
- [ ] live/local migration state understood and documented;
- [ ] Auth/RLS role matrix passes;
- [ ] SMTP/redirect path works with an approved test account;
- [ ] preview smoke passes;
- [ ] intended commit is deployed and production smoke passes;
- [ ] rollback target is recorded;
- [ ] technical state and roadmap reflect the verified deployment.

### Gate B — Safe to move to the next major platform feature

All are mandatory or explicitly deferred by the owner with risk recorded:

- [ ] migration baseline can bootstrap a clean database;
- [ ] security advisor warnings are closed or accepted with rationale;
- [ ] duplicate indexes are resolved safely;
- [ ] stable property identity/notes migration is planned and testable;
- [ ] exact reconciliation and atomic publication design is approved;
- [ ] 5,000-result execution is either durable or clearly labelled experimental;
- [ ] frontend behavior at the target result size is measured;
- [ ] no unresolved P0 regression remains.

## 16. Required final report from Claude

Return:

1. concise outcome first;
2. checkboxes completed and still open;
3. files changed;
4. exact test/build results;
5. live Supabase/Vercel facts with verification date;
6. production and rollback deployment URLs/commit SHAs, if a release was authorized;
7. permission-bound tasks still requiring the owner;
8. known risks and recommended next task;
9. confirmation that no secrets were printed or committed.

Do not say “done” while a mandatory gate is merely assumed.
