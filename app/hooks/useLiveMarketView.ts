"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { MarketChartDisplayQuote, MarketChartResponse } from "@/lib/market-chart";
import { LiveMarketViews, EMPTY_MARKET_VIEW, displayQuoteIsLive, displayQuoteLabel, marketViewKey } from "@/lib/live-market-view";
import {
  marketChartFeedFrameFromBootstrap,
  mergeMarketChartFeedDelta,
  validCurrentMarketChartFrame,
  validMarketChartBootstrapResponse,
  validMarketChartDeltaResponse,
  type MarketChartBootstrapResponse,
} from "@/lib/market-chart-feed";
import {
  createServerAnchoredClock,
  MarketChartHttpError,
  marketChartRolloverBootstrapDelay,
  marketChartSessionRolloverRequired,
  parseRetryAfterMs,
} from "@/lib/market-chart-polling";

const marketServerClock = createServerAnchoredClock();
const trustedNow = () => marketServerClock.now();

function acceptResponseClock(response: Response) {
  marketServerClock.accept(response.headers.get("Date"));
}

async function marketViewResponseError(response: Response, message: string) {
  throw new MarketChartHttpError(
    `${message} (${response.status}).`,
    response.status,
    parseRetryAfterMs(response.headers.get("Retry-After"), trustedNow()),
  );
}

async function loadMarketViewChart(key: `stock:${string}` | `crypto:${string}`) {
  const asset = key.startsWith("stock:") ? "stock" : "crypto";
  const id = key.slice(key.indexOf(":") + 1);
  const params = new URLSearchParams({ asset, symbol: asset === "stock" ? id : id.replace(/-USD$/, "") });
  if (asset === "crypto") params.set("productId", id);
  const response = await fetch(`/api/market-chart?${params}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  acceptResponseClock(response);
  if (!response.ok) await marketViewResponseError(response, "Market view unavailable");
  const body = await response.json() as MarketChartResponse;
  if (body.success !== true) throw new Error("Market view unavailable");
  if (
    asset === "stock" &&
    !validMarketChartBootstrapResponse(body, {
      asset: "stock",
      symbol: id,
      sessionScope: "extended",
    })
  ) {
    throw new Error("Market view bootstrap contract mismatch.");
  }
  if (asset === "stock") {
    const bootstrap = body as MarketChartBootstrapResponse;
    marketServerClock.accept(bootstrap.instrumentation.responseCompletedAt);
    if (marketChartSessionRolloverRequired({
      displayedSessionDate: bootstrap.sessionAuthority.displayedSessionDate,
      now: new Date(trustedNow()),
      sessionScope: bootstrap.sessionAuthority.sessionScope,
    })) {
      rolloverBootstrapAt.set(key, trustedNow());
    } else {
      rolloverBootstrapAt.delete(key);
    }
  }
  return body;
}

const rolloverBootstrapAt = new Map<string, number>();

async function loadRolloverBootstrap(
  key: `stock:${string}`,
  current: MarketChartBootstrapResponse,
) {
  const now = trustedNow();
  const previousAttempt = rolloverBootstrapAt.get(key) ?? 0;
  const retryDelay = marketChartRolloverBootstrapDelay(previousAttempt, now);
  if (retryDelay > 0) {
    throw new MarketChartHttpError(
      "Waiting for current-session provider evidence.",
      409,
      retryDelay,
    );
  }
  rolloverBootstrapAt.set(key, now);
  const bootstrap = await loadMarketViewChart(key) as MarketChartBootstrapResponse;
  if (!marketChartSessionRolloverRequired({
    displayedSessionDate: bootstrap.sessionAuthority.displayedSessionDate,
    now: new Date(trustedNow()),
    sessionScope: current.sessionAuthority.sessionScope,
  })) {
    rolloverBootstrapAt.delete(key);
  }
  return bootstrap;
}

const store = new LiveMarketViews({
  now: trustedNow,
  cryptoQuotes: async products => {
    const response = await fetch("/api/crypto/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ products }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    acceptResponseClock(response);
    if (!response.ok) throw new Error("Crypto quotes unavailable");
    return (await response.json()).quotes;
  },
  chart: async key => {
    return loadMarketViewChart(key);
  },
  chartDelta: async (key, current) => {
    if (!key.startsWith("stock:")) return loadMarketViewChart(key);
    const stockKey = key as `stock:${string}`;
    const symbol = key.slice("stock:".length);
    const bootstrap = current as MarketChartBootstrapResponse;
    const request = {
      asset: "stock" as const,
      symbol,
      sessionScope: "extended" as const,
      displayedSessionDate: bootstrap.sessionAuthority?.displayedSessionDate,
    };
    if (!validCurrentMarketChartFrame(bootstrap, request, trustedNow())) {
      return loadMarketViewChart(key);
    }
    const params = new URLSearchParams({
      symbol,
      sessionScope: "extended",
      sessionDate: bootstrap.sessionAuthority.displayedSessionDate,
    });
    const response = await fetch(`/api/market-chart/update?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    acceptResponseClock(response);
    if (response.status === 409 && response.headers.has("X-HT-Session-Rollover")) {
      return loadRolloverBootstrap(stockKey, bootstrap);
    }
    if (!response.ok) await marketViewResponseError(response, "Market view update unavailable");
    const delta: unknown = await response.json();
    if (!validMarketChartDeltaResponse(delta, request)) {
      throw new Error("Market view delta contract mismatch.");
    }
    if (delta.instrumentation) {
      marketServerClock.accept(delta.instrumentation.responseCompletedAt);
    }
    if (delta.sessionAuthority.reason === "outside_displayed_session") {
      return loadRolloverBootstrap(stockKey, bootstrap);
    }
    const merged = mergeMarketChartFeedDelta(
      marketChartFeedFrameFromBootstrap(bootstrap, trustedNow()),
      delta,
      trustedNow(),
    );
    // Keep the transport-neutral legacy chart shape while retaining enough
    // bootstrap metadata for the next delta. HeroPriceChart and its consumers
    // do not need to know whether polling or a future stream delivered it.
    return {
      ...merged.chart,
      feedVersion: "market-chart-feed-v1" as const,
      feedPhase: "bootstrap" as const,
      previousClose: merged.previousClose,
      sessionAuthority: merged.sessionAuthority,
      instrumentation: bootstrap.instrumentation,
    } as MarketChartBootstrapResponse;
  },
  quotes: async symbols => {
    const response = await fetch("/api/bulk-quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    acceptResponseClock(response);
    if (!response.ok) await marketViewResponseError(response, "Quotes unavailable");
    const body = await response.json();
    const result: Record<string, MarketChartDisplayQuote> = {};
    for (const [symbol, value] of Object.entries(body.quotes ?? {})) {
      const quote = value as { price: number; change: number; asOf: string; live?: boolean; priceKind?: "trade" | "minute_aggregate";
        source?: "massive_polygon_last_trade" | "massive_polygon_snapshot";
        displayFrame?: { id?: string; version?: "stock-display-frame-v1"; bucket?: number;
          coordination?: "database" | "instance_fallback";
          issue?: "not_configured" | "rpc_error" | "invalid_rpc_response" | "transport_error" } | null };
      result[symbol] = { price: quote.price, changePercent: quote.change, asOf: quote.asOf, live: quote.live === true,
        source: quote.source ?? "massive_polygon_snapshot", priceKind: quote.priceKind,
        frameId: quote.displayFrame?.id, frameVersion: quote.displayFrame?.version,
        frameBucket: quote.displayFrame?.bucket, frameCoordination: quote.displayFrame?.coordination,
        frameCoordinationIssue: quote.displayFrame?.issue };
    }
    return result;
  },
});

const clockListeners = new Set<() => void>();
let clock = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let kickoff: ReturnType<typeof setTimeout> | null = null;
function tick(force = false) {
  clock = trustedNow();
  for (const listener of clockListeners) listener();
  if (document.visibilityState !== "hidden" && navigator.onLine) void store.poll(force);
}
const resume = () => tick(true);
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!timer) {
    timer = setInterval(tick, 1_000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    document.addEventListener("visibilitychange", resume);
    kickoff = setTimeout(() => tick(), 0);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      if (timer) clearInterval(timer);
      if (kickoff) clearTimeout(kickoff);
      timer = null;
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      document.removeEventListener("visibilitychange", resume);
    }
  };
}
const clockSnapshot = () => clock;
const serverClock = () => 0;
const serverView = () => EMPTY_MARKET_VIEW;

export function useLiveMarketView(symbol: string, options: { asset?: "stock" | "crypto"; productId?: string; chart?: boolean } = {}) {
  const key = marketViewKey(options.asset ?? "stock", symbol, options.productId);
  const enabled = Boolean(symbol && (options.asset !== "crypto" || options.productId));
  const chart = options.chart ?? false;
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled) return () => {};
    const unsubscribe = store.subscribe(key, listener, chart);
    // Coalesce subscribers mounted together into one batch on the next tick.
    const initial = setTimeout(() => tick(), 0);
    return () => { clearTimeout(initial); unsubscribe(); };
  }, [chart, enabled, key]);
  const snapshot = useCallback(() => enabled ? store.get(key) : EMPTY_MARKET_VIEW, [enabled, key]);
  const view = useSyncExternalStore(subscribe, snapshot, serverView);
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverClock);
  const offline = now > 0 && !navigator.onLine;
  return { ...view, now, live: !offline && displayQuoteIsLive(view, now, options.asset ?? "stock"),
    label: offline ? "Offline · last received data" : displayQuoteLabel(view, now, options.asset ?? "stock") };
}
