"use client";

import { useEffect, useMemo, useState } from "react";
import {
  marketChartFeedFrameFromBootstrap,
  mergeMarketChartFeedDelta,
  validMarketChartBootstrapResponse,
  validMarketChartDeltaResponse,
  type MarketChartFeedFrame,
  type MarketChartSessionScope,
  type MarketChartTransport,
} from "@/lib/market-chart-feed";
import {
  displayQuoteIsLive,
  displayQuoteLabel,
  type MarketView,
} from "@/lib/live-market-view";

type Fetcher = typeof fetch;

export function createPollingMarketChartTransport(options: {
  fetcher?: Fetcher;
  intervalMs?: number;
  now?: () => number;
} = {}): MarketChartTransport {
  const fetcher = options.fetcher ?? fetch;
  const intervalMs = Math.max(1_000, options.intervalMs ?? 5_000);
  const now = options.now ?? (() => Date.now());

  return {
    async loadBootstrap(request, signal) {
      const params = new URLSearchParams({
        asset: request.asset,
        symbol: request.symbol,
        sessionScope: request.sessionScope ?? "extended",
      });
      const response = await fetcher(`/api/market-chart?${params}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error(`Chart bootstrap unavailable (${response.status}).`);
      }
      const payload: unknown = await response.json();
      if (!validMarketChartBootstrapResponse(payload, request)) {
        throw new Error("Chart bootstrap contract mismatch.");
      }
      return payload;
    },
    subscribe(request, listener, onError) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let controller: AbortController | null = null;

      const schedule = () => {
        if (stopped) return;
        const remainder = now() % intervalMs;
        timer = setTimeout(run, Math.max(250, intervalMs - remainder));
      };
      const run = async () => {
        if (stopped) return;
        if (
          typeof document !== "undefined" &&
          (document.visibilityState === "hidden" || !navigator.onLine)
        ) {
          schedule();
          return;
        }
        controller = new AbortController();
        const params = new URLSearchParams({
          symbol: request.symbol,
          sessionScope: request.sessionScope ?? "extended",
          sessionDate: request.displayedSessionDate ?? "",
        });
        try {
          const response = await fetcher(`/api/market-chart/update?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Chart delta unavailable (${response.status}).`);
          }
          const payload: unknown = await response.json();
          if (!validMarketChartDeltaResponse(payload, request)) {
            throw new Error("Chart delta contract mismatch.");
          }
          listener(payload);
        } catch (error) {
          if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
            onError?.(error);
          }
        } finally {
          controller = null;
          schedule();
        }
      };
      schedule();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        controller?.abort();
      };
    },
  };
}

const defaultTransport = createPollingMarketChartTransport();

export function useMarketChartFeed(
  symbol: string,
  options: {
    enabled?: boolean;
    sessionScope?: MarketChartSessionScope;
    transport?: MarketChartTransport;
  } = {},
) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const enabled = options.enabled ?? true;
  const sessionScope = options.sessionScope ?? "extended";
  const transport = options.transport ?? defaultTransport;
  const [frame, setFrame] = useState<MarketChartFeedFrame | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const tick = () => {
      setClock(Date.now());
      setOffline(!navigator.onLine);
    };
    const timer = window.setInterval(tick, 1_000);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);
    window.addEventListener("offline", tick);
    document.addEventListener("visibilitychange", tick);
    const kickoff = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(kickoff);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
      window.removeEventListener("offline", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  useEffect(() => {
    if (!normalizedSymbol || !enabled) {
      queueMicrotask(() => {
        setFrame(null);
        setLoading(false);
        setError(null);
      });
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | null = null;
    let controller: AbortController | null = null;
    let connecting = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    queueMicrotask(() => {
      if (!active) return;
      setFrame(null);
      setLoading(true);
      setError(null);
    });

    const scheduleRetry = () => {
      if (!active || retryTimer) return;
      const delay = Math.min(30_000, 5_000 * 2 ** retryAttempt);
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect(false);
      }, delay);
    };
    const connect = async (sessionRollover = false) => {
      if (!active || connecting) return;
      connecting = true;
      controller = new AbortController();
      try {
        const bootstrap = await transport.loadBootstrap(
          { asset: "stock", symbol: normalizedSymbol, sessionScope },
          controller.signal,
        );
        if (!active) return;
        unsubscribe?.();
        setFrame(marketChartFeedFrameFromBootstrap(bootstrap));
        setLoading(false);
        setError(null);
        retryAttempt = 0;
        if (retryTimer) {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
        unsubscribe = transport.subscribe(
          {
            asset: "stock",
            symbol: normalizedSymbol,
            sessionScope,
            displayedSessionDate:
              bootstrap.sessionAuthority.displayedSessionDate,
          },
          (delta) => {
            if (!active) return;
            if (delta.sessionAuthority.reason === "outside_displayed_session") {
              // Stop the prior-session poller before attempting a four-call
              // bootstrap. If that bootstrap fails, the normal bounded retry
              // timer owns recovery; an old delta must not trigger another
              // bootstrap every five seconds and multiply provider traffic.
              const previousSubscription = unsubscribe;
              unsubscribe = null;
              previousSubscription?.();
              void connect(true);
              return;
            }
            setFrame((current) =>
              current ? mergeMarketChartFeedDelta(current, delta) : current,
            );
            setError(null);
          },
          () => {
            if (active) setError("Live update reconnecting");
          },
        );
      } catch (reason: unknown) {
        if (!active) return;
        if (!sessionRollover) setLoading(false);
        setError(
          reason instanceof Error ? reason.message : "Chart feed unavailable.",
        );
        scheduleRetry();
      } finally {
        connecting = false;
      }
    };
    const reconnectNow = () => {
      // Focus/online events should recover a failed initial connection, not
      // create another bootstrap while an already-healthy subscription is
      // running. The polling transport itself resumes when the tab is visible.
      if (!active || !navigator.onLine || connecting || unsubscribe) return;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      void connect(false);
    };
    void connect();
    window.addEventListener("online", reconnectNow);
    window.addEventListener("focus", reconnectNow);

    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      controller?.abort();
      unsubscribe?.();
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("focus", reconnectNow);
    };
  }, [enabled, normalizedSymbol, sessionScope, transport]);

  return useMemo(() => {
    const view: MarketView = {
      quote: frame?.chart.displayQuote ?? null,
      chart: frame?.chart ?? null,
      receivedAt: frame?.receivedAt ?? 0,
      error: Boolean(error),
    };
    const live = !offline && clock > 0 && displayQuoteIsLive(view, clock, "stock");
    return {
      frame,
      loading,
      error,
      reconnecting: Boolean(error && frame),
      live,
      offline,
      label: offline
        ? "Offline · last received data"
        : displayQuoteLabel(view, clock, "stock"),
    };
  }, [clock, error, frame, loading, offline]);
}
