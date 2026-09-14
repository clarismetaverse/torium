# Handoff: ranking, exit benchmark, search partition

**Branch:** `ranking-and-exit-benchmark`, four commits on `eb19231`
**Written:** 2026-09-14
**Tests:** 394 passing · `vercel build --prod` clean · nothing deployed

This is written for whoever picks the work up next, human or agent. It says what
changed and where, how each claim was measured, what I am not sure about, and
what I would do next. Numbers carry their date and their source, because most of
them will go stale.

---

## 1. How the system fits together

A run has three stages, and they are more separable than they look.

**Search** — `pipelines/triage-multisource-massive.js`. Builds one query per
requested area per source, runs them in parallel through Apify, normalises the
results through `lib/source-normalizers.js`, deduplicates, and scores each
listing with `lib/door-engine.js`. Entry points: `api/run-triage.js` (the
frontend button, admin-gated) and `npm run triage:massive` (CLI, env-driven).

**Valuation** — `lib/valuation-runner.js`. Reads candidates back out of
`triage_source_listings`, projects a unit mix (`lib/unit-mix-planner.js`),
prices the exit (`lib/deterministic-valuation.js` against
`config/valuation-profiles/milan-microzones-v1.json`), and runs the money
(`lib/financial-underwriting.js`).

**Ranking** — also `lib/valuation-runner.js`: `sourceCandidateOrder` decides
which candidates are valued at all, `scoreValuedResult` decides the order they
are shown in. Both switch on the strategy.

### The strategies are an experiment, not a settings menu

`lib/search-strategies.js` holds four. Two of them are an experiment and its
control, described in `docs/UNBIASED_SEARCH_EXPERIMENT.md`:
`legacy_low_price_m2` ranks with price per square metre, `neutral_fractionability`
is deliberately blind to it. That document states plainly that for the neutral
arm "exit value, spread, ROI, confidence, and recommended action cannot reorder
the shortlist".

**Do not edit either of them.** Changing an arm mid-experiment makes every run
before the change incomparable with every run after it. `deal_quality` was added
as a third arm for exactly this reason, and `test/deal-ranking.test.js` asserts
the other two are untouched.

The live problem is not the design, it is that the control arm shipped:
`api/run-triage.js` allows only `neutral_fractionability` from the frontend, so
production ranks by a price-blind arm. `deal_quality` runs from the CLI only.
Whether the frontend should offer it is a product decision, not an engineering
one.

---

## 2. The four commits

### `a2a01c3` — Make the Door Score answer only the question it can

`lib/door-engine.js`, `test/door-engine.test.js`

The score correlated with modelled ROI at **-0.182** on the multisource run of
22 August 2026 (770 properties). It ranked backwards: 172 of the 201
best-scored properties lost money.

Two causes. Sixty-two of its hundred points came from three components that
fired on 770 of 770 — they describe the search filter, not the property. And the
bathroom bonus fired on 513 properties averaging -18.2 per cent ROI against -6.8
for the ones it skipped: it reads luxury where it means to read plumbing.

Now: a feasibility gate plus the evidence that varies (floor plan 40, second
entrance 40, double exposure 15, mansard -15, 10 for being divisible at all).
Correlation moves to **+0.050**, the best third from -20.8 to -10.4 per cent.
Six distinct values in practice, not a hundred.

`fractioningFeasible` is returned separately. Callers that filter should read
the boolean, never threshold the score.

To reproduce: recompute the engine over any stored run's `door_engine.basics`
and correlate against `roi_base_pct`.

### `c26e7ed` — Measure the market TORIUM sells into

`lib/exit-benchmark.js`, `scripts/collect-exit-market.js`,
`scripts/build-exit-benchmark.js`,
`config/valuation-profiles/milan-exit-benchmark-v1.json`,
`scrapers/idealista/client.js`, `test/exit-benchmark.test.js`

Across every triage run ever stored there were 1,265 listings of 130 sqm or
more, 1,076 between 90 and 129, and **three** between 60 and 89. The pipeline
had never observed the market it intends to sell into. The exit price came from
a published city-zone average mixing every size and every condition — both
errors pushing the same way, which is most of why the modelled ROI had a median
of -17.7 per cent.

Four segments now collect it. From 1,200 listings, on two draws an hour apart:

| | measured | moved between draws |
| --- | --- | --- |
| size premium, small over large, same neighbourhood | **x1.06** | 0.002 over 12 areas |
| renovation premium, small units | **x1.11** | 0.023 over 10 areas |

The model assumed 1.02–1.06 for size. It was roughly right; my expectation that
it understated the premium threefold was wrong.

**The methodological finding is the valuable part.** Measured across the 32
canonical zones the size premium comes out at 0.88–0.97 — the opposite sign —
because inside one coarse zone the large renovated flats sit on the better
streets. By neighbourhood, same listings, it is 1.06–1.09. A zone-level
benchmark is not imprecise for this question; it gives the wrong answer.

```bash
node scripts/collect-exit-market.js --dry-run
node scripts/collect-exit-market.js --max-items 300 --out data/exit-market.json
node scripts/build-exit-benchmark.js data/exit-market.json --out config/valuation-profiles/milan-exit-benchmark-v1.json
```

The committed benchmark is **generated data**, 220 KB from a collection of
13 September 2026. It prices 56 areas.

### `08498a7` — Rank on how good the deal is, in a third arm

`lib/deal-quality.js`, `lib/deal-ranking.js`, `lib/search-strategies.js`,
`lib/valuation-runner.js`, and their tests

Ranks on the discount to comparable stock in the property's own neighbourhood
against the measured exit price there. Break-even is computed per property,
because 25,000 EUR of works is 19 per cent of a 2,861 EUR/sqm purchase and 8 per
cent of a 6,800 one — a single threshold ranks cheap areas as easier when they
are harder.

Scores read as margin: **break-even sits at 50**. Unproven properties occupy a
band below it, ordered by their discount where that is known, at 25 where
nothing is known. Verdicts are three words, not a scale, because the precision
of a score would be borrowed from medians built on a handful of listings.

Measured on one live run, 397 valued properties, same day and same code:

| ordering | mean modelled ROI, top 20 |
| --- | --- |
| Door Score | **-9.2%** |
| deal margin | **+26.3%** |
| raw price per square metre | +43.4% |

Pool mean: -13.0 per cent. Restricted to the 218 the margin can assess, so the
comparison does not measure abstention: +26.3 against -8.2.

**The third row is not a defeat, and not a victory either** — see §3.

### `8aab8c6` — Search Milan by the piece, not all at once

`api/run-triage.js`, `lib/milan-idealista-locations.js`,
`lib/milan-immobiliare-areas.js`, `pipelines/triage-multisource-massive.js`,
`test/run-triage-api.test.js`

A serious run asked for `requestedAreas: ['Milano']`, which resolves to no
location id, so every query became the same city-wide sweep. Sorted by recency,
that follows listing density, which follows price: 33 slots to Città Studi at
-20.9 per cent, 15 to Moscova at -52.3, five to Cimiano — the one neighbourhood
whose measured spread cleared its own break-even.

Each portal is now asked in its own words. Idealista by location id.
**Immobiliare by coordinates**, because its `area` parameter is accepted and
inert: probed 14 September 2026, it logs `Using area name="Cimiano,
Crescenzago, Adriano"` and returns eight listings from seven macrozones. The
coordinate radius does work — probed at 2 km, everything came back inside it.

Result on a live run: 744 listings across **109 neighbourhoods**, median four
each against 33 in one before. One listing of 744 outside Milan.

Idealista returned 144 of 611 requested. Not an error: many neighbourhoods hold
almost no large unrenovated stock, which the city-wide sweep hid.

`TORIUM_RUN_DUMP_PATH` is here too — it writes a run's scored listings beside
its summary, which is how two rankings were compared on one pool without
persisting anything.

---

## 3. What I am not sure about

**The yardstick is the model's own ROI, and it is largely price per square
metre.** On the live run, `corr(price_by_area, roi) = -0.583`. So "raw
cheapest-first wins" mostly means cheapest-first optimises the measure directly.
The two orderings *select* very differently — cheapest-first took 20 of 20 under
2,500 EUR/sqm from eleven areas at the floor of the market, where the product
may be price-capped social housing and not freely resaleable; the margin spread
across price levels. **Settling which is better needs resale evidence the model
does not produce.** Treat this as open.

**The premiums are reproducible, not independent.** The two draws were an hour
apart with `mostRecent`, so they share most listings. They show the estimates
are stable, not that a second sample of the market would agree.

**Half the pool cannot be assessed.** 179 of 397 on the live run; 106 of those
were missing only the exit price and are now ordered by discount, the remaining
73 are not ordered at all. The benchmark prices 56 areas. This is the binding
constraint on everything in commit `08498a7`.

**Twenty-five cross-portal matches, zero with a price difference — twice.** Both
live runs. After removing price from the identity matcher I expected some
price-differing pairs to surface. Either cross-portal spread in Milan is rarer
than assumed, or the matcher still has a constraint I have not found. Unexplained.

**Deep discounts are unguarded on purpose.** I wanted a ceiling on discounts
beyond about 45 per cent, suspecting bare ownership and auctions. The live run
held **two** properties discounted more than 50 per cent. A rule built on n=2 is
a prejudice with a number attached, so there is none — the reasoning is in the
code where the evidence would land.

**The August run diagnoses, it does not predict.** Every search number in commit
`8aab8c6` describes behaviour that commit changed. Do not use them as a baseline
for the new configuration; run it and measure again.

**A 2 km radius crosses the municipal boundary.** One listing in 744 came from
Sesto San Giovanni. It resolves to no Milan zone, so it cannot corrupt a
benchmark, but it occupies budget.

**The Door Score correlation is +0.050.** Near zero is the honest ceiling: a
listing's text says little about return. The point of the change was to stop it
being *negative*, not to make it predictive.

---

## 4. What I would do next, in order

1. **Collect more exit market.** Same script, larger `--max-items`, repeated
   over time. It moves properties out of the unassessable band, which no formula
   change can do. Worth more than anything else on this list.
2. **Update the documents this branch made wrong.** `OPERATIONS_TESTING_AND_RUNBOOK.md`
   §6.1 still expects `physical_fractionability_only_v1`; the engine now reports
   `physical_feasibility_v2`. `UNBIASED_SEARCH_EXPERIMENT.md` describes two arms
   and there are three.
3. **Investigate the zero cross-portal spread.** Bounded: take the 25 matched
   pairs from a run and check by hand whether the prices really are identical.
4. **Decide whether the frontend gets the third arm.** Product call. Today it
   cannot be started except from the CLI.

Not on the list: more formula work on the ranking. It went from anticorrelated
with return to a rank correlation of 0.474 and the next gain is in data, not
arithmetic.

---

## 5. Traps

- `lib/milan-immobiliare-areas.js` looks like an area-name list and is not one:
  the names are labels for coordinate centres. Immobiliare's `area` parameter
  does nothing. There is a test that pins this.
- A radius query sets `source_area_enforced`. Without it the post-fetch text
  check demands the area's own name in the listing and discards everything a
  circle legitimately returns from the neighbouring zone.
- The exit benchmark is keyed by **neighbourhood name**, in Idealista's
  vocabulary. Immobiliare names fall back through the canonical zone. A price
  measured on one neighbourhood is never lent to another; only a zone median
  stands in.
- `door_score` no longer means what it meant before `a2a01c3`. No stored
  threshold depended on it — `investor_alert_preferences.min_door_score` was
  null for both existing profiles when this was checked — but any new consumer
  should read `fractioningFeasible`.
- `TORIUM_RUN_DUMP_PATH` writes tens of megabytes. Point it at a scratch
  directory.
