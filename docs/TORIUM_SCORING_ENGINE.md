# TORIUM — Scoring Engine

**Status:** Design baseline for V1/V2  
**Last updated:** 2026-08

## Objective

The engine ranks value-add residential opportunities without confusing physical feasibility, financial attractiveness, and market liquidity.

## Independent score families

Every property and fractioning hypothesis must expose three scores on a 0–100 scale.

### 1. Physical Fractionability Score

Answers: **Can this property realistically be divided?**

Possible inputs:

- usable surface and geometry;
- bathrooms and wet-area distribution;
- independent entrances;
- floor-plan availability and confidence;
- windows, circulation, and access;
- renovation state;
- technical/legal risk flags;
- plausible number and size of resulting units.

Acquisition price, price per square meter, resale value, and ROI must not affect this score.

### 2. Economic Opportunity Score

Answers: **Is the operation financially attractive?**

Possible inputs:

- acquisition price and price per square meter;
- purchase costs;
- renovation/transformation costs;
- total project cost;
- low/base/high exit value;
- nominal ROI and margin;
- capital duration and risk adjustments;
- sensitivity to cost overruns and exit-price changes.

### 3. Sellability Score

Answers: **How liquid are the current and projected units in this market?**

V1 reads the matching `microzone_unit_profiles` record using:

```text
microzone + unit_type + min/max sqm
```

Inputs may include:

- hardcoded sellability prior;
- expected days to sell;
- fit with local demand segments;
- size-band fit;
- price-band or premium adjustment;
- projected output mix.

For multiple projected units, aggregate unit-level scores explicitly (for example a unit-count-weighted mean) and retain the individual values.

The UI should show:

```text
Current Sellability → Projected Sellability → Delta
```

## V1 microzone profiles

`microzone_profiles` describes the market ecosystem rather than replacing unit-level sellability. Suggested fields:

- `name`
- `overall_score`
- `sellability_score`
- `fractionability_ecosystem_score`
- `university_score`
- `young_professional_score`
- `family_score`
- `luxury_score`
- `transport_score`
- `growth_score`
- `notes`

Suggested initial overall benchmark from expert priors:

| Microzone | Sellability | Fractionability ecosystem | Overall |
|---|---:|---:|---:|
| Città Studi | 98 | 95 | 97 |
| Porta Venezia / Buenos Aires | 96 | 94 | 95 |
| Bocconi / Porta Romana | 95 | 93 | 94 |
| Garibaldi / Isola / Porta Nuova | 95 | 91 | 93 |
| Moscova / Brera | 93 | 88 | 91 |
| Stazione Centrale | 91 | 89 | 90 |
| Navigli / Porta Genova | 90 | 88 | 89 |
| Sant'Ambrogio / Cattolica | 89 | 87 | 88 |
| Lambrate | 88 | 89 | 88 |
| Bicocca | 87 | 89 | 88 |
| NoLo | 85 | 90 | 87 |
| Porta Vittoria | 86 | 87 | 87 |
| Washington / De Angeli | 86 | 84 | 85 |
| Corso San Gottardo | 84 | 86 | 85 |
| Fiera / CityLife | 84 | 82 | 83 |
| Bovisa | 81 | 86 | 83 |
| Dergano | 80 | 85 | 82 |
| Barona | 79 | 84 | 81 |
| Giambellino / Lorenteggio | 78 | 83 | 80 |
| Corvetto | 74 | 80 | 77 |

These are editable priors and must be labeled as such.

## V1 unit profiles

`microzone_unit_profiles` should contain:

- `microzone_id`
- `unit_type` (studio, one-bedroom/bilocale, two-bedroom/trilocale, etc.)
- `min_mq`
- `max_mq`
- `sellability_score`
- `expected_days_to_sell`
- `premium_multiplier`
- `notes`

Example: Città Studi may rate a 40–55 sqm bilocale substantially higher than a large quadrilocale. Therefore, the value of a fractioning plan depends on the units it creates.

## Strategy profiles and composite ranking

A strategy profile defines weights and hard constraints. It does not rewrite component scores.

A normalized composite may be expressed as:

```text
Strategy Score =
  w_physical × Physical Fractionability
+ w_economic × Economic Opportunity
+ w_sellability × Sellability
- explicit risk penalties
```

where the non-penalty weights sum to 1. Profiles such as Developer, Crowdfunding, Student Housing, Build-to-Rent, Luxury, and Fast Exit can choose different weights.

Every ranked result must persist:

- component scores;
- strategy profile and version;
- weights;
- bonuses and penalties;
- input assumptions;
- final composite;
- human-readable reasons.

This makes ranking replayable and auditable.

## V2 dynamic sellability

Once listing snapshots exist, replace or blend hardcoded priors with observed measures. A candidate model by microzone, unit type, and size band is:

- **35%** turnover / absorption proxy;
- **20%** estimated days on market;
- **15%** price stability and price reductions;
- **15%** demand-depth proxy;
- **10%** output-unit fit;
- **5%** microzone trend.

A core proxy is:

```text
absorption_proxy =
  listings leaving the market during the period
  / average active stock during the period
```

Disappearance is not proof of sale, so the score is an estimate and must be calibrated through backtests.

## Versioning rules

- Never overwrite the meaning of a score silently.
- Version formulas, thresholds, profiles, and priors.
- Persist raw inputs and component outputs for replay.
- Keep hardcoded V1 and dynamic V2 distinguishable.
- Recompute historical runs without re-scraping when inputs are available.
- Document every material bonus, penalty, or weight change in this file and the ADR log.
