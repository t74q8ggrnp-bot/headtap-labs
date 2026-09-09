import {
  easternDateString,
  mergeMarketBars,
  mergeVerifiedTradeIntoBars,
  normalizeMarketBars,
  rollupMarketBars,
  selectLatestEasternSessionBars,
  summarizeMarketBars,
  type MarketChartAsset,
  type MarketChartBar,
  type MarketChartResponse,
} from "@/lib/market-chart";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  fetchMassiveLastTradeResult,
  fetchMassiveStockSnapshotResult,
} from "@/lib/massive-stocks";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotTimestampMs,
} from "@/lib/polygon-snapshot";
import { resolveStockDisplayPrice } from "@/lib/stock-display-price";
import { isActiveMarketTimestampUsable } from "@/lib/market-data-time";
import { getStockMarketClock } from "@/lib/stock-market-session";
import { fetchMassiveCryptoChart } from "@/lib/massive-crypto";
import {
  areCryptoCapabilitiesEnabled,
  cryptoUnavailableResponse,
} from "@/lib/crypto/product-capabilities";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";
import {
  preflightStockDisplayFrameCoordination,
  publishStockDisplayFrame,
  StockDisplayFrameCoordinationError,
} from "@/lib/stock-display-frame-server";
import {
  MarketChartHttpError,
  marketChartHistoryLabel,
  marketChartPollingState,
  parseRetryAfterMs,
  providerResponseRequiresBackoff,
} from "@/lib/market-chart-polling";
import {
  createProviderRequestInstrumentation,
  marketBarsAtOrBeforeProviderTimestamp,
  marketChartFrameHasSharedPriceInvariant,
  marketChartSecondAggregateWindowStart,
  resolveMarketChartDisplayedSessionDate,
  resolveMarketChartSessionAuthority,
  stockSessionAllowedInChartScope,
  type MarketChartBootstrapResponse,
  type MarketChartSessionAuthority,
  type MarketChartSessionScope,
} from "@/lib/market-chart-feed";
import {
  marketProviderCoalescingKey,
  marketProviderCostGuard,
  providerTimestampCanEnterShortCache,
  type MarketProviderEvidence,
} from "@/lib/market-provider-cost-guard";

const POLYGON_ORIGIN = "https://api.polygon.io";
const STOCK_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const CRYPTO_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const CRYPTO_PRODUCT_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,30}-USD$/;

type PolygonAggregate = {
  t?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
};

type PolygonPayload = {
  results?: unknown;
};

type SecondAggregateEvidence = {
  bars: MarketChartBar[];
  succeeded: boolean;
};

const errorResponse = (
  message: string,
  status: number,
  headers: Record<string, string> = {},
) => Response.json(
  { success: false, error: message },
  { status, headers: { "Cache-Control": "private, no-store, max-age=0", ...headers } },
);

function responseWithCache(
  payload: MarketChartResponse,
  headers: Record<string, string>,
) {
  return Response.json(payload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      ...headers,
    },
  });
}

function evidenceTimestampIsCacheable(
  timestamp: string | null | undefined,
  completedAt: number,
) {
  return providerTimestampCanEnterShortCache({
    providerTimestamp: timestamp,
    completedAt,
    activeSession: marketChartPollingState(new Date(completedAt), "extended").active,
    maxAgeMs: DISPLAY_LIVE_MAX_AGE_MS,
  });
}

function aggregateEvidenceIsCacheable(
  bars: readonly MarketChartBar[],
  completedAt: number,
  intervalSeconds: number,
) {
  const latest = bars.at(-1);
  if (!latest) return false;
  const maxAge = intervalSeconds === 60 ? 90_000 : DISPLAY_LIVE_MAX_AGE_MS;
  return providerTimestampCanEnterShortCache({
    providerTimestamp: new Date(latest.time * 1_000).toISOString(),
    completedAt,
    activeSession: marketChartPollingState(
      new Date(completedAt),
      "extended",
    ).active,
    maxAgeMs: maxAge,
  });
}

function providerReceipt<T>(
  kind: "minute_history" | "second_delta" | "snapshot" | "last_trade",
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

async function fetchStockBars(
  symbol: string,
  requestStartedAt: Date,
  sessionScope: MarketChartSessionScope,
  requestId: string,
  onProviderAttempt: () => void,
): Promise<{
  bars: MarketChartBar[];
  realTimeSeconds: boolean;
  displayQuote: NonNullable<MarketChartResponse["displayQuote"]>;
  previousClose: number | null;
  sessionAuthority: MarketChartSessionAuthority;
  instrumentation: MarketChartBootstrapResponse["instrumentation"];
}> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("Stock chart provider is not configured.");

  const now = new Date();
  const from = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1_000);
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/minute/` +
    `${easternDateString(from)}/${easternDateString(now)}`;
  const params = new URLSearchParams({
    adjusted: "true",
    sort: "asc",
    limit: "5000",
    apiKey,
  });
  const secondWindowStart = marketChartSecondAggregateWindowStart(
    now.getTime(),
    15,
  );
  const secondPath =
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/second/` +
    `${secondWindowStart}/${now.getTime()}`;
  const secondParams = new URLSearchParams({
    adjusted: "true",
    sort: "asc",
    limit: "50000",
    apiKey,
  });
  const bucketTimestamp = requestStartedAt.getTime();
  const [minuteEvidence, secondEvidence, snapshotEvidence, lastTradeEvidence] =
    await Promise.all([
      marketProviderCostGuard.run({
        key: marketProviderCoalescingKey({
          operation: "minute_history",
          symbol,
          timestampMs: bucketTimestamp,
          variant: `${easternDateString(from)}-${easternDateString(now)}`,
        }),
        load: async () => {
          onProviderAttempt();
          const response = await fetch(`${POLYGON_ORIGIN}${path}?${params}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          });
          if (providerResponseRequiresBackoff(
            response.status,
            response.headers.get("Retry-After"),
          )) {
            throw new MarketChartHttpError(
              "Massive rate-limited chart history.",
              response.status,
              parseRetryAfterMs(response.headers.get("Retry-After"), Date.now()),
            );
          }
          if (!response.ok) {
            throw new Error(`Stock chart provider returned ${response.status}.`);
          }
          const payload = (await response.json()) as PolygonPayload;
          const results = Array.isArray(payload.results)
            ? (payload.results as PolygonAggregate[])
            : [];
          return normalizeMarketBars(results.map((bar) => ({
            time: bar.t,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
          })));
        },
        cacheIf: (bars, completedAt) =>
          aggregateEvidenceIsCacheable(bars, completedAt, 60),
      }),
      marketProviderCostGuard.run({
        key: marketProviderCoalescingKey({
          operation: "second_delta",
          symbol,
          timestampMs: bucketTimestamp,
          variant: "15-minute-bootstrap",
        }),
        load: async (): Promise<SecondAggregateEvidence> => {
          onProviderAttempt();
          const response = await fetch(
            `${POLYGON_ORIGIN}${secondPath}?${secondParams}`,
            {
              cache: "no-store",
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (providerResponseRequiresBackoff(
            response.status,
            response.headers.get("Retry-After"),
          )) {
            throw new MarketChartHttpError(
              "Massive rate-limited second aggregates.",
              response.status,
              parseRetryAfterMs(response.headers.get("Retry-After"), Date.now()),
            );
          }
          if (!response.ok) return { bars: [], succeeded: false };
          const payload = (await response.json()) as PolygonPayload;
          const results = Array.isArray(payload.results)
            ? (payload.results as PolygonAggregate[])
            : [];
          return {
            bars: normalizeMarketBars(results.map((bar) => ({
              time: bar.t,
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
            }))),
            succeeded: true,
          };
        },
        cacheIf: (result, completedAt) => result.succeeded &&
          aggregateEvidenceIsCacheable(result.bars, completedAt, 1),
      }),
      marketProviderCostGuard.run({
        key: marketProviderCoalescingKey({
          operation: "snapshot",
          symbol,
          timestampMs: bucketTimestamp,
        }),
        load: async () => {
          onProviderAttempt();
          const result = await fetchMassiveStockSnapshotResult(symbol);
          if (providerResponseRequiresBackoff(
            result.status,
            result.retryAfter,
          )) {
            throw new MarketChartHttpError(
              "Massive rate-limited the stock snapshot.",
              result.status,
              parseRetryAfterMs(result.retryAfter, Date.now()),
            );
          }
          return result.value;
        },
        cacheIf: (snapshot, completedAt) => {
          if (!snapshot) return false;
          const providerAt = resolveSnapshotTimestampMs(snapshot);
          return evidenceTimestampIsCacheable(
            providerAt === null ? null : new Date(providerAt).toISOString(),
            completedAt,
          );
        },
      }),
      marketProviderCostGuard.run({
        key: marketProviderCoalescingKey({
          operation: "last_trade",
          symbol,
          timestampMs: bucketTimestamp,
        }),
        load: async () => {
          onProviderAttempt();
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
        cacheIf: (trade, completedAt) =>
          Boolean(trade && evidenceTimestampIsCacheable(
            trade.timestamp,
            completedAt,
          )),
      }),
    ]);
  const minuteBars = minuteEvidence.value;
  const secondBars = secondEvidence.value.bars;
  const snapshot = snapshotEvidence.value;
  const lastTrade = lastTradeEvidence.value;
  const providerDisplay = resolveStockDisplayPrice(snapshot, lastTrade);
  if (!providerDisplay) {
    // A stock feed success payload must always satisfy the verified-frame
    // contract its clients validate. Returning bars without a provider-timed
    // display observation would create an unusable HTTP 200 response.
    throw new Error("Stock chart provider returned no verified display frame.");
  }
  const display = await publishStockDisplayFrame(
    symbol,
    providerDisplay,
    requestStartedAt,
  );
  if (!display) {
    throw new Error("Stock chart display-frame coordination is unavailable.");
  }
  const displayPrice = display.price;
  const displayAsOf = display.asOf;
  const alignedMinuteBars = marketBarsAtOrBeforeProviderTimestamp(
    minuteBars,
    displayAsOf,
    60,
  );
  const alignedSecondBars = rollupMarketBars(
    marketBarsAtOrBeforeProviderTimestamp(secondBars, displayAsOf),
  );
  const scopeBars = mergeMarketBars(alignedMinuteBars, alignedSecondBars).filter((bar) =>
    stockSessionAllowedInChartScope(
      getStockMarketClock(new Date(bar.time * 1_000)).session,
      sessionScope,
    ),
  );
  const latestAggregateSession = selectLatestEasternSessionBars(scopeBars);
  const displayedSessionDate = resolveMarketChartDisplayedSessionDate({
    latestAggregateTimestamp: latestAggregateSession.at(-1)
      ? new Date(latestAggregateSession.at(-1)!.time * 1_000).toISOString()
      : null,
    providerTimestamp: displayAsOf,
    sessionScope,
    fallbackTimestamp: requestStartedAt,
  });
  const sessionBars = scopeBars.filter(
    (bar) => easternDateString(bar.time * 1_000) === displayedSessionDate,
  );
  const sessionAuthority = resolveMarketChartSessionAuthority({
    providerTimestamp: displayAsOf,
    displayedSessionDate,
    sessionScope,
    intervalSeconds: 60,
  });
  const mergedBars = mergeVerifiedTradeIntoBars(
    sessionBars,
    sessionAuthority.displayPriceAppliedToCandle && displayPrice > 0 && displayAsOf
      ? {
          price: displayPrice,
          size: display?.size ?? null,
          timestamp: displayAsOf,
        }
      : null,
  );
  const presentationSession = marketChartPollingState(new Date(), sessionScope);
  const displayQuote = {
    price: Number(displayPrice.toFixed(6)),
    changePercent: snapshot
      ? resolveSnapshotChangePercent(snapshot, displayPrice)
      : null,
    asOf: displayAsOf,
    live:
      display.priceKind === "trade" &&
      presentationSession.active &&
      secondEvidence.value.succeeded &&
      isActiveMarketTimestampUsable(
        displayAsOf,
        Date.now(),
        DISPLAY_LIVE_MAX_AGE_MS,
      ),
    changeBasis: "previous_close" as const,
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
    sessionAuthority,
  })) {
    throw new Error("Stock chart frame failed shared-price alignment.");
  }
  return {
    bars: mergedBars,
    realTimeSeconds: secondEvidence.value.succeeded && secondBars.length > 0,
    displayQuote,
    previousClose: Number(snapshot?.prevDay?.c) > 0
      ? Number(snapshot?.prevDay?.c)
      : null,
    sessionAuthority,
    instrumentation: createProviderRequestInstrumentation({
      phase: "bootstrap",
      requestId,
      requestStartedAt,
      responseCompletedAt: new Date(),
      requests: [
        providerReceipt("minute_history", minuteEvidence, minuteBars.length > 0),
        providerReceipt(
          "second_delta",
          secondEvidence,
          secondEvidence.value.succeeded,
        ),
        providerReceipt("snapshot", snapshotEvidence, snapshot !== null),
        providerReceipt("last_trade", lastTradeEvidence, lastTrade !== null),
      ],
    }),
  };
}

export async function GET(request: Request) {
  const requestStartedAt = new Date();
  const requestId = crypto.randomUUID();
  let providerRequestsAttempted = 0;
  const rateLimit = checkApiRateLimit(request, {
    namespace: "public-market-chart",
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return errorResponse(
      "Too many chart requests. Please retry shortly.",
      429,
      rateLimit.headers,
    );
  }
  const searchParams = new URL(request.url).searchParams;
  const asset = searchParams.get("asset")?.trim().toLowerCase() as
    | MarketChartAsset
    | undefined;
  const symbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  if (
    asset === "crypto" &&
    !areCryptoCapabilitiesEnabled([
      "publicApiEnabled",
      "providerCollectionEnabled",
    ])
  ) {
    return cryptoUnavailableResponse();
  }
  const requestedSessionScope = searchParams.get("sessionScope");
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

  const validSymbol = asset === "stock"
    ? STOCK_PATTERN.test(symbol)
    : asset === "crypto" && CRYPTO_SYMBOL_PATTERN.test(symbol);
  if ((asset !== "stock" && asset !== "crypto") || !validSymbol) {
    return errorResponse(
      "A valid asset and symbol are required.",
      400,
      rateLimit.headers,
    );
  }

  try {
    let bars: MarketChartBar[];
    let productId: string | undefined;
    let sourceLabel: string;
    let windowLabel: string;
    let displayQuote: MarketChartResponse["displayQuote"];
    let intervalSeconds = 60;
    let stockBootstrap: Pick<
      MarketChartBootstrapResponse,
      "previousClose" | "sessionAuthority" | "instrumentation"
    > | null = null;

    if (asset === "stock") {
      await preflightStockDisplayFrameCoordination();
      const stockFeed = await fetchStockBars(
        symbol,
        requestStartedAt,
        sessionScope,
        requestId,
        () => {
          providerRequestsAttempted += 1;
        },
      );
      bars = stockFeed.bars;
      displayQuote = stockFeed.displayQuote;
      stockBootstrap = {
        previousClose: stockFeed.previousClose,
        sessionAuthority: stockFeed.sessionAuthority,
        instrumentation: stockFeed.instrumentation,
      };
      sourceLabel = stockFeed.realTimeSeconds
        ? "Massive minute + second aggregates"
        : "Massive minute aggregates";
      const latest = bars.at(-1);
      windowLabel = marketChartHistoryLabel(
        latest ? new Date(latest.time * 1_000).toISOString() : null,
        requestStartedAt,
        sessionScope,
      );
    } else {
      productId = searchParams.get("productId")?.trim().toUpperCase() ?? "";
      if (!CRYPTO_PRODUCT_PATTERN.test(productId)) {
        return errorResponse(
          "A valid USD crypto product is required.",
          400,
          rateLimit.headers,
        );
      }
      const cryptoFeed = await fetchMassiveCryptoChart(symbol, productId);
      bars = cryptoFeed.bars;
      displayQuote = cryptoFeed.displayQuote;
      sourceLabel = cryptoFeed.sourceLabel;
      intervalSeconds = cryptoFeed.intervalSeconds;
      windowLabel = "Rolling 24 hours";
    }

    const summary = summarizeMarketBars(bars, asset === "crypto" ? 12 : 6);
    const latest = bars.at(-1);
    if (!summary || !latest || bars.length < 1) {
      return errorResponse(
        "Verified price history is not available yet.",
        404,
        rateLimit.headers,
      );
    }

    const responsePayload: MarketChartResponse | MarketChartBootstrapResponse = {
      success: true,
      asset,
      symbol,
      ...(productId ? { productId } : {}),
      windowLabel,
      sourceLabel,
      dataMode: asset === "stock"
        ? (displayQuote?.live ? "real_time" : "delayed")
        : undefined,
      ...(displayQuote ? { displayQuote } : {}),
      latestAt: new Date(latest.time * 1_000).toISOString(),
      summary,
      bars,
      intervalSeconds,
      ...(asset === "stock" && stockBootstrap
        ? {
            feedVersion: "market-chart-feed-v1" as const,
            feedPhase: "bootstrap" as const,
            ...stockBootstrap,
          }
        : {}),
    };
    if (asset === "stock" && stockBootstrap) {
      console.info("[market-chart-feed] bootstrap", {
        symbol,
        providerRequests: stockBootstrap.instrumentation.providerRequestCount,
        legacyEquivalent:
          stockBootstrap.instrumentation.legacyEquivalentRequestCount,
        providerAsOf: stockBootstrap.sessionAuthority.providerTimestamp,
        candleAt: stockBootstrap.sessionAuthority.candleIntervalTimestamp,
        applied: stockBootstrap.sessionAuthority.displayPriceAppliedToCandle,
        evidenceDelivery: stockBootstrap.instrumentation.requests.map(
          (receipt) => `${receipt.kind}:${receipt.delivery}`,
        ),
      });
    }
    const responseHeaders = { ...rateLimit.headers };
    if (asset === "stock" && stockBootstrap) {
      responseHeaders["X-HT-Market-Feed-Request"] =
        stockBootstrap.instrumentation.requestId;
      responseHeaders["X-HT-Provider-Requests"] = String(
        stockBootstrap.instrumentation.providerRequestCount,
      );
      responseHeaders["X-HT-Legacy-Equivalent-Requests"] = String(
        stockBootstrap.instrumentation.legacyEquivalentRequestCount,
      );
      responseHeaders["X-HT-Accepted-Provider-Evidence"] = String(
        stockBootstrap.instrumentation.acceptedEvidenceCount,
      );
      responseHeaders["X-HT-Reused-Provider-Evidence"] = String(
        stockBootstrap.instrumentation.reusedEvidenceCount,
      );
    }
    return responseWithCache(responsePayload, responseHeaders);
  } catch (error) {
    console.error("Market chart fetch failed", {
      asset,
      symbol,
      message: error instanceof Error ? error.message : "Unknown error",
      ...(asset === "stock"
        ? { requestId, providerRequestsAttempted }
        : {}),
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
          : "Verified price history is temporarily unavailable.",
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
        ...(asset === "stock"
          ? {
              "X-HT-Market-Feed-Request": requestId,
              "X-HT-Provider-Requests-Attempted": String(
                providerRequestsAttempted,
              ),
            }
          : {}),
      },
    );
  }
}
