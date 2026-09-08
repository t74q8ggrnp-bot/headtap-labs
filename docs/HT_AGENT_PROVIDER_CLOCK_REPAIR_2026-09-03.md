# Agent provider-clock repair — September 3, 2026

## Scope and authorization

The owner approved correcting Agent timestamp handling while preserving scoring,
numerical risk limits, trading modes and spending. This work does not enable
crypto collection or execution, modify Canonical ranking, or introduce a price
floor. The dual-lane stock universe remains included.

## Reproduced defect and correction

The entry and managed-position builders fetched a price and a separate Massive
NBBO, but discarded the NBBO timestamp. Fresh price time could therefore let an
hour-old, missing or future-dated bid/ask pass the market-freshness rule. The
price-age helper also clamped future timestamps to zero age.

New frames preserve `quoteProviderTimestamp` independently. Both market clocks
must now pass the existing age limit without future-time clamping. NBBO joins
the existing alignment calculation. A versioned risk receipt preserves both
clocks, their signed ages, their states and the original evaluation time.
Entry, management and approval revalidation use the correction.

New decisions: `ht-agent-decision-v4-provider-clocks`.
New research cohorts: `ht-agent-cohorts-v3-provider-clocks`.
Unchanged numeric policy: `ht-agent-risk-v3-evidence`.
Historical frames and outcomes are not rewritten or mixed into new metrics.
No SQL migration is needed.

## ProX source investigation

At 07:15:56 Eastern, direct Massive last-quote and quote-history reads agreed
that VIDA's latest NBBO was 06:05:46 Eastern. Last-trade and trade-history reads
agreed on 06:10:34 Eastern. The recent two-minute tape contained zero trades;
provider reads did not return errors. This proves no newer evidence was returned
by those Massive endpoints at that probe, not an exchange halt or a claim about
every possible provider.

The existing collector health criterion permits 80% combined source freshness.
Because the combined clock is the later of quote and trade time, it is not proof
that both sources are fresh. New read-only diagnostics disclose quote and trade
freshness independently, mark partial coverage explicitly, and retain original
provider times. Existing hard-failure criteria are unchanged. Closed-session
evidence is labeled retained rather than triggering an active-session warning.

## Verification

- Full standard suite: 334/334 passed.
- Actual health-route tests: 4/4 existing crypto cases plus 4/4 ProX coverage cases.
- Actual server-function tests include both frame builders and entry/exit approval
  revalidation, with network and writes prohibited by test doubles.
- TypeScript and focused ESLint passed.
- Production build (`next build --webpack`) passed.
- Diff whitespace checks passed.

These are local verification results, not a deployed lifecycle demonstration.
No paper or real orders were created during these tests. No CoinAPI requests
were made by this repair.

## Separate unresolved CoinAPI budget issue

The deployed collection workload was approximately three requests/credits per
minute: one shared quote request and two history requests. At normal one-credit
charges this is 4,320 daily plus one daily catalog request, not 1,440. A
900-credit cap covers about five hours of that workload. The lower 1,440 figure
only described quote-only minute polling; it was not the deployed workload.

At the 07:30 Eastern production check, the accounting ledger showed 900 reserved,
895 provider-reported credits, one bounded unknown-cost hold, and daily/lifetime
limits of 900. Those counters are not a dollar invoice. Collection remained
paused with no fresh execution quotes; the last provider request was at 04:36
Eastern. This fix does not change or reset those counters or limits. Crypto
cannot be claimed live or fully converted while paused.

## Deployment boundary

The code is tested locally; the production check at 07:30 Eastern still reported
decision v3 and cohort v2. Do not call v4 live until an app deployment completes
and health shows a nonzero v4 audit sample with internally consistent receipts.
There are substantial existing working-tree changes from earlier work; this
repair does not imply that they have been newly committed or pushed.

Final live recheck at 07:33:03 Eastern: 36/37 checks passed, with
`crypto_coinapi_collection` still failing. The Agent completed its 07:32 Observe
cycle successfully (10 decisions, zero orders); the earlier running-cycle
health failure was not persistent. ProX combined source coverage was 95%, with
VIDA still stale. This is partial source coverage, not an all-fresh app. The
deployed Agent remained v3; the local v4 repair still requires deployment.
