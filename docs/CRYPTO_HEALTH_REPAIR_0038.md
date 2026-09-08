# Crypto health repair — migration 0038

## Status at handoff

**0038 is applied and deployed, but production verification FAILED at archive
scale. Continue with `CRYPTO_QUERY_REPAIR_0039.md`; do not call 0038 healthy.**

The owner supplied a complete SQL snapshot at `2026-09-03T02:29:55.054015Z`:
199,859 preserved historical rows, 20,000 audited, 179,859 missing audits; all
guards enabled, no detected fingerprint mismatch/review case. CoinAPI is enabled,
129 request credits reserved (128 provider-reported), no unknown/unsettled costs,
1,620 books, 73 episodes, 22 observed horizons, 25 overdue. Latest collection
stopped at 02:16:32Z. No profitability or execution authorization exists.

The standard cloud Turbopack build passed. 0038 release:
`dpl_FuVpfKwH939eujnJGNuJa3SKcK5z`. Diagnostic follow-up:
`dpl_5HXqMy1q7YtWCmNYE4n6tLkiFqtC` (READY). It confirmed SQLSTATE `57014`
on the health snapshot and collector failure at `maintenance`. Both are red.

No production database credential is available to this task. The SQL editor
read succeeds while the API statement/collector deadlines expire; this is not
evidence that the schema, collector switch, or budget is missing.

Earlier production baseline: `2026-09-03T02:01:14.223Z` (September 2, 10:01 PM Eastern).
`ok:false`; failures were `crypto_prox_observation_pipeline` and
`crypto_multivenue_shadow_discovery`. Reported old overdue 15-minute counts were
124 and 507. The existing checks still report `auditedLegacyRows:null`.
HT Agent's overdue count was zero, and closed-session stock integrity passed.
These are observations about the previous deployment, not proof of this repair.

## Root cause and scope

Earlier repairs preserved and quarantined legacy outcomes but left the health
condition dependent on their `evaluationEligible:false` flag. Those checks could
never succeed, even with a healthy current observation writer. The histories
also lacked a completed, per-record audit. Meanwhile the main health endpoint
did not verify the new CoinAPI collector, and HTTP 200 from its cron could mean
"paused" rather than "collected".

This repair separates historical evidence disposition from present collection
and measurement. It does not convert excluded history into trusted returns.

## Implemented

- Add an audit record for each preserved legacy observation, with its original
  row fingerprint, saved entry identity/price and four horizon evidence results.
  Unexpected raw provider provenance requires review. Other documented legacy
  records are classified **unverifiable from saved evidence**, not externally
  reconstructed. Missing horizon prices remain missing.
- Keep every original source row unchanged. Audit completion does not make any
  legacy record eligible for training, evaluation or profitability claims.
- Check missing audits, source fingerprint mismatches, outstanding review cases,
  disabled write guards, deletion privileges and invalid new outcome schedules.
  Any such issue remains a hard health failure.
- Retain original current-writer freshness, provider coverage, exact-set and
  packet checks in both legacy observation lanes.
- Add `crypto_legacy_evidence_audit`, `crypto_coinapi_collection`, and
  `crypto_coinapi_outcomes` as hard checks. Global health still fails whenever
  **any** hard check fails. Historical limitations remain explicit warnings with
  original counts and `evaluationEligible:false`.
- Obtain one atomic database snapshot of the CoinAPI control, completed frame,
  latest attempt, usage receipts and outcome ledger. Verify publication hash,
  exact market identities, provider-time alignment and reported request costs.
- Keep the existing 90-second research publication limit and strict 30-second
  trade / 15-second book checks at collection. Expose current execution-fresh
  coverage separately; a 60-second research cadence is not continuous execution
  freshness. No stale quote is relabeled live.
- Require verified entry evidence and complete 5/15/30/60-minute horizon rows.
  Missing, overdue, incorrect-market, mistimed or arithmetically invalid
  measurements fail. An entirely unmeasured mature sample fails as well.
- Continue unbilled saved-evidence maintenance under a database budget pause.
  Maintenance audits bounded batches and resolves outcomes from saved quotes
  only. It does not request new provider data.
- Log collector outcome/reason/counts without credentials. Authenticated
  evaluation reads now report the same hard checks; an empty ledger with zero
  overdue records is no longer called healthy.

## Boundaries preserved

No stock ranking, Canonical/ProX scoring, Agent dual-lane policy, public crypto
feed selection, paper execution, brokerage connection, spending allowance,
collection cadence, usage counter or API key changed in this repair.
This is not a completed public CoinAPI conversion or proof of profitable picks.

No historical reset, deletion, current-price backfill or automatic accounting
block clearance is included. A provider entitlement/accounting block must be
resolved from its actual receipt; exhausted allowances require owner approval,
not counter resets.

## Verification completed locally

- Application tests: 308 passed, zero failed/skipped.
- SQL tests against isolated PostgreSQL: 17 budget + 11 evidence + 8 observation
  retirement + 9 new audit/snapshot tests; all 45 passed.
- Actual changed health-route section tests: 4 passed.
- Authenticated research/evaluation route tests: 6 passed.
- Actual collector server-module boundary tests: 6 passed.
- TypeScript, focused ESLint and whitespace checks passed.
- Full production build via `npm run build -- --webpack` passed. The default
  Turbopack build was blocked locally by an OS port-binding restriction, including
  on its approved retry. No project build configuration was changed; verify the
  default build in the deployment environment before declaring release success.
- New billable CoinAPI requests made by this repair task: zero.

## Remaining release steps

1. Apply 0038 after 0037. It performs an initial bounded audit and returns the
   number audited; scheduled maintenance completes any remaining batches.
2. Run `tools/verify-crypto-audit-health.sql` if private diagnostics are needed.
   It is read-only and returns no API keys or raw market frames.
3. Deploy the tested code. Verify the deployment's build and exact source
   checkpoint; the current workspace contains earlier uncommitted stock/UI
   changes, so neither a clean repository nor a new committed release is claimed.
4. Read `/api/system-health`. All 36 checks must pass; specifically inspect all
   three new checks and the two existing crypto observation checks. Missing 0038,
   paused/failed collection, unresolved usage or insufficient outcome evidence
   must remain red until actually addressed.
5. Confirm real provider-time cycles, measured usage and mature outcome coverage.
   Do not call the whole app healthy based only on these local tests.
