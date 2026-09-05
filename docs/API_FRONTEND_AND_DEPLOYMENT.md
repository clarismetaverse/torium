# TORIUM API, frontend and deployment

**Version:** 1.0
**Verified:** 2026-09-04

## 1. Web architecture

TORIUM is a framework-free static web application served by Vercel. HTML pages in `public/` call Node.js Functions in `api/`. Functions read/write Supabase and may start Apify-backed pipelines.

There is no bundler, server-side rendering layer, client router or component framework. The advantages are low dependency count and simple deployment; the costs are duplicated page logic, large HTML files and fewer structural boundaries.

## 2. Frontend pages

| Route/file | Purpose | Access |
| --- | --- | --- |
| `/login` / `login.html` | Email/password login | unauthenticated |
| `/register` | Invite registration request for investors | unauthenticated |
| `/forgot-password` | Generic recovery request | unauthenticated |
| `/set-password` | Invite/recovery token adoption and password creation | link holder |
| `/home` / `home.html` | Run selector, summary, ROI ranking and filters | authenticated member |
| `/property/:property` / `index.html` | Operation detail, scenarios, DD signals, media and note | authenticated member |
| `/villas` / `villas.html` | Villa run selector and opportunity cards | authenticated member |
| `/renewals` / `renewals.html` | Paired original/render editorial feed | authenticated member |
| `/account` / `account.html` | Identity, role and investor preferences | authenticated member |

`public/auth-client.js` is the shared browser guard. It checks the session endpoint and redirects to `/login?next=...` when required.

The API repeats authentication checks. Page redirects are usability controls, not the security boundary.

## 3. Logical API surface

### 3.1 Account

| Endpoint | Method | Authorization | Purpose |
| --- | --- | --- | --- |
| `/api/auth-session` | GET | valid member session | Return safe user ID, email and application role. |
| `/api/auth-session` | POST | same-origin | Exchange email/password for server cookies; require active membership. |
| `/api/auth-session` | DELETE | same-origin/session optional | Global sign-out, audit and cookie clearing. |
| `/api/auth-password` | POST `action=request` | same-origin | Request generic password recovery email. |
| `/api/auth-password` | POST `action=invite` | same-origin | Request a new invite email for investor registration. |
| `/api/auth-password` | POST `action=adopt` | one-time invite/recovery tokens | Validate user/membership and adopt link session into HttpOnly cookies. |
| `/api/auth-password` | PUT | recovery/member session + same-origin | Set password, revoke global sessions and require login again. |
| `/api/investor-preferences` | GET | active member | Return canonical zones and own preferences. |
| `/api/investor-preferences` | PUT | active member + same-origin | Validate and upsert own preferences through user JWT/RLS. |

Physical implementation: all three logical groups are multiplexed by `api/account.js` through the `resource` query parameter and Vercel rewrites.

### 3.2 Triage reads

| Endpoint | Method | Authorization | Purpose |
| --- | --- | --- | --- |
| `/api/outputs` | GET | active member | List latest fractioning runs plus optional combined neutral/legacy view. |
| `/api/output?file=...` | GET | active member | Return sanitized full or compact run output. |
| `/api/triage-runs` | GET | active member | Diagnostic run data through multiplexed triage API. |
| `/api/triage-properties` | GET | active member | Diagnostic property/result rows. |
| `/api/triage-source-listings` | GET | active member | Sanitized source rows; query flags cannot bypass redaction. |
| `/api/villa-runs` | GET | active member | List villa runs. |

Output IDs:

- `supabase:<run_id>`;
- `combined:<neutral_run_id>+<legacy_run_id>`;
- legacy allowed JSON file path.

For Supabase runs, `triage_properties` is preferred. If absent, the API rebuilds a frontend result from eligible `triage_source_listings`.

Sanitization removes or replaces:

- source internal IDs/fingerprints;
- agency/contact data;
- external references;
- filtered-out raw arrays;
- raw payload fields not required for the UI.

It adds:

- normalized Italian floor;
- deterministic underwriting;
- data-quality result;
- safe source URLs;
- asset access tokens;
- sanitized analysis.

### 3.3 Triage mutations and execution

| Endpoint | Method | Authorization | Purpose |
| --- | --- | --- | --- |
| `/api/run-triage` | POST | admin + same-origin | Start neutral apartment run; 1–5,000 items per source. |
| `/api/run-valuation` | POST | admin + same-origin | Deterministically value a persisted run; max 5,000. |
| `/api/run-villas` | POST | admin + same-origin | Start Como/Toscana/Sardegna villa run; 20–2,000 per source. |
| `/api/property-note` | GET | active member | Read one run/listing note. |
| `/api/property-note` | POST | active member + same-origin | Validate target and upsert a note. |
| `/api/listing-asset` | POST | active member + same-origin + signed token | Fetch/cache a source image and return signed view/download URLs. |

Execution endpoints currently return `200` only after the run finishes. The roadmap changes this to `202 Accepted` plus a durable status resource.

### 3.4 Virtual renewals

| Endpoint | Method | Authorization | Purpose |
| --- | --- | --- | --- |
| `/api/renewals` | GET | active member in working-tree release | Return published projects with signed asset URLs. |
| `/api/renewals` | POST | renewal agent bearer key | Upsert a project/style/assets linked to an existing source listing. |
| `/api/renewals?action=upload-url` | POST | renewal agent bearer key | Create asset metadata and two-hour signed upload URL. |
| `/api/renewals?external_id=...` | PATCH | renewal agent bearer key | Patch project/assets and publish when ready. |

The agent key is a separate machine credential, not an investor/admin session. Minimum configured length is 32 characters.

## 4. Authentication mechanics

### 4.1 Cookies

Production:

- `__Host-torium_access_token`;
- `__Host-torium_refresh_token`;
- HttpOnly;
- Secure;
- SameSite=Lax;
- Path=/;
- access lifetime from Supabase session, minimum 60 seconds;
- refresh cookie maximum 30 days.

Local development uses non-`__Host` cookie names because HTTPS/Secure may not be available. A production login clears old legacy cookies.

### 4.2 Session refresh

For each authenticated request:

1. read access token from cookies;
2. validate it with Supabase Auth `/user`;
3. when invalid/expired, use refresh token;
4. rotate cookies with the refreshed session;
5. verify current active TORIUM membership;
6. return 401/403 and clear cookies on failure.

### 4.3 Cross-site request protection

Mutation routes compare forwarded host/protocol with `Origin` or `Referer`, and reject incompatible `Sec-Fetch-Site`. SameSite cookies provide another layer.

This is appropriate for the present single-origin app. If custom domains, mobile clients or external APIs are added, allowed origins and token-based API authorization must be designed explicitly.

## 5. Function topology and Vercel limit

The deployment currently produces 11 Node.js Functions. Logical helpers beginning with underscore are imported into public functions.

Multiplexers:

```text
/api/auth-session          \
/api/auth-password          > /api/account?resource=...
/api/investor-preferences  /

/api/triage-runs             \
/api/triage-properties        > /api/triage?resource=...
/api/triage-source-listings  /
```

This keeps stable endpoint names while staying below the Vercel Hobby 12-function limit. Any new API file can break deployment. Prefer extending a coherent existing router until the project moves to a plan or architecture without that cap.

Configured functions:

- listing asset: Frankfurt `fra1`, 30 seconds;
- renewals: Frankfurt `fra1`, 30 seconds;
- run triage: 300 seconds;
- run valuation: 300 seconds;
- run villas: 300 seconds.

## 6. Caching

Global API header in `vercel.json` is `Cache-Control: no-store, private`.

Some read handlers override caching:

- sanitized output: public CDN cache 300 seconds with 24-hour stale-while-revalidate;
- villa run list: 60-second public cache with 300-second stale-while-revalidate;
- Auth/account/mutations: no-store.

Because output routes now require authentication, public shared caching deserves a deliberate review. Even sanitized data should not be stored in a shared CDN cache if investor membership is intended as a strict access boundary. Target: private/no-store or user-independent signed publication semantics, chosen explicitly.

Listing and renewal images use private Storage signed URLs. These URLs expire independently from HTTP JSON caching.

## 7. Security headers

Global:

- HSTS for two years, including subdomains and preload;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- strict-origin-when-cross-origin referrer policy;
- camera, microphone and geolocation disabled.

Login/recovery/password pages additionally receive a restrictive Content Security Policy:

- same-origin default/connect/script;
- data images;
- inline styles currently allowed;
- no base URI;
- no framing;
- same-origin form action.

Future hardening:

- add CSP to product pages;
- remove inline script/style where practical;
- use nonce/hash policy;
- add explicit `object-src 'none'`;
- review CDN caching behind authentication;
- rate-limit login, recovery, asset and run endpoints;
- add bot/abuse controls without storing excessive personal data.

## 8. Media access

### Listing assets

1. output API signs `run_id + source URL + type`;
2. browser POSTs token to listing-asset API;
3. server verifies HMAC and source allowlist;
4. server returns cached signed URL or downloads once;
5. bytes are validated and stored;
6. user gets 10-minute view/download URLs.

### Renewal assets

1. external trusted agent creates project metadata;
2. agent requests signed upload URL;
3. agent directly PUTs binary to Supabase;
4. agent patches asset ready state;
5. project is published;
6. read API issues one-hour signed URLs.

## 9. Production deployment state

Verified production on 2026-09-04:

| Field | Value |
| --- | --- |
| Vercel project | `torium` |
| Project ID | `prj_iUNYNTe87Yq5TSButgwBL6FYOe6O` |
| Team ID | `team_NyJzt1O0AJ9BHWshNKf1uBex` |
| Node version | 24.x |
| Deployment | `dpl_GN845jsDyS5pyY7cWBBdLSFqPY9v` |
| State | READY |
| Target | production |
| Git ref | `main` |
| Commit | `6bbb260e7e8ce48cff74e7f38122fd7a84af4930` |
| Function count | 11 |
| Primary domain | `torium-nu.vercel.app` |

The current local working tree contains later Auth hardening and documentation changes. Do not describe them as deployed until a production deployment contains their commit.

## 10. Environment variables

### Required for core server reads

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`.

### Required for hardened Auth

- `SUPABASE_PUBLISHABLE_KEY` preferred, or `SUPABASE_ANON_KEY`.

### Required for real source runs

- `APIFY_TOKEN`.

### Optional/configurable

- source actor IDs;
- OpenAI key/model for legacy GPT paths;
- `TORIUM_RENEWAL_AGENT_KEY`;
- `TORIUM_ASSET_TOKEN_SECRET`;
- viewer result limit;
- source/run/dataset and search parameters.

Secrets must be configured for the correct Vercel environment. Preview and production must not silently share development assumptions.

## 11. Frontend performance notes

Current strengths:

- no framework bootstrap;
- compact JSON mode for dashboard;
- media can be omitted until needed;
- on-demand private image cache;
- deterministic rendering with stable URL query state;
- responsive renewal feed.

Current risks:

- `home.html` and `index.html` exceed 50 KB and embed substantial behavior;
- full runs can contain thousands of records;
- client-side sorting/filtering can block the main thread;
- repeated full output fetches are expensive;
- property navigation may re-fetch data already loaded;
- signed media requires extra round trips;
- large DOM/card sets need pagination or virtualization.

Target:

- versioned API projections;
- cursor pagination;
- server-side rank/filter parameters;
- cached run metadata separate from property pages;
- client cache keyed by run and revision;
- list virtualization;
- prefetch next property;
- image size variants and lazy loading;
- measured Web Vitals on desktop, iPad and mobile.

## 12. API versioning and compatibility target

The current API is unversioned. Before external agents and investor clients grow, introduce:

- `/api/v1/...` or an explicit media type/version header;
- stable error envelope;
- request ID;
- idempotency key on run, note and renewal mutations;
- cursor pagination;
- documented schemas;
- deprecation policy;
- rate limits by actor/user;
- audit-safe logging;
- machine-readable OpenAPI specification.

## 13. Release checklist

- [ ] Confirm intended diff; preserve unrelated working-tree changes.
- [ ] Run syntax checks for modified server/browser JS.
- [ ] Run `npm test`.
- [ ] Run Vercel production-equivalent build.
- [ ] Count generated Functions; must remain within the active plan.
- [ ] Verify required environment variable names, never values.
- [ ] Apply additive Supabase migrations before dependent code.
- [ ] Re-run Supabase security and performance advisors.
- [ ] Smoke-test login, logout and protected-page redirect.
- [ ] Smoke-test home, one property, villas, renewals and account.
- [ ] Verify admin-only run endpoints with investor and admin roles.
- [ ] Verify source rows remain sanitized.
- [ ] Verify signed asset view and download.
- [ ] Verify rollback candidate before promotion.
- [ ] Record deployed commit and absolute date in technical state.
