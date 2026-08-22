# TORIUM Milan area taxonomy

## Decision

TORIUM uses one shared Milan area dimension for Idealista, Immobiliare.it, Supabase reporting, valuation grouping, and frontend filtering.

The canonical level follows the 32 zone groups used by Immobiliare.it because that portal exposes the richer neighborhood-oriented search structure. Source labels are never discarded.

```text
Idealista label ───────┐
                      ├─> TORIUM canonical zone ─> dashboard / analytics / AVM
Immobiliare.it label ─┘

Original source label ────────────────────────────> provenance / audit / microzone V2
```

Examples:

| Source label | TORIUM canonical zone |
| --- | --- |
| NoLo - Brianza - Pasteur | Pasteur - Rovereto |
| San Vittore - Washington | Solari - Washington |
| Portello - Tre Torri | Fiera - Sempione - CityLife - Portello |
| Corso San Gottardo | Navigli |
| Soderini | Napoli - Soderini |

## Data contract

- `area_label`: canonical TORIUM/Immobiliare-style zone used for grouping and filtering;
- `canonical_zone_id` and `canonical_zone_name`: normalized runtime metadata in new pipeline results;
- `neighborhood`: original portal neighborhood when supplied;
- `source_area_label`: most detailed source label available;
- `raw_listing`: untouched source payload for audit.

The existing Supabase schema already persists `area_label`, `neighborhood`, and `raw_listing`, so the common standard does not require an immediate migration. Dedicated canonical ID/version columns can be introduced when the geographic model becomes versioned.

## Search behavior

- Immobiliare.it can receive a canonical zone directly in a targeted query.
- Idealista continues to use an exact portal location ID where a reliable mapping exists.
- Where Idealista has no safe one-to-one equivalent, TORIUM performs the broader Milan query and classifies the returned listing after collection.

This avoids pretending that two portal boundaries are identical or forcing a lossy one-to-one location-ID mapping.

## Current limitations

- Alias matching is deterministic and conservative, but edge addresses near zone borders still require coordinates and official polygons.
- Historic runs are not rewritten automatically; they retain the labels available when collected.
- Canonical zones are suitable for cross-source coverage and preliminary valuation grouping, not cadastral or legal conclusions.
- The AVM target should version the taxonomy and resolve coordinates against polygons before applying microzone-level comparables.
