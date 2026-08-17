# TORIUM - Current Valuation State and AVM Target

**Status:** living memory for product, engineering, and investment review
**Snapshot date:** 2026-08-17
**Current cost model:** `max_doors_unit_type_costs_v4_sales_cost_3pct`
**Current exit model:** `milan_city_exit_v3_provisional_2026_07`
**Current unit planner:** `max_doors_residual_studio_v2`

## Purpose

This document records exactly how TORIUM currently estimates fractioning unit economics and exit values, which assumptions are provisional, and the intended path toward a complete Automated Valuation Model (AVM).

The current model is designed for fast, comparable screening. It is not a professional appraisal, a confirmed construction budget, legal feasibility evidence, or an investment recommendation.

## Current fractioning unit economics

### Acquisition

```text
purchase costs = purchase price x 12%
```

The 12% is an aggregate preliminary allowance. It is not yet a deal-specific tax and fee engine. It does not separately model the buyer's legal form, tax regime, cadastral basis, deductible VAT, financing structure, or negotiated brokerage.

### Transformation

Transformation is charged against every final unit, not only the additional units created:

| Final unit type | Provisional transformation cost |
|---|---:|
| Monolocale | EUR 25,000 |
| Bilocale | EUR 25,000 |
| Trilocale | EUR 30,000 |
| Unknown/default | EUR 25,000 |

```text
transformation cost = sum(cost assigned to each final unit type)
```

The allowance is a screening prior. Furniture, architect and municipal practices, systems, condominium work, structural intervention, energy upgrades, and specification quality are not yet itemized. Depending on the deal, some of these costs may be only partially represented by the aggregate allowance.

### Sale and return

```text
selling cost = exit value x 3%
project cost = purchase price + purchase costs + transformation cost
total cost = project cost + selling cost
profit/loss = exit value - total cost
ROI = profit/loss / total cost x 100
margin on sales = profit/loss / exit value x 100
```

The current model deliberately excludes contingency and holding costs. It also does not yet itemize financing, interest, condominium charges during the project, IMU, insurance, utilities, taxes on profit, or investor/platform fees.

## Current provisional EUR/sqm exit valuation

### Geographic benchmark

Each Milan listing is matched to the most specific configured zone alias using query area, area label, district, neighborhood, title, and address. Most profiles use July 2026 idealista/data asking-price benchmarks. Corso San Gottardo retains a specific blended benchmark from Immobiliare.it and idealista/data. A Milan-wide fallback is allowed only when no more specific configured macrozone matches and is marked low-confidence.

These are asking prices, not confirmed transaction prices.

### Saleable surface and unit mix

```text
estimated saleable area = gross listing area x 92%
```

The provisional planner produces a final-unit mix from the estimated saleable area. It currently prioritizes bilocali of at least 40 saleable sqm and may preserve one residual monolocale of at least 28 saleable sqm. The plan remains subject to technical, legal, urban-planning, cadastral, condominium, access, window, ventilation, and building-system validation.

### Small-unit adjustment

The zone benchmark is adjusted for each projected final unit:

| Size/type band | Current multiplier |
|---|---:|
| Monolocale up to 39.9 sqm | 1.06 |
| Bilocale up to 45 sqm | 1.06 |
| Bilocale up to 55 sqm | 1.04 |
| Trilocale up to 70 sqm | 1.02 |
| Larger/unknown | 1.00 |

```text
unit base value = unit saleable sqm x zone asking EUR/sqm x size multiplier
```

Each projected unit is rounded to EUR 5,000. Total exit value is the sum of all final-unit values.

### Scenarios

```text
low = base value x 90%
base = current asking benchmark x 100%
high = base value x 110%
```

The zone sentiment and recent percentage change are retained for audit but do not currently increase or decrease the base valuation. No future appreciation is silently added.

## Current caveats

- Asking prices can differ materially from closed transaction prices.
- Macrozone averages can hide street-level and building-level differences.
- Text alias matching is less reliable than coordinate-based spatial assignment.
- The small-unit premium and 92% saleable-area ratio are expert-authored priors.
- The automatic unit mix is not proof that a split is technically or legally feasible.
- Exact renovation specification, furniture, professional and municipal costs are not itemized.
- Floor, lift, light, exposure, outdoor space, energy class, building quality, occupancy, and renovation quality do not yet produce a complete repeatable adjustment.
- Disappearance of a listing is not proof of sale.
- Low/base/high are sensitivities around a provisional benchmark, not statistical confidence intervals.
- The model is suitable for screening and comparison, not final underwriting or an investment offer.

## Target evolution

### Stage 1 - Versioned and editable priors

- Move current assumptions into editable, versioned records.
- Maintain microzone profiles and unit-type/size-band profiles.
- Recompute historical runs without scraping again.
- Persist every source, formula, override, and confidence level.
- Keep physical feasibility, economic return, and sellability as separate components.

### Stage 2 - Observed market behavior

- Store recurring listing snapshots with first-seen and last-seen dates.
- Track price changes, inventory, disappearance, relisting, and estimated days on market.
- Estimate asking-to-sale discounts by microzone, unit type, size, and condition.
- Calibrate small-unit premiums and saleable-area assumptions against completed TORIUM operations.
- Build sellability metrics from absorption, inventory depth, price stability, and time on market.

### Stage 3 - Comparable-based valuation

- Geocode every property and assign it spatially to a microzone and street context.
- Retrieve recent, nearby, homogeneous asking and closed-transaction comparables.
- Adjust for time, size, condition, floor, lift, outdoor space, energy performance, building quality, and renovation specification.
- Separate current fair value from expected value at the projected sale date.
- Produce a comparable table, adjustment bridge, value range, and confidence score for every final unit.

### Stage 4 - Complete AVM

The target AVM combines transaction evidence, observed listing behavior, property features, location, unit type, and time effects:

```text
current fair value
  = comparable transaction baseline
  + micro-location adjustment
  + property and building adjustments
  + unit-type and size adjustment
  - calibrated asking-to-sale discount

expected exit value
  = current fair value
  x calibrated time-horizon scenario
```

Each output must include:

- estimated value and EUR/sqm range;
- confidence and data-quality score;
- selected comparables and exclusion reasons;
- model, data, and assumption versions;
- current value versus expected exit-date value;
- expected selling time and liquidity risk as separate outputs;
- sensitivity to sale price, time, and transformation cost;
- backtest error against observed outcomes.

## Governance principles

1. Never present an asking-price benchmark as a confirmed transaction value.
2. Never mix physical fractionability with price or ROI.
3. Never mix expected appreciation into the current base value without an explicit horizon and model version.
4. Preserve raw inputs and make every adjustment replayable.
5. Show missing evidence and lower confidence instead of inventing precision.
6. Require professional technical, legal, tax, and appraisal validation before an investment decision.
