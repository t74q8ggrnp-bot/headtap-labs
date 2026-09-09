import type { MarketChartDisplayQuote, MarketChartResponse } from "./market-chart.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { marketChartBootstrapRetryDelay, marketChartHistoryLabel, marketChartPollingState, marketChartFailureBackoffMs, MarketChartHttpError } from "./market-chart-polling.ts";

// Presentation freshness only. Never use these limits for scoring or orders.
export const DISPLAY_LIVE_MAX_AGE_MS = 30_000;
export const DISPLAY_TRANSPORT_MAX_AGE_MS = 30_000;
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

export function validDisplayQuote(
  quote: MarketChartDisplayQuote | null | undefined,
  _deviceNow?: number,
): quote is MarketChartDisplayQuote {
  void _deviceNow;
  // Provider-vs-server time is validated at the API/transport boundary. A
  // client device clock must never reject a database-selected shared frame.
  return Boolean(quote && Number.isFinite(quote.price) && quote.price > 0 &&
    Number.isFinite(Date.parse(quote.asOf)) &&
    (quote.changePercent === null || Number.isFinite(quote.changePercent)));
}

export function displayQuoteIsLive(view: MarketView, now: number, asset: "stock" | "crypto" = "stock"): boolean {
  // This can only downgrade a server's Live flag. It cannot make a stale quote
  // live or change its price/time. Crypto deliberately has no stock-session gate.
  const transportAge = now - view.receivedAt;
  return (asset === "crypto" || marketChartPollingState(new Date(now), "extended").active) &&
    !view.error && validDisplayQuote(view.quote) && view.quote.live && view.quote.priceKind !== "minute_aggregate" &&
    transportAge >= -2_000 && transportAge <= DISPLAY_TRANSPORT_MAX_AGE_MS;
}

export function displayQuoteLabel(view: MarketView, now: number, asset: "stock" | "crypto" = "stock"): string {
  if (!view.quote) return "Awaiting verified quote";
  // A server-verified Live receipt ages by local elapsed transport time so a
  // skewed device clock cannot disagree with another client about freshness.
  // Retained/non-live history still shows the immutable provider timestamp.
  const ageMs = view.quote.live
    ? now - view.receivedAt
    : now - Date.parse(view.quote.asOf);
  const age = Math.max(0, Math.floor(ageMs / 1_000));
  const elapsed = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
  const stockLabel = asset === "stock" ? marketChartHistoryLabel(view.quote.asOf, new Date(now)) : null;
  const prefix = stockLabel?.startsWith("Last session") ? `${stockLabel} · `
    : view.quote.priceKind === "minute_aggregate" ? "Last minute bar · "
      : displayQuoteIsLive(view, now, asset) ? "Live · " : "Last trade · ";
  return `${prefix}${elapsed} ago${view.error ? " · reconnecting" : ""}`;
}

type Transport = {
  now: () => number;
  chart: (key: MarketViewKey) => Promise<MarketChartResponse>;
  /** Optional incremental stock transport. Legacy tests/crypto remain on the
   * bootstrap transport; production stock chart consumers use deltas. */
  chartDelta?: (
    key: MarketViewKey,
    current: MarketChartResponse,
  ) => Promise<MarketChartResponse>;
  quotes: (symbols: string[]) => Promise<Record<string, MarketChartDisplayQuote>>;
  cryptoQuotes?: (products: string[]) => Promise<Record<string, MarketChartDisplayQuote>>;
  random?: () => number;
};

/** Shared read-only display state. A chart subscription owns the quote and bars
 * atomically; a bulk quote can never advance its header without its candle. */
export class LiveMarketViews {
  private views = new Map<MarketViewKey, MarketView>();
  private listeners = new Map<MarketViewKey, Map<() => void, boolean>>();
  private inFlight = new Set<MarketViewKey>();
  private attemptedAt = new Map<MarketViewKey, number>();
  private retryNotBefore = new Map<MarketViewKey, number>();
  private failureAttempts = new Map<MarketViewKey, number>();
  private readonly transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }

  get(key: MarketViewKey) { return this.views.get(key) ?? EMPTY_MARKET_VIEW; }
  subscribe(key: MarketViewKey, listener: () => void, chart: boolean) {
    const listeners = this.listeners.get(key) ?? new Map();
    listeners.set(listener, chart);
    this.listeners.set(key, listeners);
    if (chart && !this.get(key).chart) {
      this.attemptedAt.delete(key);
      this.retryNotBefore.delete(key);
      this.failureAttempts.delete(key);
    }
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
    if (previous.quote) {
      const nextAsOf = Date.parse(quote.asOf);
      const previousAsOf = Date.parse(previous.quote.asOf);
      if (nextAsOf < previousAsOf) return false;
      if (nextAsOf === previousAsOf) {
        if (quote.price !== previous.quote.price) return false;
        if (previous.quote.live && !quote.live) {
          this.publish(key, {
            ...previous,
            quote: { ...previous.quote, live: false },
            error: false,
          });
        }
        // An unchanged provider frame is successful evidence, but it cannot
        // renew freshness merely because another HTTP response arrived.
        return true;
      }
    }
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
    if (previous.quote) {
      const nextAsOf = Date.parse(quote.asOf);
      const previousAsOf = Date.parse(previous.quote.asOf);
      if (nextAsOf < previousAsOf) return false;
      if (nextAsOf === previousAsOf) {
        if (quote.price !== previous.quote.price) return false;
        if (previous.quote.live && !quote.live) {
          this.publish(key, {
            quote: { ...previous.quote, live: false },
            chart: previous.chart
              ? {
                  ...previous.chart,
                  displayQuote: {
                    ...previous.quote,
                    live: false,
                  },
                }
              : previous.chart,
            receivedAt: previous.receivedAt,
            error: false,
          });
        }
        return true;
      }
    }
    if (previous.chart && last.time < previous.chart.bars.at(-1)!.time) return false;
    this.publish(key, { quote, chart, receivedAt: this.transport.now(), error: false });
    return true;
  }
  private fail(key: MarketViewKey) {
    this.publish(key, { ...this.get(key), error: true });
  }
  private cadence(key: MarketViewKey) {
    return key.startsWith("stock:") || this.wantsChart(key) ? 5_000 : 10_000;
  }
  private succeeded(key: MarketViewKey) {
    this.failureAttempts.delete(key);
    this.retryNotBefore.set(key, this.transport.now() + this.cadence(key));
  }
  private failed(key: MarketViewKey, error: unknown) {
    this.fail(key);
    const attempt = (this.failureAttempts.get(key) ?? 0) + 1;
    this.failureAttempts.set(key, attempt);
    const now = this.transport.now();
    const backoffMs = marketChartFailureBackoffMs({
      attempt,
      baseMs: this.cadence(key),
      retryAfterMs: error instanceof MarketChartHttpError
        ? error.retryAfterMs
        : null,
      random: this.transport.random,
    });
    const retryDelay = key.startsWith("stock:") && !this.get(key).chart
      ? marketChartBootstrapRetryDelay({
          now: new Date(now),
          sessionScope: "extended",
          backoffMs,
        })
      : backoffMs;
    this.retryNotBefore.set(key, now + retryDelay);
  }
  async poll(force = false) {
    const now = this.transport.now();
    const pending = [...this.listeners.keys()].filter(key => {
      if (this.inFlight.has(key)) return false;
      if ((this.retryNotBefore.get(key) ?? 0) > now) return false;
      if (
        key.startsWith("stock:") &&
        !marketChartPollingState(new Date(now), "extended").active &&
        this.attemptedAt.has(key) &&
        Boolean(this.get(key).quote || this.get(key).chart)
      ) {
        // One initial request may load the last verified quote or chart. Once
        // retained provider evidence exists, closed-session ticks/focus events
        // are local clock checks only and spend zero provider requests. A
        // failed first request is retried at the bounded inactive cadence.
        return false;
      }
      if (force) return true;
      const cadence = this.cadence(key);
      const previous = this.attemptedAt.get(key);
      // Stock clients follow the same wall-clock presentation buckets. This
      // prevents desktop and mobile from permanently polling five seconds out
      // of phase merely because their screens mounted at different moments.
      return previous === undefined || Math.floor(now / cadence) > Math.floor(previous / cadence);
    });
    for (const key of pending) { this.inFlight.add(key); this.attemptedAt.set(key, now); }
    const chartKeys = pending.filter(key => this.wantsChart(key));
    const quoteKeys = pending.filter(key => !this.wantsChart(key));
    await Promise.all([
      ...chartKeys.map(async key => {
        try {
          const current = this.get(key).chart;
          const loader = key.startsWith("stock:") && current && this.transport.chartDelta
            ? this.transport.chartDelta(key, current)
            : this.transport.chart(key);
          if (this.acceptChart(key, await loader)) this.succeeded(key);
          else this.failed(key, new Error("Market view contract mismatch."));
        }
        catch (error) { this.failed(key, error); }
        finally { this.inFlight.delete(key); }
      }),
      ...[false, true].map(crypto => quoteKeys.filter(key => key.startsWith(crypto ? "crypto:" : "stock:")))
        .filter(keys => keys.length).map(keys => this.pollQuotes(keys)),
    ]);
    // Bound retained display state without evicting active subscriptions.
    for (const [key, view] of this.views) {
      if (!this.listeners.has(key) && !this.inFlight.has(key) && now - view.receivedAt > 600_000) {
        this.views.delete(key); this.attemptedAt.delete(key);
        this.retryNotBefore.delete(key); this.failureAttempts.delete(key);
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
          if (quote && this.acceptQuote(key, quote)) this.succeeded(key);
          else this.failed(key, new Error("Quote contract mismatch."));
        }
      }
    } catch (error) {
      for (const key of keys) {
        if (!this.wantsChart(key)) this.failed(key, error);
      }
    }
    finally { for (const key of keys) this.inFlight.delete(key); }
  }
}
