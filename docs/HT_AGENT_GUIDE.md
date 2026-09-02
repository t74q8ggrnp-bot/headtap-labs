# HT Agent Phase 1 contract

HT Agent Phase 1 is a paper-only decision and portfolio-management system. It
does not replace Canonical, ProX, or the HT Labs manual paper ledger.

## Authority boundaries

- Canonical remains the only production detection, eligibility, and ranking
  authority. HT Agent may consume its immutable decision frame but may not
  modify its score, rank, role, eligibility, or public presentation.
- Independent ProX remains a separate research system built from raw market
  structure, microstructure, event evidence, and its own outcomes. It may
  support, warn, veto, or abstain inside HT Agent's paper-only decision, but it
  never sizes a position, creates an order, or executes.
- The deterministic Agent risk gate is the final paper-action authority. No AI
  explanation or future model output can override a failed rule.
- HT Labs Paper Trading is the only execution destination. Robinhood, Alpaca,
  and every live brokerage route are outside this subsystem.

## Immutable decision frame

Every decision is based on one persisted frame containing provider-time Massive
market facts, the Canonical decision, the independently completed ProX member,
catalyst evidence, and a marked paper-account snapshot. The frame is hashed,
append-only, and timestamp-aligned before evaluation.

## Versioned actions and modes

The action vocabulary is `observe`, `prepare`, `enter`, `manage`, `reduce`,
`exit`, `reject`, and `expire`.

- `observe`: journal and cohort measurement only.
- `approval_paper`: create a pending paper proposal; a user must approve it.
- `paper_autopilot`: an allowed full-Agent action may enter the HT paper ledger
  automatically. Deterministic exits and risk reductions remain subject to the
  same risk and reconciliation checks.

Phase 1 may observe every stock session, but it only simulates market-order
execution during the regular session. This prevents an old premarket or
after-hours decision from resting and filling later against a different market.

Profiles default fail-closed through their per-profile kill switch. A persistent
global kill switch can stop all profiles at once. Either switch blocks new exposure. Position reconciliation
and risk-reducing exits remain observable even while entries are blocked.

## Risk gate

The versioned pure policy rejects stale or misaligned provider timestamps,
excessive spreads, inadequate liquidity, explicit halt/bad-print conditions,
duplicate decisions or orders, position-count and position-risk violations,
daily drawdown and gross-exposure violations, and unavailable buying power.
There is deliberately no minimum share-price gate.

`ht-agent-risk-v2-tradeability` also requires correctly ordered measurable
entry/invalidation/target levels, modeled reward/risk of at least 1.5,
Canonical entry quality of at least 55, and Canonical extension risk no higher
than 65 for a new paper entry. These are Agent paper-policy gates. They do not
change Canonical eligibility, ranking, or the one public opportunity score.

## HT Trade Plan

`ht-trade-plan-v1` is the backend-owned presentation contract for one Agent
decision. It translates the immutable frame and deterministic risk result into
one paper/research state: `wait`, `paper_entry_eligible`, `manage`, `reduce`,
`exit`, `avoid`, or `unavailable`. It may show an NBBO entry band,
confirmation trigger, invalidation, measured targets, reward/risk, chase risk,
and plain-language confirmation and failure evidence.

The plan defaults to no action. It must not fabricate a level when structure is
unmeasurable, must never re-rank Canonical candidates, and must never present a
ProX score as a second public score. The browser only formats the persisted
plan; it does not derive a replacement status or price level.

## Research cohorts and evaluation

Each evaluated candidate records three counterfactual cohorts from the same
frame: Canonical-only, Canonical plus independent ProX, and full HT Agent. Only
the full-Agent cohort can create a paper proposal or paper order. Evaluation
must be chronological walk-forward; training and evaluation windows may not
overlap. Performance estimates use the paper ledger's conservative simulated
slippage and must not be presented as live-execution results.

## Auditability and promotion

Every action and no-trade records input evidence, provider timestamps, policy
version, proposed levels and quantity, maximum risk, every risk-rule result,
explanation, paper-order outcome, and later outcome observations. A decision
frame is never rewritten after insertion. State changes are appended to the
Agent event journal.

Outcome horizons resolve from verified historical Massive minute bars nearest
their own target timestamp—not from the worker's current quote. Historical
NBBO, provider time, unavailable states, DST-aware Eastern day boundaries, and
the next eligible weekday session close are retained explicitly.

The Agent allows ten minutes for a delayed or sparse verified bar to arrive.
If no Massive bar exists after that bounded window, the outcome is completed as
`unavailable` and excluded from performance math; it is never left as an
unbounded backlog and never converted into a fabricated zero return. Health
allows two additional one-minute worker cycles before declaring a record
overdue.

Phase 1 is not considered production-complete until migration 0030 is applied,
tests and the production build pass, system health is green, no live brokerage
execution path exists, and at least one decision-to-paper-exit lifecycle is
visible in the journal without manual database edits.
