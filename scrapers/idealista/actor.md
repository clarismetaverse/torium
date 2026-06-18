# Idealista Scraper

Actor: `igolaizola/idealista-scraper`

OpenAPI schema:

```text
https://api.apify.com/v2/actors/igolaizola~idealista-scraper/builds/default/openapi.json
```

## Role in TORIUM

This actor is used to collect property listings from Idealista for the TORIUM MVP.

The goal is not to scrape everything.

The goal is to collect a small, high-signal batch of candidate properties that can be normalized and passed into the TORIUM intelligence pipeline.

```text
Idealista listing
↓
property_candidate object
↓
WhatsApp expert RAG
↓
GPT / Gemini / Claude analysis
↓
Deal brief
```

---

## Supported Countries

The actor supports:

- Spain: `es`
- Portugal: `pt`
- Italy: `it`

For TORIUM, use:

```json
{
  "country": "it"
}
```

---

## Required Inputs

The OpenAPI schema requires:

- `operation`
- `propertyType`
- `country`

Recommended default for TORIUM:

```json
{
  "operation": "sale",
  "country": "it"
}
```

---

## Relevant Property Types

The actor supports several property types.

The most relevant for TORIUM are:

- `homes`
- `premises`
- `offices`
- `buildings`

### `homes`

Useful for residential value-add, renovation-heavy apartments, and possible fractioning opportunities.

### `premises`

Useful for ground-floor commercial units, potential change-of-use analysis, and distressed commercial spaces.

### `offices`

Useful for conversion potential and professional-use assets.

### `buildings`

Useful for whole-building opportunities, small cielo-terra assets, and larger restructuring cases.

---

## Recommended Sorting

Useful `sortBy` values for TORIUM:

- `mostRecent`
- `lowestPriceM2`
- `highestPriceReduction`
- `lowestPrice`
- `biggest`

Initial recommendation:

```json
{
  "sortBy": "lowestPriceM2"
}
```

For distressed or motivated-seller signals:

```json
{
  "sortBy": "highestPriceReduction"
}
```

---

## Useful Filters

### Condition

The most important value is:

```json
{
  "condition": ["renew"]
}
```

This targets properties that need renovation.

### Floor

For commercial-to-residential or ground-floor analysis:

```json
{
  "floor": ["groundFloor"]
}
```

### Property Status

Potentially relevant values:

```json
{
  "propertyStatus": ["free"]
}
```

Other values such as `tenanted`, `bareOwnership`, and `illegallyOccupied` may be useful for special strategies but should be handled carefully.

### Publication Date

The schema supports:

- `Y`
- `T`
- `W`
- `M`

Use this only if the MVP needs recent listings.

---

## Details and Stats

The actor supports:

```json
{
  "fetchDetails": true,
  "fetchStats": true
}
```

However, both options require one extra request per property and are described as much slower.

MVP recommendation:

1. Run broad searches with `fetchDetails: false`.
2. Select the top candidates.
3. Re-run only selected property codes with `fetchDetails: true`.

---

## Recommended TORIUM Strategy

Start with small runs:

- 30–50 items per search
- Milan only
- One property type at a time
- Details disabled at first

Then build a scoring layer that selects the most interesting candidates for deeper analysis.

---

## First Search Families

### Residential Renovation

Target renovation-heavy residential properties.

```json
{
  "country": "it",
  "operation": "sale",
  "propertyType": "homes",
  "location": "Milano",
  "condition": ["renew"],
  "sortBy": "lowestPriceM2",
  "maxItems": 50
}
```

### Ground-Floor Premises

Target commercial units with possible transformation potential.

```json
{
  "country": "it",
  "operation": "sale",
  "propertyType": "premises",
  "location": "Milano",
  "floor": ["groundFloor"],
  "sortBy": "highestPriceReduction",
  "maxItems": 50
}
```

### Buildings

Target small whole-building opportunities.

```json
{
  "country": "it",
  "operation": "sale",
  "propertyType": "buildings",
  "location": "Milano",
  "sortBy": "lowestPriceM2",
  "maxItems": 30
}
```

---

## Notes

The Idealista scraper is useful because it already exposes filters that match TORIUM's early strategy:

- renovation condition
- ground-floor filtering
- property type separation
- price and size ranges
- sorting by price per square meter and price reduction

This makes it a good first data source for a simple, vertical MVP.
