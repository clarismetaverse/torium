# TORIUM — Technical State

**Version:** 0.3
**Last updated:** 2026-09-01

## Purpose

This document is the current technical snapshot for developers and AI agents. It records what is implemented, what has been validated, and what still requires redesign.

## Stack

- **Frontend:** static HTML/JavaScript views and Vercel Functions, deployed on Vercel
- **Backend and database:** Supabase / PostgreSQL
- **AI:** GPT
- **Scraping:** Apify Actors

TORIUM originally used Xano. Supabase is now the primary backend because it provides SQL, simpler debugging, stronger AI/MCP integration, and a better path to scale.

## Current pipeline

```text
Listing sources
      ↓
Scraping and normalization
      ↓
Raw source listings
      ↓
Deduplication
      ↓
Pre-triage
      ↓
Door Engine
      ↓
GPT analysis
      ↓
Supabase persistence
      ↓
Frontend
```

Raw source rows are preserved and canonical listings are generated. Current API/result views distinguish raw, deduped, eligible, and area-matched records.

## Persistence

Implemented core tables include:

- `triage_runs`
- `triage_source_listings`
- `triage_properties`

Persistence is currently stable.

## Frontend

Implemented:

- run dashboard and statistics;
- property detail viewer;
- separate villa and virtual-renewal views;
- GPT analysis;
- cost estimation;
- low/base/high exit scenarios;
- profit/loss and ROI panel;
- invite-only email/password access;
- investor alert-preference editor.

## Investor access and alert-preference V1

Status on 2026-09-01:

- Supabase Auth email/password is used for invite-only accounts;
- there is no public sign-up flow;
- the Vercel Function exchanges credentials with Supabase Auth and stores access
  and refresh tokens in HttpOnly, SameSite=Lax cookies;
- the browser never receives the Supabase service-role key;
- /home, property detail, /villas, /renewals, and /account use the shared
  authentication guard;
- their data APIs also validate the authenticated session, so the restriction is
  not only a frontend redirect;
- renewal-agent POST/PATCH remains a separate server-to-server channel protected
  by TORIUM_RENEWAL_AGENT_KEY.
- the Vercel Hobby deployment stays below the 12-function limit by multiplexing
  account routes through api/account.js and Supabase debug routes through
  api/triage.js; vercel.json preserves the existing public endpoint URLs.

The preference surface intentionally includes only:

- canonical Milan neighborhoods;
- minimum and maximum asking price;
- minimum and maximum surface;
- maximum price per square meter;
- minimum Door Score;
- minimum base-case ROI.

The preference model intentionally excludes:

- presence on both portals;
- cross-portal price spread;
- notification frequency.

Dual-portal presence and price spread remain internal discovery/ranking signals.
Notification frequency belongs to the future delivery layer, not to the first
investor matching profile.

Supabase table:

- public.investor_alert_preferences;
- one row per auth.users.id;
- foreign key with on delete cascade;
- primary key on user_id;
- value and range constraints;
- RLS enabled and forced;
- four ownership policies for select, insert, update, and delete;
- anon has no table privileges.

Migration:

- supabase/migrations/20260901154307_investor_alert_preferences.sql;
- applied to Supabase project wboeyszksqtcjnaiiofe;
- verified live with RLS enabled, forced RLS, 4 policies, and the expected 11
  columns.

Required Vercel variables:

- SUPABASE_URL;
- SUPABASE_PUBLISHABLE_KEY (preferred) or legacy SUPABASE_ANON_KEY;
- SUPABASE_SERVICE_ROLE_KEY, server-side only.

Current caveats:

- account creation/invitation is still managed from Supabase Auth;
- preferences are persisted but no scheduler, matching job, email, or push
  delivery is active yet;
- expensive run/valuation endpoints need a separate admin role before they are
  exposed again in the interface;
- Supabase advisors reported pre-existing issues outside this migration:
  security-definer views, mutable function search paths, and duplicate indexes.
  They should be handled in a separate audited migration.

Target notification flow:

    New normalized listing
           |
           v
    Data-quality gate
           |
           v
    Canonical neighborhood + financial/physical signals
           |
           v
    Match against investor_alert_preferences
           |
           v
    Deduplicate per investor and listing
           |
           v
    Notification outbox
           |
           v
    Email / push delivery with audit trail

Validation:

- node --check passed for all new and modified server modules;
- full repository suite passed: 133/133 tests.

Planned:

- richer admin dashboard;
- run comparison and replay;
- microzone and unit-profile editors;
- strategy-weight editor;
- scoring simulator.

## Source validation

### Idealista — VALIDATED / PRIMARY

Observed behavior:

- stable scraping;
- good geographic consistency;
- low duplication;
- good candidate quality.

Idealista is the current source of truth for scouting.

### Immobiliare.it — PARTIALLY VALIDATED / SECONDARY

Known issues in the current actor:

- identical listings returned across multiple districts;
- duplicated candidates;
- area mismatches;
- excessive renovated/showcase inventory;
- geographic filtering that is not reliable enough.

Required rework:

- redesign actor configuration;
- validate query generation and district mapping;
- improve filters and normalization;
- reassess or replace the actor if necessary.

Immobiliare.it remains integrated but must not drive primary scouting or benchmarking until this work is validated.

## Current scoring implementation

The Door Engine currently uses signals including surface, bathrooms, entrances, plans, renovation status, and risk flags. A known limitation is that price per square meter still affects ranking.

The next version must separate:

- **Physical Fractionability**
- **Economic Opportunity**
- **Market Sellability**

Price and ROI belong to economic opportunity, not physical fractionability. Sellability is evaluated against the projected output units, not only the original asset.

## V1 market model

Planned V1 entities:

- `microzone_profiles`: general microzone demand and ecosystem;
- `microzone_unit_profiles`: unit type + surface band sellability;
- `strategy_profiles`: weights and constraints for investor objectives.

The values start hardcoded and editable through the admin dashboard. This is an intentional expert-prior phase, not a claim of observed market truth.

## V2 data model

Planned data capabilities:

- recurring `listing_snapshots`;
- `first_seen_at` and `last_seen_at`;
- price history and reductions;
- estimated days on market;
- stock, disappearance, and turnover/absorption proxies;
- dynamic sellability profiles by microzone, unit type, and size band.

External commercial APIs are not required for the MVP. Listing history is the primary signal; official geographic boundaries and market benchmarks can provide stable reference layers.

## Validation summary

Validated:

- Idealista scraping;
- normalization/deduplication pipeline;
- Supabase persistence;
- GPT integration;
- frontend property viewer;
- cost, P&L, and ROI presentation.

Needs validation or redesign:

- Immobiliare.it acquisition;
- scoring separation;
- microzone profiles;
- unit profiles;
- strategy profiles;
- dynamic sellability and backtesting.

## Next technical milestone

```text
Microzone profiles
       ↓
Microzone unit profiles
       ↓
Strategy profiles
       ↓
Admin dashboard + replay
       ↓
Scoring Engine V2
       ↓
Snapshot-based sellability
```
