# Crypto / CoinAPI readiness audit — September 2, 2026

> Historical audit snapshot. The later owner-authorized local repair is recorded
> in `docs/CRYPTO_REPAIR_HANDOFF_2026-09-02.md`. Findings below describe the code
> and production evidence at audit time, not the repaired working tree. The
> offline diagnostic now verifies regressions; the original findings remain here.

## Bottom line

**The local research pilot has useful safeguards, but the public crypto product
is not yet CoinAPI-only and no profitable incremental edge has been established.**
More prepaid credit will not resolve the integration or outcome-quality gaps.

This audit made no application, scoring, stock, bot, production, billing, or
execution changes. Only this report and an offline diagnostic were added.
No new direct CoinAPI requests were made. Collection remains unactivated by
this audit; an owner suggestion of another $50 was not treated as spending
authorization.

Evidence is separated below into live responses, inspected local code,
owner-provided account information, and synthetic tests. Local HEAD was
`19fc3d30159bc37dacd08741426bdb7dba550ed8` on `rescue-build-passing`, with extensive
pre-existing modified/untracked work. HEAD does not identify all inspected
working-tree code, and a production-to-commit match was not established.

## 1. Account, measured consumption, and runway

The owner reports the **$25 trial**, not a paid monthly subscription. The
September 2, 7:06 PM ET billing screenshot shows:

| Account evidence | Value |
| --- | --- |
| Total granted/purchased balance | $25.00 |
| Usage this billing period | $0.07 |
| Remaining balance | $24.93 |
| Negative-balance allowance | $0.00 |
| Daily dollar hard cap | Not set |
| Auto-recharge | Not shown; still unverified |
| Hypothetical balance after adding $50 | $74.93; not purchased by this audit |

Dollar balance and REST request credits are different units. The screenshot
does not reveal the REST-credit count, streaming bytes, exchange entitlements,
or attribution of the seven cents to particular tests. It cannot establish a
daily burn rate. It also does not prove auto-recharge is off.

The earlier manual probe documented in `docs/CRYPTO_LIVE_RESEARCH_V1.md` reports
six requests/six provider-reported credits at 21:42:21 UTC: BTC and SKR passed
the evidence checks; SQD remained unavailable. This audit did not repeat that
paid probe. It is transport evidence, not six trades or proof of profitability.

### Estimated spending, not invoices

Using published PAYG marginal REST rates and **one credit per request**, with
no other use of the key, taxes, or hosting:

| Scenario | Credits/day | Dollars/day | Hypothetical 30 days | $74.93 runway |
| --- | ---: | ---: | ---: | ---: |
| Capped pilot, ~100 active minutes/day | 300 | $1.58 | $47.34* | 47.48 pilot days* |
| 24/7 quotes/minute only | 1,441 | $6.42 | $192.59 | 11.67 days |
| Quotes/minute, two histories/5 minutes** | 2,017 | $7.93 | $238.04 | 9.44 days |
| Current three-request cycle every minute, 24/7 | 4,321 | $12.81 | $384.16 | 5.85 days |

\* The actual prepared pilot stops at **900 lifetime credits**, approximately
**$4.73 across three capped days**, not 30 days. It is currently disabled.
\*\* This lower-frequency deep-research option is not implemented or approved.

Full-day math: 1,440 × (one batch quote + two candle histories) + one catalog.
Existing $24.93 would fund approximately 1.95 continuous days at that rate.
[Published pricing](https://www.coinapi.io/products/market-data-api/pricing).

PAYG streaming is separately metered: Tier 1 $1/GiB; Tier 2 $0.0625/MiB.
No streaming traffic was measured and this Vercel pilot does not open sockets.
Do not convert these prices into a monthly streaming estimate without measuring
the subscribed traffic. [Published streaming rates](https://www.coinapi.io/products/market-data-api/pricing).

Request cost can depend on the requested data quantity. Verify response receipts;
the pilot reserves before fetching and stops on unknown/unexpected costs. Its
UTC-day/lifetime reservation limits are not a CoinAPI account-wide dollar cap
or the same as the provider's rolling 24-hour quota. Other key users and an
unexpected first charge remain outside those guarantees.
[Billing and limits](https://www.coinapi.io/products/market-data-api/docs/api-limits-and-billing-metrics).

**Budget recommendation:** do not top up or expand collection yet. The existing
balance is sufficient for the proposed bounded transport/coverage trial after
its blockers and budget settings are approved. That short trial would assess
data quality and cost, not prove trading profitability.

## 2. Shared feed: what works versus what is disconnected

| Layer | Inspected state |
| --- | --- |
| Server-only CoinAPI transport | Fixed provider origin, secret in header, bounded requests, in-process cache/deduplication |
| Durable pilot collector | Database cycle lease, pre-request reservations, request receipts, immutable completed cycles and atomic latest-publication pointer |
| Catalog cache | Shared daily catalog persisted across server instances |
| Candle cache | Incomplete: the selected 65-bar histories are downloaded again each cycle, not incrementally reused |
| Pilot read API | Reads saved publications; does not call CoinAPI for each reader |
| Activation guards | Production environment flag plus database enable switch; migration defaults disabled |
| Public crypto opportunities | Legacy centralized-exchange feed, not the pilot |
| Crypto quote/chart routes | Local code uses Massive, with Coinbase coverage fallback; not connected to CoinAPI publications |
| Desktop/mobile sharing | `useLiveMarketView` deduplicates within one browser runtime; this is not a shared cross-device backend feed |
| iOS | Configured webview points to the public website; installed-device behavior was not independently tested |
| HT Agent / Paper | No CoinAPI crypto decision-to-exit consumer found; no crypto execution activated |

At **23:05:40 UTC / 7:05:40 PM ET**, the deployed
`https://gethtlabs.com/api/crypto/coinapi-research` returned **404**. It is not a
live pilot read service yet. Migration 0035's production application and its
database switch could not be verified without authenticated storage access.
The collector route was not invoked because its GET performs collection.

`/api/crypto/opportunities` returned HTTP 200, provider
`centralized_exchange_public`, methodology `crypto-momentum-v3-prox-authority`.
Its materialized decision frame was dated **23:05:34.831 UTC**. This is direct
production evidence that the public ranking source is still legacy.

The public route can rebuild the legacy feed when materialized data is missing
or expired. Readers can therefore still cause upstream work on that fallback
path. The isolated CoinAPI reader's zero-provider-call guarantee does not yet
apply to the whole app. Do not cancel a still-used subscription on this basis.

Relevant code: `lib/crypto/coinapi-client.ts`, `coinapi-pilot-server.ts`,
`coinapi-pilot.ts`, `supabase/migrations/0035_coinapi_vercel_pilot.sql`,
`app/api/crypto/opportunities/route.ts`, `app/api/crypto/quotes/route.ts`,
`app/api/market-chart/route.ts`, `lib/massive-crypto.ts`,
`lib/crypto-display-fallback.ts`, `app/hooks/useLiveMarketView.ts`.

## 3. Coverage and research selection

Production's legacy feed, sampled at 23:05–23:06 UTC:

| Measurement | Observed count |
| --- | ---: |
| Assets watched across 3 healthy venues | 770 |
| Supported pairs in discovery | 1,357 |
| Available Coinbase USD products | 387 |
| Shortlisted/evaluated products | 80 |
| ProX evaluated / available | 28 / 28 |
| ProX marked stale | 24 |
| Eligible confirmed leaders | 0 |
| Radar products | 6 |
| Discovery candidate assets | 25 |
| Reported provider failures | 0 |

Pair distribution: Coinbase 80, Kraken 753, Crypto.com 524. Coinbase contributes
the shortlist here, not all 387 available USD products. Quote currencies:
USD 1,089; USDT 158; BTC 43; USDC 38; ETH 20; PYUSD 5; CRO 4.
These are **legacy coverage counts, not CoinAPI entitlements or deep analysis
of every watched asset**. Zero provider failures does not mean all data is fresh.

The local CoinAPI pilot configures Coinbase, Kraken, and Crypto.com **native-USD
spot pairs only**. It does not yet cover all those non-USD crosses, Binance,
or Robinhood. It does not reinterpret a USDT quote as a USD quote. Meme coins
are not categorically excluded, and there is no minimum $1 price. Existing
stable/wrapped/leveraged-asset policy still applies. Actual account-wide CoinAPI
market coverage was not re-fetched in this audit.

Every enabled minute, the prepared pilot gets batch quotes, then deeply evaluates
at most two markets: one previous-snapshot mover plus one rotating market, or
two rotating markets when no priority exists. Thus breadth is mostly quote-only;
it is not a deep one-minute scan of the entire catalog. With one rotating slot,
a universe of N eligible markets may take roughly N active minutes to revisit.
The 300-credit daily cap can end collection before that rotation is complete.

The independent research module measures 1/3/5/15/30-minute changes, successive
5-minute acceleration, participation versus a preceding baseline, efficiency,
VWAP/structure, spread, and estimated traded dollar volume. It requires 61
consecutive observed closed minutes. Ten-/30-second features stay missing
without actual trade evidence. Initial component weights 30/25/25/20 are
unvalidated hypotheses; probability of profit and expected net return remain null.

The deployed legacy discovery combines rolling-24-hour and UTC-session moves
on some assets; sample candidates explicitly carried `mixed_measurement_windows`.
The new independent method is not using those mixed daily moves as its score,
but it also has not replaced the public method.

## 4. Timestamp honesty and an additional candle defect

Provider trade time, provider quote time, candle-close event time, and decision
time are distinct. They must stay distinct even when the display price is shared.
CoinAPI market identity includes exchange + base + quote; symbol-only substitution
is insufficient.

The pilot accepts trades at most 30 seconds old and books at most 15 seconds old,
with at most 15 seconds of trade/book disagreement. Its publication can remain
fresh for 90 seconds. The read API additionally requires at least one fresh aligned
quote for `ok`, so it does not blindly equate a fresh publication with a fresh book.

The offline test confirmed: **16 seconds after a perfect collection**, publication
freshness remains true while fresh aligned quotes fall to zero. At 60 seconds,
both trade and quote freshness counts are zero. This makes one-minute research
reasonable as a sampled observation process, but not a continuously execution-fresh
quote service. The coverage record also stores collection-time failures, so readers
must not treat those old flags as a new per-market freshness evaluation.

Required presentation contract: show separately **research last collected**, each
market's **provider as-of**, and **execution quote availability**. Use one immutable
publication/market identity across displays. Do not advance source timestamps,
force different exchange prices equal, or widen the execution gate to conceal lag.
For now crypto execution remains disabled.

**New reproducible finding:** `parseCoinApiBars` silently chooses the last of two
different candles with the same bucket and exact same close-event timestamp.
Reversing the payload changed the accepted close from 11 to 10 in an offline
fixture. The downstream research module detects conflicting candles only if both
survive normalization. Fix the normalizer to reject/flag same-version conflicts
before collection is used for evaluation. Do not mistake this finding for evidence
that an actual provider returned such a conflict; it is a confirmed handling gap.

Halt/status evidence and book sizes are not supplied to the pilot's research
adapter. Missing market status is explicitly reported; it is not execution clearance.

## 5. Outcome integrity: confirmed failure, not merely documentation

The actual local functions in `app/api/crypto/prox-sensor/route.ts` were extracted
and executed with in-memory price/database substitutes. No production rows were
read or changed by the reproduction.

| Synthetic case | Actual legacy behavior |
| --- | --- |
| Entry 10; 15-minute historical price 12; 1-hour price 11; processing-time price 20 | Both horizons receive 20 and +100% |
| Coinbase discovery identity but only same-symbol Kraken current price available | Kraken price accepted for the Coinbase-identified outcome |

`persistOutcomePrices` fetches current prices once and assigns them to every due
horizon. Its query does not retain the horizon target time in the selected row.
`persistDiscoveryOutcomePrices` has the same timing problem plus a symbol fallback
across venues. Neither writes each horizon's actual source timestamp/provenance.

**Evaluation exclusion for this report:** no records from
`ht_crypto_prox_observations` or `ht_crypto_discovery_observations` were used as
profitability evidence. These legacy outcome fields must be treated as unverified
until audited against exact-market, horizon-time history. The affected production
count is unknown. A persistent database quarantine or resolver repair was **not**
applied by this audit. Existing records were not erased or cosmetically repaired.

The separate `measureCryptoResearchOutcome` helper correctly used each horizon's
book in the same synthetic test: 15-minute net +19.521% and 1-hour net +9.561%,
after the explicitly synthetic spread/fee/slippage assumptions. Supplying only
the late current book produced **unavailable/null**, not zero or a substituted
price. These values demonstrate arithmetic behavior, not market returns.

Required repair: preserve the target; resolve only the exact pair and a valid
historical source time; record source, actual time, received time, and quality;
classify missing history as unavailable. Audit/quarantine legacy rows before any
calibration. No current-price backfill or relaxed horizon tolerance.

## 6. Paper evaluation: what is and is not proved

Working locally:

- Exact-market ask-to-bid hypothetical returns with explicit fees/slippage.
- 5/15/30/60-minute outcome contracts; missing, late, conflicting, and wrong-market
  books are rejected. Unfinished horizons are pending, not losses.
- Chronological splits with model versions, an embargo, unavailable-label
  exclusions, and duplicate episode checks.
- No profit probability, promotion authority, or execution permission fabricated.

Not connected or implemented sufficiently for an edge claim:

- Persisted CoinAPI horizon-book collection/resolution and production evaluator.
- Matched baseline-versus-new-model episodes for the same markets and times.
- Actual venue fees and calibrated slippage assumptions in collected frames
  (`costs` is currently null).
- Order-size/liquidity-aware fills, execution delay, partial fills, book depth,
  halts, and portfolio equity/drawdown measurement.
- A frozen model evaluated on a later unseen sample, including losers and no-trades.

**Measured improvement, average net P&L, drawdown, and unseen-sample success:
not available.** Synthetic tests and two accepted quotes out of three are not
trading performance. No justified high-win-rate or profitability claim exists.

One-minute snapshots can miss the evaluator's strict horizon-book window because
of polling jitter or stale source data. Keep such outcomes unavailable; collecting
more precise evidence or authorized historical retrieval is preferable to silently
widening the rule. The current short credit pilot is primarily a coverage/cost test.

## Verification and scope

- Existing Node test suite: **270 passed**, zero failed/skipped.
- Isolated PostgreSQL/PGlite migration/budget tests: **17 passed**.
- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Focused ESLint for the new audit tool and `git diff --check`: passed.
- Offline diagnostic completed and reproduced the defects above. Its successful
  exit indicates the diagnostic ran, not that those defects are fixed.
- Production build: **passed**, including TypeScript and all 29 static pages.
  The first attempt was blocked by the sandbox's local-port restriction;
  rerunning with the required local-process permission succeeded. No deployment
  or collection was performed.
- No whole-app production-health certification, authenticated billing access,
  migration verification, or installed-iOS visual test was performed here.

Reproduce without credentials or provider charges:

```sh
node --experimental-strip-types tools/audit-crypto-readiness-offline.mjs
```

## Next steps, in order

1. Repair exact-horizon/venue outcome handling and add persistent legacy provenance
   quarantine; fix conflicting-candle normalization. Preserve all original evidence.
2. Incrementally cache candle history and finish a shared read contract with
   separate collection/provider/execution freshness and honest per-market coverage.
3. Verify account entitlements, auto-recharge and hard spending controls. Approve
   a bounded trial explicitly; no additional $50 is required for the proposed
   ~$4.73 transport/coverage pilot if the pricing assumptions hold.
4. Deploy disabled components and verify storage/read contracts; only then enable
   the approved pilot. Do not replace the public feed or enable crypto execution.
5. Collect matched, cost-aware baseline/research outcomes, freeze the candidate
   model, and test later unseen periods. Report confidence/sample limitations.
   Seek separate approval for any public-score cutover, execution, or larger budget.
