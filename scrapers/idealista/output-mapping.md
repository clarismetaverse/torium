# Idealista Output Mapping

This document defines how Idealista scraper results should be normalized into TORIUM's internal `property_candidate` object.

The exact output fields may vary depending on whether `fetchDetails` and `fetchStats` are enabled.

The purpose of this mapping is to keep TORIUM independent from the specific structure of the Apify actor response.

---

## Target Object

Each scraped listing should become a normalized object:

```json
{
  "source": "idealista",
  "source_property_id": null,
  "listing_url": null,
  "title": null,
  "description": null,
  "operation": "sale",
  "property_type": null,
  "price_eur": null,
  "surface_mq": null,
  "price_per_mq": null,
  "rooms": null,
  "bedrooms": null,
  "bathrooms": null,
  "floor": null,
  "address": null,
  "city": null,
  "neighborhood": null,
  "latitude": null,
  "longitude": null,
  "condition": null,
  "property_status": null,
  "has_floor_plan": null,
  "has_virtual_tour": null,
  "has_lift": null,
  "has_balcony": null,
  "has_terrace": null,
  "has_garage": null,
  "agency_name": null,
  "images": [],
  "raw": {}
}
```

---

## Mapping Principles

### 1. Preserve Raw Data

Always store the full original actor item inside:

```json
{
  "raw": {}
}
```

This prevents data loss when the actor output changes or when future logic needs fields not mapped in the first version.

### 2. Normalize Across Sources

Idealista and Immobiliare should eventually map into the same `property_candidate` shape.

The downstream RAG and LLM layers should not care whether a listing came from Idealista or Immobiliare.

### 3. Keep Source-Specific Fields Out of the Core Object

If a field is useful but specific to Idealista, keep it inside `raw` first.

Only promote it to the normalized object when it is useful across multiple sources.

---

## Priority Fields

The first version should focus on these fields:

| TORIUM field | Purpose |
|---|---|
| `source` | Identifies Idealista as the listing source |
| `source_property_id` | Used for deduplication and detail fetches |
| `listing_url` | Human review and source traceability |
| `title` | LLM context |
| `description` | Main semantic input for RAG and LLM analysis |
| `property_type` | Strategy classification |
| `price_eur` | Basic financial screening |
| `surface_mq` | Basic financial screening |
| `price_per_mq` | Opportunity filtering |
| `floor` | Key for ground-floor and conversion analysis |
| `condition` | Renovation signal |
| `address` | Location context |
| `city` | Geographic filtering |
| `neighborhood` | Micro-market context |
| `agency_name` | Source and broker traceability |
| `images` | Future visual analysis |

---

## TORIUM-Derived Fields

The scraper output should later be enriched with derived fields.

These are not scraped directly.

```json
{
  "torium_tags": [],
  "torium_strategy": null,
  "torium_initial_score": null,
  "torium_red_flags": [],
  "torium_missing_info": []
}
```

Examples of `torium_tags`:

- `renovation_needed`
- `ground_floor`
- `price_reduction`
- `low_price_per_mq`
- `commercial_conversion_candidate`
- `fractioning_candidate`
- `whole_building_candidate`

---

## Initial Strategy Classification

### Residential Renovation

Condition:

```text
propertyType = homes
condition contains renew
```

Possible tag:

```json
"renovation_needed"
```

### Ground-Floor Premises

Condition:

```text
propertyType = premises
floor contains groundFloor
```

Possible tags:

```json
[
  "ground_floor",
  "commercial_conversion_candidate"
]
```

### Buildings

Condition:

```text
propertyType = buildings
```

Possible tag:

```json
"whole_building_candidate"
```

---

## Detail Fetching Flow

Recommended flow:

```text
1. Run broad Idealista search with fetchDetails = false
2. Normalize basic items into property_candidate
3. Apply first-pass TORIUM scoring
4. Select top candidates
5. Re-run actor using propertyCodes
6. Enable fetchDetails = true and fetchStats = true only for selected items
7. Update property_candidate with richer data
```

This keeps cost and execution time under control.

---

## Downstream Usage

The normalized `property_candidate` object is the input for:

- expert corpus retrieval
- GPT analysis
- Gemini analysis
- Claude analysis
- final report synthesis

The LLM should receive both:

1. normalized structured fields
2. selected relevant raw fields

This avoids over-compressing the listing before reasoning.
