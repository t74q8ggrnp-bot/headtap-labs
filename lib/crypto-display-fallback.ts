import "server-only";
import { mergeVerifiedTradeIntoBars, normalizeMarketBars, type MarketChartDisplayQuote } from "@/lib/market-chart";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";

// Preserve coverage of existing Coinbase USD listings that Massive explicitly
// does not carry. Never invoke on Massive timeouts, authorization or rate limits.
async function coinbase(product: string, resource: "ticker" | "candles") {
  if (!/^[A-Z0-9]{1,20}-USD$/.test(product)) throw new Error("Invalid USD product");
  const response = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/${resource}${resource === "candles" ? "?granularity=300" : ""}`, {
    cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Verified exchange data unavailable");
  return response.json();
}
export async function fetchCoverageFallbackQuote(product: string): Promise<MarketChartDisplayQuote> {
  const trade = await coinbase(product, "ticker");
  const price = Number(trade.price);
  const timestamp = Date.parse(trade.time);
  if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(timestamp) || timestamp > Date.now() + 2_000) throw Error("Invalid exchange trade");
  return { price, asOf: new Date(timestamp).toISOString(), changePercent: null,
    source: "coinbase_crypto_trade", live: Date.now() - timestamp <= DISPLAY_LIVE_MAX_AGE_MS };
}
export async function fetchCoverageFallbackChart(product: string) {
  const [raw, quote] = await Promise.all([coinbase(product, "candles"), fetchCoverageFallbackQuote(product)]);
  const bars = normalizeMarketBars((Array.isArray(raw) ? raw : []).map((b: number[]) =>
    ({ time: b[0], low: b[1], high: b[2], open: b[3], close: b[4], volume: b[5] })), 12)
    .filter(bar => bar.time * 1000 >= Date.now() - 86_700_000 && bar.time * 1000 <= Date.now() + 2_000);
  const merged = mergeVerifiedTradeIntoBars(bars, { price: quote.price, size: null, timestamp: quote.asOf }, 300, 12);
  const last = merged.at(-1);
  if (!last || merged.length < 2) throw Error("Exchange candles unavailable");
  const tradeMatches = last.close === Number(quote.price.toFixed(12)) && last.time === Math.floor(Date.parse(quote.asOf) / 300_000) * 300;
  const displayQuote: MarketChartDisplayQuote = { ...quote, price: last.close,
    asOf: tradeMatches ? quote.asOf : new Date(last.time * 1000).toISOString(),
    live: tradeMatches && quote.live, source: tradeMatches ? "coinbase_crypto_trade" : "coinbase_crypto_aggregate",
    changePercent: (last.close / merged[0].open - 1) * 100, changeBasis: "chart_open" };
  return { bars: merged, displayQuote, intervalSeconds: 300, sourceLabel: "Coinbase USD · 5-minute candles · Massive pair unavailable" };
}
