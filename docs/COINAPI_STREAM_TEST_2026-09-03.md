# CoinAPI shared-stream cost test — prepared, not activated

## Release boundary

This is a manual local measurement tool, **not a new production collector**.
No stock code, Canonical/ProX scores, risk policy, account, paper order, public
feed, cron, database budget, deployment configuration or subscription changes.
No migration is needed. Nothing starts by deploying these files.

The owner approved **up to $1 from the existing trial for one live measurement**,
conditional on verifying the provider-side spending cap first. No recurring
collection, new deposit, auto-recharge or public-feed change was approved.
Do not treat a CLI argument as proof that the provider cap has been verified.
The preparation checkpoint used **zero provider requests**.

Account verification follow-up (September 3): the owner signed in to the
CoinAPI/API Bricks portal. The existing local CoinAPI credential is present
(not printed). **The live test has not started; no paid provider request was
made by this verification.** No account settings were saved.

### Signed-in billing evidence

- Billing Overview: original credits **$25.00**, period usage **$4.79**,
  remaining balance **$20.21**, overage allowance **$0.00**.
- Auto Recharge: **disabled**.
- Spend Management: **disabled; no daily budget configured**. Its form
  displayed **$4.48 consumed today** and **$0.07 yesterday**.
- Metered Usage / Daily History, September 3: **900 REST calls received**:
  598 OHLCV, 301 quotes, and 1 symbols call. Calls sent are duplicate transport
  counters for these requests, not another 900 requests. The page reports
  **4.71 total pre-tax usage credits**. These are account totals, not charges
  caused by the unstarted stream benchmark.
- The $4.48 spending-control counter, 4.71 daily ledger total and $4.79 period
  total are distinct displayed readings. Their differences are **not yet
  reconciled**; no reporting-delay, tax or timing explanation is asserted.
- Quotas and Limits: account resource tier 0, concurrency 1, 10 requests/minute;
  no custom quotas listed. Resource tiers are not WebSocket pricing tiers.

The available spending control is account-wide and resets by UTC day. Its UI
promises to reject **new connections or API calls** after the daily budget is
exceeded; it does not establish that an already-open stream is terminated at
an exact dollar boundary. Do not claim a verified per-test $1 billing ceiling
or pass `--provider-cap-confirmed` based on this evidence. Setting a protective
account-wide limit or accepting a best-effort bounded stream requires the
owner's informed approval. The unsaved switch used to inspect the form was
returned to its original off state; no limit was changed.

Local verification: 57 focused tests passed (19 new measurement/runner tests
and 38 existing CoinAPI tests); TypeScript and focused ESLint passed. This is
not a production-health check, completed live measurement or full app build.

## What the test can measure

- One CoinAPI WebSocket, authenticated only from the local server process.
- Exact native-USD spot pairs from existing Coinbase/Kraken/Crypto.com scope;
  1–20 explicitly selected market IDs, no wildcard or exchange-wide subscription.
- Default smoke sample: Coinbase BTC/USD and ETH/USD for 180 seconds. This
  is **not broad discovery coverage or a representative meme-coin sample**.
- Quotes throttled to one update/second per symbol and all received trades.
  The one-minute research cadence is unchanged; this tool does not score.
- Received payload bytes, exact requested/observed coverage, trade/quote clocks,
  freshness at receipt/end, sequence anomalies and duplicate trade detection.
- Diagnostic one-minute candles built only from observed, non-duplicate trades;
  open/close ordered by provider timestamps (including sub-millisecond order).
  No synthetic empty candles, historical filling, verified-completeness claim,
  bad-print/halt certification or production publication. Gaps remain gaps.

Stops on duration, 8 MiB received-payload threshold, connection/heartbeat
timeout, malformed/error/unrequested feed, local clock jump or operator stop.
One connection only: **no automatic reconnect, paid REST, fallback or retry**.
Same-host exclusive lock prevents ordinary duplicate local runs. This is not a
distributed lease or a validated production WebSocket service.

## Money contract

Current official PAYG reference (checked September 3, 2026):
[pricing](https://www.coinapi.io/products/market-data-api/pricing) lists
Tier 1 at $1/GiB and Tier 2 at $0.0625/MiB.
[FAQ](https://www.coinapi.io/products/market-data-api/faq) classifies quotes and
trades as Tier 1; streamed OHLCV/metadata/rates are Tier 2. The test does not
subscribe to Tier 2.

8 MiB at $1/GiB is **$0.0078125 of estimated Tier 1 payload**, not a guaranteed
maximum bill. A crossing frame, queued traffic, transport/provider accounting,
control messages or unrelated account activity are not capped by that number.
The client has no verified CoinAPI billing receipt or account-budget API.
Do not relabel a local byte count or operator assertion as a provider receipt.

Before a live run:

1. Obtain explicit owner approval for a one-off amount (tool allows at most $1).
2. Verify CoinAPI account-side spending controls cover the proposed test and
   confirm remaining balance and auto-recharge settings. Account limits may
   include other keys/traffic and already-used daily spend. Do not restart the
   paused REST collector or reset its limits to make room.
3. Recheck current pricing/entitlement. Set the provider spending control only
   with approval. If a reliable dollar ceiling cannot be established, report
   that limitation before spending; do not promise one from the byte threshold.
4. Record the CoinAPI usage/billing baseline, exact markets and start time.
5. Run once; reconcile the report with provider usage/billing afterward.

Reports deliberately keep `providerReportedUsd`, `providerReportedGiB`,
`totalMonthlyUsd` and hosting cost null until independently established.
The operator's CLI attestation is recorded separately, not marked verified.
An uninterrupted sample can extrapolate **only its selected markets' Tier 1
payload rate**: bytes / elapsed seconds × 86,400 × 30 / 2^30 × $1.
Do not scale two liquid markets into an all-market quote or describe the
projection as a paid invoice. Repeat representative periods, with separate
approval, before using it as a budget. Activity spikes and repaired gaps add cost.

## Run offline now

```sh
node --experimental-strip-types tools/coinapi-stream-benchmark.mjs --plan
node --experimental-strip-types --test lib/crypto/coinapi-stream-measurement.test.ts tools/test-coinapi-stream-benchmark.mjs
```

Live CLI requires `--live`, explicit `--approved-usd`,
`--provider-cap-confirmed` and an absolute **new** `--output` JSON file path.
Credential comes only from server-side `COINAPI_API_KEY`; never paste it into
the command line or saved report. Report and local lock use private permissions.
Do not pass the live flags before steps 1–4 above are complete.

## Still needed before replacing the public collector

Actual measured cost/freshness, broader representative coverage, reliable
single-owner production hosting with reconnect/resubscribe/gap recovery,
durable candles/publication, independent provider clocks and consumer alignment,
and a total budget including hosting, history repairs and traffic spikes.
Native Vercel WebSocket support is not proof of an indefinitely running shared
upstream process; validate runtime duration and billing before choosing hosting.

CoinAPI's [usage policy](https://www.coinapi.io/usage-policy) and its
[commercial-use explanation](https://www.coinapi.io/blog/coinapi-data-commercial-use-policy)
give differing guidance on external UI display. Obtain written confirmation for
HT Labs' public desktop/iOS architecture before expanding public distribution.
This isolated internal test does not establish public display rights, realistic
paper execution, signal improvement or profitability.
