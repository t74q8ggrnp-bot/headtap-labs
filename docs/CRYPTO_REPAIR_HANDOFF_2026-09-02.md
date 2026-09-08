# Crypto research repairs — September 2, 2026

## Outcome

Implemented and tested locally. No production deployment, SQL application,
CoinAPI paid request, billing change, public-feed replacement or crypto execution
was performed in this repair. The pre-existing stock/UI/Agent/bot work was
preserved. This working tree contains earlier uncommitted work; it is not a
clean release checkpoint or proof of which commit production runs.

This repair makes the evidence safer to collect and evaluate. It does not
establish profitable picks, verify the private CoinAPI plan's full entitlement,
or connect the new feed to the public app without approval.

## Requested work: implemented versus still gated

| Request | Local implementation | Remaining evidence/approval |
| --- | --- | --- |
| Confirm spending runway | Existing disabled 300-credit/day, 900-credit lifetime guard preserved; missing migration fails before paid requests; no cap or cadence increase | Trial balance was $24.93 in the owner's screenshot. Auto-recharge, actual exchange entitlements and provider hard-dollar cap still need verification. No new $50 purchase needed for code testing. |
| Shared backend feed | Bounded shared catalog/history caches; immutable publication hash; one saved price/chart representation; authenticated read/export routes make zero provider requests | Desktop/mobile/iOS/Agent public consumers are deliberately not switched. Their currently deployed sources remain unchanged. |
| Broad scan, selective depth | Existing 60-second pilot policy retained; one prior-snapshot mover plus rotating exploration; no minimum price/daily-move gate added; no research weights changed | Maximum two deep markets per cycle, native-USD Coinbase/Kraken/Crypto.com only. Full current exchange coverage not proved. |
| Honest freshness/coverage | Read-time trade/book ages and exact pair/venue identity; chart last close equals published price; conflicts reject; stale/missing/quote-only/deep evidence distinguished | Minute polling cannot satisfy a 15-second book requirement continuously. Prices age out honestly between cycles; no streaming or execution freshness claim. |
| Correct outcomes | Invalid processing-time and same-symbol fallback writers removed; originals preserved; SQL quarantine/write guards; separate selected-market provider-time quote ledger | Old entries and horizons are unverified, not reconstructed. Production application and actual future horizon availability remain unverified. |
| Prove improvement | Offline matched frozen-model comparison includes delay, spread, declared fees/slippage, observed size, capital after losses, no-trades, missing data, and sampled drawdown | No matched real baseline, verified venue fees/status, executable-size evidence or later unseen performance sample yet. Net improvement remains unknown. |

## What changed

### Historical evidence

- Removed the legacy routines that filled overdue 15m/1h/4h/24h results with the
  latest price and could match another venue by symbol alone.
- Kept all original historical rows and values. Both legacy outcome sources
  are excluded from research evaluation until their provenance is audited.
- The old outcome diagnostic now reads stored evidence only. It no longer
  calls legacy providers or proposes current-price substitution as a fix.
- Migration 0036 blocks further writes to the old horizon-price/return fields.
  It does not delete rows or turn missing historical returns into zero.

### Shared CoinAPI research evidence

- Fixed conflicting same-version candles and cache revisions. Internal gaps
  trigger a bounded history re-read, never fabricated candles.
- Retained actual provider event/receipt timestamps and available book sizes.
- Shared history stores at most 128 markets × 65 bars. Fresh complete history
  is reused; incremental requests overlap existing history for validation.
- Full batch quote coverage is already archived in each publication. The new
  indexed book table duplicates only selected/recent-episode markets, avoiding
  a second per-book copy of the entire universe every minute.
- Selected decisions, including missing/no-trade cases, are retained. First
  selection per market/UTC-hour defines an episode; every scan remains in its
  immutable publication rather than being counted as another independent win.
- Saved 5/15/30/60-minute outcomes require exact-market bid/ask evidence at the
  target or up to five seconds before. Missing/conflicting prices stay null.
- A 90-second receipt grace does not change the price timestamp requirement.
  Saved-book maintenance is unbilled and can continue through a credit-cap pause
  while the collector environment remains configured.
- A later recorded conflict quarantines an already-observed result in the
  verified read view without overwriting its original ledger row.
- Gross ask-to-bid quote returns are explicitly not net profits or simulated
  executions. The comparison runner requires additional evidence/assumptions.

### Read and comparison contracts

- `/api/crypto/coinapi-research`: stored publication/status/credits/coverage;
  optional `marketId` selects one exact native-USD market.
- `/api/crypto/coinapi-evaluation`: verified horizon counts, unavailable data,
  source quarantine and explicitly missing profitability evidence.
- `/api/crypto/coinapi-evaluation?episodeId=<UUID>`: authenticated episode/frame
  hash/exact-market book export. A 500-book cap is disclosed; truncation cannot
  be treated as complete evidence. It does not fabricate baseline choices.
- `tools/compare-crypto-paper.mjs`: offline comparison of supplied frozen model
  choices on the same evidence and unseen chronological window. Duplicate and
  overlapping episodes cannot inflate counts. Missing/unfilled pairs stay in
  the exclusions report, not the win rate. No fit, model promotion or orders.
- The reported drawdown uses observed quote marks; it is not tick-complete.
  Full depth, queue priority, partial fills and actual trading performance are
  not established by this tool.

The batch endpoint, exchange filter and last-trade/book fields were rechecked
against [CoinAPI's current-quote documentation](https://www.coinapi.io/products/market-data-api/docs/rest-api/quotes/quotes/current/get).
That documentation check is not a paid account entitlement or live-coverage test.

## Cost and coverage report

- New billable CoinAPI requests during this repair: **0**.
- New recurring jobs enabled / budgets raised / purchases: **0**.
- Prior observed probe: six calls/six reported credits (documented in the
  research guide). That was transport evidence, not a representative daily cost.
- Current trial balance/subscription/overage/recharge: not re-read privately.
  The owner's last screenshot showed $24.93, $0 negative-balance allowance and
  no daily dollar cap; auto-recharge was not shown.
- Existing capped pilot estimate: about $1.58 per 300-credit active day and
  $4.73 for 900 credits over three capped days under the prior PAYG assumptions.
  It buys roughly 100 active minutes/day, **not 24/7 coverage**. Different daily
  spreading, actual receipts, other key users, taxes or provider terms can change
  the bill. See the dated readiness audit for the full cost assumptions/sources.
- Incremental candle responses save bandwidth but do not necessarily save a
  REST credit per request. No cheaper continuous invoice is promised.
- Existing Supabase/Vercel storage/runtime use is separate and not measured by
  CoinAPI credit receipts. New storage is bounded by the disabled trial's lifetime
  request allowance; retained evidence is not automatically deleted.
- Current production asset/pair/deep-coverage counts were not re-measured here.
  Prior public-feed counts were legacy data and must not be called CoinAPI coverage.
- Measured net P&L, net drawdown and improvement over baseline: **unknown**.

## Health and safe rollout — do not skip this distinction

The two legacy crypto outcome health checks now explicitly report unverified
history. They cannot turn green simply because an invalid backfill cleared an
overdue counter. Stock health criteria and public scoring are unchanged.
The new CoinAPI readiness endpoint is separate; it does not rehabilitate old data.
**Expect the legacy crypto outcome health checks to remain attention-required.**
This is an acknowledged evidence gap, not permission to disable the checks.

1. Review this repair and keep `COINAPI_PILOT_ENABLED` absent/false and the
   database pilot switch disabled. No activation or public-source cutover is
   implied by this handoff.
2. Deploy the tested writer removal while the pilot remains off. This stops the
   bad historical writes before database guards are introduced. Since unrelated
   changes were already present, review the release diff and checkpoint rather
   than blindly treating the entire workspace as this crypto repair.
3. Apply `0035_coinapi_vercel_pilot.sql` **only if not already applied**, then
   `0036_crypto_research_evidence_integrity.sql`. They do not enable collection
   or reset usage. The guard migration is additive and was tested twice in an
   isolated database. No production SQL was run here.
4. Verify authenticated read/schema contracts and legacy quarantine in production.
   Never label the whole app healthy from a successful local build alone.
5. Verify private plan entitlements, recharge and account spending controls;
   explicitly approve the small existing trial budget before enabling it.
6. Capture measured costs/coverage and exact-time evidence. Freeze a baseline,
   candidate policy and venue costs before later evaluation. Missing exchange
   status and executable-size evidence must not be replaced with assumptions of
   safety. Public cutover, faster spending and crypto orders require new approval.

## Verification

- Application Node test suite: **289 passed**, zero failed/skipped.
- Actual SQL budget migration/RPC tests in isolated PGlite: **17 passed**.
- Actual SQL outcome/quarantine/role/atomicity tests in isolated PGlite: **11 passed**.
- Actual server-module boundary tests with in-memory storage and network blocked:
  **6 passed** (disabled/preview, missing migration, DB switch, auth, shared reads,
  tampered/old frame rejection).
- TypeScript, focused ESLint, production build and whitespace validation: passed
  in the final validation pass recorded with this handoff.
- Offline audit now verifies the repaired counterexamples. No production access
  or paid provider call is part of these tests.

Reproduce:

```sh
npm test
npx tsc --noEmit --incremental false
node --experimental-strip-types tools/audit-crypto-readiness-offline.mjs
node --experimental-strip-types tools/test-coinapi-server-boundaries.mjs
node tools/test-coinapi-pilot-sql.mjs /absolute/path/to/pglite/dist/index.js
node tools/test-crypto-evidence-sql.mjs /absolute/path/to/pglite/dist/index.js
npm run build
git diff --check
```

No installed-iOS/desktop visual test was performed because public UI consumers
were intentionally not switched. Passing pure shared-payload tests does not mean
the production app is already displaying CoinAPI data.
