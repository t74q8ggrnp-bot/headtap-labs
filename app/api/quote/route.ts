import { NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  ACTIVE_MARKET_DATA_MAX_AGE_MS,
  buildMarketDataTimingReceipt,
  isActiveMarketTimestampUsable,
} from "@/lib/market-data-time";
import {
  fetchMassiveLastQuote,
  fetchMassiveLastTrade,
  fetchMassiveStockSnapshot,
  probeMassiveRealtimeEntitlement,
} from "@/lib/massive-stocks";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotDisplayPrice,
  resolveSnapshotTimestampMs,
} from "@/lib/polygon-snapshot";
import { fetchHydratedSessionSnapshot } from "@/lib/intraday-snapshot-hydration";
import { getStockMarketClock } from "@/lib/stock-market-session";

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
  const clock = getStockMarketClock(requestStartedAt);
  const massiveApiKey = process.env.POLYGON_API_KEY?.trim();
  const sessionOhlcvPromise = massiveApiKey && clock.active
    ? fetchHydratedSessionSnapshot(symbol, massiveApiKey, clock.session).catch(
      (error: unknown) => {
        console.error("[quote] Massive session OHLCV hydration failed", {
          symbol,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        return null;
      },
    )
    : Promise.resolve(null);
  try {
    const [snapshot, liveTrade, liveQuote, entitlement, sessionOhlcv] =
      await Promise.all([
      fetchMassiveStockSnapshot(symbol),
      fetchMassiveLastTrade(symbol),
      fetchMassiveLastQuote(symbol),
      probeMassiveRealtimeEntitlement(),
      sessionOhlcvPromise,
    ]);
    const receivedAt = new Date();
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
        { status: 502, headers: responseHeaders },
      );
    }

    const snapshotPrice = resolveSnapshotDisplayPrice(snapshot);
    const snapshotTimestampMs = resolveSnapshotTimestampMs(snapshot);
    const tradeTimestampMs = liveTrade ? Date.parse(liveTrade.timestamp) : null;
    const useLiveTrade = Boolean(
      liveTrade &&
        tradeTimestampMs !== null &&
        (snapshotTimestampMs === null || tradeTimestampMs >= snapshotTimestampMs),
    );
    const price = useLiveTrade ? liveTrade!.price : snapshotPrice;
    if (!(price > 0)) {
      console.error("[quote] Massive returned no usable price", { symbol });
      return NextResponse.json(
        { error: "Verified price unavailable.", symbol, c: 0, dp: 0 },
        { status: 502, headers: responseHeaders },
      );
    }

    const marketTimestampMs = Math.max(
      snapshotTimestampMs ?? 0,
      tradeTimestampMs ?? 0,
    );
    const marketAsOf = marketTimestampMs > 0
      ? new Date(marketTimestampMs).toISOString()
      : null;
    const timing = buildMarketDataTimingReceipt({ marketAsOf, receivedAt });
    const activeTimestampUsable = isActiveMarketTimestampUsable(
      marketAsOf,
      new Date(timing.processedAt),
    );
    const directRealtimeCoverage = Boolean(liveTrade && liveQuote);
    const isLive = clock.active &&
      entitlement.dataMode === "real_time" &&
      directRealtimeCoverage &&
      activeTimestampUsable;
    const snapshotOpen = Number(snapshot.day?.o || 0);
    const snapshotHigh = Number(snapshot.day?.h || 0);
    const snapshotLow = Number(snapshot.day?.l || 0);
    const snapshotVolume = Number(snapshot.day?.v || 0);
    const open = sessionOhlcv?.sessionOpenPrice ?? snapshotOpen;
    const high = sessionOhlcv?.sessionHighPrice ?? snapshotHigh;
    const low = sessionOhlcv?.sessionLowPrice ?? snapshotLow;
    const volume = sessionOhlcv && sessionOhlcv.currentVolume > 0
      ? sessionOhlcv.currentVolume
      : snapshotVolume;

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
      asOf: marketAsOf,
      source: useLiveTrade
        ? "massive_polygon_last_trade"
        : "massive_polygon_snapshot",
      provider: "massive_polygon",
      dataMode: entitlement.dataMode,
      marketSession: clock.session,
      ohlcvAsOf: sessionOhlcv?.latestBarAt ?? marketAsOf,
      ohlcvSource: sessionOhlcv
        ? "massive_polygon_minute_aggregates"
        : "massive_polygon_snapshot",
      sessionOhlcvHydrated: Boolean(sessionOhlcv),
      live: isLive,
      freshness: clock.active
        ? activeTimestampUsable ? "fresh" : "stale"
        : "retained_closed_session",
      degraded: !directRealtimeCoverage,
      degradedReason: directRealtimeCoverage
        ? null
        : "Massive last-trade or NBBO coverage was unavailable; snapshot facts were retained explicitly.",
      activeMaxAgeMs: ACTIVE_MARKET_DATA_MAX_AGE_MS,
      timing: {
        ...timing,
        requestStartedAt: requestStartedAt.toISOString(),
        providerRoundTripMs: Math.max(
          0,
          receivedAt.getTime() - requestStartedAt.getTime(),
        ),
      },
    }, { headers: responseHeaders });
  } catch (error) {
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
      },
      { status: 502, headers: responseHeaders },
    );
  }
}
