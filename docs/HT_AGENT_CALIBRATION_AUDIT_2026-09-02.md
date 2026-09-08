# HT Agent calibration audit — September 2, 2026

## Scope and status

Read-only investigation. No Agent thresholds, Canonical scores, ProX authority,
profile modes, database rows, or production deployment were changed in this
audit. Earlier uncommitted work was preserved.

Production `/api/system-health` returned `ok: true` at
2026-09-02T19:10:19.836Z (3:10 PM Eastern). Its Agent check reported:

- 990 decision frames and 990 decisions;
- zero paper orders and zero overdue Agent outcomes;
- one unlocked active profile;
- the latest cycle ran successfully in **Observe** mode.

These are operational checks, not evidence of profitable or calibrated behavior.
Zero orders is expected in Observe mode. The number of independent market
episodes cannot be inferred from 990 recurring decision records.

## Reproduced defects

The following were reproduced by calling the repository's actual pure risk and
decision functions with controlled inputs. They are not assertions about the
frequency of these defects in production history.

### 1. Full-Agent shadow measurement depends on execution mode

`lib/ht-agent/decision.ts`, `buildHtAgentCohorts`, sets full-Agent `wouldEnter`
only for `enter` or `prepare`. An identical valid frame with ProX support and
every risk rule passing yields:

| Mode | Decision | Full-Agent wouldEnter |
| --- | --- | --- |
| Observe | observe | false |
| Approval Paper | prepare | true |
| Paper Autopilot | enter | true |

This makes Observe-mode full-Agent performance selection unusable as a
counterfactual comparison. Repair research qualification separately from order
permission. Do not enable an execution mode to repair the metric. Version the
corrected cohort contract and distinguish historical v1 measurements.

### 2. Unknown numbers become zero

`lib/ht-agent/risk.ts` uses `Number(value)` before checking finiteness:
`Number(null)` is zero.

- A missing spread passed as a measured 0% spread.
- Missing extension risk passed as measured zero extension.
- A missing stop was returned as `proposedStop: 0` even though the earlier
  positive-stop fix correctly prevents sizing and authorization.

The prior fix prevents a non-positive stop from authorizing an entry, but it
did not repair null preservation. Unknown evidence must remain unknown. This
can make some inputs incorrectly permissive as well as other inputs restrictive;
the problem is not simply that all rules are too tight.

### 3. Dependent failures look like independent problems

A missing stop with $100,000 buying power produced four failures:
`trade_levels`, `risk_reward`, `position_risk`, and `buying_power`.

The last three are consequences of unavailable sizing, not proof that the
account lacks funds or that measured reward/risk was actually too low. Keep the
entry blocked, but report the root cause and mark dependent checks unevaluable.
Calibration must distinguish missing values from measured threshold failures.

## Additional code findings

- `server.ts` projects proposed entry/stop/target from Canonical price and
  downside/upside percentages; a separate quote supplies `market.price`.
  These are not yet an independently calibrated, setup-specific Agent entry
  model. Proposal/quote basis alignment needs explicit validation.
- ProX structural failures can veto, and the Agent separately requires
  Canonical-derived reward/risk >= 1.5, entry quality >= 55, and extension <= 65.
  This is a stack of filters using different evidence. Code alone cannot show
  whether their intersection improves outcomes or over-filters good entries.
- Dashboard cohort metrics combine completed returns across horizons without
  selecting a common horizon or independent episode. They are not trade win
  rates. The observation query is not paginated, and the outcome query is
  capped, so a complete matched denominator is not established.
- The outcome worker uses the decision's proposed entry rather than the
  cohort's separately stored decision price. It measures returns from minute
  closes selected within a ten-minute tolerance, including 30-second horizons.
  That is not sufficiently precise to validate second-scale decisions or to
  determine whether a stop or target would have filled first.
- `chronologicalWalkForward` splits chronological samples, but its existence
  alone does not demonstrate that policy parameters were trained and evaluated
  on disjoint market episodes with non-overlapping outcome windows.

## Recommended sequence — requires implementation approval

1. **Repair measurement and input semantics without loosening thresholds.**
   Preserve nulls; reject invalid required evidence; report root-cause failures;
   make shadow qualification independent of mode while preserving execution
   locks; version measurement changes. Never rewrite immutable source frames.
2. **Build a complete, matched episode dataset.** Use identical provider-time
   price bases and horizons across cohorts. Separate sessions and setup types;
   deduplicate repeated observations for evaluation; preserve unavailable
   outcomes as unavailable. Compare blocked and qualified cases, not winners only.
3. **Agree on the Agent's trading objective.** Scalps and multi-hour continuation
   require different entry timing and management. Do not choose wider targets
   just to make displayed reward/risk attractive, or introduce a share-price floor.
4. **Calibrate a versioned paper-only challenger.** Fit only on earlier episodes;
   evaluate later sessions with purged/embargoed boundaries where horizons overlap.
   Account for bid/ask, slippage, liquidity, halts, partial fills, and ambiguous
   same-bar stop/target paths. Keep production policy frozen for comparison.
5. **Promote only with evidence and owner approval.** Report data coverage,
   readiness among data-valid cases, target-before-stop rate, after-cost returns,
   drawdown, missed opportunities, and abstentions. No Canonical or independent
   ProX score changes and no live brokerage route are implied.

## Historical-data access limitation

The local environment does not provide the server-side database key required
for the authenticated Agent history. Automated security review rejected a broad
production-environment download because it would also download unrelated
brokerage and other credentials. No credentials were downloaded.

Historical calibration therefore still needs a scoped, read-only export of
Agent decision rules, market/Canonical/ProX evidence, cohort observations, and
outcomes. Omit user identifiers, access tokens, and unrelated account records.
Until that is available, this audit establishes defects and operational status,
not production rejection percentages or an improved trading expectancy.

## Approved follow-up implementation — September 2, 2026

After the read-only audit, the owner approved repairing the measurement/input
defects. The follow-up code addresses the three reproduced defects above:

- Full-Agent research qualification no longer depends on execution mode.
  Observe remains non-executing; eligibility, vetoes, existing positions and
  all deterministic risk gates remain binding.
- Required numeric evidence preserves unknown values instead of coercing them
  to zero. Trade-plan extension and malformed profile overrides use the same
  numeric parsing rule.
- Missing trade levels produce root-cause explanations and explicitly
  unevaluable dependent checks, not fabricated funds/threshold failures.

The writer uses decision v3 / evidence-risk v3 / cohort v2. New reporting
excludes legacy cohort v1, uses a single 15-minute horizon and a bounded matched
sample (latest 100 current-version decisions at least 15 minutes old). Missing outcomes stay
unmeasured. This resolves the mixed-horizon and unmatched query-window issue
for that diagnostic, not full-history/independent-episode evaluation. Historical
cohorts are retained unchanged.

Thresholds, Canonical/ProX scoring and execution authority are unchanged. Apply
migration 0034 and deploy before validating production. The original health
snapshot above predates this implementation. The remaining price-basis,
short-horizon precision, episode sampling and walk-forward calibration findings
are still open; these code repairs are not a profitability or readiness claim.

Local verification of the follow-up: 168/168 repository tests passed; TypeScript
and focused Agent/system-health ESLint passed; the production Next.js build
passed. The initial sandboxed build could not bind its local worker port; the
same production build succeeded with approved execution outside the sandbox.
Migration 0034 has not been run against production here, and these changes have
not been deployed or verified on production in this implementation turn.
