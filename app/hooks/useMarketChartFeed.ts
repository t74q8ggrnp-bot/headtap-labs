"use client";

import { useEffect, useMemo, useState } from "react";
import {
  marketChartFeedFrameFromBootstrap,
  marketChartFeedFrameForSymbol,
  marketChartTransportNow,
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
import {
  alignedMarketChartPollDelay,
  createServerAnchoredClock,
  createMarketChartPollAttemptGate,
  marketChartBootstrapRetryDelay,
  marketChartFailureBackoffMs,
  marketChartPollingState,
  marketChartRolloverBootstrapDelay,
  marketChartSessionRolloverRequired,
  MarketChartHttpError,
  parseRetryAfterMs,
} from "@/lib/market-chart-polling";

type Fetcher = typeof fetch;

export function createPollingMarketChartTransport(options: {
  fetcher?: Fetcher;
  intervalMs?: number;
  now?: () => number;
  monotonicNow?: () => number;
  random?: () => number;
} = {}): MarketChartTransport {
  const fetcher = options.fetcher ?? fetch;
  const intervalMs = Math.max(1_000, options.intervalMs ?? 5_000);
  const deviceNow = options.now ?? (() => Date.now());
  const serverClock = createServerAnchoredClock({
    deviceNow,
    monotonicNow: options.monotonicNow ?? (options.now ? deviceNow : undefined),
  });
  const now = serverClock.now;
  const random = options.random ?? Math.random;

  return {
    trustedNow: now,
    acceptTrustedTime: serverClock.accept,
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
      serverClock.accept(response.headers.get("Date"));
      if (!response.ok) {
        throw new MarketChartHttpError(
          `Chart bootstrap unavailable (${response.status}).`,
          response.status,
          parseRetryAfterMs(response.headers.get("Retry-After"), now()),
        );
      }
      const payload: unknown = await response.json();
      if (!validMarketChartBootstrapResponse(payload, request)) {
        throw new Error("Chart bootstrap contract mismatch.");
      }
      serverClock.accept(payload.instrumentation.responseCompletedAt);
      return payload;
    },
    subscribe(request, listener, onError) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let controller: AbortController | null = null;
      let consecutiveFailures = 0;
      const attemptGate = createMarketChartPollAttemptGate(now);

      const schedule = (delayMs?: number) => {
        if (stopped) return;
        if (timer) clearTimeout(timer);
        const policy = marketChartPollingState(
          new Date(now()),
          request.sessionScope ?? "extended",
        );
        const requestedDelay = delayMs ?? (policy.active
          ? alignedMarketChartPollDelay(now(), intervalMs)
          : policy.retryAfterMs);
        const delay = attemptGate.delay(requestedDelay);
        timer = setTimeout(run, delay);
      };
      const run = async () => {
        if (stopped) return;
        timer = null;
        if (
          typeof document !== "undefined" &&
          (document.visibilityState === "hidden" || !navigator.onLine)
        ) {
          schedule(Math.max(intervalMs, 15_000));
          return;
        }
        const policy = marketChartPollingState(
          new Date(now()),
          request.sessionScope ?? "extended",
        );
        if (!policy.active) {
          // Recheck the local market clock without contacting HT or Massive.
          schedule(policy.retryAfterMs);
          return;
        }
        if (!attemptGate.start()) {
          schedule(intervalMs);
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
          serverClock.accept(response.headers.get("Date"));
          if (!response.ok) {
            throw new MarketChartHttpError(
              `Chart delta unavailable (${response.status}).`,
              response.status,
              parseRetryAfterMs(response.headers.get("Retry-After"), now()),
            );
          }
          const payload: unknown = await response.json();
          if (!validMarketChartDeltaResponse(payload, request)) {
            throw new Error("Chart delta contract mismatch.");
          }
          if (payload.instrumentation) {
            serverClock.accept(payload.instrumentation.responseCompletedAt);
          }
          listener(payload);
          consecutiveFailures = 0;
          // Focus/online events may recover a paused feed, but they cannot
          // compress the successful provider cadence below the configured
          // interval and multiply requests.
          attemptGate.succeed(intervalMs);
          schedule();
        } catch (error) {
          if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
            onError?.(error);
            consecutiveFailures += 1;
            const retryDelay = marketChartFailureBackoffMs({
              attempt: consecutiveFailures,
              baseMs: intervalMs,
              retryAfterMs: error instanceof MarketChartHttpError
                ? error.retryAfterMs
                : null,
              random,
            });
            attemptGate.fail(retryDelay);
            schedule(retryDelay);
          } else {
            attemptGate.succeed();
          }
        } finally {
          controller = null;
        }
      };
      const recheckNow = () => {
        if (
          stopped ||
          attemptGate.running ||
          (typeof document !== "undefined" &&
            (document.visibilityState === "hidden" || !navigator.onLine))
        ) return;
        schedule(250);
      };
      if (typeof window !== "undefined") {
        window.addEventListener("online", recheckNow);
        window.addEventListener("focus", recheckNow);
        document.addEventListener("visibilitychange", recheckNow);
      }
      schedule();
      return () => {
        stopped = true;
        attemptGate.stop();
        if (timer) clearTimeout(timer);
        controller?.abort();
        if (typeof window !== "undefined") {
          window.removeEventListener("online", recheckNow);
          window.removeEventListener("focus", recheckNow);
          document.removeEventListener("visibilitychange", recheckNow);
        }
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
      setClock(marketChartTransportNow(transport));
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
  }, [transport]);

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
    let retryNotBefore = 0;
    let lastRolloverBootstrapAt = 0;
    const trustedNow = () => marketChartTransportNow(transport);
    queueMicrotask(() => {
      if (!active) return;
      setFrame(null);
      setLoading(true);
      setError(null);
    });

    const scheduleRetry = (reason?: unknown) => {
      if (!active || retryTimer) return;
      retryAttempt += 1;
      const backoffMs = marketChartFailureBackoffMs({
        attempt: retryAttempt,
        retryAfterMs: reason instanceof MarketChartHttpError
          ? reason.retryAfterMs
          : null,
      });
      const delay = marketChartBootstrapRetryDelay({
        now: new Date(trustedNow()),
        sessionScope,
        backoffMs,
      });
      retryNotBefore = trustedNow() + delay;
      const retryWhenEligible = () => {
        retryTimer = null;
        // Bootstrap may recover retained history once per bounded retry while
        // closed. Only delta subscriptions are prohibited outside sessions.
        void connect(false);
      };
      retryTimer = window.setTimeout(retryWhenEligible, delay);
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
        setFrame(marketChartFeedFrameFromBootstrap(bootstrap, trustedNow()));
        setLoading(false);
        setError(null);
        retryAttempt = 0;
        retryNotBefore = 0;
        const bootstrapCompletedAt = trustedNow();
        lastRolloverBootstrapAt = marketChartSessionRolloverRequired({
          displayedSessionDate:
            bootstrap.sessionAuthority.displayedSessionDate,
          now: new Date(bootstrapCompletedAt),
          sessionScope,
        })
          ? bootstrapCompletedAt
          : 0;
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
              current
                ? mergeMarketChartFeedDelta(current, delta, trustedNow())
                : current,
            );
            setError(null);
          },
          (reason) => {
            if (!active) return;
            if (reason instanceof MarketChartHttpError && reason.status === 409) {
              // An illiquid ticker may legitimately retain yesterday's frame
              // after a new extended session opens. One bootstrap per minute is
              // enough to discover its first current-session print; retrying
              // four bootstrap calls every five seconds is not.
              if (marketChartRolloverBootstrapDelay(
                lastRolloverBootstrapAt,
                trustedNow(),
              ) > 0) {
                setError(null);
                return;
              }
              lastRolloverBootstrapAt = trustedNow();
              const previousSubscription = unsubscribe;
              unsubscribe = null;
              previousSubscription?.();
              setError(null);
              void connect(true);
              return;
            }
            if (reason instanceof MarketChartHttpError && reason.status === 425) {
              setError(null);
              return;
            }
            setError("Live update reconnecting");
          },
        );
      } catch (reason: unknown) {
        if (!active) return;
        if (!sessionRollover) setLoading(false);
        setError(
          reason instanceof Error ? reason.message : "Chart feed unavailable.",
        );
        scheduleRetry(reason);
      } finally {
        connecting = false;
      }
    };
    const reconnectNow = () => {
      // Focus/online events should recover a failed initial connection, not
      // create another bootstrap while an already-healthy subscription is
      // running. The polling transport itself resumes when the tab is visible.
      if (!active || !navigator.onLine || connecting || unsubscribe) return;
      const session = marketChartPollingState(new Date(trustedNow()), sessionScope);
      if (!session.active && retryAttempt > 0) {
        if (!retryTimer) scheduleRetry();
        return;
      }
      const retryDelay = retryNotBefore - trustedNow();
      if (retryDelay > 0) {
        if (!retryTimer) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void connect(false);
          }, retryDelay);
        }
        return;
      }
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
    // React effects clear state after a symbol prop changes. Fail closed during
    // that render so an old symbol can never appear below a new ticker header.
    const currentFrame = marketChartFeedFrameForSymbol(
      frame,
      normalizedSymbol,
    );
    const currentError = currentFrame || !frame ? error : null;
    const view: MarketView = {
      quote: currentFrame?.chart.displayQuote ?? null,
      chart: currentFrame?.chart ?? null,
      receivedAt: currentFrame?.receivedAt ?? 0,
      error: Boolean(currentError),
    };
    const live = !offline && clock > 0 && displayQuoteIsLive(view, clock, "stock");
    return {
      frame: currentFrame,
      loading: loading || Boolean(enabled && normalizedSymbol && !currentFrame),
      error: currentError,
      reconnecting: Boolean(currentError && currentFrame),
      live,
      offline,
      nowMs: clock,
      acceptTrustedTime: transport.acceptTrustedTime,
      label: offline
        ? "Offline · last received data"
        : displayQuoteLabel(view, clock, "stock"),
    };
  }, [
    clock,
    enabled,
    error,
    frame,
    loading,
    normalizedSymbol,
    offline,
    transport.acceptTrustedTime,
  ]);
}
