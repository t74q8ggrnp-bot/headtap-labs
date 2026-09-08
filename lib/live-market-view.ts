import type { MarketChartDisplayQuote, MarketChartResponse } from "./market-chart.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getStockMarketClock, stockHistoryLabel } from "./stock-market-session.ts";

// Presentation freshness only. Never use these limits for scoring or orders.
export const DISPLAY_LIVE_MAX_AGE_MS = 30_000;
export const DISPLAY_TRANSPORT_MAX_AGE_MS = 30_000;
export const DISPLAY_FUTURE_TOLERANCE_MS = 2_000;
export type MarketViewKey = `stock:${string}` | `crypto:${string}`;
export type MarketView = {
  quote: MarketChartDisplayQuote | null;
  chart: MarketChartResponse | null;
  receivedAt: number;
  error: boolean;
};
export const EMPTY_MARKET_VIEW: MarketView = Object.freeze({ quote: null, chart: null, receivedAt: 0, error: false });

export function marketViewKey(asset: "stock" | "crypto", symbol: string, productId?: string): MarketViewKey {
  return `${asset}:${(asset === "crypto" ? productId ?? "" : symbol).trim().toUpperCase()}`;
}

export function validDisplayQuote(quote: MarketChartDisplayQuote | null | undefined, now: number): quote is MarketChartDisplayQuote {
  return Boolean(quote && Number.isFinite(quote.price) && quote.price > 0 &&
    Number.isFinite(Date.parse(quote.asOf)) && Date.parse(quote.asOf) <= now + DISPLAY_FUTURE_TOLERANCE_MS &&
    (quote.changePercent === null || Number.isFinite(quote.changePercent)));
}

export function displayQuoteIsLive(view: MarketView, now: number, asset: "stock" | "crypto" = "stock"): boolean {
  // This can only downgrade a server's Live flag. It cannot make a stale quote
  // live or change its price/time. Crypto deliberately has no stock-session gate.
  return (asset === "crypto" || getStockMarketClock(new Date(now)).active) &&
    !view.error && validDisplayQuote(view.quote, now) && view.quote.live && view.quote.priceKind !== "minute_aggregate" &&
    now - Date.parse(view.quote.asOf) <= DISPLAY_LIVE_MAX_AGE_MS &&
    now - view.receivedAt <= DISPLAY_TRANSPORT_MAX_AGE_MS;
}

export function displayQuoteLabel(view: MarketView, now: number, asset: "stock" | "crypto" = "stock"): string {
  if (!view.quote) return "Awaiting verified quote";
  const age = Math.max(0, Math.floor((now - Date.parse(view.quote.asOf)) / 1_000));
  const elapsed = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
  const stockLabel = asset === "stock" ? stockHistoryLabel(view.quote.asOf, new Date(now)) : null;
  const prefix = stockLabel?.startsWith("Last session") ? `${stockLabel} · `
    : view.quote.priceKind === "minute_aggregate" ? "Last minute bar · "
      : displayQuoteIsLive(view, now, asset) ? "Live · " : "Last trade · ";
  return `${prefix}${elapsed} ago${view.error ? " · reconnecting" : ""}`;
}

type Transport = {
  now: () => number;
  chart: (key: MarketViewKey) => Promise<MarketChartResponse>;
  quotes: (symbols: string[]) => Promise<Record<string, MarketChartDisplayQuote>>;
  cryptoQuotes?: (products: string[]) => Promise<Record<string, MarketChartDisplayQuote>>;
};

/** Shared read-only display state. A chart subscription owns the quote and bars
 * atomically; a bulk quote can never advance its header without its candle. */
export class LiveMarketViews {
  private views = new Map<MarketViewKey, MarketView>();
  private listeners = new Map<MarketViewKey, Map<() => void, boolean>>();
  private inFlight = new Set<MarketViewKey>();
  private attemptedAt = new Map<MarketViewKey, number>();
  private readonly transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }

  get(key: MarketViewKey) { return this.views.get(key) ?? EMPTY_MARKET_VIEW; }
  subscribe(key: MarketViewKey, listener: () => void, chart: boolean) {
    const listeners = this.listeners.get(key) ?? new Map();
    listeners.set(listener, chart);
    this.listeners.set(key, listeners);
    if (chart && !this.get(key).chart) this.attemptedAt.delete(key);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  private wantsChart(key: MarketViewKey) {
    return [...(this.listeners.get(key)?.values() ?? [])].some(Boolean);
  }
  private publish(key: MarketViewKey, value: MarketView) {
    this.views.set(key, value);
    for (const listener of this.listeners.get(key)?.keys() ?? []) listener();
  }
  acceptQuote(key: MarketViewKey, quote: MarketChartDisplayQuote) {
    // Chart-owning entries only accept a complete matching frame.
    if (this.wantsChart(key) || !validDisplayQuote(quote, this.transport.now())) return false;
    const previous = this.get(key);
    if (previous.quote && Date.parse(quote.asOf) < Date.parse(previous.quote.asOf)) return false;
    this.publish(key, { quote, chart: null, receivedAt: this.transport.now(), error: false });
    return true;
  }
  acceptChart(key: MarketViewKey, chart: MarketChartResponse) {
    if (marketViewKey(chart.asset, chart.symbol, chart.productId) !== key) return false;
    const previous = this.get(key);
    const quote = chart.displayQuote;
    const last = chart.bars.at(-1);
    if (chart.success !== true || !last || !validDisplayQuote(quote, this.transport.now()) || last.close !== quote.price) return false;
    const interval = chart.intervalSeconds ?? 60;
    if (interval !== 60 && interval !== 300) return false;
    const quoteBucket = Math.floor(Date.parse(quote.asOf) / (interval * 1_000)) * interval;
    if (quoteBucket !== last.time || chart.summary.close !== quote.price) return false;
    if (chart.bars.some((bar, index) => ![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
      Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 || bar.volume < 0 ||
      bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) ||
      (index > 0 && bar.time <= chart.bars[index - 1].time))) return false;
    if (previous.quote && Date.parse(quote.asOf) < Date.parse(previous.quote.asOf)) return false;
    if (previous.chart && last.time < previous.chart.bars.at(-1)!.time) return false;
    this.publish(key, { quote, chart, receivedAt: this.transport.now(), error: false });
    return true;
  }
  private fail(key: MarketViewKey) {
    this.publish(key, { ...this.get(key), error: true });
  }
  async poll(force = false) {
    const now = this.transport.now();
    const pending = [...this.listeners.keys()].filter(key => !this.inFlight.has(key) &&
      (force || now - (this.attemptedAt.get(key) ?? -Infinity) >= (this.wantsChart(key) ? 5_000 : 10_000)));
    for (const key of pending) { this.inFlight.add(key); this.attemptedAt.set(key, now); }
    const chartKeys = pending.filter(key => this.wantsChart(key));
    const quoteKeys = pending.filter(key => !this.wantsChart(key));
    await Promise.all([
      ...chartKeys.map(async key => {
        try { if (!this.acceptChart(key, await this.transport.chart(key))) this.fail(key); }
        catch { this.fail(key); }
        finally { this.inFlight.delete(key); }
      }),
      ...[false, true].map(crypto => quoteKeys.filter(key => key.startsWith(crypto ? "crypto:" : "stock:")))
        .filter(keys => keys.length).map(keys => this.pollQuotes(keys)),
    ]);
    // Bound retained display state without evicting active subscriptions.
    for (const [key, view] of this.views) {
      if (!this.listeners.has(key) && !this.inFlight.has(key) && now - view.receivedAt > 600_000) {
        this.views.delete(key); this.attemptedAt.delete(key);
      }
    }
  }
  private async pollQuotes(keys: MarketViewKey[]) {
    try {
      for (let offset = 0; offset < keys.length; offset += 250) {
        const batch = keys.slice(offset, offset + 250);
        const crypto = batch[0].startsWith("crypto:");
        const prefix = crypto ? 7 : 6;
        const transport = crypto ? this.transport.cryptoQuotes : this.transport.quotes;
        if (!transport) throw new Error("Quote transport unavailable");
        const quotes = await transport(batch.map(key => key.slice(prefix)));
        for (const key of batch) {
          // A chart may have mounted while this batch was in flight.
          if (this.wantsChart(key)) { this.attemptedAt.delete(key); continue; }
          const quote = quotes[key.slice(prefix)];
          if (!quote || !this.acceptQuote(key, quote)) this.fail(key);
        }
      }
    } catch { for (const key of keys) if (!this.wantsChart(key)) this.fail(key); }
    finally { for (const key of keys) this.inFlight.delete(key); }
  }
}
