# TORIUM technical documentation

This folder is the technical source of truth for TORIUM. The documents distinguish three states:

- **Production:** deployed on Vercel or applied to the live Supabase project.
- **Working tree:** implemented and tested locally but not yet deployed.
- **Target:** approved direction that still requires implementation and validation.

## Start here

1. [Technical infrastructure overview](TECHNICAL_INFRASTRUCTURE_OVERVIEW.md) — system boundaries, components, environments and end-to-end flows.
2. [Technical state](TORIUM_TECHNICAL_STATE.md) — concise current-state snapshot and release delta.
3. [Data pipelines and domain model](DATA_PIPELINES_AND_DOMAIN_MODEL.md) — scraping, normalization, quality gates, deduplication, scoring, valuation, villas and renewals.
4. [Supabase data, security and storage](SUPABASE_DATA_SECURITY_AND_STORAGE.md) — live schema, RLS, Auth, Storage, migration state and known database debt.
5. [API, frontend and deployment](API_FRONTEND_AND_DEPLOYMENT.md) — routes, authorization, static views, Vercel topology, caching and release model.
6. [Operations, testing and runbook](OPERATIONS_TESTING_AND_RUNBOOK.md) — local setup, controlled runs, validation, incidents and recovery.
7. [Vision and roadmap](TORIUM_VISION_AND_ROADMAP.md) — product direction and sequenced milestones.
8. [Pre-next-phase handoff checklist](PRE_NEXT_PHASE_HANDOFF_CHECKLIST.md) — prioritized Claude-ready stabilization, release and verification plan.

## Specialist references

- [Architectural decisions](ARCHITECTURAL_DECISIONS.md)
- [Scoring engine](TORIUM_SCORING_ENGINE.md)
- [Valuation state and AVM target](TORIUM_VALUATION_STATE_AND_AVM_TARGET.md)
- [Multisource V2 implementation plan](TORIUM_MULTISOURCE_V2_IMPLEMENTATION.md)
- [Unbiased search experiment](UNBIASED_SEARCH_EXPERIMENT.md)
- [Villa search and dynamic value V1](VILLA_SEARCH_AND_DYNAMIC_VALUE_V1.md)
- [Virtual renewals](VIRTUAL_RENEWALS.md)
- [Listing asset cache](LISTING_ASSET_CACHE.md)
- [Authentication and authorization](TORIUM_AUTH.md)

## Documentation rules

- Record dates as absolute dates.
- Name every model, assumption, schema and API version explicitly.
- Do not describe a target design as deployed.
- Preserve raw-data provenance and list known approximations.
- Update the roadmap and technical state whenever a milestone changes state.
- When code and prose disagree, code plus live infrastructure inspection wins; fix the document in the same change.

Last verified against the repository, live Supabase project and Vercel project on **2026-09-04**.
