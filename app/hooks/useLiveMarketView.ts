"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { MarketChartDisplayQuote, MarketChartResponse } from "@/lib/market-chart";
import { LiveMarketViews, EMPTY_MARKET_VIEW, displayQuoteIsLive, displayQuoteLabel, marketViewKey } from "@/lib/live-market-view";

const store = new LiveMarketViews({
  now: () => Date.now(),
  cryptoQuotes: async products => {
    const response = await fetch("/api/crypto/quotes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ products }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Crypto quotes unavailable");
    return (await response.json()).quotes;
  },
  chart: async key => {
    const asset = key.startsWith("stock:") ? "stock" : "crypto";
    const id = key.slice(key.indexOf(":") + 1);
    const params = new URLSearchParams({ asset, symbol: asset === "stock" ? id : id.replace(/-USD$/, "") });
    if (asset === "crypto") params.set("productId", id);
    const response = await fetch(`/api/market-chart?${params}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error("Market view unavailable");
    const body = await response.json() as MarketChartResponse;
    if (body.success !== true) throw new Error("Market view unavailable");
    return body;
  },
  quotes: async symbols => {
    const response = await fetch("/api/bulk-quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Quotes unavailable");
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
  clock = Date.now();
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
