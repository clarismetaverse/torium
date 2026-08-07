# TORIUM — Architectural Decisions

**Last updated:** 2026-08

This log records durable product and technical decisions. Statuses are **Accepted**, **Superseded**, or **Proposed**.

## ADR-001 — Migrate the primary backend from Xano to Supabase

- **Status:** Accepted
- **Decision:** Supabase/PostgreSQL is the primary backend. Xano is no longer the target architecture.
- **Rationale:** SQL access, easier debugging, stronger AI and MCP integration, simpler data inspection, and a better long-term scalability path.
- **Consequences:** New persistence, schemas, and tooling target Supabase. Existing Xano-specific assumptions should not be extended.

## ADR-002 — Use Idealista as the primary listing source

- **Status:** Accepted
- **Decision:** Idealista is the primary scouting source. Immobiliare.it remains secondary.
- **Rationale:** Idealista has shown stable scraping, better geographic consistency, lower duplication, and stronger candidate quality.
- **Consequences:** Primary runs and validation benchmarks should rely on Idealista unless explicitly testing another source.

## ADR-003 — Keep Immobiliare.it integrated but require rework

- **Status:** Accepted
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
