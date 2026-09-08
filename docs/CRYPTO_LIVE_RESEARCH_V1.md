# Crypto live-momentum research v1

## Scope and activation status — 2026-09-02

Owner request: strengthen crypto scoring using current market evidence before
spending on faster collection. This is an executable **research evaluator**,
not a completed public-ranking migration or a calibrated profitability model.

Implemented:

- `lib/crypto/live-research.ts`: deterministic raw-evidence scoring and an
  atomic research comparison board with every supplied candidate accounted for.
- `lib/crypto/live-research-coinapi.ts`: exact-market CoinAPI evidence adapter.
- `lib/crypto/live-research-evaluation.ts`: historical quote-horizon measurement
  and chronological, embargoed evaluation splits.
- `tools/crypto-live-research-audit.ts`: manual offline or bounded live audit.
- Vercel-only shared collection pilot and durable credit/observation storage:
  see `docs/COINAPI_VERCEL_PILOT.md`. Prepared locally, disabled until migration
  0035/0036, production configuration and an approved budget are enabled.
- `0036_crypto_research_evidence_integrity.sql`: immutable quote/episode evidence,
  timed horizon observations, and preserved-but-excluded legacy outcomes.
- `lib/crypto/research-comparison.ts` and `tools/compare-crypto-paper.mjs`:
  offline matched frozen-model comparison with delay, bid/ask, fees, slippage,
  observed size, finite capital, no-trades, losses and sampled drawdown.

Not activated: public crypto ranking, crypto Agent execution, background CoinAPI
collection, replacement of existing providers, new refresh schedules, historical
price reconstruction or automatic learning. Stock Canonical/ProX and the trading bot
are unchanged. The original standalone tools need no migration; the new,
optional Vercel collector requires migrations 0035 and 0036.

This is a separate crypto research contract. It does not replace the stock
independent ProX 60/30/10 contract or the current bounded crypto ProX authority.

## What changes in the model

The existing public model starts from 24-hour gains and limits deeper ProX
review to base-qualified/radar opportunities. This can miss a developing move
that has not yet crossed the daily-movement gates.

The new evaluator accepts raw, verified native-USD markets directly. Its input
contains no daily-move requirement, minimum coin price, canonical score, rank,
eligibility, crowd/trap score, previous model answer, or future outcome.
It retains the existing stablecoin/wrapped/leveraged asset routing. The manual
sample is not full-universe discovery; production ingestion still needs work.

Initial, frozen research weights:

| Component | Weight | Evidence |
| --- | ---: | --- |
| Current momentum | 30% | Volatility-scaled 1/3/5/15-minute movement and change in successive 5-minute returns |
| Participation | 25% | Recent 5-minute volume vs the preceding 55 minutes, actual active-minute coverage; down-volume is not bullish |
| Price structure | 25% | Directional efficiency, observed higher low, 15-minute VWAP and recent-high retention |
| Tradability | 20% | Estimated recent dollar volume and spread/cost relative to the observed 15-minute range |

Thirty-minute returns are context. Ten-/thirty-second returns require real
timestamped trades; missing sub-minute data stays null. No candle interpolation
manufactures those features. All minute returns share the latest completed
minute as their endpoint. An in-progress candle is not a completed minute.

These weights are hypotheses, NOT trained or calibrated parameters. No observed
range is called predicted upside. No stop, target, quantity, win probability or
expected profit is invented. States are `strengthening`, `developing`, `mixed`,
`cooling` or `unavailable`, not a buy/sell instruction. Every output has
`executionAuthorized: false`, `probabilityOfProfit: null`, and
`expectedNetReturnPercent: null`.

## Evidence requirements

- Trade timestamp: at most 30 seconds old at evaluation.
- Independently timestamped book: at most 15 seconds old; trade/book alignment
  within 15 seconds. Do not borrow last-trade time to freshen bid/ask.
- Latest closed candle's actual last event: within 90 seconds of evaluation
  and trade time. Nominal bucket end or request completion is not freshness.
- Sixty-one consecutive, observed closed minute buckets; missing buckets are
  not padded with fictional prices. Identical duplicates are harmless;
  conflicting versions fail validation.
- OHLC geometry, prices, volume and derived math must be finite and valid.
- A volatility-scaled trade/candle inconsistency causes abstention, not a
  bullish spike bonus. Provider-time tolerance is two seconds for clock skew.
- Known halts/suspect data fail. Missing explicit market-status evidence is
  disclosed and cannot authorize execution.

Thin markets may remain unavailable under this research contract. They remain
in the denominator; this is not permission to delete their discovery records
or claim that no trade occurred on another exchange.

## Cost and outcome measurements

Fees and slippage must be supplied as a versioned scenario; there is no default
exchange fee. Missing costs stay missing. For a hypothetical long position:

```
entry cost per coin = observed ask × (1 + slippage) × (1 + fee)
exit proceeds = observed exit bid × (1 − slippage) × (1 − fee)
net return = exit proceeds / entry cost − 1
break-even exit bid = entry cost / ((1 − slippage) × (1 − fee))
```

The original horizon helper is quote-based, not a fill-aware backtest. The new
offline comparison additionally checks a declared execution delay and observed
top-of-book size/participation: insufficient size is unfilled, never an assumed
full or partial fill. Missing exchange-status evidence also excludes execution
simulation. Queue position, depth beyond the best quote and tick-complete
drawdown are not modeled. Neither establishes actual Agent profitability.

For each 5/15/30/60-minute horizon, the evaluator requires the same provider,
market and native quote currency, with a real bid/ask observation at or up to
five seconds before that horizon. Later/current prices cannot substitute.
Unavailable prices produce null, never zero; a not-yet-due outcome is pending.
Book availability is checked as of the report time, and conflicting books are
not silently selected. Entry books must be fresh and known at decision time.

The repaired local collector no longer has the processing-time/current-price
outcome writers. Migration 0036 preserves old values and excludes both legacy
tables from evaluation. New SQL guards reject further horizon-field writes;
the diagnostic no longer suggests current prices or same-symbol venue fallbacks
as a repair. Production deployment/application is still unverified.

The new ledger saves all publication evidence and indexes selected/recent
episode markets separately to limit duplicated storage. First selection per
market/UTC-hour defines an episode; every cycle remains archived. Four horizons
resolve from exact-market saved books at target or up to five seconds before.
Resolution waits 90 seconds for receipt, then missing stays unavailable. Unbilled
maintenance runs before budget claims, so a paused credit cap can still finish
pending saved-book outcomes while the production collector environment remains
configured. No deleted rows, current-price substitution or automatic paid retry.
The verified view also excludes a previously observed return if conflicting
entry/exit evidence is subsequently recorded; its original ledger value remains.

Walk-forward inputs must be genuine, de-correlated episode records with a
fixed model version. Duplicate episode IDs are rejected. Training labels must
have matured AND been available by the training cutoff. Evaluation starts
after an explicit embargo; training/test windows cannot overlap. Empty samples
remain unknown, not 0% or 100% success. The split helper does not auto-optimize
or promote a model; callers must form episodes honestly rather than assigning
new IDs to repeated views of the same move.

The matched-comparison runner requires both model choices/version/evidence hash
to be frozen before the evaluation period. It rejects repeated episodes, excludes
overlapping portfolio allocations, and respects remaining capital after losses.
The source tag is an input check, not external provenance certification: assemble
inputs from the authenticated verified episode export, never hand-label legacy
records with the new source version. Missing baseline choices are not inferred
from hindsight or from a current public score. No-trades remain decisions, not
wins; unmatched/unknown results remain excluded with reasons. Sampled quote
drawdown is reported honestly, not claimed as the worst tick-level drawdown.

```sh
node --experimental-strip-types tools/compare-crypto-paper.mjs /absolute/path/comparison.json
```

Input keys: `episodes: MatchedCryptoEpisode[]`, `policy: CryptoSimulationPolicy`,
and `window` matching `compareFrozenCryptoModels`. These TypeScript contracts
are in `lib/crypto/research-comparison.ts`. No model optimization, order routing,
API requests or automatic promotion exists in this runner.

## Owner-selected cadence — not enabled

Owner wants evidence of value before paying for 5–10-second scans.

- Broad discovery and active contender reassessment: 60 seconds. The owner
  chose this over the discussed 30-second option. The versioned research
  policy records that target. A disabled, budget-controlled one-minute Vercel
  pilot schedule is now prepared; production activation is not yet verified.
- Selected chart/price and open paper positions: shared streaming or targeted
  5–10-second updates later, not separate polling per consumer.
- Before any paper order: a fresh, aligned bid/ask check and the deterministic
  risk gate, never reuse a minute-old ranking price as a fill.

One shared market publication should supply chart, price label and Agent
evidence. Ranking time, provider price time and candle time remain distinct and
visible. Thirty-second requests do not imply 30-second-old or fresher source
data; thin markets can go without prints. The current production crypto cron
is still five minutes. The separate Vercel pilot prepares a 60-second cadence
and bounded trial credit settings; it does not replace that public pipeline.

## Manual audits

Offline (zero provider requests), input is `{ evidence: CryptoLiveResearchInput[],
costs: CryptoResearchCosts | null }`, with one common decision timestamp:

```sh
node --experimental-strip-types tools/crypto-live-research-audit.ts --input /absolute/path/evidence.json
```

Explicit live sample (up to three verified native-USD markets, two calls each):

```sh
node --env-file=.env.local --experimental-strip-types tools/crypto-live-research-audit.ts --live COINBASE_SPOT_BTC_USD,COINBASE_SPOT_SQD_USD,COINBASE_SPOT_SKR_USD
```

The key stays server-side in the request header. Output includes sanitized raw
market evidence, an input hash, results, unavailable candidates and provider-
reported credits. The local request allowance is NOT a durable dollar budget
or a production spending guard. Restarting the process resets it. No retry
loop, scheduler, order or production write is present.

## Read-only sample observed on 2026-09-02

At 21:42:21 UTC, the three-market manual probe completed six requests and the
provider reported six credits. This is request-credit evidence, not an invoice
or a projected monthly bill.

- BTC: current trade/book and closed-candle evidence accepted; research state
  mixed, score 68. Recent participation was weaker than its preceding baseline.
- SKR: evidence accepted; mixed, score 57. A positive short-term return did not
  automatically mean strong participation.
- SQD: retained as unavailable; older trade/book timestamps, alignment failure
  and incomplete observed-minute coverage. No fake fresh price or score.

Costs were unspecified in this transport probe, so no net-profit claim is
possible. Two scored markets out of three is not a trading success rate. Do not
tune weights to make these three hand-selected examples look successful.

## Remaining rollout requirements

1. Owner-reviewed weight/behavior comparison; do not silently switch public rank.
2. Shared CoinAPI ingestion, explicit usage budget and persistence; no separate
   direct-exchange fallback relabeled as CoinAPI.
3. Independent live shortlist coverage beyond the old daily-move gate, with
   coverage receipts for omitted/unavailable assets and venue identity.
4. Timestamp-correct observation/outcome storage and repair/quarantine of
   legacy results. Persist decisions and no-trades, not only winners.
5. Defined crypto paper entry/exit/risk rules, actual venue fee assumptions and
   liquidity-aware fills before any Agent execution work is declared complete.
6. Predeclared, out-of-sample evaluation: net returns, win/loss sizes, drawdown,
   missing-data rates, fee sensitivity, and matched comparisons against the
   old model and faster/slower cadence on the same markets/timestamps.
7. Public promotion and faster scanning only after evidence and owner approval.

No public UI, production deployment, stock score, ProX stock authority, bot,
paper order, subscription, or live brokerage connection was changed by the
standalone research tools or the locally prepared Vercel pilot.
