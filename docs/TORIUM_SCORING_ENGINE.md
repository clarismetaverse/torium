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

## Financial underwriting shown in the frontend

The physical Door Score and financial underwriting remain separate. Both legacy
and neutral runs use the same versioned `max_doors_unit_type_costs_v4_sales_cost_3pct` cost model:

```text
purchase costs = purchase price × 12%
transformation cost = sum of the cost assigned to every final unit
monolocale or bilocale = EUR 25,000 per final unit
trilocale = EUR 30,000 per final unit
project cost = purchase price + purchase costs + transformation cost
selling cost = exit value × 3%
total scenario cost = project cost + selling cost
profit / loss = exit value − total scenario cost
ROI = profit / loss ÷ total scenario cost × 100
margin on sales = profit / loss ÷ exit value × 100
```

The current model does not include contingency or holding costs. A fractioning
ROI is not applicable when the physical plan creates no new unit; those listings
keep their physical score but expose null exit, P/L, and ROI values.

Low, base, and high exit values come from the persisted valuation or the sum of
the corresponding values in the final-unit plan. They are not inferred from the
physical score. When a run has not yet been valued, exit, P/L, and ROI remain
`null` and the frontend must show them as unavailable rather than zero.

Run-level ROI averages and medians include only properties with a calculable
base-case ROI and expose the included property count.

## Provisional Milan-wide exit profile V3

The temporary profile `milan_city_exit_v3_provisional_2026_07` maps all 18
idealista Milan macro-zones to their July 2026 asking-price benchmarks. The
base case does not add forecast appreciation. Zone sentiment is persisted for
audit, while low/base/high scenarios remain 90% / 100% / 110% of the
size-adjusted benchmark. These values are comparison inputs, not professional
appraisals or confirmed transaction prices.

The more specific Corso San Gottardo benchmark remains available and wins over
the broader Navigli-Bocconi profile when the listing location supports that
match. Every other zone uses the citywide provisional table until transaction
comparables and microzone-specific sellability models replace it.
A citywide 5,681 EUR/sqm fallback is used only when a future or unexpected
area label does not match any of the 18 zones; those valuations are explicitly
marked low-confidence.

## Provisional output-unit planner V2

The current `max-doors-25k-final-units` profile (kept at the legacy-compatible
`max-doors-20k.json` path) uses the versioned
`max_doors_residual_studio_v2` planning rule. It converts gross listing area to
estimated saleable area using the same 92% ratio used by deterministic
valuation, then applies:

```text
minimum bilocale = 40 saleable sqm
minimum residual monolocale = 28 saleable sqm

bilocali = floor(saleable area / 40)
residual = saleable area - (bilocali x 40)

if residual >= 28:
  preserve one residual monolocale
else:
  redistribute residual area across the bilocali
```

The monolocale is residual-only and the planner creates at most one. A surface
below 68 saleable sqm is not presented as a fractioning plan because it cannot
contain both one 40 sqm bilocale and one 28 sqm monolocale under this rule.

The 28 sqm threshold is a conservative automatic planning gate based on the
ordinary minimum dwelling area in Milan. It does not prove feasibility. The
floor plan, windows and ventilation, independent access, services, building
systems, condominium rules, cadastral/urban status, and all current legal
requirements still require professional validation. The exceptional 20 sqm
case introduced by national legislation is not used automatically.

Deterministic valuation must value every planned unit at its own size band and
must preserve the exact unit mix. The physical plan and the economic unit plan
must therefore never silently use different unit counts or equal-size
assumptions.

This is deliberately not the final sellability optimizer. A later version will
choose the locally most liquid mix from `microzone + unit type + size band`
rather than maximizing door count alone. For example, a prestigious family
microzone may prefer fewer, larger trilocali even when more 40 sqm bilocali are
physically possible.

## Versioning rules

- Never overwrite the meaning of a score silently.
- Version formulas, thresholds, profiles, and priors.
- Persist raw inputs and component outputs for replay.
- Keep hardcoded V1 and dynamic V2 distinguishable.
- Recompute historical runs without re-scraping when inputs are available.
- Document every material bonus, penalty, or weight change in this file and the ADR log.
