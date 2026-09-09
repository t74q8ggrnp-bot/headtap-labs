import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  createProviderRequestInstrumentation,
  marketBarsAtOrBeforeProviderTimestamp,
  marketChartBarsInDisplayedSession,
  marketChartFrameHasSharedPriceInvariant,
  marketChartSecondAggregateWindowStart,
  resolveMarketChartSessionAuthority,
  type MarketChartDeltaResponse,
  type MarketChartSessionScope,
} from "@/lib/market-chart-feed";
import {
  mergeVerifiedTradeIntoBars,
  normalizeMarketBars,
  rollupMarketBars,
} from "@/lib/market-chart";
import {
  fetchMassiveLastTradeResult,
  massiveStocksUrl,
} from "@/lib/massive-stocks";
import { isActiveMarketTimestampUsable } from "@/lib/market-data-time";
import { getStockMarketClock } from "@/lib/stock-market-session";
import { resolveStockDisplayPrice } from "@/lib/stock-display-price";
import {
  preflightStockDisplayFrameCoordination,
  publishStockDisplayFrame,
  StockDisplayFrameCoordinationError,
} from "@/lib/stock-display-frame-server";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";
import {
  marketChartPollingState,
  marketChartSessionRolloverRequired,
  MarketChartHttpError,
  parseRetryAfterMs,
  providerResponseRequiresBackoff,
} from "@/lib/market-chart-polling";
import {
  marketProviderCoalescingKey,
  marketProviderCostGuard,
  providerTimestampCanEnterShortCache,
  type MarketProviderEvidence,
} from "@/lib/market-provider-cost-guard";

export const dynamic = "force-dynamic";

const STOCK_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PolygonAggregate = {
  t?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
};

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

function errorResponse(message: string, status: number, extraHeaders = {}) {
  return Response.json(
    { success: false, error: message },
    { status, headers: { ...headers, ...extraHeaders } },
  );
}

async function fetchSecondDelta(symbol: string, now: Date) {
  // Start on a complete minute boundary. A rolling `now - 2 minutes` window
  // begins partway through its first minute, and rolling that partial result
  // up would overwrite a complete historical candle with incomplete OHLCV.
  // The previous full minute plus the current minute is sufficient for a
  // five-second tail update and keeps the delta response bounded.
  const from = marketChartSecondAggregateWindowStart(now.getTime(), 2);
  const response = await fetch(
    massiveStocksUrl(
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/second/${from}/${now.getTime()}`,
      { adjusted: true, sort: "asc", limit: 5000 },
    ),
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (providerResponseRequiresBackoff(
    response.status,
    response.headers.get("Retry-After"),
  )) {
    throw new MarketChartHttpError(
      "Massive rate-limited the chart delta.",
      response.status,
      parseRetryAfterMs(response.headers.get("Retry-After"), now.getTime()),
    );
  }
  if (!response.ok) {
    // A persistent aggregate failure must reach the transport as a failure so
    // its exponential backoff can engage. Returning a partial HTTP 200 would
    // otherwise keep spending two provider calls every five seconds.
    throw new MarketChartHttpError(
      "Massive chart delta is unavailable.",
      response.status,
      parseRetryAfterMs(response.headers.get("Retry-After"), now.getTime()),
    );
  }
  const payload = (await response.json()) as { results?: unknown };
  const rows = Array.isArray(payload.results)
    ? (payload.results as PolygonAggregate[])
    : [];
  return {
    bars: normalizeMarketBars(rows.map((bar) => ({
        time: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      }))),
    succeeded: true,
  };
}

function providerReceipt<T>(
  kind: "second_delta" | "last_trade",
  evidence: MarketProviderEvidence<T>,
  accepted: boolean,
) {
  return {
    kind,
    attempted: evidence.providerRequestAttempted,
    succeeded: evidence.providerRequestAttempted && accepted,
    delivery: evidence.delivery,
    evidenceAccepted: accepted,
    evidenceAgeMs: evidence.evidenceAgeMs,
  } as const;
}

function secondDeltaIsCacheable(
  result: Awaited<ReturnType<typeof fetchSecondDelta>>,
  completedAt: number,
) {
  const latest = result.bars.at(-1);
  return result.succeeded && Boolean(latest) &&
    providerTimestampCanEnterShortCache({
      providerTimestamp: latest
        ? new Date(latest.time * 1_000).toISOString()
        : null,
      completedAt,
      activeSession: marketChartPollingState(
        new Date(completedAt),
        "extended",
      ).active,
      maxAgeMs: DISPLAY_LIVE_MAX_AGE_MS,
    });
}

export async function GET(request: Request) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "public-market-chart-delta",
    limit: 180,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return errorResponse(
      "Too many chart updates. Please retry shortly.",
      429,
      rateLimit.headers,
    );
  }

  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase() ?? "";
  const displayedSessionDate = params.get("sessionDate")?.trim() ?? "";
  const requestedSessionScope = params.get("sessionScope");
  if (
    requestedSessionScope !== null &&
    requestedSessionScope !== "regular" &&
    requestedSessionScope !== "extended"
  ) {
    return errorResponse(
      "Session scope must be regular or extended.",
      400,
      rateLimit.headers,
    );
  }
  const sessionScope: MarketChartSessionScope =
    requestedSessionScope === "regular" ? "regular" : "extended";
  if (!STOCK_PATTERN.test(symbol) || !DATE_PATTERN.test(displayedSessionDate)) {
    return errorResponse(
      "A valid stock symbol and displayed session date are required.",
      400,
      rateLimit.headers,
    );
  }

  const requestStartedAt = new Date();
  const requestId = crypto.randomUUID();
  let providerRequestsAttempted = 0;
  const polling = marketChartPollingState(requestStartedAt, sessionScope);
  if (!polling.active) {
    return errorResponse(
      "Stock chart updates are paused outside the requested market session.",
      425,
      {
        ...rateLimit.headers,
        "Retry-After": String(Math.ceil(polling.retryAfterMs / 1_000)),
        "X-HT-Market-Feed-Request": requestId,
        "X-HT-Provider-Requests-Attempted": "0",
        "X-HT-Market-Polling-State": polling.reason,
      },
    );
  }
  if (marketChartSessionRolloverRequired({
    displayedSessionDate,
    now: requestStartedAt,
    sessionScope,
  })) {
    return errorResponse(
      "The displayed stock session has rolled over; reload the verified frame.",
      409,
      {
        ...rateLimit.headers,
        "X-HT-Market-Feed-Request": requestId,
        "X-HT-Provider-Requests-Attempted": "0",
        "X-HT-Session-Rollover": getStockMarketClock(requestStartedAt).easternDate,
        "Retry-After": "60",
      },
    );
  }
  try {
    await preflightStockDisplayFrameCoordination();
    const bucketTimestamp = requestStartedAt.getTime();
    const [secondEvidence, lastTradeEvidence] = await Promise.all([
      marketProviderCostGuard.run({
        key: marketProviderCoalescingKey({
          operation: "second_delta",
          symbol,
          timestampMs: bucketTimestamp,
          variant: "2-minute-update",
        }),
        load: () => {
          providerRequestsAttempted += 1;
          return fetchSecondDelta(symbol, requestStartedAt);
        },
        cacheIf: secondDeltaIsCacheable,
      }),
      marketProviderCostGuard.run({
        key: marketProviderCoalescingKey({
          operation: "last_trade",
          symbol,
          timestampMs: bucketTimestamp,
        }),
        load: async () => {
          providerRequestsAttempted += 1;
          const result = await fetchMassiveLastTradeResult(symbol);
          if (providerResponseRequiresBackoff(
            result.status,
            result.retryAfter,
          )) {
            throw new MarketChartHttpError(
              "Massive rate-limited the latest trade.",
              result.status,
              parseRetryAfterMs(result.retryAfter, Date.now()),
            );
          }
          return result.value;
        },
        cacheIf: (trade, completedAt) => Boolean(trade &&
          providerTimestampCanEnterShortCache({
            providerTimestamp: trade.timestamp,
            completedAt,
            activeSession: marketChartPollingState(
              new Date(completedAt),
              sessionScope,
            ).active,
            maxAgeMs: DISPLAY_LIVE_MAX_AGE_MS,
          })),
      }),
    ]);
    const secondDelta = secondEvidence.value;
    const lastTrade = lastTradeEvidence.value;
    const providerDisplay = resolveStockDisplayPrice(
      null,
      lastTrade,
      Date.now(),
    );
    if (!providerDisplay) {
      return errorResponse(
        "A verified provider trade is not available yet.",
        502,
        {
          ...rateLimit.headers,
          "X-HT-Market-Feed-Request": requestId,
          "X-HT-Provider-Requests-Attempted": String(
            providerRequestsAttempted,
          ),
        },
      );
    }
    const display = await publishStockDisplayFrame(
      symbol,
      providerDisplay,
      requestStartedAt,
    );
    if (!display) {
      throw new Error("Stock chart display-frame coordination is unavailable.");
    }
    const responseCompletedAt = new Date();
    const responseSession = marketChartPollingState(
      responseCompletedAt,
      sessionScope,
    );
    const authority = resolveMarketChartSessionAuthority({
      providerTimestamp: display.asOf,
      displayedSessionDate,
      sessionScope,
      intervalSeconds: 60,
    });
    // The database-selected display frame is the atomic presentation winner.
    // Never let a provider aggregate from a later minute outrun that frame;
    // the next five-second delta will advance both together.
    const alignedBars = marketChartBarsInDisplayedSession(
      rollupMarketBars(
        marketBarsAtOrBeforeProviderTimestamp(secondDelta.bars, display.asOf),
      ),
      displayedSessionDate,
      sessionScope,
    );
    const mergedBars = mergeVerifiedTradeIntoBars(
      alignedBars,
      authority.displayPriceAppliedToCandle
        ? {
            price: display.price,
            size: display.size ?? null,
            timestamp: display.asOf,
          }
        : null,
    );
    const instrumentation = createProviderRequestInstrumentation({
      phase: "delta",
      requestId,
      requestStartedAt,
      responseCompletedAt,
      requests: [
        providerReceipt(
          "second_delta",
          secondEvidence,
          secondDelta.succeeded,
        ),
        providerReceipt("last_trade", lastTradeEvidence, lastTrade !== null),
      ],
    });
    const displayQuote: MarketChartDeltaResponse["displayQuote"] = {
      price: Number(display.price.toFixed(6)),
      changePercent: null,
      asOf: display.asOf,
      live:
        display.priceKind === "trade" &&
        responseSession.active &&
        secondDelta.succeeded &&
        isActiveMarketTimestampUsable(
          display.asOf,
          responseCompletedAt,
          DISPLAY_LIVE_MAX_AGE_MS,
        ),
      changeBasis: "previous_close",
      source: display.source,
      priceKind: display.priceKind,
      ...("frameId" in display
        ? {
            frameId: display.frameId,
            frameVersion: display.frameVersion,
            frameBucket: display.frameBucket,
            frameCoordination: display.coordination,
            ...(display.coordinationIssue
              ? { frameCoordinationIssue: display.coordinationIssue }
              : {}),
          }
        : {}),
    };
    if (!marketChartFrameHasSharedPriceInvariant({
      bars: mergedBars,
      displayQuote,
      sessionAuthority: authority,
    })) {
      throw new Error("Stock chart delta failed shared-price alignment.");
    }
    const latestDelta = mergedBars.at(-1);
    const payload: MarketChartDeltaResponse = {
      success: true,
      asset: "stock",
      symbol,
      feedVersion: "market-chart-feed-v1",
      feedPhase: "delta",
      bars: mergedBars,
      displayQuote,
      latestAt: latestDelta
        ? new Date(latestDelta.time * 1_000).toISOString()
        : authority.candleIntervalTimestamp ?? display.asOf,
      intervalSeconds: 60,
      sessionAuthority: authority,
      instrumentation,
    };
    console.info("[market-chart-feed] delta", {
      symbol,
      providerRequests: instrumentation.providerRequestCount,
      legacyEquivalent: instrumentation.legacyEquivalentRequestCount,
      providerAsOf: display.asOf,
      candleAt: authority.candleIntervalTimestamp,
      applied: authority.displayPriceAppliedToCandle,
      evidenceDelivery: instrumentation.requests.map((receipt) =>
        `${receipt.kind}:${receipt.delivery}`
      ),
    });
    return Response.json(payload, {
      headers: {
        ...headers,
        ...rateLimit.headers,
        "X-HT-Market-Feed-Request": instrumentation.requestId,
        "X-HT-Provider-Requests": String(
          instrumentation.providerRequestCount,
        ),
        "X-HT-Legacy-Equivalent-Requests": String(
          instrumentation.legacyEquivalentRequestCount,
        ),
        "X-HT-Accepted-Provider-Evidence": String(
          instrumentation.acceptedEvidenceCount,
        ),
        "X-HT-Reused-Provider-Evidence": String(
          instrumentation.reusedEvidenceCount,
        ),
      },
    });
  } catch (error) {
    console.error("[market-chart-feed] delta failed", {
      symbol,
      message: error instanceof Error ? error.message : "Unknown error",
      requestId,
      providerRequestsAttempted,
    });
    const coordinationFailure = error instanceof StockDisplayFrameCoordinationError;
    const providerBackoff = error instanceof MarketChartHttpError &&
      providerResponseRequiresBackoff(error.status, error.retryAfterMs === null
        ? null
        : String(error.retryAfterMs / 1_000));
    const retryAfterMs = providerBackoff
      ? error.retryAfterMs
      : coordinationFailure ? 30_000 : null;
    return errorResponse(
      coordinationFailure
        ? "Shared chart coordination is temporarily unavailable."
        : providerBackoff
          ? "Chart provider rate limit reached. Retrying with backoff."
          : "Verified chart update is temporarily unavailable.",
      coordinationFailure
        ? 503
        : providerBackoff && error instanceof MarketChartHttpError
          ? error.status
          : 502,
      {
        ...rateLimit.headers,
        ...(retryAfterMs !== null
          ? { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))) }
          : {}),
        "X-HT-Market-Feed-Request": requestId,
        "X-HT-Provider-Requests-Attempted": String(
          providerRequestsAttempted,
        ),
      },
    );
  }
}
