# TORIUM — Architectural Decisions

**Last updated:** 2026-09-04

This log records durable product and technical decisions. Statuses are **Accepted**, **Superseded**, or **Proposed**.

## ADR-001 — Migrate the primary backend from Xano to Supabase

- **Status:** Accepted
- **Decision:** Supabase/PostgreSQL is the primary backend. Xano is no longer the target architecture.
- **Rationale:** SQL access, easier debugging, stronger AI and MCP integration, simpler data inspection, and a better long-term scalability path.
- **Consequences:** New persistence, schemas, and tooling target Supabase. Existing Xano-specific assumptions should not be extended.

## ADR-002 — Use Idealista as the primary listing source

- **Status:** Superseded by ADR-012 and ADR-013
- **Decision:** Idealista is the primary scouting source. Immobiliare.it remains secondary.
- **Rationale:** Idealista has shown stable scraping, better geographic consistency, lower duplication, and stronger candidate quality.
- **Consequences:** Primary runs and validation benchmarks should rely on Idealista unless explicitly testing another source.

## ADR-003 — Keep Immobiliare.it integrated but require rework

- **Status:** Superseded by ADR-012 and ADR-013
- **Decision:** Do not remove Immobiliare.it, but do not treat it as validated or primary.
- **Rationale:** The current actor returns cross-district duplicates, geographic mismatches, and too much renovated/showcase inventory.
- **Consequences:** Actor configuration, query generation, geographic filtering, and normalization require redesign and validation before promotion.

## ADR-004 — Separate physical, economic, and market scores

- **Status:** Accepted
- **Decision:** Maintain independent scores for Physical Fractionability, Economic Opportunity, and Sellability.
- **Rationale:** A cheap property is not necessarily physically divisible, and a high nominal ROI does not guarantee a liquid exit.
- **Consequences:** Price per square meter and ROI must not contaminate the physical score. Strategy profiles may combine transparent component scores but must preserve them.

## ADR-005 — Use hardcoded microzone knowledge in V1

- **Status:** Accepted
- **Decision:** Start with expert-authored `microzone_profiles` and `microzone_unit_profiles`, editable in the admin dashboard.
- **Rationale:** Handcrafted priors enable rapid experimentation before sufficient historical data exists.
- **Consequences:** Values must be labeled as priors, versioned, and auditable. They must not be presented as measured market facts.

## ADR-006 — Score the microzone/output-unit combination

- **Status:** Accepted
- **Decision:** Sellability is keyed by microzone, unit type, and surface band, with current and projected sellability shown separately.
- **Rationale:** Demand differs materially by unit size and type within the same neighborhood; TORIUM evaluates the units created by a fractioning plan.
- **Consequences:** A single neighborhood score is contextual information, not the final sellability score.

## ADR-007 — Introduce strategy profiles

- **Status:** Accepted
- **Decision:** Ranking weights and constraints belong to versioned strategy profiles.
- **Rationale:** Crowdfunding, flip, student housing, build-to-rent, luxury, and fast-exit investors optimize different outcomes.
- **Consequences:** TORIUM has no universal ranking. The same component scores can produce different rankings without changing the underlying algorithms.

## ADR-008 — Make the Admin Dashboard the control plane

- **Status:** Accepted
- **Decision:** Manage runs, priors, unit profiles, strategy profiles, scoring weights, and replay from the Admin Dashboard.
- **Rationale:** Operators need to change assumptions and recompute scores without re-running scraping.
- **Consequences:** Inputs and versions must be persisted alongside results to support deterministic replay.

## ADR-009 — Move from hardcoded V1 to dynamic V2 without changing the domain model

- **Status:** Accepted
- **Decision:** Preserve the profile interfaces while replacing or blending expert priors with observed market behavior.
- **Rationale:** A stable schema allows fast V1 delivery and gradual data-driven calibration.
- **Consequences:** V2 adds recurring snapshots, days on market, price-reduction histories, stock/turnover metrics, backtesting, and dynamic sellability.

## ADR-010 — Treat listing disappearance as a proxy, not a confirmed sale

- **Status:** Accepted
- **Decision:** Use listing entry, disappearance, and price-history signals as market-liquidity proxies.
- **Rationale:** A disappeared listing may be sold, withdrawn, or expired.
- **Consequences:** Dynamic scores must express uncertainty and be validated by backtesting; they must not claim confirmed transaction outcomes without transaction data.

## ADR-011 — Use a conservative residual-studio rule before microzone optimization

- **Status:** Accepted (provisional)
- **Decision:** Version `max_doors_residual_studio_v2` uses 40 saleable sqm as the minimum bilocale size and may preserve at most one residual monolocale when it reaches 28 saleable sqm. Smaller residuals are redistributed and never counted as an extra unit. The exceptional national 20 sqm case is excluded from automatic planning.
- **Rationale:** The previous equal-size division discarded potentially sellable residual configurations and could make the physical unit count diverge from valuation. A conservative residual rule is useful immediately while retaining an explicit feasibility gate.
- **Consequences:** Door Engine and deterministic valuation share the same planned unit mix. Every residual monolocale is labeled for technical due diligence. This rule maximizes plausible doors but does not yet optimize market demand.
- **Future:** Replace the fixed mix with a microzone-aware optimizer that evaluates alternative layouts and prefers the most sellable size/type combination for the area, including larger trilocali in prestigious or family-oriented microzones.

## ADR-012 — Use a source-neutral observation contract

- **Status:** Accepted
- **Decision:** Adapt Idealista and Immobiliare.it into a versioned `NormalizedListingV1` observation contract while preserving the original source payload and field provenance.
- **Rationale:** Portal schemas differ in identity, price states, geography, surface semantics, media and floor codes. Business rules cannot be reliable when they branch directly on raw formats.
- **Consequences:** Quality and eligibility run after normalization. Missing/hidden values remain null. Adapter coverage and schema drift become publication gates. Neither portal is a universal source of truth; source-specific observations remain auditable.

## ADR-013 — Prefer conservative deduplication and preserve all source offers

- **Status:** Accepted
- **Decision:** Optimize cross-source matching for precision. Keep uncertain pairs separate and retain every source URL, asking price, observation time and provenance for confirmed matches.
- **Rationale:** A false merge can combine two apartments in the same building and corrupt valuation. A confirmed cross-portal price difference is also a valuable negotiation signal.
- **Consequences:** Known floor conflict blocks merging. Stable canonical property identity is required. Underwriting may select a conservative price explicitly, but it may not overwrite the lower source offer.

## ADR-014 — Separate Supabase identity from TORIUM authorization

- **Status:** Accepted
- **Decision:** Supabase Auth proves identity; an active server-managed `torium_memberships` row grants product access and role.
- **Rationale:** An Auth account must not automatically gain application access, and authorization must not trust user-editable metadata.
- **Consequences:** TORIUM is invite-only. Roles are `admin` and `investor`. Missing/suspended membership fails closed. Expensive run and valuation operations require admin. Investor-owned preferences use user JWT plus RLS.

## ADR-015 — Keep browser sessions server-owned

- **Status:** Accepted
- **Decision:** Vercel exchanges credentials with Supabase Auth and stores access/refresh tokens in HttpOnly cookies; production cookies are Secure and use the `__Host-` prefix.
- **Rationale:** Browser JavaScript should not own persistent Auth tokens or service credentials.
- **Consequences:** APIs validate/refresh sessions and memberships. Mutations require same-origin requests. Password changes revoke sessions globally. The service-role key remains server-only.

## ADR-016 — Store listing media privately and on demand

- **Status:** Accepted
- **Decision:** Keep portal media links as provenance and fetch/cache bytes only after an authenticated user requests them. Store generated renewal media in a separate private bucket via signed direct uploads.
- **Rationale:** Bulk copying is expensive and unnecessary, while portal CDNs and Vercel request limits make direct browser-only or Function-proxied designs unreliable.
- **Consequences:** Listing asset tokens are HMAC scoped; hosts, redirects, MIME and size are validated. Storage URLs are short-lived. Retention cleanup and content-rights governance remain required.

## ADR-017 — Replace synchronous serverless runs with durable orchestration

- **Status:** Proposed
- **Decision:** The target run API returns `202` and a durable UUID; database-backed state, leases and idempotency coordinate work.
- **Rationale:** A module-global promise is not a distributed lock and a 300-second HTTP invocation cannot guarantee 4,000–5,000-observation execution.
- **Consequences:** At most two full runs are active, a third queues, source jobs are independently tracked, leases heartbeat/expire, and retries/cancellation are explicit. Vercel Workflow is preferred only after a compatibility and fault-injection spike.

## ADR-018 — Publish immutable result revisions atomically

- **Status:** Proposed
- **Decision:** Write a complete run/property revision to staging, validate reconciliation, then atomically move a published-revision pointer.
- **Rationale:** A partial write must never replace the last trusted result, and historical scoring/valuation must remain replayable.
- **Consequences:** Frontends read published revisions only. Results carry source, adapter, match, profile, scoring, valuation and model versions. Failed revisions remain auditable but invisible as current output.

## ADR-019 — Use an idempotent notification outbox

- **Status:** Proposed
- **Decision:** Investor matching writes a unique user/property/revision event to an outbox before any email or push delivery.
- **Rationale:** Listing ingestion and delivery retry at different rates. Direct sends can duplicate alerts or lose them during transient failure.
- **Consequences:** Matching, consent, delivery and engagement are auditable. Suspended users are excluded. OneSignal may provide product push, while Supabase Auth through custom SMTP owns password/invite email.
