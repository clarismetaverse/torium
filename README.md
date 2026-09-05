# TORIUM

TORIUM is a real-estate intelligence system for sourcing, screening, valuing and operating residential value-add opportunities.

Current product domains:

- Milano apartment fractioning;
- multisource Idealista/Immobiliare discovery and price comparison;
- villa renovation and tourism opportunity search;
- deterministic unit economics and ROI scenarios;
- private listing media cache;
- virtual before/after renewal feeds;
- invite-only investor access and alert preferences.

## Architecture

```text
Apify listing sources
  -> source adapters and normalized observations
  -> quality, pre-triage and conservative deduplication
  -> physical/villa scoring
  -> deterministic valuation and underwriting
  -> Supabase Postgres/Auth/Storage
  -> Vercel Functions
  -> static authenticated web application
```

TORIUM is decision support. Its current market values are provisional asking-price benchmarks, and its physical, legal, tax and financial outputs require professional validation before investment.

## Documentation

Start with [the technical documentation index](docs/README.md).

Core references:

- [Infrastructure overview](docs/TECHNICAL_INFRASTRUCTURE_OVERVIEW.md)
- [Current technical state](docs/TORIUM_TECHNICAL_STATE.md)
- [Data pipelines and domain model](docs/DATA_PIPELINES_AND_DOMAIN_MODEL.md)
- [Supabase data, security and storage](docs/SUPABASE_DATA_SECURITY_AND_STORAGE.md)
- [API, frontend and deployment](docs/API_FRONTEND_AND_DEPLOYMENT.md)
- [Operations and runbook](docs/OPERATIONS_TESTING_AND_RUNBOOK.md)
- [Vision and roadmap](docs/TORIUM_VISION_AND_ROADMAP.md)
- [Architectural decisions](docs/ARCHITECTURAL_DECISIONS.md)

## Local validation

```powershell
npm install
npm test
vercel build --prod
```

In Node.js environments where default test isolation is process-spawn based, prefer the repository default script:

```powershell
npm test   # executes `node --test --test-isolation=none`
```

Use dry-run mode to inspect final source payloads before a paid actor call:

```powershell
$env:TORIUM_DRY_RUN='true'
$env:TORIUM_SEARCH_STRATEGY='neutral_fractionability'
$env:TORIUM_MASSIVE_SOURCES='idealista,immobiliare'
npm run triage:massive
```

Never commit service credentials or expose the Supabase service-role, Apify or renewal-agent keys to browser code.

Last documentation verification: **2026-09-04**.
