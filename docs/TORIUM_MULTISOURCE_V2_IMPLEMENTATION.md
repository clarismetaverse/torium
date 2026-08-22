# TORIUM Multisource V2 — implementation state and rollout plan

Status: **checkpoint 2 — adapters and offline matcher implemented; production unchanged**

This document is the execution log and decision record for adapting Idealista and
Immobiliare.it to a shared data model, resolving duplicates safely, and allowing
up to two durable runs in parallel.

## Safety rules

- Do not call Apify while adapter behaviour can be verified by replaying the
  source payloads already stored in Supabase.
- Do not deploy or mutate production before the replay and concurrency gates pass.
- Never convert missing, hidden, or on-request prices to zero.
- Never publish a partially written valuation revision.
- Never use a result rank or array index as the identity of a property.
- Preserve the original source observation and field provenance after merging.
- Prefer a missed duplicate to an incorrect merge of two distinct apartments.
- Never allow a public query parameter to bypass raw-listing redaction.

## Baseline evidence

Run inspected:
`1787384842398-milanoFractioningMultisource-neutral_fractionability`.

| Metric | Value |
| --- | ---: |
| Idealista source observations | 618 |
| Immobiliare.it source observations | 659 |
| Raw total | 1,277 |
| First pipeline dedupe | 1,267 |
| Source eligible | 999 |
| Pipeline eligible after dedupe | 995 |
| Valuation output | 996 |

Immobiliare.it evidence from the stored raw payloads:

- all 659 observations use the structured `analytics`, `geography`, `media`,
  `price`, and `topology` groups;
- 619 have a street value in the raw payload;
- 657 have raw images;
- 574 have raw floor plans;
- 40 have no numeric asking price or use an on-request/hidden state;
- 33 price-invalid observations reached valuation in the current run.

The differing 999/995/996 counts are treated as a blocking reconciliation error.

## Canonical contract: `NormalizedListingV1`

`NormalizedListingV1` is a source-neutral observation. It is not yet a canonical
property and it must not discard source-specific information.

### Envelope

| Field | Type | Rule |
| --- | --- | --- |
| `schema_version` | string | Always `normalized_listing_v1`. |
| `adapter_version` | string | Version of the source adapter. |
| `source_channel` | enum | `idealista` or `immobiliare`. |
| `source_listing_id` | string | Required when supplied by the source. |
| `source_observation_key` | string | Deterministic; never includes array index. |
| `canonical_url` | string/null | Validated against a source-specific host allowlist. |
| `observed_at` | ISO timestamp/null | Source timestamp when available; ingestion time otherwise. |
| `raw_reference` | object/null | Reference to stored raw observation, not a public payload. |

`source_observation_key` priority:

1. `source_channel + source_listing_id`;
2. `source_channel + canonical_url`;
3. deterministic fingerprint of stable source fields.

### Display identity

| Field | Type | Rule |
| --- | --- | --- |
| `source_title` | string/null | Original source title, even if generic. |
| `display_title` | string | Derived from canonical fields; never only `Appartamento`. |
| `property_type` | enum/null | Mapped source typology. |
| `property_subtype` | string/null | More specific source typology if present. |

### Location

| Field | Type | Rule |
| --- | --- | --- |
| `address.street` | string/null | Street without inventing a civic number. |
| `address.house_number` | string/null | Kept separate when available. |
| `address.formatted` | string/null | Most precise source display address. |
| `location.city` | string/null | Observed and inferred states distinguished. |
| `location.source_macrozone` | string/null | Original source value. |
| `location.source_microzone` | string/null | Original source value. |
| `location.canonical_zone_id` | string/null | Versioned TORIUM taxonomy ID. |
| `location.canonical_zone_name` | string/null | Display label for the taxonomy ID. |
| `location.zone_confidence` | number/null | `0..1`; city fallback cannot masquerade as an exact zone. |
| `location.latitude` | number/null | Decimal coordinate; do not round to an integer. |
| `location.longitude` | number/null | Decimal coordinate; do not round to an integer. |
| `location.precision` | enum | `exact`, `approximate`, `area`, `inferred`, or `unknown`. |

### Asking price

| Field | Type | Rule |
| --- | --- | --- |
| `asking_price.status` | enum | `known`, `on_request`, `hidden`, `missing`, `parse_error`. |
| `asking_price.amount_eur` | number/null | Positive only when status is `known`; otherwise `null`. |
| `asking_price.raw_text` | string/null | Source representation for audit. |
| `asking_price.price_per_sqm_eur` | number/null | Source value or derived only from valid amount and surface. |
| `asking_price.observed_at` | ISO timestamp/null | Supports future price history. |

### Physical attributes

| Field | Type | Rule |
| --- | --- | --- |
| `surface.value_sqm` | number/null | Positive finite value. |
| `surface.kind` | enum | `commercial`, `usable`, `cadastral`, `unspecified`. |
| `rooms` | number/null | Do not infer from the title when a structured value exists. |
| `bathrooms` | number/null | Preserve missingness. |
| `floor.normalized` | string/null | Italian display normalization. |
| `floor.raw` | string/null | Original source floor code. |
| `has_lift` | boolean/null | `null` is different from `false`. |
| `condition` | enum/null | Shared taxonomy with raw value retained in provenance. |
| `is_new_construction` | boolean/null | Low ranking priority, not silently removed. |

### Media

| Field | Type | Rule |
| --- | --- | --- |
| `media.images` | array | Validated image objects with source URL and label. |
| `media.floor_plans` | array | Separate from ordinary photos. |
| `media.thumbnail_url` | string/null | Selected from images; does not replace the image list. |
| `media.has_floor_plan` | boolean | Derived from normalized floor-plan collection. |

Each media object contains `url`, `label`, `source_channel`, and optional
resolution metadata. Immobiliare.it `hd` and `sd` paths are supported explicitly.

### Features, provenance, and quality

| Field | Type | Rule |
| --- | --- | --- |
| `features` | string[] | Normalized, deduplicated features. |
| `flags` | string[] | Auction, occupied, bare ownership, attic, basement, etc. |
| `field_provenance` | object | Source path and transformation for material fields. |
| `quality.status` | enum | `pass`, `review`, or `blocked`. |
| `quality.blocking_reasons` | string[] | Prevent valuation when non-empty. |
| `quality.warnings` | string[] | Missing but non-blocking information. |

## Quality gates

### Normalization gate

Blocks observations that cannot be assigned a stable source key or whose payload
does not match the declared adapter schema. Schema coverage is measured per run;
a material drop from the replay baseline stops publication as possible actor drift.

### Eligibility gate

Business filters operate once, after normalization and before identity resolution
selection. The same canonical candidate set is then consumed by valuation.

### Valuation gate

ROI is not calculated unless all required inputs are present and plausible:

- `asking_price.status = known` and `amount_eur > 0`;
- positive surface;
- supported property type;
- usable zone estimate with explicit confidence;
- no critical unit inconsistency.

Blocked observations remain visible as `not valued` with reasons. They do not enter
ROI ranking and are never represented as zero-cost acquisitions.

### Reconciliation invariants

For each source:

```text
raw_received = normalized + normalization_blocked
```

For each run:

```text
normalized observations = sum(canonical property memberships)
canonical properties = filtered_out + valuation_blocked + valued
published properties = valued + explicitly published_unvalued
```

Every count is stored by source and stage. A mismatch blocks publication.

## Identity resolution and deduplication

### Level 1 — exact source identity

Same `source_channel + source_listing_id` is the same source listing observation.
Repeated observations become history rather than duplicate properties.

### Level 2 — high-confidence cross-source match

Candidate generation uses normalized address/coordinates before similarity scoring.
Indicative signals, to be calibrated on a labelled sample:

- compatible street and civic number;
- small geographic distance;
- compatible floor;
- surface within a narrow tolerance;
- compatible rooms and property type;
- asking price within a tolerance, when known.

No single fuzzy field is sufficient. Apartments in the same building with similar
surface and price must remain distinct unless the evidence is strong.

### Level 3 — uncertain match

Uncertain pairs remain separate and are recorded for review. Auto-merge thresholds
are optimized for precision, not maximum duplicate removal.

### Canonical property fusion

- Keep all source IDs and URLs as memberships.
- Combine media without losing source provenance.
- Keep price observations separately; select a current asking price by an explicit
  rule rather than overwriting values.
- Prefer the most precise location but retain conflicting source values.
- Never collapse commercial and usable surfaces without a conversion rule.
- Generate a stable `property_id` UUID that survives ranking and revaluation.

## Durable execution and two-run concurrency

Two kinds of parallelism are required:

1. Idealista and Immobiliare.it source jobs run independently within a run.
2. At most two complete TORIUM runs may be active at the same time.

Target lifecycle:

```text
queued -> sourcing -> normalizing -> deduplicating -> valuating -> publishing
       -> completed | completed_with_warnings | failed | cancelled
```

The HTTP start endpoint returns `202` with a run UUID. Durable state is stored in
Supabase; module globals are not coordination locks.

Two database-backed lease slots control concurrency. A lease has an expiry and a
heartbeat so an interrupted worker cannot block capacity forever. A third run is
queued. Client idempotency prevents double-click duplication.

Initial capacity definition:

```text
target_total_per_run = 5,000
reserved_idealista = 2,500
reserved_immobiliare = 2,500
max_concurrent_runs = 2
```

A later fill phase may reassign unused source quota. `5,000 per source` is a
different, more expensive mode and must be requested explicitly.

Vercel Workflow is the preferred orchestration candidate, subject to a repository
compatibility spike. The fallback is asynchronous Apify execution plus Supabase
job state and a callback/worker. No production implementation choice is considered
complete until interruption, retry, and cancellation tests pass.

## Persistence target

Additive target entities:

- `triage_runs`: request, lifecycle, progress, configuration snapshot, published
  revision, workflow ID, errors, timestamps;
- `triage_run_sources`: one status and actor reference per run/source;
- `source_listing_observations`: globally unique source observations and raw data;
- `triage_run_source_memberships`: source observations participating in a run;
- `canonical_properties`: stable TORIUM property identity;
- `property_source_memberships`: source listings linked to a property with match
  method and confidence;
- `triage_property_revisions`: run-scoped underwriting and ranking revision;
- property notes referenced by stable `property_id`, not `listing_index`.

Publication writes a complete revision and then atomically changes the run's
published revision pointer. The frontend reads only published revisions.

All new public-schema tables require RLS. Raw observations, actor IDs, dataset IDs,
contacts, and errors remain service-role-only and are exposed through sanitized
server endpoints only when needed.

## Implementation checklist

### Step 1 — contract and replay harness

- [x] Audit the latest structured multisource run.
- [x] Define `NormalizedListingV1` and invariants.
- [x] Add sanitized structured fixtures for both sources.
- [x] Build a replay report using stored source observations without calling Apify.
- [ ] Execute the complete JS replay when the local Supabase environment contains
  non-empty read credentials; the current Vercel pull contains empty quoted values.

### Step 2 — source adapters

- [x] Separate Idealista and Immobiliare.it deterministic adapters.
- [x] Map structured Immobiliare.it URL, location, topology, analytics, and media.
- [x] Represent price status explicitly.
- [x] Add source-specific host allowlists.
- [x] Detect schema drift and adapter coverage regression.

### Step 3 — quality and valuation

- [x] Run the quality gate before prescore and valuation candidate selection.
- [x] Make invalid-price and invalid-surface cases ineligible for valuation.
- [ ] Require explicit zone confidence for ranked ROI.
- [ ] Reconcile counts from one canonical candidate set.

### Step 4 — stable identity and dedup

- [ ] Review and approve the real duplicate/non-duplicate calibration examples.
- [x] Implement exact same-source identity in the offline matcher.
- [x] Implement conservative cross-source candidate scoring and guarded auto-merge.
- [x] Classify uncertain matches separately in the offline matcher.
- [x] Fuse canonical fields while preserving every source offer and its provenance.
- [ ] Move property routes and notes to stable property IDs.

### Step 5 — persistence and publication

- [ ] Prepare additive Supabase migration and rollback.
- [ ] Add idempotent natural unique keys.
- [ ] Add revision staging and atomic publication.
- [ ] Add bounded retry for transient Supabase failures.
- [ ] Remove raw-payload duplication from valuation rows.

### Step 6 — durable parallel execution

- [ ] Complete Vercel Workflow compatibility spike.
- [ ] Implement database-backed lease slots and idempotent start requests.
- [ ] Run source jobs independently and track source state.
- [ ] Support retry, cancellation, stale lease recovery, and partial-source warning.
- [ ] Add progress endpoint and frontend polling.

### Step 7 — rollout gates

- [ ] Offline replay passes coverage and reconciliation assertions.
- [ ] Notes survive ranking and revaluation changes.
- [ ] Fault injection cannot expose a partial revision.
- [ ] Two simultaneous runs finish independently; a third queues predictably.
- [ ] Canary 100–200 passes.
- [ ] Canary 1,000 passes.
- [ ] User approval before production migration, deploy, or 4,000–5,000 run.

### Security finding discovered during replay preparation

The diagnostic source-listings endpoint previously accepted `internal=1` from an
unauthenticated request and returned unredacted rows. The bypass is removed in the
working branch. This fix is a production-release blocker because source raw data
may include agency contact information. The public endpoint must always apply the
same redaction regardless of `raw` or `internal` query parameters.

## Dedup calibration evidence from the stored run

The current exact-string key removed only 10 rows, but the cross-source candidate
audit found many high-confidence duplicate pairs with identical coordinates,
surface, price, and floor. They were missed because:

- Idealista embeds typology and zone in the address string while Immobiliare.it
  supplies the street separately;
- equivalent floors use different source codes (`bj`/`T`, `en`/`R`, `ss`/`S`);
- minor spelling, punctuation, and surface differences prevent exact equality.

Examples considered safe positive labels include records with the same street and
civic number, distance below a few metres, identical surface and price, and a
compatible normalized floor.

The audit also exposed the main false-positive pattern: one building may contain
multiple apartments with identical surface but different floors and prices. In Via
Emilio Cornalia 19, for example, the dataset contains a 120 sqm unit on floor 5 at
EUR 850,000 and another 120 sqm unit on floor 4 at EUR 795,000. A matcher based on
address, coordinates, and surface alone cross-pairs them incorrectly. The offline
matcher therefore treats a conflicting known floor as a hard blocker.

Missing addresses, ambiguous multi-floor values, and approximate coordinates stay
`uncertain_cross_source_match` and are not auto-merge eligible.

## Cross-portal price differences

A price mismatch is not discarded during deduplication. When strong physical
identity confirms that Idealista and Immobiliare describe the same unit, the
canonical property keeps a `source_offers` array with each portal's asking price,
price per sqm, observation time, and listing URL. `price_comparison` records the
absolute and percentage spread and exposes it as a negotiation signal.

For conservative screening, financial underwriting uses the highest known asking
price. The lowest known asking price is retained separately as the initial
negotiation target. The run summary reports how many canonical properties are
multi-source, how many are price-comparable, how many have different prices, the
share of mismatches, and median/maximum differences. Both portal prices and both
links remain visible on the property page.

## Acceptance targets for the stored Immobiliare.it replay

- 0 on-request/hidden/missing prices valued;
- canonical URL for every observation with a valid listing ID;
- normalized address coverage consistent with the 619 raw street values;
- image coverage consistent with the 657 raw image collections;
- floor-plan coverage consistent with the 574 raw floor-plan collections;
- no source-specific data exposed through an unsafe public URL;
- exact reconciliation of normalized, blocked, canonical, eligible, and valued
  counts;
- every published field traceable to its source path or a documented derivation.

## Decision checkpoints

1. **Canonical contract:** this document and adapter contract are reviewed before
   schema or production work.
2. **Dedup calibration:** ambiguous labelled pairs are reviewed before enabling
   automatic cross-source merges.
3. **Production gate:** migration, deployment, and real Apify runs require explicit
   approval after replay and concurrency evidence is available.
