# TORIUM — Vision and Roadmap

**Version:** 0.2  
**Status:** Active development  
**Last updated:** 2026-08

## Vision

TORIUM is a **Real Estate Intelligence Operating System**, not a property search engine. It is an intelligence layer that discovers, ranks, underwrites, and continuously improves residential value-add opportunities.

TORIUM must optimize for the highest probability of creating and monetizing value—not for the cheapest apartment. Its decision-making balances:

- physical fractionability;
- market sellability and liquidity of the units produced;
- economic opportunity and risk-adjusted ROI;
- execution feasibility.

## Product architecture

```text
Idealista / Immobiliare.it / future sources
                    ↓
                 Scraping
                    ↓
              Normalization
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
                Supabase
                    ↓
                Frontend
```

Future sources may include agencies, off-market inventory, auctions, cadastral data, and energy certificates.

## Current product state

The working pipeline includes scraping, normalization, deduplication, pre-triage, fractionability analysis, cost and ROI estimates, GPT analysis, Supabase persistence, and a frontend run/property viewer.

Source policy:

- **Idealista:** validated and used as the primary scouting source.
- **Immobiliare.it:** integrated but not sufficiently reliable; it remains secondary until its actor and geographic filtering are reworked.

## Core scoring principle

TORIUM must keep three independent dimensions visible:

1. **Physical Fractionability** — can the asset realistically be divided?
2. **Economic Opportunity** — does the acquisition and transformation produce an attractive return?
3. **Sellability** — how quickly and reliably can the resulting units be sold?

A strategy-specific composite may combine them, but no dimension should silently contaminate another. In particular, price per square meter must not influence the physical score.

## V1: handcrafted market intelligence

V1 encodes expert judgment as editable priors:

- `microzone_profiles` describe the local demand ecosystem;
- `microzone_unit_profiles` describe demand for a unit type and surface band;
- `strategy_profiles` define investor-specific weights.

A unit profile is keyed by microzone, unit type, and size range. It can store sellability, expected days to sell, premium multiplier, and notes. This allows TORIUM to compare the current apartment with the projected units after fractioning.

The Admin Dashboard is the control center for runs, microzones, unit profiles, strategy profiles, ranking replay, and a scoring simulator. Assumptions should be editable and scores recomputable without scraping again.

## Strategy profiles

TORIUM must not have one universal ranking. Initial profiles may include:

- Crowdfunding
- Developer / Flip
- Student Housing
- Build-to-Rent
- Luxury
- Fast Exit

The underlying component scores stay stable; the strategy selects the weights and constraints.

## Roadmap

### Phase 1 — controllable V1

- hardcoded microzone profiles;
- hardcoded microzone unit profiles;
- strategy profiles;
- admin editing UI;
- run history, comparison, and replay;
- scoring simulator and versioned assumptions.

### Phase 2 — observed market behavior

- recurring listing snapshots;
- first-seen and last-seen tracking;
- estimated days on market;
- price-reduction history;
- inventory and turnover metrics;
- sellability by microzone, unit type, and size band.

### Phase 3 — dynamic intelligence

- dynamic sellability calibrated from observed behavior;
- backtesting against disappearance speed and price stability;
- risk prediction;
- AI-assisted strategy optimization;
- continuous deal monitoring.

## Long-term direction

```text
Hardcoded expert knowledge
          ↓
Observed market behavior
          ↓
Automatic calibration
          ↓
Predictive real estate intelligence
```

The schema and UI should support the transition from handcrafted V1 to data-driven V2 without a redesign.
