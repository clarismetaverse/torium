# TORIUM Supabase data, security and storage

**Version:** 1.0
**Live project verified:** 2026-09-04
**Project ref:** `wboeyszksqtcjnaiiofe`

## 1. Responsibilities

Supabase provides:

- PostgreSQL persistence;
- Supabase Auth identity and password lifecycle;
- Row Level Security;
- private object storage;
- REST access used by Vercel Functions;
- database migration history and advisors.

The Vercel server is the application gateway. It uses the service role only for server-owned operations, while investor preference reads/writes use the authenticated user's JWT so PostgreSQL RLS remains authoritative.

## 2. Live schema inventory

Observed row counts are a point-in-time diagnostic, not contractual limits.

| Table | Purpose | Live rows 2026-09-04 | RLS |
| --- | --- | ---: | --- |
| `triage_runs` | Run metadata, configuration, counts, summary and raw output | 6 | enabled |
| `triage_properties` | Ranked/valued run results | 2,966 | enabled |
| `triage_source_listings` | Source observations and normalized acquisition fields | 659 | enabled |
| `milan_idealista_locations` | Optional Idealista location taxonomy cache | 0 | enabled |
| `triage_property_notes` | One note per run/listing index | 0 | enabled |
| `triage_listing_assets` | On-demand listing image cache metadata | 64 | enabled |
| `renewal_styles` | Version-stable style catalog | 4 | enabled |
| `virtual_renewals` | Renewal project/version and publication state | 4 | enabled |
| `virtual_renewal_assets` | Ordered original/render/plan/material media | 32 | enabled |
| `investor_alert_preferences` | One investor preference row per Auth user | 0 | enabled + forced |
| `torium_memberships` | Application allowlist, role and status | 0 | enabled + forced |
| `torium_auth_events` | Minimal server-side Auth audit | 0 | enabled + forced |

## 3. Core triage entities

### 3.1 `triage_runs`

Identity:

- numeric database `id`;
- unique text `run_id`;
- creation/update timestamps;
- filename/search name/city/investor profile.

Configuration and provenance:

- `search_strategy`;
- `scoring_mode`;
- `source_channels`;
- `requested_areas`;
- `query_payloads`.

Counts:

- scraped/raw source;
- eligible;
- filtered out;
- pre-scored;
- GPT candidates/analyzed.

Output summary:

- top result title, URL, score, spread and ROI;
- filtered-out summary;
- result links;
- `raw_output` JSON.

The table is presently both run ledger and output container. The target separates execution state, immutable configuration, staging revision and published revision.

### 3.2 `triage_source_listings`

Stores one source/run observation with:

- source channel, platform, URL and listing ID;
- source fingerprint/key and canonical-match fields;
- query name, area, municipality, province and payload;
- title/address/location and canonical Idealista area metadata;
- price, EUR/sqm, surface, rooms, bathrooms, floor and condition;
- lift, plan, coordinates and thumbnail;
- pre-triage result;
- Door Score and unit/cost estimates;
- features, ignored/risk/quality flags;
- raw listing JSON.

The current table mixes raw observation, normalized values, matching fields and calculated prescore. The target decomposes these concerns without losing the current audit trail.

### 3.3 `triage_properties`

Stores a run result with:

- run foreign keys and list/rank fields;
- source identity and confidence;
- display/location/physical attributes;
- Door Score and fractioning outputs;
- deterministic exit values;
- estimated project cost, spread and ROI;
- positive signals, red flags, missing information and DD questions;
- final-unit plan, Door Engine JSON, GPT JSON, raw listing and raw result.

This is a denormalized read model optimized for the current frontend. It is not yet a stable global property record.

### 3.4 Notes

`triage_property_notes` is uniquely keyed by `run_id + listing_index` and accepts up to 4,000 characters.

Limitations:

- ranking/revaluation can change list indexes;
- a note is not automatically shared across duplicate portal records or later runs;
- there is no author ID, status history or structured feedback label.

Target migration:

- link to stable `property_id`;
- keep author `user_id`;
- separate free text from structured outcomes;
- preserve revisions and timestamps;
- allow feedback labels such as feasible, infeasible, documents requested, visited, offer made and rejected.

## 4. Auth and authorization entities

### 4.1 `torium_memberships`

One row per `auth.users.id`:

- `role`: `admin` or `investor`;
- `status`: `active` or `suspended`;
- optional inviter;
- timestamps.

Auth identity alone is insufficient. The application checks a current, active membership on the server. Roles are never derived from user-editable metadata.

RLS:

- forced;
- authenticated users can select only their own row;
- no client write access;
- administrative writes use the service role.

### 4.2 `investor_alert_preferences`

One row per Auth user:

- up to 32 canonical neighborhood IDs;
- min/max asking price;
- min/max size;
- maximum EUR/sqm;
- minimum Door Score;
- minimum base ROI;
- timestamps.

Database checks enforce numeric bounds and valid ranges. Four RLS policies cover select/insert/update/delete. Every policy requires both ownership and active membership.

### 4.3 `torium_auth_events`

Minimal events:

- login succeeded;
- logout;
- invite accepted;
- recovery link opened;
- password changed.

The table deliberately omits passwords, tokens, raw IPs and email payloads. It is server-written and closed to browser roles. A deny-all authenticated SELECT policy exists to make the closure explicit to the advisor.

## 5. RLS model

### Server-owned tables

The following are intentionally inaccessible to `anon` and `authenticated`:

- triage runs/results/source rows;
- location cache;
- notes;
- listing asset metadata;
- renewal styles/projects/assets;
- Auth audit.

RLS is enabled and there are no permissive client policies. Vercel Functions sanitize and return only required fields.

### User-owned table

`investor_alert_preferences` is the only current browser-role data surface. It uses the user's JWT and `auth.uid()`, not a service-role bypass.

### Views

`triage_best_properties` and `triage_source_shortlist` are configured with `security_invoker = true`, so they obey the querying role's permissions and RLS rather than implicitly inheriting the view owner.

## 6. Storage buckets

### 6.1 `torium-listing-assets`

- private;
- 10 MB object limit;
- JPEG, PNG, WebP, GIF and AVIF;
- path derived from run and SHA-256 asset identity;
- signed read URL: 10 minutes;
- retention metadata: 90 days;
- no automatic cleanup job yet.

`triage_listing_assets` records:

- original URL and host;
- asset type;
- cache state;
- storage path;
- MIME type and byte size;
- content hash;
- cache/access/expiry timestamps;
- last error.

The server validates source host, redirect destination, MIME and size before upload. A public image proxy may be used as a fallback for portal CDN blocking, after which the bytes are stored in TORIUM's private bucket.

### 6.2 `torium-renewals`

- private;
- 15 MB object limit;
- JPEG, PNG, WebP and AVIF;
- direct signed binary upload;
- signed read URL: one hour;
- publication controlled by database state.

The agent requests an upload URL from TORIUM, then PUTs the binary directly to Storage. This avoids Function body and execution constraints.

## 7. Virtual renewal schema

### `renewal_styles`

Stable style ID, name, description, palette, active flag and timestamps.

### `virtual_renewals`

- UUID and unique external ID;
- optional source listing row and run;
- source channel/listing ID/URL;
- style ID;
- title/subtitle/narrative/location;
- status: draft, processing, published, failed or archived;
- version;
- generation provider/model/prompt/job metadata;
- order and publication timestamps.

Uniqueness:

```text
source_channel + source_listing_id + style_id + version
```

### `virtual_renewal_assets`

- renewal reference;
- stable asset key;
- kind: renewal, original, floor plan, material or detail;
- view/room/layout metadata;
- sequence;
- source URL or Storage reference;
- upload state;
- MIME, size, dimensions and hash;
- caption, alt text and cover flag.

An asset must have either a source URL or a Storage bucket/path.

## 8. Migration state

Live migration history contains 19 migrations:

1. `20260624143812 create_torium_triage_schema`
2. `20260624144506 create_torium_triage_tables`
3. `20260625160409 add_torium_multisource_staging`
4. `20260625161955 add_source_listing_key`
5. `20260625202034 add_cross_source_match_fields`
6. `20260625230340 add_source_listing_quality_fields`
7. `20260625231740 replace_source_listing_unique_key_with_source_key`
8. `20260706113127 create_milan_idealista_locations`
9. `20260706113305 add_idealista_location_columns_to_source_listings`
10. `20260706114300 set_idealista_location_fields_from_query_payload`
11. `20260805232110 add_search_strategy_to_triage_runs`
12. `20260817175229 enable_rls_on_source_and_location_tables`
13. `20260824002742 allow_villa_dynamic_market_search_strategy`
14. `20260824120106 create_triage_listing_assets`
15. `20260824134454 create_virtual_renewals`
16. `20260824134539 add_virtual_renewal_fk_indexes`
17. `20260901155603 investor_alert_preferences`
18. `20260902110652 auth_security_hardening`
19. `20260902110751 close_auth_security_advisors`

The checkout contains only migrations from August onward. The first ten production migrations are not represented locally. This is migration-baseline drift and must be fixed before reproducible development branches or disaster recovery can be trusted.

Required remediation:

1. export/reconstruct the exact first ten SQL migrations;
2. compare checksums and schema effects with production;
3. add a schema snapshot for bootstrap;
4. validate a clean disposable database from zero;
5. prevent future dashboard-only DDL.

## 9. Advisor snapshot

Live advisor result on 2026-09-04:

- security: 11 notices, 0 errors, 2 warnings, 9 informational;
- performance: 66 notices, 10 warnings, 56 informational.

Security informational notices report RLS-enabled tables without client policies. For server-only tables this is intentional fail-closed behavior, not an access gap.

Security warnings:

- `public.set_updated_at` has mutable `search_path`;
- `public.set_idealista_location_fields_from_query_payload` has mutable `search_path`.

Remediation: set an explicit safe `search_path`, schema-qualify referenced objects and re-run the [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

Performance warnings report duplicate indexes:

- eight duplicate pairs on `triage_properties`;
- two duplicate pairs on `triage_runs`.

Do not drop them blindly. First inspect definitions, constraints, usage and lock impact, then keep one index per identical definition through a reviewed migration. The unused-index notices are not actionable until representative production traffic and enough observation time exist.

## 10. Secrets and environment variables

| Variable | Used by | Exposure |
| --- | --- | --- |
| `SUPABASE_URL` | API, pipelines and scripts | server configuration |
| `SUPABASE_PUBLISHABLE_KEY` | Auth and user-RLS requests | publishable but currently server-mediated |
| `SUPABASE_ANON_KEY` | Legacy fallback | publishable; prefer modern key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-owned tables, Auth admin and Storage | secret, server only |
| `TORIUM_ASSET_TOKEN_SECRET` | HMAC listing asset tokens | secret; service-role fallback exists but dedicated key is preferred |
| `TORIUM_RENEWAL_AGENT_KEY` | Renewal POST/PATCH channel | secret, minimum 32 chars |

Rules:

- never embed service role or agent keys in `public/`;
- never log token values;
- do not put credentials in documentation or screenshots;
- rotate a key immediately if exposed;
- separate production and local secrets;
- prefer `SUPABASE_PUBLISHABLE_KEY` over legacy anon key;
- use service role only where bypassing RLS is explicitly required.

## 11. Backup, recovery and retention

Current gaps:

- no repository runbook verifies database backup/PITR tier;
- no automated export of critical configuration tables;
- no renewal/listing asset cleanup worker;
- no tested restore drill;
- no documented RPO/RTO;
- no soft-delete/version history for notes/preferences.

Target policy:

- document Supabase plan and backup guarantees;
- export assumption/style/profile tables regularly;
- define RPO/RTO for screening data versus Auth/membership data;
- test restore into a branch or separate project;
- keep immutable source observation and valuation revisions;
- delete expired cached media only through a reference-aware cleanup job.

## 12. Target schema for durable execution

Additive entities:

- `triage_run_sources`: source-level job status, actor IDs, dataset IDs, counts and errors;
- `source_listing_observations`: global temporal source observations;
- `triage_run_source_memberships`: observations participating in a run;
- `canonical_properties`: stable property identity;
- `property_source_memberships`: match evidence and confidence;
- `triage_property_revisions`: immutable run/model result;
- `run_leases`: database-backed concurrency slots with heartbeat and expiry;
- `notification_outbox`: idempotent investor/listing delivery state;
- `notification_deliveries`: channel attempts and outcomes;
- structured DD/operation feedback linked to property and user.

Publication must stage a complete revision, validate reconciliation, then atomically update a published-revision pointer.

## 13. Database acceptance checklist

- [ ] Reconstructed baseline creates the live schema from zero.
- [ ] Every public table has RLS enabled.
- [ ] User-owned policies test positive and negative ownership cases.
- [ ] Server-only tables remain inaccessible with anon and user JWTs.
- [ ] Views use `security_invoker`.
- [ ] Both mutable-`search_path` warnings are closed.
- [ ] Duplicate indexes are removed after measured verification.
- [ ] Foreign keys used for deletion/join paths are indexed.
- [ ] Service-role access is confined to server code.
- [ ] Storage buckets remain private and signed URLs expire.
- [ ] Backup/restore drill and retention jobs are documented.
- [ ] Advisor checks run after every DDL release.
