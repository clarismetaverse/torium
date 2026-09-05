# TORIUM data pipelines and domain model

**Version:** 1.0
**Verified:** 2026-09-04

## 1. Pipeline families

TORIUM currently contains several pipeline generations:

| Pipeline | Role | Status |
| --- | --- | --- |
| `pipelines/triage-multisource-massive.js` | Main deterministic apartment and villa acquisition pipeline | Preferred |
| `pipelines/triage-gpt-from-supabase.js` | Optional GPT enrichment over a persisted run | Supported but secondary |
| `pipelines/triage-idealista-filtered.js` | Earlier Idealista filtered/GPT workflow | Legacy |
| `pipelines/triage-idealista.js` | Earlier small Idealista workflow | Legacy |
| `pipelines/analyze-idealista.js` | Early direct analysis experiment | Legacy |

New work should extend the multisource contract and pure `lib/` modules. It should not add new business rules to legacy entry points unless required for compatibility.

## 2. Acquisition sources

### 2.1 Idealista

Default actor:

```text
igolaizola~idealista-scraper
```

The actor ID can be overridden with `TORIUM_IDEALISTA_ACTOR_ID`. The pipeline can also replay a known Idealista dataset or actor run with `TORIUM_IDEALISTA_DATASET_ID` and `TORIUM_IDEALISTA_RUN_ID`.

Supported TORIUM ordering:

- legacy: `lowestPriceM2`;
- neutral: `mostRecent`;
- villas: `mostRecent`.

### 2.2 Immobiliare.it

Structured actor:

```text
igolaizola~immobiliare-it-scraper
```

URL-driven fallback actor:

```text
shahidirfan~immobiliare-it-scraper
```

The selected adapter is controlled by `TORIUM_IMMOBILIARE_ACTOR`, with configurable actor IDs. The structured payload is the preferred contract because it exposes grouped location, topology, analytics, price and media fields.

### 2.3 Source policy

Both sources are useful, but their observations are not interchangeable:

- identity fields and URLs remain source-specific;
- asking prices are preserved per source;
- addresses can have different precision;
- surface semantics can differ;
- floor codes require normalization;
- photos and floor plans have different nesting and URL formats;
- a portal may hide or omit price;
- actors can change schema without notice.

The adapter layer exists to map these differences without deleting provenance.

## 3. Run configuration

The primary pipeline resolves runtime settings into an explicit configuration snapshot.

Core knobs:

| Variable/option | Meaning |
| --- | --- |
| `TORIUM_SEARCH_STRATEGY` | `legacy_low_price_m2`, `neutral_fractionability` or `villa_dynamic_market`. |
| `TORIUM_MASSIVE_SOURCES` | Comma-separated `idealista,immobiliare`; code default is currently `immobiliare`. |
| `TORIUM_CITY` | Default city label; defaults to Milano. |
| `TORIUM_MASSIVE_AREAS` | Requested area list when not supplied programmatically. |
| `TORIUM_MIN_SIZE` | Minimum source surface. |
| `TORIUM_MIN_ROOMS`, `TORIUM_MAX_ROOMS` | Immobiliare room bounds. |
| `TORIUM_IMMOBILIARE_REQUIRE_LIFT` | Optional lift filter. |
| `TORIUM_IMMOBILIARE_FURNISHED` | Optional furnished filter. |
| `TORIUM_IMMOBILIARE_EXCLUDE_AUCTIONS` | Exclude auctions. |
| `TORIUM_MASSIVE_INCLUDE_RENOVATION_VARIANT` | Enables the renovation query variant unless set to `false`. |
| `TORIUM_APIFY_MAX_WAIT_SECONDS` | Actor wait ceiling; default 1,800 seconds. |
| `TORIUM_APIFY_POLL_INTERVAL_SECONDS` | Actor polling interval; default 10 seconds. |
| `TORIUM_APIFY_DATASET_PAGE_SIZE` | Dataset pagination size; default 1,000. |
| `TORIUM_DRY_RUN` | Prints query payloads without requiring a real actor call. |

Frontend apartment profiles:

| Profile | Sources | Area | Limit |
| --- | --- | --- | --- |
| `scout` | Idealista | configured scout areas | request default 600 |
| `milano_broad` | Idealista | Milano | max 5,000 |
| `milano_multisource` | Idealista + Immobiliare | Milano | max 5,000 per source |

The frontend enables only `neutral_fractionability`. Legacy strategy remains a controlled CLI/replay comparison.

## 4. Source-neutral observation contract

`NormalizedListingV1` represents one observation from one source. It is not yet a stable canonical property.

Material groups:

- schema and adapter versions;
- source channel, listing ID, canonical URL and observation key;
- display title and source title;
- street, civic number, formatted address and coordinates;
- source macrozone/microzone and canonical Milan zone;
- asking-price status, amount, raw text and EUR/sqm;
- surface value and surface kind;
- rooms, bathrooms, floor, lift, condition and new-construction flag;
- images, floor plans and thumbnail;
- normalized features and risk flags;
- field provenance;
- quality status, blocking reasons and warnings;
- raw observation reference.

Identity priority:

```text
source + listing ID
  else source + canonical URL
  else deterministic stable-field fingerprint
```

Array indexes must never become source identity.

## 5. Normalization and area enforcement

Source adapters in `lib/source-normalizers.js` and `lib/normalized-listing-v1.js`:

- parse source-specific nested shapes;
- retain raw values where material;
- normalize numeric fields without treating missing values as zero;
- map floor codes to Italian display values;
- separate floor plans from ordinary images;
- select a display thumbnail while preserving the full media set;
- validate source URLs against allowlists;
- attach query provenance.

When an actor cannot guarantee its geographic filter, TORIUM performs a second area check using normalized and raw location text. Region filters for villas are also validated against source payload content.

## 6. Quality gates

### 6.1 Apartment gate

`data_quality_gate_v1` blocks misleading financial analysis when it sees:

- missing or non-positive price;
- missing or non-positive surface;
- surface above 1,500 sqm;
- more than 20 bathrooms;
- EUR/sqm below 500 or above 30,000;
- more than 15% inconsistency between explicit and derived EUR/sqm;
- impossible final-unit or new-unit counts.

Warnings include:

- surface above 600 sqm;
- bathroom count above 8;
- missing bathrooms;
- 5–15% EUR/sqm rounding mismatch;
- missing floor plan;
- missing address.

A valid listing receives:

```text
score = max(0, 100 - 40 * critical_flags - 5 * warnings)
```

Records that fail remain available for audit but must not distort ROI statistics or ranked investment results.

### 6.2 Villa gate

`villa_data_quality_gate_v1` uses villa-specific thresholds:

- surface above 5,000 sqm is critical;
- surface above 1,500 sqm is a warning;
- EUR/sqm outside 150–60,000 is critical;
- missing plan and address are warnings.

### 6.3 Reconciliation target

Every future durable run must satisfy:

```text
raw_received = normalized + normalization_blocked
normalized = sum(canonical memberships)
canonical = filtered_out + valuation_blocked + valued
published = valued + explicitly_published_unvalued
```

The current pipeline exposes stage counts but does not yet enforce atomic reconciliation as a publication blocker.

## 7. Pre-triage

Pre-triage removes structurally unsuitable records before expensive analysis.

Apartment signals include:

- auction;
- incompatible ownership/occupancy;
- unsupported typology;
- construction/new-build or already-renovated states when they conflict with the selected strategy;
- change-of-use requirements;
- missing essential numeric inputs;
- configurable minimum surface.

Change-of-use and in-construction assets are low-priority because feasibility and timing are difficult, not because they are universally impossible.

Villa pre-triage excludes:

- auctions;
- bare ownership, occupied or rented assets;
- commercial/industrial typologies;
- records without a recognisable villa/house/country-house typology;
- new construction in renovation intent.

## 8. Physical fractionability

### 8.1 Unit-mix planner

Current version:

```text
max_doors_residual_studio_v2
```

Inputs from `max-doors-20k.json`:

- minimum source surface: 90 sqm;
- saleable-area ratio: 92%;
- bilocale minimum: 40 saleable sqm;
- monolocale minimum: 28 saleable sqm;
- maximum residual studios: one;
- existing units: one.

Algorithm:

1. `saleable_area = gross_area * 0.92`.
2. If saleable area is below `40 + 28 = 68 sqm`, keep one existing unit and do not model fractioning.
3. Create the maximum number of 40 sqm bilocali that fit.
4. If the residual is at least 28 sqm, retain one residual monolocale.
5. Otherwise redistribute the residual over the bilocali.

This is geometric planning, not confirmation of doors, windows, wet columns, structural walls, condominium rules or municipal/cadastral legality.

### 8.2 Door Score

The physical engine considers:

- minimum surface;
- number of final units;
- new units created;
- bathrooms and one-bathroom risk on large surfaces;
- floor-plan availability;
- double entrance;
- double exposure;
- attic/mansarda risk.

Legacy economic additions include renovation state, already-renovated penalty, price bands, price reduction, balcony, cellar, terrace and furnished signals.

Neutral mode disables those economic signals and labels the output:

```text
physical_fractionability_only_v1
```

The result is clamped to 0–100.

## 9. Search strategies

| Strategy | Source ordering | Door Score | Tie-break |
| --- | --- | --- | --- |
| `legacy_low_price_m2` | Idealista `lowestPriceM2` | Physical + economic/spread signals | lower EUR/sqm |
| `neutral_fractionability` | Idealista `mostRecent` | Physical signals only | stable source order when scores tie |
| `villa_dynamic_market` | most recent | Villa opportunity score + benchmark gap | villa score |

Distinct search names append the strategy ID. Strategy and scoring mode are persisted in `triage_runs`.

## 10. Deduplication and source offers

### 10.1 Current behavior

Current deduplication creates a canonical source key and merges matched source observations for the run. It preserves source offers and generates price-comparison statistics.

### 10.2 Match levels

1. **Exact same-source:** source channel + source listing ID.
2. **High-confidence cross-source:** compatible street/civic or coordinates, floor, surface, rooms and typology, with price as supporting evidence.
3. **Uncertain:** retained separately for human calibration.

Known floor conflict is a hard blocker. Address + coordinates + surface alone are not enough because the same building can contain multiple similar units.

### 10.3 Price differences

For confirmed cross-portal matches:

- every source URL remains available;
- every source asking price remains available;
- absolute and percentage spread are calculated;
- highest asking price is the conservative underwriting input;
- lowest asking price is retained as a negotiation target;
- run summary exposes multi-source and price-mismatch counts.

A price mismatch is a commercial negotiation signal, never a reason to discard an observation.

### 10.4 Target identity

The target model introduces:

- stable `canonical_properties.id`;
- source-listing memberships;
- match method, evidence and confidence;
- temporal observations;
- immutable run-scoped property revisions.

Notes, renewals and valuations will reference stable property IDs rather than rank/listing index.

## 11. Deterministic Milano valuation

Current profile:

```text
milan_city_exit_v3_provisional_2026_07
```

Method:

```text
provisional_asking_price_by_idealista_macrozone
```

For each planned final unit:

```text
base EUR/sqm = zone asking benchmark * small-unit multiplier
low EUR/sqm  = base * 0.90
high EUR/sqm = base * 1.10
unit value   = unit saleable sqm * scenario EUR/sqm
```

Values are rounded to EUR 5,000. Current small-unit multipliers are:

- up to 39.9 sqm monolocale: 1.06;
- up to 45 sqm bilocale: 1.06;
- up to 55 sqm bilocale: 1.04;
- up to 70 sqm trilocale: 1.02;
- larger/unknown: 1.00.

The profile includes Milano macrozones and a citywide fallback. It stores source month, source link and market sentiment. Sentiment is descriptive and does not add forecast appreciation to the base case.

Valuation is not applicable if fewer than two final units or no new unit is created. In that case fractioning ROI is `null`, not an invented flip/renovation return.

## 12. Financial underwriting

Version:

```text
max_doors_unit_type_costs_v4_sales_cost_3pct
```

Current defaults:

- purchase-side costs: 12% of acquisition price;
- transformation: EUR 25,000 for each final monolocale/bilocale;
- transformation: EUR 30,000 for each final trilocale;
- sale intermediation: 3% of exit value;
- no contingency;
- no holding cost;
- no financing cost.

Formulas:

```text
purchase_costs       = purchase_price * 12%
transformation_cost  = sum(cost of every final unit by type)
project_cost         = purchase_price + purchase_costs + transformation_cost
selling_cost         = exit_value * 3%
total_cost           = project_cost + selling_cost
profit_or_loss       = exit_value - total_cost
ROI                  = profit_or_loss / total_cost
margin_on_sales      = profit_or_loss / exit_value
```

The 12% purchase-side assumption is an aggregate placeholder. It does not separately model registration/VAT treatment, notary, buyer agency fee, financing, due diligence, SPV costs or transaction-specific tax conditions.

## 13. Villa opportunity model

Geographies are versioned in `lib/villa-search-profiles.js`:

- Como;
- Toscana;
- Sardegna.

Each geography may contain multiple latitude/longitude/radius tiles. Candidate and comparable queries are independent. Per-tile quotas are derived from the per-source request limit.

Renovation score signals:

- explicit renovation need +26;
- 180–700 sqm scale +12;
- garden/land +12;
- panoramic/destination view +12;
- historic character +8;
- parking/garage +6;
- terrace +5;
- existing pool +4;
- three or more bathrooms +6;
- floor plan +5.

Tourism score gives greatest weight to garden/land, pool and destination view (+18 each), then hospitality use, terrace, parking, room count, historic character, bathrooms and floor plan.

Dynamic benchmark:

1. collect current asking-price comparables;
2. group by normalized local market bucket;
3. use local median when at least four observations exist;
4. otherwise use run-area median;
5. calculate asking-price discount/premium;
6. apply a bounded score adjustment between -12 and +18;
7. calculate indicative gross value as benchmark × surface, rounded to EUR 5,000.

Confidence is at most medium and the output explicitly states it is not an AVM or renovation exit valuation.

## 14. Optional AI enrichment

Older flows can ask GPT to produce:

- positive signals;
- red flags;
- missing information;
- human due-diligence questions;
- suggested final-unit plan;
- recommended action and confidence labels.

Deterministic fields remain authoritative for arithmetic. AI output must not overwrite source facts, invent missing numbers or silently change model assumptions. The target design stores model name, prompt version, input revision and generated output separately.

## 15. Virtual-renewal domain

The domain model is:

```text
source listing
   |
   +-- virtual renewal (style + version + publication state)
            |
            +-- ordered assets
                  original
                  renewal
                  floor plan
                  material/detail
```

`view_id` pairs original and generated images. `sort_order` controls the feed. The relationship is declarative; computer vision does not yet verify that two images share the same viewpoint.

## 16. Pipeline evolution targets

The next data architecture must add:

- source observation history rather than overwrite;
- price and media history;
- stable property identity;
- normalized location confidence;
- deterministic canonical-field provenance;
- revisioned scoring/valuation;
- atomic publication;
- data-quality and reconciliation blocking;
- actor schema-drift monitoring;
- labelled duplicate/non-duplicate examples;
- actual outcome feedback for fractionability, offer, construction and sale;
- backtesting by model and assumption version.

See [Multisource V2](TORIUM_MULTISOURCE_V2_IMPLEMENTATION.md) and [AVM target](TORIUM_VALUATION_STATE_AND_AVM_TARGET.md) for detailed acceptance gates.
