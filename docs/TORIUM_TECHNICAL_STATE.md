# TORIUM — Technical State

**Version:** 0.2  
**Last updated:** 2026-08

## Purpose

This document is the current technical snapshot for developers and AI agents. It records what is implemented, what has been validated, and what still requires redesign.

## Stack

- **Frontend:** React, deployed on Vercel
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
- GPT analysis;
- cost estimation;
- low/base/high exit scenarios;
- profit/loss and ROI panel.

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

Current recovery work uses the structured `igolaizola/immobiliare-it-scraper` actor as the default secondary adapter. It runs asynchronously, uses `mostRecent` in neutral mode, validates source-provided geography after collection, isolates individual query failures, and performs conservative cross-source deduplication while retaining source provenance. The older start-URL actor remains available only through `TORIUM_IMMOBILIARE_ACTOR=url` for controlled comparisons. Promotion beyond secondary status still requires a live validation sample and geographic/duplicate-rate reporting.

### Milan area standard

New runs normalize both portal taxonomies into 32 canonical Milan zones derived from Immobiliare.it's search/market grouping. The canonical name is stored in `area_label` and drives dashboard grouping and filters; the original Idealista or Immobiliare neighborhood remains available in `neighborhood`, `source_area_label`, and the raw source payload for audit and future microzone analysis. This is a many-label-to-one-zone compatibility layer, not a claim that the two portals draw identical geographic boundaries.

See `docs/MILAN_AREA_TAXONOMY.md` for the full mapping and current limitations.

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
