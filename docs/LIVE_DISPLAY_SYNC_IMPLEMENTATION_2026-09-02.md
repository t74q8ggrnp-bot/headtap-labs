# Shared current-price display — September 2, 2026

## Implemented locally, not deployed

One shared browser subscription per symbol/product owns the current price and its provider timestamp. Whenever a chart is mounted, its complete backend response owns both the price heading and the last candle/graph value. A bulk quote cannot advance that heading independently. The graph renders the very same candle closes; changing chart mode does not fetch another price. Price formatting is shared, including sub-dollar precision.

Selected chart frames refresh every five seconds; other quote lists batch every ten seconds. This is live-source polling, **not tick-by-tick WebSocket streaming**, and separate devices are not promised zero-latency simultaneity. Late/regressive responses, mismatched symbols, inconsistent candles, future timestamps and duplicate in-flight requests are guarded. Display-only Live status expires after 30 seconds, ages continuously, and is removed offline or on a fetch failure. Resume/focus triggers a fresh request. Last known data is retained with an age label.

Consumers updated: desktop/mobile Spot Momentum and Before The Crowd, mobile detail, shared charts, scanners, watchlist price/change values, contender price changes, selected-stock modal, Paper Trading selected header/ticket/estimate, and crypto heroes/contenders/radar. Canonical scores and decision-time evidence remain unchanged. Historical entry/fill/discovery prices, account P&L marks and modeled levels are not overwritten with current trades. The actual native iOS bundle still needs syncing and device verification.

## Crypto source coverage

The existing server `POLYGON_API_KEY` successfully accessed upgraded Massive crypto snapshots and minute aggregates; a separate optional `MASSIVE_CRYPTO_API_KEY` is supported. No secret was printed or installed. The live full snapshot returned 415 instruments, including 391 USD pairs, during this check. This is one response's active coverage, not a promise of all listings.

Supported pairs use Massive consolidated USD trades and minute candles. SKR returned 404 from Massive but a Coinbase SKR-USD quote only two seconds old. To avoid removing existing coverage, a confirmed unsupported pair retains the existing Coinbase USD source with explicit labeling. Its five-minute candles are advanced by the same verified latest trade shown in the heading. Massive timeouts, authorization failures and rate limits do **not** trigger provider substitution. Unsupported quote-list pairs use clearly attributed Coinbase trade data, not invented prices or Massive approval requirements.

This does not replace the crypto scoring/research collectors, exchange-listing metadata, multi-venue evidence or ProX inputs. A consolidated price is not independent exchange confirmation. Provider/venue selection is explicit; a future streaming service must preserve that identity throughout each chart session.

## Verification

- Automated regression tests cover atomic price/candle updates, batching, late responses, future/invalid timestamps, provider-age expiry, disconnect/recovery, five-minute legacy coverage, format precision and crypto identity.
- Full application suite: 183/183 passing. TypeScript and production build passed. Initial sandbox build could not open a required local process port; the permitted full build passed. Focused lint passed after correcting the chart interval dependency.
- Read-only local API checks: AAPL and BTC returned matching `displayQuote.price`, last candle close and summary close, with current provider timestamps. SKR fallback returned matching live trade/last candle close with Coinbase attribution.
- Browser fixture exercised duplicated AAPL views plus BTC and SKR charts at desktop and 390×844. All matching DOM price/timestamp attributes agreed before/after graph/candle toggles; mobile width had no horizontal overflow. Prices advanced in successive observations. The temporary fixture was removed.
- Full authenticated Paper UI and native-device testing were not performed. Local Canonical endpoints lack service credentials, so real stock-card integration was checked through the shared component fixture, not a falsely green local system-health claim. No orders were placed, no production state was changed, and no commit/deployment was performed.

## Next infrastructure decision

For Robinhood-like continuous movement, use an always-on server market-data subscriber with reconnect/resubscribe, heartbeat, event ordering, gap repair and one normalized downstream stream. Never expose paid provider keys to browser clients. Compare exact current HT crypto pairs against provider *live* inventories (not total historical symbol counts), and verify display rights and streaming usage cost before buying another subscription. No single provider has been verified here to cover every crypto asset live.
