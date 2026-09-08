# Manual crypto paper trading — 0040

## Boundaries

- Separate $100,000 virtual crypto account; stock paper balances are untouched.
- Manual native-USD spot buy/sell on saved Coinbase, Kraken and Crypto.com markets.
- No real brokerage, crypto shorting, leverage, Agent orders or public-feed switch.
- Canonical, ProX, stock scoring and stock execution contracts are unchanged.
- The account is created only after the signed-in user clicks the account button.
- No CoinAPI call from the page, API reads, previews, orders or matcher. Everything
  reuses the existing shared one-minute publication and server-side credentials.
- Collection limits remain 300 daily / 900 lifetime request credits. Those units
  are not dollars. No uncertain charge is assigned an invented value.

## Surface and API

Page: `/paper/crypto`; links from stock paper and CoinAPI research.
Authenticated private/no-store API: `/api/crypto/paper`.

GET returns the user's ledger and the shared saved CoinAPI publication without
creating an account or issuing a provider request. POST actions are
`open_account`, `preview`, `submit`, and `cancel`. Identity comes exclusively
from the verified session; client-supplied cash, fees and user IDs are ignored.

Preview accepts an exact exchange market ID, buy/sell, editable price limit and
either decimal units or a USD budget. Server-side exact decimal math includes
fees and all existing reservations. Submissions carry a unique client ID and
preview publication ID. Retries with the same payload return the original order;
reuse with a different payload is rejected. Uncertain submissions retain their
ID in the tab so a retry cannot silently create a second order.

Desktop uses chart/market selection beside the ticket; mobile stacks the same
controls with a Trade anchor. Positions have Sell/Close and exact fractional
quantity. History retains partial fills, fees, realized P&L and cancellation.
Missing charts remain quote-only; missing marks remain unavailable. A price is
not relabeled current merely because the browser refreshed.

## Explicit simulation policy

Policy `crypto-manual-paper-v1`: 60 basis points fee per fill plus 10 basis points
adverse slippage from observed bid/ask. These are disclosed test assumptions,
not verified user-specific exchange fees or evidence of profitability.

Orders are limits expiring after 10 minutes, not immediate market fills. The
editable initial limit gives the shown bid/ask 0.5% room. The reviewed limit is
fixed. Buying fills at ask plus slippage, selling at bid minus slippage, only if
within the user's limit. Fees apply only to filled units.

The scheduled collector invokes the matcher after collection, including paused
cycles so expiration continues. Only existing user-created orders can be matched.
It requires a healthy saved publication, a book timestamp at/after submission
and no more than 15 seconds old, trade no more than 30 seconds old, and at most
15 seconds book/trade skew. Unbounded provider charges, bad identity, excluded
assets, invalid/crossed prices and missing liquidity block fills. No freshness
rule is weakened to make minute polling look continuous.

Fills use only available displayed top-of-book quantity. Its consumption is
shared across orders at the same market/time/side. Partial fills, reserved funds,
reserved sell units and exact cost-basis release are transactional. The kill
switch blocks new submissions and fills while allowing cancellation/expiration.

## Migration and integrity

Owner reports 0040 applied. It creates additive crypto-only tables and
service-only mutation RPCs, RLS, ownership checks, immutable events/fills,
idempotency and aggregate reconciliation health. Account deletion cascades only
the deleting user's crypto records. Rerunning the migration never resets cash
or provider spending counters.

New health check: `crypto_manual_paper_ledger`. Missing schema, overdue orders,
cash/basis/fill/order/event mismatches or a live-execution flag cannot pass.
This check is separate from collection health: an intact ledger does not mean
fresh quotes exist or production trading has been demonstrated.

## Verification before deployment

- 314/314 core tests.
- 28/28 isolated PostgreSQL ledger tests, including buy → partial sell → full
  close, conservation of cash/basis, fees, duplicates, global liquidity usage,
  kill switch, expiration, stale/future/misaligned data and auth isolation.
- New API, server and component render tests pass; focused lint is clean.
- Production Webpack build and TypeScript pass locally. Local default Turbopack
  encountered a sandbox bind restriction; remote production build is a separate
  release check, not assumed successful from the local Webpack result.

Synthetic tests do not prove a production fill. No production account or order
was created to claim success, and no current price was inserted into old history.

## Remaining operational limitations

The original STX/USD timeout pause is resolved by the applied and deployed 0041
recovery. Its actual charge remains unknown and its one-credit maximum remains
reserved. An owner-authorized production BTC paper buy and full sell completed
on September 3. See `CRYPTO_TIMEOUT_RECOVERY_0041.md` for provider timestamps,
fill evidence and the deployment ID. Intermittent publication-write and archive
audit timeouts remain unresolved; a successful trade is not whole-system health.

The current batch matcher reads at most 100 oldest pending orders and starts
matches within a five-second budget. It is not yet a high-volume exchange simulator.
The one-minute collection may leave orders waiting when quotes miss the strict
fill freshness window; the UI explains waiting, expiry and price limits.

Legacy evidence remains excluded from performance claims even after its audit
finishes. The public `/crypto` feed has not been converted; the research and new
manual paper surfaces use CoinAPI. Crypto Agent execution remains off.

## Original 0040 production release verification (historical)

The following is the original release snapshot, not current collection status.
For the subsequent recovery and successful production lifecycle, see
`CRYPTO_TIMEOUT_RECOVERY_0041.md`.

Deployed and aliased to `https://gethtlabs.com`:
`dpl_FHziz8QE2SDUcWnXzyz74DktN7sA`, READY.
Deployment URL:
`https://headtap-labs-r3yrp1zji-nkzmhmtw4w-5153s-projects.vercel.app`.
The remote default Turbopack build, TypeScript and prerender all passed.

At `2026-09-03T03:53:19.094Z`, production is **33/37, not healthy**.
0040 is independently confirmed: `crypto_manual_paper_ledger` passes with zero
account/position/order/audit mismatches and no overdue orders. Accounts, orders
and fills are all zero; a production buy-to-sell lifecycle is NOT claimed.
Anonymous API access returns 401/private-no-store; the existing signed-in browser
successfully loads the new account invitation and saved markets. PEPE search
and exact Kraken selection update the ticket without a provider request.

The collector's scheduled paper matcher reports `ok:true`, `schemaReady:true`,
`processed:0`, `fills:0`, `providerRequests:0`. Small archive batches now commit:
the audited count increased from 20,000 to 23,500 of 199,859. An initial batch
timed out, so continued drain still needs verification; completion is not claimed.

The four remaining failures are `crypto_legacy_evidence_audit`,
`crypto_coinapi_collection`, `crypto_prox_observation_pipeline`, and
`crypto_multivenue_shadow_discovery`. The last two are blocked by the incomplete
legacy audit. CoinAPI remains paused on the one unknown-cost receipt: 142
reserved request credits, 140 reported, no new provider request since the pause.

No Git commit/reset was performed. Before release, the deployed-source comparison
confirmed all existing stock/scoring/Agent/iOS source already matched production;
the delta was the documented crypto implementation, linked navigation, health,
tests and batch repair. Existing unrelated working-tree changes were preserved.
