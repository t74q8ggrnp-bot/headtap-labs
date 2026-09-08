# Live display synchronization audit — September 2, 2026

## Verdict

Not ready for an app-wide synchronization sign-off. Massive's live stock feed is working, but individual presentation paths do not all consume the same latest quote and provider timestamp. A green system-health response currently does not prove every displayed price, chart, or ProX observation is synchronized.

This was an audit only. No scoring, risk policy, order execution, production data, or application implementation was changed. Existing uncommitted work was preserved.

## Verified live evidence

Production quote and chart requests at approximately 3:48 PM Eastern returned:

| Symbol | Quote price | Latest candle close | Shared price-event time (ET) |
| --- | ---: | ---: | --- |
| VIOT | 1.8001 | 1.8001 | 3:48:23.488 PM |
| LOCL | 1.19 | 1.19 | 3:48:19.038 PM |
| GBTG | 9.485 | 9.485 | 3:48:25.069 PM |

In all three samples the chart's `displayQuote.asOf` also matched the quote endpoint's `asOf`. The candle's `time` was 3:48:00 PM because that identifies the start of its one-minute interval, not the time of the latest trade. This difference is valid and must not be fixed by rewriting timestamps.

The production homepage was inspected in desktop and 390×844 mobile layouts. Both rendered provider-backed stock candles and Eastern time labels. The mobile graph/candle toggle was exercised successfully in both directions. This was responsive browser testing, not testing a physical iPhone or its installed native build. Paper account UI was not tested through an authenticated user session.

Sixteen existing tests passed across market-chart, market-data-time, canonical-decision-frame, and runtime-capabilities suites. These tests cover current contracts, not every missing cross-view synchronization behavior listed below. No full-build claim is made for this audit.

## Remaining display gaps

1. **Paper Trading has independent price clocks.** `app/components/paper/PaperTradingDashboard.tsx` refreshes its selected instrument every 10 seconds, while `HeroPriceChart` refreshes stocks every 5 seconds. The chart's quote callback is not connected to the paper header/ticket. Account state refreshes every 20 seconds. The displayed quote-age value comes from the last instrument response and does not continuously age on screen. Any remediation must preserve backend order validation and distinguish a last trade from bid/ask execution estimates.

2. **Mobile detail is not connected to chart prices.** `app/components/opportunity/MobileCardDetail.tsx` shows the opportunity's stored price/change/live flag, but its chart independently refreshes without `onQuoteUpdate`. It also rounds all header prices to two decimals. Main mobile Spot Momentum and Before The Crowd cards do use the callback; not every mobile surface does.

3. **Crypto prices and candles have different update paths.** The crypto opportunity feed refreshes every 60 seconds and may serve a still-valid stored decision frame. Its chart separately reads Coinbase five-minute candles every 60 seconds and returns no shared `displayQuote`. At approximately 3:55 PM, the EGLD chart returned a 3:50 PM candle with close 4.6592; the earlier rendered hero price was 4.62. These observations are not a simultaneous price comparison, but the independently timed data paths are confirmed in code. Cross-venue prices also require explicit venue/product identity.

4. **Other views retain decision-time prices.** Scanner rows poll opportunity frames every 30 seconds rather than following the selected chart. `app/HomeClient.tsx` derives its section update label from the opportunity frame, independently of the chart quote. Scanner's last-updated label is browser receipt time, not provider event time. A user can therefore see different prices or timestamps for the same symbol without a clear explanation.

5. **“Live” does not currently mean only seconds old.** `lib/market-data-time.ts` permits active market timestamps up to five minutes old, and the stock quote/chart live flags use this acceptance window. A quiet stock may legitimately have no newer last trade, but it should show its actual last-trade age rather than imply a new trade occurred. Existing data-quality policy and user-facing live labeling should be separated, not silently change ranking gates.

6. **Late responses and resume behavior need protection.** Chart refreshes lack a provider-time monotonic guard or in-flight exclusion; a slow older response can replace a newer result for the same symbol. Paper instrument lookups similarly lack request sequencing. The inspected polling hooks have no immediate focus/visibility-resume refresh or continuously evaluated display-expiry mechanism. Browser/mobile suspension can therefore prolong old display state.

7. **Some apparent percentage discrepancies are different baselines.** The chart's move is calculated from the first displayed bar's open. The ticker's daily change uses a previous-close reference. For example, mobile GELS showed a positive daily change alongside a slightly negative chart move. That is not by itself incorrect arithmetic or delayed data; the labels need to explain the different reference points.

## ProX status and limits of this audit

- At approximately 3:46 PM, five of six sampled Canonical/ProX timing pairs exceeded the two-minute alignment allowance. LOCL's embedded ProX market timestamp lagged its Canonical price by approximately 49 minutes. The documented conservative fallback removed ProX support authority; the health check intentionally accepted that fallback. This was not proof that all evidence was aligned.
- At 3:55 PM, production health again returned `ok: true`; all six then-selected timing pairs were aligned, with skews of 6–80 seconds. Therefore the observed alignment problem is intermittent, not universal or continuously broken.
- Operational checks showed independent discovery scanning 13,157 snapshots, persisting 300 research candidates, and deeply evaluating 30 board candidates, with three selected and zero forbidden scoring inputs in the sampled board. The sampled microstructure collection covered 20 symbols. Live data does not mean every discovered symbol receives equally fresh deep research.
- The shadow outcome check still reported roughly 190,000 retry-pending outcome records, despite zero terminal-overdue records. “Healthy and retrying” is different from “fully measured.”
- Protected independent comparison/scorecard endpoints returned 401 with the available local authorization. No credentials were extracted or authorization bypassed. This audit cannot provide a verified recent independent-ProX win rate, incremental return, or readiness-to-take-over claim.

## Recommended repair boundary

Use one versioned, symbol/venue-keyed backend market view containing the latest trade, its provider timestamp, chart bars/current candle, and separate bid/ask timestamps. Feed every matching live-price presentation from that view. Reject regressive responses, refresh immediately on resume, and visibly age retained data. Keep historical discovery prices, completed candles, order fills, and decision-time scoring evidence immutable and explicitly labeled.

Canonical remains the ranking authority; ProX research and paper-order gates retain their existing boundaries. Do not force different historical timestamps to be identical or fabricate activity for quiet/closed markets. Independently connected devices cannot be promised zero-latency simultaneity; they can share source events and meet an explicitly tested freshness/lag target.

Before sign-off, add cross-view tests covering the same symbol in stock heroes, detail views, scanner, crypto and paper UI; graph/candle equivalence; late responses; offline/resume; no-new-trade and closed-market cases; and desktop/mobile rendering. Verify the actual native build separately.
