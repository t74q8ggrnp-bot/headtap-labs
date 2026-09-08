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

### Stock evaluation coverage v2 (prepared September 2, 2026)

`ht-agent-stock-universe-v2-dual-lane` consumes the first six published
opportunities from each independently loaded Canonical stock lane: Momentum
and Before the Crowd. It is a bounded evaluation universe, not a new scoring
model, a guarantee of profit, or a claim to scan the entire stock market.
Canonical ordering and eligibility remain unchanged. Processing preserves the
existing Momentum order, followed by Before the Crowd. Shared symbols retain
the complete Momentum decision when that lane is available and valid; no
cross-lane score, eligibility, entry, or target fields are merged. Duplicate
lane/rank receipts remain visible in run diagnostics. Invalid or duplicate
records do not cause the quota to backfill below either lane's first six.

Each new stock frame additionally records its source lane, universe version,
and original Canonical provider timestamp (null when unavailable). Its original
source-run ID, within-lane rank, decision timestamp, strategy and engine version
are preserved. These are additive JSON provenance fields; historical frames
remain unchanged. Provider time is never fabricated from display or processing
time. This patch does not amend v3 risk's source-alignment or price-basis rules.

Missing, explicitly stale, malformed or failed source lanes cannot supply new
entry candidates. `ht_agent_runs.diagnostics.stock_universe` records each lane's
state, published/considered/valid counts, omissions and duplicates, including
when a cycle subsequently fails. A healthy lane can still be evaluated during
another lane's outage, and existing-position management remains independent.
A successful cycle is not proof that both source lanes were available; inspect
the coverage receipt before claiming complete coverage.

Approval revalidation resolves the original strategy from the proposal's
persisted Canonical evidence. A Before the Crowd proposal is revalidated
against Before the Crowd, never against Momentum as a fallback. Historical
frames with a known strategy remain supported; unknown strategy, stale source,
source-run mismatch or withdrawn symbols require a new decision. An existing
proposal below the six-record cycle quota can still be revalidated within its
original lane. All existing deterministic risk, ProX veto, execution-mode and
paper-only rules apply unchanged. Risk-reducing position management continues
to use its original persisted frame.

Deploy only after checking this isolated patch against the active crypto/web
work. Verify a new Observe cycle's two lane receipts and correct Before the
Crowd provenance without creating a proposal or order. No new migration,
threshold change, mode change or kill-switch change is required. Evaluate
subsequent outcomes separately by universe version and original strategy;
coverage expansion itself is not evidence of profitable calibration.

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

`ht-agent-risk-v3-evidence` retains the v2 thresholds: strictly positive, correctly
ordered, measurable entry/invalidation/target levels, modeled reward/risk of at least 1.5,
Canonical entry quality of at least 55, and Canonical extension risk no higher
than 65 for a new paper entry. These are Agent paper-policy gates. They do not
change Canonical eligibility, ranking, or the one public opportunity score.

V3 corrects evidence semantics, not threshold calibration. Missing, blank,
boolean, non-finite, or object-valued numeric evidence is unknown, never zero.
Measured zero remains valid where the existing policy allows it. Invalid
numeric profile overrides do not replace a default threshold with zero.
Every new risk rule records `passed`, `failed`, `unavailable`, or
`not_evaluated`. A dependent rule that cannot run records its `dependsOn`
codes, stays blocking and not passed, and cannot authorize an order. Decision
explanations list root causes rather than claiming insufficient buying power
when a missing stop prevented sizing. Full rule evidence remains in the journal.

## HT Trade Plan

`ht-trade-plan-v1` is the backend-owned presentation contract for one Agent
decision. It translates the immutable frame and deterministic risk result into
one paper/research state: `wait`, `paper_entry_eligible`, `manage`, `reduce`,
`exit`, or `unavailable`. It may show an NBBO entry band,
confirmation trigger, invalidation, measured targets, reward/risk, chase risk,
and plain-language confirmation and failure evidence.

The plan defaults to no action. It must not fabricate a level when structure is
unmeasurable, must never re-rank Canonical candidates, and must never present a
ProX score as a second public score. The browser only formats the persisted
plan; it does not derive a replacement status or price level.

Incomplete or non-entry-ready momentum is presented as `wait` / “Setup
Forming,” not as a directional instruction to avoid the security. Historical
v1 plans that persisted the retired `avoid` state are normalized to that same
neutral public presentation. The deterministic paper-order gate remains
fail-closed independently of this language.

## Research cohorts and evaluation

Each evaluated candidate records three counterfactual cohorts from the same
frame: Canonical-only, Canonical plus independent ProX, and full HT Agent. Only
the full-Agent decision path can create a paper proposal or paper order. Evaluation
must be chronological walk-forward; training and evaluation windows may not
overlap. Performance estimates use the paper ledger's conservative simulated
slippage and must not be presented as live-execution results.

`ht-agent-cohorts-v2-mode-independent` determines full-Agent research
qualification from Canonical eligibility, no ProX veto, no existing symbol
position, and every deterministic risk rule passing. It does not use action
names to infer qualification. The identical passing frame therefore qualifies
in all three modes, but Observe still creates no proposal or order. Kill
switches and failed evidence rules still disqualify it. Prior v1 cohorts are
retained unchanged and excluded from corrected metrics, not relabeled/backfilled.

The dashboard API reports a bounded diagnostic from the latest 100 current-version
decisions at least 15 minutes old, including only complete three-cohort groups.
Selection is based on elapsed horizon time, not successful outcome collection,
so frequent new decisions cannot continually crowd matured outcomes out.
All three use the same 15-minute horizon. Missing/pending outcomes are counted
as unmeasured, not zero returns. `cohortMeasurement` labels this window, version,
and approximation. These remain modeled returns from proposed entry and minute
bars, not trade win rates or independent episodes. Episode deduplication,
provider-price basis alignment, precise short horizons and fill-aware evaluation
remain separate work before calibration or any claim of incremental value.

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

Outcome maintenance now runs every minute even while the stock session is
closed. Late-session horizons can mature after the decision cron stops; the
old maintenance schedule ended at 8:59 PM Eastern during daylight time and
left those records overdue overnight. This change affects only the historical
outcome worker. It still queries due records first (no provider requests for
an empty queue), uses the existing timestamp rules and unavailable reasons,
and cannot create an Agent decision or order. Decision/entry schedules, stock
ranking, freshness tolerances and risk rules are unchanged.

Phase 1 is not considered production-complete until migration 0030 is applied,
tests and the production build pass, system health is green, no live brokerage
execution path exists, and at least one decision-to-paper-exit lifecycle is
visible in the journal without manual database edits.

## Evidence correction rollout (September 2, 2026)

Apply `supabase/migrations/0034_ht_agent_evidence_calibration.sql` after the
existing 0030/0031 schema, then deploy the matching code. It updates version
metadata/defaults only, leaving thresholds, overrides, modes, kill switches,
balances, and historical decision/frame/cohort/outcome records unchanged.
The migration is transactional and repeatable.

Health requires the v3 policy version and validates complete, internally
consistent risk-evidence logging for sampled v3 decisions, in addition to the
existing freshness, outcome, trade-plan and paper-only checks. It reports the
sampled v3 count so a schema-ready result before the first v3 cycle is not
mistaken for proof that the new writer ran. Verify a successful fresh cycle,
nonzero current-version sample, preserved Observe mode, and no paper orders
created by observation. A green operational health check does not establish
profitable calibration.

## Separate provider clocks (September 3, 2026)

The owner-approved timestamp correction records `market.quoteProviderTimestamp`
from the fetched Massive NBBO alongside the existing price `providerTimestamp`.
Neither clock is replaced with collection time or the other source's timestamp.
Both new-entry and managed-position frames record it, including null when
unavailable. Approval revalidation builds a new frame using the same contract.

`ht-agent-decision-v4-provider-clocks` requires both clocks to be measurable,
non-future, and within the existing policy age limit (90 seconds by default).
NBBO also participates in the existing source alignment rule (120 seconds by
default). Missing or malformed clocks remain unavailable; future timestamps
are rejected, not clamped to an age of zero. The existing management freshness
gate also withholds paper exits against unsafe market clocks. This patch does
not alter Canonical ranking, ProX authority, numerical risk limits, modes,
kill-switch settings, execution destinations, schedules or provider spending.

The `fresh_market_data` rule carries a `ht-agent-market-timing-v1` receipt:
evaluation time, the applied age limit, each original provider time, signed age
and freshness state. Health checks current-version receipts for internal
consistency using their original evaluation time, never today's clock.

`ht-agent-cohorts-v3-provider-clocks` retains the mode-independent cohort rules
but isolates new outcomes from cohorts evaluated without the NBBO clock check.
Historical records stay unchanged; empty current-version metrics are unknown,
not a reset balance or proof of improvement. These are additive JSON fields and
writer versions; the existing v3 policy and SQL schema remain valid. No new SQL
is required. Deployment validation must confirm the new decision version and a
nonzero current-version audit sample before claiming the new writer is live.

## Operational lifecycle recovery (migration 0045)

Migration 0045 repairs two outage-exposed state-machine gaps without changing
Canonical, ProX, Agent policy, modes, balances, orders, or execution authority.
It adds a database-enforced partial unique index so one Agent profile cannot
own two `running` cycles. Pre-existing duplicates are retained and closed as
failed; none are deleted. A stale running cycle is failed before a replacement
starts, and application success/failure is returned only after the matching
database state transition is confirmed.

Health evaluates the latest successful cycle separately from a newly running
cycle. A current in-progress cycle does not hide a still-fresh success, while a
missing/stale success or a running cycle older than five minutes remains a hard
failure. First-use profile creation also tolerates a simultaneous request by
reading the row chosen by the existing unique user constraint; it never
overwrites the winning profile's mode, kill switch, or risk policy.

The same migration gives an old CoinAPI request whose settlement database write
never completed an immutable one-credit maximum-cost hold. The raw request and
unknown provider receipt remain unchanged, the already-reserved credit remains
reserved, and a late settlement cannot charge/account it twice. Only supported
one-credit paths on failed cycles older than two minutes qualify; access errors,
unbounded costs, active leases, insufficient reservations, or altered evidence
remain blocked. The migration performs no provider requests and changes no
credit limit. `tools/verify-operational-lifecycle-0045.sql` is the read-only
post-migration proof.
