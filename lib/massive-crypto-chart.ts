// @ts-expect-error Node's strip-types test runner resolves the source extension.
import { mergeVerifiedTradeIntoBars, normalizeMarketBars } from "./market-chart.ts";
import type { MarketChartDisplayQuote } from "./market-chart.ts";
// @ts-expect-error Node's strip-types test runner resolves the source extension.
import { DISPLAY_LIVE_MAX_AGE_MS } from "./live-market-view.ts";

export type CryptoSnapshot = { ticker?: { ticker?: string; lastTrade?: { p?: number; t?: number } } };
export type CryptoAggregates = { ticker?: string; results?: { t?: number; o?: number; h?: number; l?: number; c?: number; v?: number }[] };

/** Consolidated market facts only; never an exchange listing or a scoring input. */
export function buildMassiveCryptoChart(symbol: string, snapshot: CryptoSnapshot, aggregate: CryptoAggregates, now: number) {
  const ticker = `X:${symbol}USD`;
  if (snapshot.ticker?.ticker !== ticker || aggregate.ticker !== ticker) throw new Error("Massive crypto identity mismatch.");
  const bars = normalizeMarketBars((Array.isArray(aggregate.results) ? aggregate.results : []).map(bar =>
    ({ time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v })), 12)
    .filter(bar => bar.time * 1_000 <= now + 2_000 && bar.time * 1_000 >= now - 86_460_000);
  const trade = snapshot.ticker.lastTrade;
  const timestamp = Number(trade?.t);
  const price = Number(trade?.p);
  // Snapshot crypto times are milliseconds. Reject nanoseconds/seconds/future
  // values rather than substituting request time and falsely calling them live.
  const tradeValid = Number.isFinite(timestamp) && timestamp >= now - 86_400_000 && timestamp <= now + 2_000 &&
    Number.isFinite(price) && price > 0;
  const merged = mergeVerifiedTradeIntoBars(bars, tradeValid ? {
    price, size: null, timestamp: new Date(timestamp).toISOString(),
  } : null, 60, 12);
  const last = merged.at(-1);
  if (!last || merged.length < 2) throw new Error("Massive crypto candles unavailable.");
  const isTrade = tradeValid && last.close === Number(price.toFixed(12)) && Math.floor(timestamp / 60_000) * 60 === last.time;
  const asOf = new Date(isTrade ? timestamp : last.time * 1_000).toISOString();
  const baseline = merged[0].open;
  const displayQuote: MarketChartDisplayQuote = {
    price: last.close,
    changePercent: baseline > 0 ? (last.close / baseline - 1) * 100 : null,
    changeBasis: "chart_open",
    asOf,
    live: isTrade && now - timestamp <= DISPLAY_LIVE_MAX_AGE_MS,
    source: isTrade ? "massive_crypto_trade" : "massive_crypto_aggregate",
  };
  return { bars: merged, displayQuote };
}
