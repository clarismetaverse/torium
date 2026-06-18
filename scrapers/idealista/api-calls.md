# Idealista API Calls

This document shows how to call the Idealista Apify actor from the TORIUM backend or from local scripts.

Actor:

```text
igolaizola/idealista-scraper
```

Base endpoint:

```text
https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items
```

The actor requires an Apify token passed as a query parameter:

```text
?token=$APIFY_TOKEN
```

Do not hardcode the token in code.

---

## Where to Put the API Key

Create a local `.env` file in the project root:

```bash
cp .env.example .env
```

Then add your real Apify token:

```env
APIFY_TOKEN=your_real_apify_token_here
```

Never commit `.env` to GitHub.

Only `.env.example` should be committed.

---

## 1. Residential Renovation Search

```bash
curl -X POST "https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "it",
    "operation": "sale",
    "propertyType": "homes",
    "location": "Milano",
    "condition": ["renew"],
    "sortBy": "lowestPriceM2",
    "maxItems": 50,
    "fetchDetails": false,
    "fetchStats": false
  }'
```

Use this to find renovation-heavy residential properties.

---

## 2. Ground-Floor Premises Search

```bash
curl -X POST "https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "it",
    "operation": "sale",
    "propertyType": "premises",
    "location": "Milano",
    "floor": ["groundFloor"],
    "sortBy": "highestPriceReduction",
    "maxItems": 50,
    "fetchDetails": false,
    "fetchStats": false
  }'
```

Use this to find commercial units with possible transformation potential.

---

## 3. Buildings Search

```bash
curl -X POST "https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "it",
    "operation": "sale",
    "propertyType": "buildings",
    "location": "Milano",
    "sortBy": "lowestPriceM2",
    "maxItems": 30,
    "fetchDetails": false,
    "fetchStats": false
  }'
```

Use this for whole-building opportunities.

---

## 4. Fetch Details for Selected Property

After a first broad run, select the most interesting `propertyCode` and run a detail fetch.

```bash
curl -X POST "https://api.apify.com/v2/acts/igolaizola~idealista-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "country": "it",
    "operation": "sale",
    "propertyType": "homes",
    "propertyCodes": ["INSERT_IDEALISTA_PROPERTY_CODE"],
    "fetchDetails": true,
    "fetchStats": true,
    "maxItems": 1
  }'
```

Use detail fetching only after pre-filtering because it is much slower.

---

## Recommended MVP Flow

```text
1. Run broad search with fetchDetails = false
2. Store raw items
3. Normalize each item into property_candidate
4. Apply first-pass TORIUM scoring
5. Select top candidates
6. Fetch details only for selected candidates
7. Send enriched property_candidate to RAG + LLM analysis
```
