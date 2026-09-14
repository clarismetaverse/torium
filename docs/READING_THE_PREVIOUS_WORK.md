# How I read the work that was already here

**Written:** 2026-09-14, at the end of the branch `ranking-and-exit-benchmark`

An account of where I misread this codebase, for whoever wrote it. I spent
several days measuring things and announcing findings, and a fair number of
those findings were me catching up with decisions that had already been made on
purpose. It seems worth writing down which were which.

---

## Where I was simply wrong

**The neutral arm's ranking.** I found that `scoreValuedResult` returns the Door
Score verbatim for `neutral_fractionability`, and called it urgent — a ranking
that had been left unfinished. Then I read `UNBIASED_SEARCH_EXPERIMENT.md`,
which says, in as many words, that for that arm "exit value, spread, ROI,
confidence, and recommended action cannot reorder the shortlist". It is a
control. I had been about to edit the control arm of a live experiment and make
every prior run incomparable with every later one.

That changed what I built: a third strategy instead of a modification. The
document that stopped me is the same one I should have read before the
diagnosis, not after.

**The immobiliare area plumbing.** When I proposed partitioning the search by
area, I wrote as though the capability were missing. It was already there —
`buildImmobiliareStructuredPayload` had passed `area` since long before I
arrived, with a `broadMilan ? null : area` guard for the city-wide case
(`git show 8aab8c6^:pipelines/triage-multisource-massive.js`). The reason it does
nothing is that the actor accepts the parameter and ignores it, which is not
discoverable without probing the live actor. The plumbing was right; the far end
of the pipe is blocked.

**`requestedAreas: ['Milano']`.** I called this "a one-line defect". The
document describes the frontend run as a deliberately broad scout that has to
finish inside a 300-second function, and says outright that it "does not
restrict the source query to one neighborhood". It was a choice made under a
constraint. My change is only safe because the queries turn out to run in
parallel — which I checked afterwards, and which whoever wrote it may well have
weighed already and decided not to risk.

**The zone taxonomy.** I spent an afternoon adding forty-nine aliases to
`milan-area-taxonomy.js` feeling like I was filling in gaps. Later, deriving an
area list from Immobiliare's own data, I got 32 macrozones — and the taxonomy
has 32 canonical zones that match them almost one for one. It had already been
built from the portal's own vocabulary. I rediscovered the method from scratch
and presented it as a principle.

---

## Where the decision was good and had outlived its context

**The sixty-two constant Door Score points.** On the production run, three
components fire on 770 listings out of 770, and I said they describe the search
rather than the property. True *there*. But the engine serves more than one
profile, and in a run that is not pre-filtered to 120 sqm and above, surface and
unit count do vary. The components became constant because the production search
tightened around them. That is an interaction between two correct pieces, not a
blunder in either.

**Price in the identity matcher.** I showed it was load-bearing: two portals had
to agree on the asking price before TORIUM would accept they were describing the
same apartment, which discarded precisely the cross-portal spreads the product
exists to find. But the matcher's stated goal was to never merge two different
apartments, and for *that* goal price agreement is real evidence. The defect was
in the objective, not the execution. Someone chose caution when the data to
choose otherwise did not exist yet.

**The exit benchmark from published zone averages.** I called it wrong twice
over — mixing sizes and mixing conditions — and it is. It is also documented as
"versioned preliminary asking-price priors, not transaction evidence or a
professional appraisal", and unsupported microzones **fail closed** rather than
quietly inheriting a citywide guess. That is more careful than most placeholders
get. The limitation was the absence of data, and the honest labelling of a
placeholder is what let me find the problem quickly.

**The bathroom bonus.** It ranks backwards, and I have the numbers. But the
thought behind it is sound: plumbing stacks genuinely do decide whether a flat
can be split. It fails as a proxy, on data that did not exist when it was
written. The penalty for a large flat with one bathroom even points the right
way — for the wrong reason, which is why I removed it too.

---

## Where the work was ahead of me

**The alerts schema.** When I came to build web push, I found this already in
`20260911090000_investor_alerts.sql`:

> A second channel - web push once the PWA supports it - becomes another
> delivery row, not a second source of truth.

The tables were already shaped for a channel that did not exist. I added a
delivery ledger and a subscription table and they slotted in without touching
anything, because the separation between *deciding* to alert and *delivering* an
alert had already been drawn. That saved a migration and an argument.

**Idempotency in the database rather than the application.** Every ledger in
this codebase claims its row before doing the thing, and the unique constraint
is the lock. I copied that pattern for push without thinking about it, which is
the highest compliment a pattern gets.

**Condition as a query parameter.** I was pleased with myself for deciding that
a listing's condition should come from the filter that found it rather than from
parsing an agent's prose. `scrapers/idealista/client.js` had `condition:
['renew']` in it already.

**Failing closed.** `resolveMicrozoneProfile` throws rather than guessing. The
data-quality gate excludes rather than imputing. I did not have to argue myself
into any of this; it was the surrounding style, and the new code follows it
because following it was easier than not.

---

## What I do think was genuinely missing

Four things, and only one of them is a mistake.

**The pipeline never observed the market it sells into.** Across every stored
run: 1,265 listings of 130 sqm or more, three between 60 and 89. The exit price
had to be borrowed from a published average because nothing else existed. That
is a blind spot rather than an error — nobody wrote the wrong thing, the right
thing was simply never collected.

**Zone granularity inverts the size premium.** Measured across the 32 canonical
zones a small renovated unit looks *cheaper* per square metre than a large one;
measured by neighbourhood it is dearer. The sign flips. I do not think this was
knowable before somebody collected small-unit prices, and it invalidates
zone-level reasoning for this particular question.

**The Door Score ranked backwards.** -0.182 against modelled ROI. This one is a
real defect, and the reason it survived is that nothing ever checked a ranking
against an outcome. The engine had no tests at all, which is what let it drift.

**The search followed listing density.** Not wrong so much as never revisited
after the frontend scout profile was written for a different purpose.

---

## The short version

Most of what I "found" was either a good decision that had outlived the context
it was made in, or a proxy that failed on data nobody had at the time. The
codebase is opinionated in ways that turned out to be right — database-enforced
idempotency, failing closed, placeholders labelled as placeholders — and I
inherited those opinions without noticing I was doing it.

The genuine gap was that nothing measured whether any of it worked. There were
no tests on the scoring engine and no comparison of a ranking against a return.
That is the habit this branch tries to leave behind: every number in
`RANKING_AND_EXIT_BENCHMARK_HANDOFF.md` carries the run it came from and the
date it will go stale.

I also got several things wrong in this branch and found them by running rather
than by reading — the inert `area` parameter, a benchmark keyed in the wrong
portal's vocabulary, my own claim that the new Door Score had three values when
it has six. Which is the same lesson from the other side.
