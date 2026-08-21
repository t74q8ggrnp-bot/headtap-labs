# Pro X — architecture and scope (Phase 1 foundation)

> **Governing doctrine:** Read `docs/PROX_GUIDE.md` before changing this
> subsystem. This file preserves the implementation history and phased
> architecture. If the two documents conflict, `docs/PROX_GUIDE.md` governs.

## What Pro X is

Pro X discovers and investigates. It observes external events (SEC filings
first, more sources later) and market activity, verifies evidence, and hands
evidence to the canonical HT Labs engine. Public eligibility, scoring, and
tier authority currently stay with `app/api/opportunities/route.ts` and the
rest of the canonical pipeline. ProX may maintain a separately versioned,
independent **shadow-only** decision board under `docs/PROX_GUIDE.md`, but that
board has no public or execution authority unless a later measured promotion
is explicitly approved.

## What's built in this pass, and what isn't

This is Phase 1 (foundation) plus the first half of Phase 2 (one real
connector) from the full roadmap. Deliberately excluded from this pass:

- **No always-on worker.** The full Pro X vision (see below) calls for a
  persistent process on Railway/Render/Fly.io, mainly to hold a live Polygon
  WebSocket connection open. That's real, recurring infrastructure cost and
  a second deployable to operate — a decision for a dedicated session, not
  bundled into this one. Everything built here runs as a Vercel cron route,
  the same pattern already used by `signal-writer`, `shadow-retrieval`, and
  `catalyst-discovery`.
- **No decision bridge.** Pro X events are stored for later use. Nothing here
  reads from or writes to `ht_signal_run_rows`, `ht_signals`, or any other
  canonical table. The existing engine cannot be destabilized by this pass
  because it cannot see this pass.
- **No AI entity resolution yet.** Ticker matching is 100% deterministic —
  SEC's own CIK-to-ticker mapping (`company_tickers.json`), no inference.
  Ambiguous matches are simply left unresolved rather than guessed.
- **No UI.** Nothing in `app/page.tsx` reads from any `prox_*` table yet.

## What's real in this pass

- **Database foundation**: `prox_sources`, `prox_entities`, `prox_events`,
  `prox_evidence`, `prox_event_tickers` — see
  `supabase/migrations/0001_prox_foundation.sql`. Excludes
  `prox_market_features`, `prox_decisions`, `prox_decision_versions`,
  `prox_worker_heartbeats`, `prox_dead_letters`, which belong to the
  market-sensor, decision-bridge, and always-on-worker phases.
- **The universal event contract** (`lib/prox/types.ts`) — the normalized
  shape every future connector (FDA, IR feeds, halts, licensed news) will
  produce, so adding a second source is repeatable connector work, not a
  redesign.
- **One real connector**: `app/api/prox-sec-connector/route.ts`. Polls SEC
  EDGAR's public "latest filings" feed for Form 8-K and 6-K, deduplicates by
  accession number, resolves company → ticker via SEC's own CIK mapping, and
  classifies 8-K catalysts deterministically from the Item numbers SEC
  itself publishes (Item 2.01 = acquisition completed, Item 3.02 =
  unregistered equity sale/dilution, Item 3.01 = delisting notice — no AI,
  no guessing). Every event stores a direct link to the primary filing as
  evidence.

## Setup required (one-time, manual)

Claude does not have direct database DDL access (no service-role key value,
no Postgres connection string) — schema changes have to be applied by
whoever holds the Supabase project. Run
`supabase/migrations/0001_prox_foundation.sql` once, in the Supabase SQL
editor, before the connector will do anything useful (it fails closed with a
clear error if the tables/seed rows aren't there yet).

## Update — Phase 3 and Phase 4, partial

Verified live against the current Polygon plan before building anything:
minute and second aggregate bars return 200, but last-trade and last-quote
return 403 ("not entitled, upgrade required"). That means true tick-by-tick
WebSocket streaming still needs the plan upgrade plus an always-on worker —
neither exists yet — but REST-polled minute bars are usable right now, at
no extra cost.

- **`app/api/prox-market-sensor/route.ts`** (Phase 3, partial): for tickers
  with a Pro X event, a direct-market research anomaly, or current canonical
  relevance, pulls the last 30 one-minute
  bars from Polygon and computes real features — 1-min velocity, 5-min
  acceleration, volume acceleration, VWAP relationship, dollar volume —
  into `prox_market_features` (one upserted row per ticker, latest
  snapshot only, not a full history yet). Runs every 2 minutes, tighter
  than the 5-minute canonical cron, per the acceptance criteria. It does not
  make a canonical decision — it only computes and stores features. Broad
  price-first discovery is supplied by the independent route documented
  below. Turning a feature into a published decision remains the canonical
  engine's boundary.
- **Former-name resolution** (Phase 4, partial), added to
  `prox-sec-connector`: SEC's own submissions API
  (`data.sec.gov/submissions/CIK....json`) publishes each company's
  former names with date ranges. Free, deterministic, fetched once per
  entity (new entity, or one whose `former_names` is still empty — former
  names don't change, no reason to refetch). Makes "corporate name changes
  don't break event history" real instead of a schema placeholder.

## Update — bounded public market authority

Pro X now produces `prox-intelligence-v5-session-recovery-contract` packets that combine the
latest verified event, source credibility, deterministic ticker match,
evidence depth, freshness, contradictions, and the live market pulse. Each
packet includes a factor trace and an explicit, versioned authority contract.

The live minute-bar market pulse has bounded public authority: it may adjust
the one canonical HT score from -12 to +12, and confirmed multi-factor
post-peak deterioration blocks canonical eligibility. Event intelligence and
historical transition evidence remain explanation/research-only and cannot
change the public score. Pro X has no order, sizing, exit, or live-trading
authority. The paper bot can record the separate hypothetical execution
opinion with `executed_influence = false`, but cannot act on it.

A short-window rebound cannot erase severe full-session damage. When a ticker
is both deeply below its session high and at least 5% below the current-day
open, Pro X withholds canonical entry qualification until a real session
reclaim. The ticker may remain visible on the explicitly no-entry Momentum
Radar. Ordinary pullbacks and runners only slightly below the open are not
classified as burnt out by this rule.

Migration `0005_prox_intelligence_bridge.sql` adds append-only market-feature
history, immutable versioned intelligence packets, and paper-bot shadow
observations for later outcome calibration. The public single-ticker
inspection route is `/api/prox-intelligence?ticker=`.

Cron materialization and the existing Pro X collectors accept only Vercel's
real `CRON_SECRET` authorization; the former hardcoded query fallback was
removed.

## Update — independent direct-market discovery

Migration `0013_prox_direct_market_discovery.sql` and
`app/api/prox-market-discovery/route.ts` add the reverse discovery direction
without weakening the canonical boundary:

- Pro X polls Polygon's full U.S. stock snapshot directly on its own schedule;
  it does not receive a preselected ticker list from Spot Momentum.
- Raw full-day, active-session, cumulative-volume, liquidity, session-high,
  and corporate-action context is stored in append-only observations. Raw and
  normalized movement are kept separately so split artifacts cannot become
  learned momentum.
- A versioned, internal research-priority queue tells the existing minute-bar
  sensor which independently discovered tickers need deeper observation. That
  priority is scheduling metadata, **not a second HT score**, and is never
  rendered to users.
- Directly discovered tickers can materialize a `market_only` Pro X packet in
  shadow mode. They receive no canonical eligibility, score, tier, UI rank,
  sizing, execution, or order authority.
- `/api/system-health` validates a fresh direct-discovery run and exact
  observation coverage during the active stock-data session.

The first research patterns include quiet cumulative participation (the
MSGY-style signal that short-window acceleration alone misses), session
reclaims, live liquidity surges, price/volume expansion, corporate-action
dislocations, and post-peak deterioration. These observations create honest
memory for later outcome calibration; they do not self-promote into the
product.

## Update — Outcome Memory and measured pattern calibration

Migration `0014_prox_outcome_memory.sql` and
`app/api/prox-outcome-memory/route.ts` turn direct observations into permanent
research episodes:

- The first Pro X discovery price and evidence are immutable for each
  ticker/session date. Later cycles update the episode; they never replace the
  original entry with a more convenient price.
- Polygon's full snapshot measures 5m, 15m, 30m, 1h, 4h, session-close,
  next-session, and 24h outcomes. The episode also stores sampled MFE, MAE,
  time-to-peak, and measurement quality.
- A split after discovery quarantines the episode instead of allowing an
  unadjusted price discontinuity to become fake learned performance.
- Deterministic labels distinguish early continuation, quiet-participation
  breakouts, reclaim continuation, late chases, post-peak failures, heavy
  downside participation, corporate-action distortion, and inconclusive
  paths.
- Only completed, calibratable episodes enter versioned pattern aggregates.
  Fewer than 30 samples is explicitly `insufficient`; 30–99 is `emerging`;
  100+ is `calibrated`.

This remains internal evidence. There is still one public HT score, and no
calibration row can alter canonical ranking or any order without a future,
explicitly tested promotion phase.

## Update — canonical strategy-transition memory

Migration `0015_prox_canonical_transition_memory.sql`,
`lib/prox/transition-memory.ts`, and the existing Outcome Memory schedule add
an explicitly separate case library for tickers that move from Before The
Crowd into Spot Momentum:

- The earliest canonical observation, price, role, rank, score, source run,
  engine version, and decision snapshot are preserved for both strategies.
- Transition time and return are calculated from those immutable observations.
  Outcome MFE, MAE, and time-to-peak stay anchored to the earlier Before The
  Crowd discovery, while the same high is also measured from the later Spot
  Momentum confirmation price.
- Existing observation history is backfilled automatically. Later Outcome
  Memory cycles materialize new transitions and refresh their outcome path.
- Every cycle writes a coverage receipt so silently dropped transition cases
  fail system health instead of disappearing from the research record.
- These rows are identified as `canonical_transition_case`. They are never
  rewritten as direct Pro X discoveries, never publish another score, and
  never carry execution authority. Calibration remains disabled until a later
  sample-size and promotion policy is explicitly approved.

The audited PLAG path is the reference case: Before The Crowd at $0.60,
Spot Momentum at $0.97 exactly 65 minutes later, and a $6.35 observed session
high. Deterministic tests preserve the corresponding +61.667% transition,
+958.333% early-entry MFE, and +554.639% post-confirmation MFE.

## Update — transition-pattern comparison brain

Migration `0016_prox_transition_pattern_calibration.sql`,
`app/api/prox-transition-calibration/route.ts`, and
`lib/prox/transition-calibration.ts` turn canonical memory into honest
historical comparison evidence:

- The learning denominator is every finalized Before The Crowd case, including
  candidates that never graduated. Pro X cannot inflate its success rate by
  studying winners alone.
- Each case preserves its early market session, price, relative-volume,
  momentum, crowd, trap, and opportunity-score buckets alongside graduation,
  MFE, MAE, time-to-peak, and whether HT missed a later 100% explosion.
- Versioned cohorts are computed at four specificity levels. Comparison backs
  off from an exact profile to broader session/behavior cohorts when the exact
  sample is too small; it never invents an exact-confidence percentage.
- Evidence remains `insufficient` below 30 finalized cases, `emerging` from
  30–99, and `calibrated` at 100+. Graduation, explosion, continuation,
  failure, and missed-explosion rates are all derived from the same complete
  denominator.
- Pro X intelligence packets now carry the best available transition evidence
  and a factor-trace explanation. The public single-ticker inspection route is
  `/api/prox-transition-calibration?ticker=PLAG`.
- The packet's existing scores and shadow bot policy do not use these rates.
  There is still one canonical HT score and no Pro X execution authority.
- `/api/system-health` independently verifies source-case coverage, cohort
  persistence, sample thresholds, and every stored count/rate calculation.

The calibration route runs after canonical observation and transition-memory
cycles, precomputing compact cohorts so live Pro X packet reads remain fast.

## The remaining roadmap

The rest of Phase 3 (true WebSocket streaming, halt status, float turnover)
and all of Phases 4's remaining
scope (subsidiaries, executives, drug names, AI-assisted disambiguation for
ambiguous cases), 5 (richer contradiction/rumor/recycled-news scoring), 6
(measured promotion beyond the current shadow-only bridge), 7 (Supabase
Realtime beyond the current opportunity-card pulse), 8 (outcome
calibration), and 9 (heartbeats, dead-letter queues, kill switch, cost
limits) remain deliberate future phases. No Pro X execution authority exists.

## Update — security-type research lanes

Migration `0017_prox_security_type_routing.sql`,
`lib/prox/security-routing.ts`, and direct-market discovery v2 replace ProX's
implicit all-instrument research pool with explicit lanes. Verified common
shares and ADR common shares are the only opportunity-learning instruments;
funds and indexes remain market context; warrants, rights, and units remain
linked-instrument context; incompatible structures are excluded; and missing
or new provider codes remain pending verification. Auxiliary lanes have hard
capacity limits so they cannot crowd common equities out of the direct-research
receipt. Outcome Memory v2 starts a clean equity-only learning cohort rather
than allowing v1's mixed instrument history to influence later calibration.

This changes neither canonical HT security eligibility nor public ranking.
Security type routes evidence and contributes zero points to ProX Edge Score.

## Update — independent Market Structure Brain and shadow board

Migration `0018_prox_market_structure_shadow_board.sql`,
`lib/prox/market-structure.ts`, `lib/prox/edge-score.ts`,
`lib/prox/shadow-board.ts`, and `app/api/prox-shadow-board/route.ts` implement
the first independent ProX decision frame described by the governing guide:

- The source universe is the independently created, security-routed ProX
  discovery run. It is not the canonical hero, contender list, or eligibility
  set.
- Adjusted daily Polygon bars and current-session minute bars produce ProX's
  own ATR, support, swing, VWAP, invalidation, resistance, Price Discovery,
  continuation-capacity, R/R, extension, and post-peak-failure assessment.
- The Edge Score uses the frozen 60% continuation, 30% asymmetry, 10% evidence
  contract with explicit risk penalties. Its continuation evidence includes
  a bounded two-clock view of prior-close movement and current-session
  participation.
- Runtime guards reject canonical scores, ranks, roles, eligibility,
  frameworks, targets, and R/R fields before scoring. The run receipt also
  records an empty canonical-input list, and system health verifies it.
- Each deeply evaluated candidate receives exactly one selected, blocked, or
  rejected disposition. A frame may have one hero and up to five contenders;
  it is valid to have no hero when no entry qualifies.
- Score, price, rank, disposition, evidence, and reasons share one atomic
  decision timestamp. A run is not healthy until persisted member coverage is
  complete and its formula and ranks recompute correctly.

This board is append-only shadow research. It is not read by the public UI or
canonical ranking and has no trading authority. The former canonical-inline
challenger is disabled; `prox-post-decision-comparison-v2` can compare two
already completed independent answers but cannot manufacture a ProX answer.

## Update — independent news-attention evidence

`prox-edge-score-v2` (`lib/prox/edge-score.ts`) adds a second, explicitly
lower-rigor evidence class to continuation probability: independently
observed news-attention velocity, sourced from ProX's own Finnhub/NewsAPI
lookup (`lib/news-intel.ts`, extracted from the pre-existing but previously
scoring-orphaned `/api/news-intel` UI route) and fetched per ticker in
`app/api/prox-shadow-board/route.ts` via `unstable_cache` (15-minute
revalidate — this route is `force-dynamic`, which forces plain `fetch()`
calls to `no-store` regardless of any `next.revalidate` option passed to
them; `unstable_cache` is the mechanism that actually honors a revalidate
window here).

This is deliberately not folded into or disguised as the verified `event`
channel: it carries no deterministic ticker match, no source credibility
score, and no verification state, unlike SEC-filing-style verified catalyst
evidence. It contributes `null` — not a neutral-looking number — unless the
lookup actually returned at least one real article, since "no API key
configured" and "measured genuinely near-zero" produce almost identical
numbers from the underlying keyword-heuristic scoring and must not be
allowed to look like real signal to the weighted average. Weighted at 10%
of continuation probability via the same renormalization mechanism already
governing comparable-outcomes evidence — not a new kind of mechanism, an
additional term in the existing one. See `docs/PROX_GUIDE.md`'s
"Independent candidate discovery" and "Continuation probability — 60%"
sections for the governing doctrine text.
