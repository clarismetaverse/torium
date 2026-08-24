# TORIUM Villa Search and Dynamic Value V1

## Scope

Villa scouting is a separate use case from apartment fractioning. It has its
own frontend (`/villas`), API (`/api/run-villas`), investor profile, filters and
opportunity scoring. Fractioning unit economics and deterministic Milan exit
values are deliberately not reused.

Initial geography presets:

- `como`: Lake Como area, common 35 km radius for both sources.
- `toscana`: four overlapping geographic tiles, followed by a strict Tuscany
  region check on the returned source data.

The presets are data configuration. New geographies can be added without
changing the ranking implementation.

## Search intents

### `renovation`

Source filters:

- Idealista: `homes`, villa / detached / semi-detached / country house,
  `condition=[renew]`, free occupancy, minimum 140 sqm, most recent.
- Immobiliare.it: `propertyType=house`, `propertyCondition=toBeRenovated`,
  exclude auctions, minimum 140 sqm, most recent.

Ranking signals include renovation condition, useful project scale, garden or
land, destination view, historic character, parking, terrace, pool, bathrooms
and floor plan.

### `tourism`

Source filters use the same villa/house typologies and geography, with good or
renovatable condition and minimum 120 sqm. Post-source ranking prioritizes
garden, pool, panoramic/lake/sea view, terrace, parking, hospitality-use text,
rooms, bathrooms and floor plan.

## Dynamic value

Every run also collects a smaller control sample of villas in good/excellent
condition. Candidate asking price per sqm is compared with the median asking
price per sqm of those controls:

1. use the candidate's local area when at least four controls are available;
2. otherwise fall back to the whole run geography;
3. record benchmark, sample size, scope, confidence, percentage gap and a gross
   size-times-benchmark indication.

This is `dynamic_villa_asking_comparables_v1`. It is intentionally **not** a
transaction AVM, renovation exit value, rental forecast or ROI. Villas are
heterogeneous and land, views, access, conservation constraints and hospitality
licensing can dominate price. Future versions require geospatial comparables,
closed transactions, capex scopes, seasonality, ADR/occupancy and legal checks.
