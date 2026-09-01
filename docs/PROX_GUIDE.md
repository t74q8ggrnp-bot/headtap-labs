# ProX operating doctrine

## Status and authority

This document is the permanent design contract for ProX inside HT Labs. Read
it before changing ProX discovery, intelligence, scoring, ranking, opportunity
selection, or any bridge between ProX and the canonical HT Labs pipeline.

This guide does not, by itself, authorize a production implementation or a
public-authority change. Any change to the rules below requires explicit owner
approval, a version bump, deterministic tests, outcome measurement, and an
update to this document.

## Product role

HT Labs is the product and canonical publishing system. ProX is its independent
market-intelligence brain.

The two systems answer different questions:

- Canonical HT Labs asks: **Which stocks show the strongest observed momentum
  under the current HT framework?**
- ProX asks: **From this exact price and time, which independently discovered
  stock has the strongest probability-adjusted continuation opportunity?**

ProX must not become canonical scoring with renamed factors or different
weights. It must discover its own candidates, evaluate them with its own
evidence, and produce its own shadow decision before any comparison with the
canonical result.

## Non-negotiable boundaries

1. ProX begins with its independent full-market discovery universe, not the
   canonical winner, contender list, or eligibility set.
2. Canonical results may be joined only **after** the independent ProX board is
   complete, solely for measurement and comparison.
3. ProX may not consume the canonical HT score, strategy score, rank, tier,
   hero/contender role, eligibility result, trade-framework score, crowd score,
   or trap score as scoring inputs.
4. Shared raw market facts are allowed: fresh price, timestamps, bars, volume,
   VWAP, session open/high/low, verified corporate actions, and primary-source
   events. Shared facts are not shared decisions.
5. The independent ProX Edge board remains shadow-only until a separately
   approved promotion phase. It cannot alter the public board, publish a
   second public score, place an order, size a position, manage an exit, or
   enable live trading.
6. The public product continues to show one HT opportunity score. Internal
   ProX components and traces exist for auditability, not as competing user
   percentages.

## Authority namespaces

HT Labs currently contains two deliberately separate ProX systems. Their
names and authority must not be conflated:

- **ProX Market Pulse** is the established, bounded live-tape input consumed
  by the canonical evaluator. `prox-public-market-authority-v4-realtime-source-authority` may apply a
  bounded rank adjustment, confirm a post-peak eligibility failure, or
  withhold a deep-session recovery until reclaim. It never produces a second
  public score, discovers the canonical universe, or receives execution
  authority. Canonical HT Labs remains the decision owner.
- **Independent ProX Edge** is the full-market discovery, Market Structure
  Brain, Edge Score, shadow board, and Outcome Memory governed by the rest of
  this guide. It remains research-only. Its score, rank, hero, dispositions,
  comparison results, and learned outcomes cannot enter the canonical board
  until the promotion ladder's evidence and approval requirements are met.

This distinction documents the production boundary approved by the owner on
2026-08-23. It does not expand either system's authority or change a score,
threshold, gate, or public field.

### HT Agent Phase 1 paper-only consumer

The product owner explicitly approved HT Agent Phase 1 on 2026-08-31 as a
paper-only consumer of the independently completed ProX shadow board. Only
after Canonical and ProX have finalized timestamp-aligned frames may HT Agent
translate independent ProX evidence into `support`, `warn`, `veto`, or
`abstain`. This does not promote the independent board into Canonical and does
not grant ProX execution authority. Canonical still owns detection and
eligibility, the deterministic Agent risk gate owns paper authorization, and
only the HT Labs paper ledger can receive an order. ProX may never size,
submit, or manage an order and may never rewrite a Canonical score.

## Independent candidate discovery

ProX scans the full available U.S. stock universe directly through its market
data source and verified event sources. Canonical nomination is not required.

Positive discovery patterns include:

- quiet participation before obvious price expansion;
- time-adjusted relative-volume acceleration;
- one-minute velocity and five-minute acceleration;
- session reclaim;
- price holding above VWAP;
- pullback recovery and higher-low behavior;
- live liquidity expansion;
- verified catalyst activity;
- sustained movement near the current session or observation-window high; and
- independently observed news-attention velocity (headline volume and
  recency from ProX's own news lookup — a distinct, explicitly lower-rigor
  evidence class than verified catalyst activity below; see "Continuation
  probability — 60%").

Defensive research patterns include:

- post-peak deterioration;
- downside volume breakdown;
- failed VWAP reclaim;
- excessive extension;
- corporate-action distortion;
- stale or inconsistent price data; and
- verified dilution, reverse-split, delisting, or contradictory evidence.

The research queue is not automatically a bullish opportunity list. Defensive
and anomaly observations remain research evidence until the independent ProX
decision layer classifies them.

## Security-type routing

Security type routes an observation to the correct research lane. It is not a
bullish factor, a penalty, or an Edge Score input.

- `opportunity_equity`: verified `CS` and `ADRC`. These are the only instrument
  types that may enter the independent opportunity board or seed bullish
  opportunity Outcome Memory.
- `market_context`: `ETF`, `ETN`, `ETV`, `FUND`, and `INDEX`. These may inform
  sector, theme, breadth, and regime research, but can never become the ProX
  opportunity hero.
- `linked_instrument_context`: `WARRANT`, `RIGHT`, `UNIT`, `ADRW`, and `ADRR`.
  These may become evidence for a separately verified, deterministically
  linked common equity, but can never become the opportunity themselves.
- `excluded_asset`: `PFD`, `ADRP`, `BOND`, `SP`, `BASKET`, and `OTHER`. These
  do not enter the independent opportunity board or Outcome Memory.
- `pending_verification`: missing, deferred, or newly introduced provider type
  codes. ProX may retain the observation for verification and retry, but it
  receives no opportunity eligibility, rank, hero role, or outcome episode.

The provider's type registry is cached and monitored so new codes become a
visible health condition instead of being silently guessed. A registry outage
may use a prior cached registry, but it may not convert an unverified type into
an opportunity. ADR common shares receive no arbitrary discount; they face the
same market-quality and risk gates as common shares.

## The single ProX Edge Score

The independent shadow board uses one `ProX Edge Score` from 0 to 100:

```text
ProX Edge Score =
  60% continuation probability
  + 30% reward/risk asymmetry
  + 10% evidence confidence
  - confirmed risk penalties
```

This is an initial, versioned blueprint. Weight changes require measured
outcome evidence and explicit approval; they cannot silently drift in live
code.

Entry qualification additionally requires an Edge Score of at least 55 and a
continuation-probability component of at least 50. These are versioned research
floors, not public percentages or guaranteed outcomes. A candidate below
either floor remains recorded on the Momentum Radar with entry withheld.

### Continuation probability — 60%

Continuation probability estimates what is likely to happen **after the
current decision timestamp**. It must not reward a stock merely for already
having a large move.

Its evidence includes:

- live price velocity and acceleration;
- time-adjusted relative volume and volume acceleration;
- price relative to VWAP;
- pullback from the recent high and time since that high;
- recovery, higher-low, and orderly path behavior;
- measured outcomes from comparable independent ProX discoveries; and
- independently observed news-attention velocity (`prox-edge-score-v2`):
  headline volume and hype-keyword density from ProX's own Finnhub/NewsAPI
  lookup, blended 60% velocity / 40% hype into a single component at 10%
  weight, the same weight and renormalization mechanism already governing
  comparable-outcomes evidence. This is **not** the verified `event`
  channel above — it carries no deterministic ticker match, no source
  credibility score, and no verification state, and it must never be
  confused with or substituted for verified catalyst activity. It
  contributes nothing (`null`, not a neutral-looking number) unless ProX's
  own lookup actually returned at least one real article; "no API key
  configured" and "measured genuinely near-zero" are different states and
  must not be allowed to look identical to the scoring formula.

### Reward/risk asymmetry — 30%

ProX calculates its own current structural invalidation and continuation
capacity from raw market structure and learned ProX outcomes.

- Structural invalidation may use VWAP, a confirmed recent swing low, and
  observed volatility.
- Continuation capacity may use the current impulse, realized range, and the
  measured distribution of comparable independent ProX episodes.
- Scenario reward/risk is continuation capacity divided by structural risk.
- There is no invented minimum upside and no fabricated target.
- If structural risk or continuation capacity cannot be measured honestly,
  the candidate is entry-withheld.

### Evidence confidence — 10%

Evidence confidence measures trustworthiness, not bullishness. It includes:

- quote and bar freshness;
- feature completeness;
- sample size and maturity of comparable ProX outcomes;
- catalyst-source credibility and verification;
- deterministic ticker matching; and
- agreement or contradiction across independent evidence sources.

Insufficient historical evidence must shrink toward a neutral prior and lower
readiness. It must never be presented as calibrated confidence.

## Entry qualification and risk authority

The following are hard entry-qualification failures rather than cosmetic score
deductions:

- confirmed post-peak failure;
- corporate-action distortion;
- stale, invalid, or internally inconsistent market data;
- unmeasurable structural risk;
- unmeasurable continuation capacity;
- scenario reward/risk below 1.0;
- severe liquidity deficiency; and
- verified defensive or contradictory catalyst evidence.

A strong mover that fails entry qualification may remain visible on the ProX
Momentum Radar as `entry_withheld`. It cannot become an entry-qualified ProX
hero.

## Independent shadow board

For each atomic decision timestamp, ProX produces and preserves:

- one entry-qualified hero when a candidate genuinely qualifies;
- five independently ranked contenders;
- an entry-withheld Momentum Radar;
- one ProX Edge Score per candidate;
- the exact discovery price, source timestamp, evidence version, and reasons;
  and
- the hard-gate disposition for every excluded high-priority candidate.

If no candidate qualifies, ProX must say so. It may still identify the market's
strongest observed name, but it cannot mislabel that name as an acceptable
entry.

## Canonical strengths rebuilt ProX-native

Canonical still contains important product lessons. ProX may rebuild those
capabilities from shared verified facts, but it may not copy canonical's
answer. The implementation boundary is:

| Canonical strength | ProX-native implementation |
| --- | --- |
| Historical support, resistance, ATR, and volatility | `prox-market-structure-v1` calculates adjusted daily structure plus intraday swings, VWAP, and realized range from raw bars. |
| Full-day versus current-session context | `prox-edge-score-v1` uses a bounded two-clock component: movement from the previous close and movement from the current session open. A large old move cannot substitute for current participation. |
| Security-type filtering | `prox-security-routing-v1` routes verified facts into opportunity equity, market context, linked-instrument context, excluded, or pending lanes. Security type contributes no score points. |
| Price and corporate-action integrity | ProX independently checks discovery-snapshot price against its minute-bar pulse using a bounded volatility-aware tolerance and hard-blocks corporate-action distortion. |
| Entry qualification and honest R/R | ProX derives structural invalidation, continuation capacity, and scenario R/R from its own Market Structure Brain. It consumes no canonical targets or framework. |
| Price Discovery classification | ProX calls Price Discovery only when adjusted daily history contains no meaningful resistance above the current price. Capacity is an observed scenario, not a promised target. |
| Data freshness enforcement | Independent observation and pulse timestamps are hard gates; missing or stale facts do not silently receive a neutral pass. |
| Atomic score/rank/display frame | `prox-shadow-board-v1` writes one run receipt and all member decisions against one decision timestamp before marking the frame complete. |
| Complete opportunity ledger | Each deeply evaluated opportunity-equity candidate receives exactly one `selected`, `blocked`, or `rejected` disposition with discovery price, decision price, evidence, structure, and reasons. |
| Health checks and disposition receipts | System health recomputes coverage, the 60/30/10 formula, roles, ranks, versions, timestamps, and the empty canonical-input receipt. |
| Multiple discovery lanes | Direct discovery retains opportunity equity, broad-market context, linked-instrument context, excluded, and pending-verification lanes without allowing auxiliary instruments to crowd equities out. |
| Human-readable explanations | Every member stores hard failures, evidence reasons, structure reasons, input provenance, and a plain disposition reason. |

The atomic board deeply evaluates at most 30 highest-priority independent
`opportunity_equity` observations per frame. That is an explicit cost and API
boundary, not an assertion that other discovered instruments were evaluated.
Every candidate inside that boundary receives a disposition; observations
outside it remain preserved in the direct-discovery receipt.

The earlier inline challenger is not an independent brain because it begins
inside a canonical opportunity. It is therefore disabled as a live challenger.
`prox-post-decision-comparison-v2` may calculate a comparison delta only after
an independently produced ProX Edge Score and a canonical decision both exist.
It cannot create or repair a missing independent ProX score.

## Outcome memory and learning

ProX learns from its own independent discovery episodes, not from canonical
selection as the answer key. Each episode preserves:

- first discovery time and price;
- 5-, 15-, 30-, and 60-minute returns;
- four-hour, session-close, next-session, and 24-hour returns;
- maximum favorable excursion;
- maximum adverse excursion;
- time to peak;
- whether continuation occurred before meaningful drawdown; and
- whether the path became a late chase, peak failure, defensive breakdown, or
  corporate-action distortion.

Learning must use complete denominators, including failures and candidates
that never graduated. Corporate-action distortions are quarantined. A model or
weight version is frozen while it is being evaluated; ProX does not rewrite
its own production rules invisibly during a live session.

Five-minute decision frames remain append-only audit evidence, but they are
not independent performance samples. Shadow scorecards use the first decision
for each ticker, trading date, market session, and disposition as the episode
representative. This prevents one persistent ticker from becoming dozens of
apparent wins or losses while preserving every underlying decision frame for
inspection.

## Canonical comparison

Only after both boards are independently complete may the system compare:

- hero and contender overlap;
- rank differences;
- forward maximum gain and drawdown from identical timestamps;
- `+5% before -5%` and `+10% before -5%` outcomes;
- continuation and peak-failure avoidance rates;
- data freshness and decision coverage; and
- performance by pre-market, regular, and after-hours session.

Canonical data may evaluate ProX performance, but it may not leak into the
independent ProX score.

## Promotion ladder

ProX authority expands only through explicit, measured stages:

1. **Independent shadow board:** no public or execution authority.
2. **Measured comparison:** fixed-version head-to-head outcome reporting.
3. **Bounded defensive authority:** approved veto or entry-withheld rules only.
4. **Ranking authority:** only after sufficient out-of-sample evidence.
5. **Public single-score authority:** explicit owner approval and regression
   protection required.

No stage grants order or live-trading authority. Trading automation is a
separate system and is outside this guide.

## Required implementation safeguards

Any future independent ProX board must include:

- a versioned scoring contract;
- an automated forbidden-input test proving canonical decision fields cannot
  enter ProX scoring;
- an atomic decision frame so score, rank, price, and display cannot diverge;
- append-only observation and outcome records;
- coverage receipts and system-health checks;
- deterministic tests for winner selection, hard failures, missing evidence,
  stale data, corporate actions, and post-peak failure;
- no frontend ranking or score calculation; and
- no bot, position, order, or live-trading authority.

Security routing is implemented by
`lib/prox/security-routing.ts` under the versioned
`prox-security-routing-v1` contract. Migration
`0017_prox_security_type_routing.sql` preserves the route on observations,
queue rows, and equity-only Outcome Memory episodes.

The independent Market Structure Brain, Edge Score, and atomic shadow board
are implemented by `lib/prox/market-structure.ts`,
`lib/prox/edge-score.ts`, `lib/prox/shadow-board.ts`, and
`app/api/prox-shadow-board/route.ts`. Migration
`0018_prox_market_structure_shadow_board.sql` adds the append-only shadow run
and member records. These records remain research-only and have no frontend,
canonical, position, order, or execution authority.

Shadow-board outcomes are implemented by
`app/api/prox-shadow-board-outcomes/route.ts` under the versioned
`prox-shadow-board-outcomes-v3-due-first-market-sessions` contract. Migrations
`0020_prox_shadow_board_outcomes.sql` and
`0021_prox_shadow_outcome_resolution.sql` create the complete-denominator
ledger and its honest resolution states. Each due horizon is measured from a
verified historical minute bar near that horizon's own timestamp; it may be
pending or terminally unavailable, but missing evidence is never converted
into a zero return. Migration `0025_prox_shadow_episode_scorecard.sql` defines
the de-correlated episode representatives used by scorecards. Calibration and
scorecards consume measured outcomes only.

Outcome collection selects the oldest due horizons first. A horizon that
lands outside the US equity extended-hours session is terminally unavailable,
not a zero return and not a seven-day pending record. Missing in-session bars
remain pending so a halt or provider gap cannot be silently rewritten.

## Provider-time authority

`scanned_at` and `computed_at` describe HT Labs processing time. They must
never prove that a market fact is fresh. Migration
`0026_market_data_timestamp_authority.sql` adds `market_data_as_of` to the
canonical run row and `market_as_of` to ProX market features. Those provider
timestamps govern source freshness.

Massive Advanced is the verified stock transport for this contract. During
U.S. extended-hours trading, source evidence must be no more than five minutes
old and canonical/ProX provider timestamps must align within two minutes.
Outside the 4:00 a.m.–8:00 p.m. Eastern equity session, the last verified
session is retained rather than relabeled as a continuously updating trade.

The bounded public ProX pulse may affect canonical ranking only when:

- both the canonical decision price and ProX feature carry usable provider
  timestamps;
- the two provider timestamps are within the versioned alignment tolerance;
- the source facts are within the active-session freshness limit; and
- the ProX processing record is also current.

Under `prox-public-market-authority-v4-realtime-source-authority`, a severe
full-session pullback removes continuation support and applies a bounded rank
penalty even if a short rolling window is bouncing. Distance below the high
alone is not a hard failure. Eligibility is blocked only by confirmed
deterioration or the documented negative-session reclaim rule.
