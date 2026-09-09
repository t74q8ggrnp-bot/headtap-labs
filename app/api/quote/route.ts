import { NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  ACTIVE_MARKET_DATA_MAX_AGE_MS,
  buildMarketDataTimingReceipt,
  isActiveMarketTimestampUsable,
} from "@/lib/market-data-time";
import {
  fetchMassiveLastQuoteResult,
  fetchMassiveLastTradeResult,
  fetchMassiveStockSnapshotResult,
} from "@/lib/massive-stocks";
import {
  resolveSnapshotChangePercent,
} from "@/lib/polygon-snapshot";
import { resolveStockDisplayPrice } from "@/lib/stock-display-price";
import { getStockMarketClock } from "@/lib/stock-market-session";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";
import {
  marketChartPollingState,
  MarketChartHttpError,
  parseRetryAfterMs,
  providerResponseRequiresBackoff,
} from "@/lib/market-chart-polling";
import {
  preflightStockDisplayFrameCoordination,
  publishStockDisplayFrame,
  StockDisplayFrameCoordinationError,
} from "@/lib/stock-display-frame-server";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export async function GET(request: Request) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "public-stock-quote",
    limit: 120,
    windowMs: 60_000,
  });
  const responseHeaders = { ...NO_STORE_HEADERS, ...rateLimit.headers };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many quote requests. Please retry shortly." },
      { status: 429, headers: responseHeaders },
    );
  }

  const symbol = new URL(request.url).searchParams
    .get("symbol")
    ?.trim()
    .toUpperCase() ?? "";
  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json(
      { error: "A valid stock symbol is required.", c: 0, dp: 0 },
      { status: 400, headers: responseHeaders },
    );
  }

  const requestStartedAt = new Date();
  let providerRequestsAttempted = 0;
  const callProvider = <T>(requestProvider: () => Promise<T>) => {
    providerRequestsAttempted += 1;
    return requestProvider();
  };
  const providerHeaders = () => ({
    ...responseHeaders,
    "X-HT-Provider-Requests-Attempted": String(providerRequestsAttempted),
  });
  try {
    // Fail before any provider function is invoked when the cross-instance
    // display-frame coordinator cannot uphold the shared-price invariant.
    await preflightStockDisplayFrameCoordination();

    // The quote endpoint is a recurring price path, not a chart-history path.
    // Reuse the snapshot's session OHLCV instead of downloading the same
    // minute candles again on every quote refresh. Full candle history is
    // owned by /api/market-chart bootstrap and its incremental delta route.
    const [snapshotResult, tradeResult, quoteResult] = await Promise.all([
      callProvider(() => fetchMassiveStockSnapshotResult(symbol)),
      callProvider(() => fetchMassiveLastTradeResult(symbol)),
      callProvider(() => fetchMassiveLastQuoteResult(symbol)),
    ]);
    const throttled = [snapshotResult, tradeResult, quoteResult].find(
      (result) => providerResponseRequiresBackoff(
        result.status,
        result.retryAfter,
      ),
    );
    if (throttled) {
      throw new MarketChartHttpError(
        "Massive rate-limited the stock quote.",
        throttled.status,
        parseRetryAfterMs(throttled.retryAfter, Date.now()),
      );
    }
    const receivedAt = new Date();
    const responseSession = marketChartPollingState(receivedAt, "extended");
    const responseClock = getStockMarketClock(receivedAt);
    const snapshot = snapshotResult.value;
    const liveTrade = tradeResult.value;
    const liveQuote = quoteResult.value;
    const directRealtimeCoverage = Boolean(
      liveTrade &&
        liveQuote &&
        isActiveMarketTimestampUsable(
          liveTrade.timestamp,
          receivedAt,
          DISPLAY_LIVE_MAX_AGE_MS,
        ) &&
        isActiveMarketTimestampUsable(
          liveQuote.timestamp,
          receivedAt,
          DISPLAY_LIVE_MAX_AGE_MS,
        ),
    );
    const dataMode = snapshot && directRealtimeCoverage
      ? "real_time" as const
      : snapshot
        ? "delayed" as const
        : "unavailable" as const;
    if (!snapshot) {
      console.error("[quote] Massive snapshot unavailable", { symbol });
      return NextResponse.json(
        {
          error: "Verified Massive market data is temporarily unavailable.",
          symbol,
          c: 0,
          dp: 0,
          provider: "massive_polygon",
          dataMode: "unavailable",
        },
        { status: 502, headers: providerHeaders() },
      );
    }

    const providerDisplay = resolveStockDisplayPrice(snapshot, liveTrade, receivedAt.getTime());
    if (!providerDisplay) {
      console.error("[quote] Massive returned no usable price", { symbol });
      return NextResponse.json(
        { error: "Verified price unavailable.", symbol, c: 0, dp: 0 },
        { status: 502, headers: providerHeaders() },
      );
    }

    const display = await publishStockDisplayFrame(
      symbol,
      providerDisplay,
      requestStartedAt,
    );
    if (!display) {
      throw new Error("Shared stock display frame was not published.");
    }
    const price = display.price;
    const marketAsOf = display.asOf;
    const timing = buildMarketDataTimingReceipt({ marketAsOf, receivedAt });
    const activeTimestampUsable = isActiveMarketTimestampUsable(
      marketAsOf,
      new Date(timing.processedAt),
    );
    const isLive = display.priceKind === "trade" && responseSession.active &&
      dataMode === "real_time" &&
      directRealtimeCoverage &&
      activeTimestampUsable && isActiveMarketTimestampUsable(marketAsOf, new Date(), DISPLAY_LIVE_MAX_AGE_MS);
    const snapshotOpen = Number(snapshot.day?.o || 0);
    const snapshotHigh = Number(snapshot.day?.h || 0);
    const snapshotLow = Number(snapshot.day?.l || 0);
    const snapshotVolume = Number(snapshot.day?.v || 0);
    const open = snapshotOpen;
    const high = snapshotHigh;
    const low = snapshotLow;
    const volume = snapshotVolume;

    return NextResponse.json({
      symbol,
      c: price,
      dp: resolveSnapshotChangePercent(snapshot, price),
      pc: Number(snapshot.prevDay?.c || 0),
      high,
      low,
      open,
      volume,
      bid: liveQuote?.bid ?? null,
      ask: liveQuote?.ask ?? null,
      quoteAsOf: liveQuote?.timestamp ?? null,
      asOf: marketAsOf,
      source: display.source,
      priceKind: display.priceKind,
      displayFrame: "frameId" in display ? {
        id: display.frameId,
        version: display.frameVersion,
        bucket: display.frameBucket,
        coordination: display.coordination,
        ...(display.coordinationIssue ? { issue: display.coordinationIssue } : {}),
      } : null,
      provider: "massive_polygon",
      dataMode,
      marketSession: responseSession.active ? responseClock.session : "closed",
      ohlcvAsOf: marketAsOf,
      ohlcvSource: "massive_polygon_snapshot",
      sessionOhlcvHydrated: false,
      live: isLive,
      freshness: responseSession.active
        ? activeTimestampUsable ? "fresh" : "stale"
        : "retained_closed_session",
      degraded: !directRealtimeCoverage,
      degradedReason: directRealtimeCoverage
        ? null
        : "Massive last-trade or NBBO coverage was unavailable; snapshot facts were retained explicitly.",
      activeMaxAgeMs: ACTIVE_MARKET_DATA_MAX_AGE_MS,
      providerRequestsAttempted,
      timing: {
        ...timing,
        requestStartedAt: requestStartedAt.toISOString(),
        providerRoundTripMs: Math.max(
          0,
          receivedAt.getTime() - requestStartedAt.getTime(),
        ),
      },
    }, { headers: providerHeaders() });
  } catch (error) {
    if (error instanceof StockDisplayFrameCoordinationError) {
      console.warn("[quote] Shared display-frame coordination unavailable", {
        symbol,
        issue: error.issue,
      });
      return NextResponse.json(
        {
          error: "Shared stock display-frame coordination is temporarily unavailable.",
          symbol,
          c: 0,
          dp: 0,
          provider: "massive_polygon",
          dataMode: "unavailable",
          coordinationIssue: error.issue,
          providerRequestsAttempted,
        },
        {
          status: 503,
          headers: { ...providerHeaders(), "Retry-After": "30" },
        },
      );
    }
    if (error instanceof MarketChartHttpError) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((error.retryAfterMs ?? 5_000) / 1_000),
      );
      return NextResponse.json(
        {
          error: "Massive quote capacity is temporarily unavailable.",
          symbol,
          c: 0,
          dp: 0,
          provider: "massive_polygon",
          dataMode: "unavailable",
          providerRequestsAttempted,
        },
        {
          status: error.status || 503,
          headers: {
            ...providerHeaders(),
            "Retry-After": String(retryAfterSeconds),
          },
        },
      );
    }
    console.error("[quote] Massive request failed", {
      symbol,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Verified Massive quote is temporarily unavailable.",
        symbol,
        c: 0,
        dp: 0,
        provider: "massive_polygon",
        dataMode: "unavailable",
        providerRequestsAttempted,
      },
      { status: 502, headers: providerHeaders() },
    );
  }
}
