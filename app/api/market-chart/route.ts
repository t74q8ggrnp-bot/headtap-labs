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
  fetchMassiveLastTrade,
  fetchMassiveStockSnapshot,
} from "@/lib/massive-stocks";
import {
  resolveSnapshotChangePercent,
} from "@/lib/polygon-snapshot";
import { resolveStockDisplayPrice } from "@/lib/stock-display-price";
import { isActiveMarketTimestampUsable } from "@/lib/market-data-time";
import { getStockMarketClock, stockHistoryLabel } from "@/lib/stock-market-session";
import { fetchMassiveCryptoChart } from "@/lib/massive-crypto";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";

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

async function fetchStockBars(symbol: string): Promise<{
  bars: MarketChartBar[];
  realTimeSeconds: boolean;
  displayQuote?: MarketChartResponse["displayQuote"];
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
  const secondPath =
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/second/` +
    `${now.getTime() - 15 * 60 * 1_000}/${now.getTime()}`;
  const secondParams = new URLSearchParams({
    adjusted: "true",
    sort: "asc",
    limit: "50000",
    apiKey,
  });
  const [response, secondResponse, snapshot, lastTrade] = await Promise.all([
    fetch(`${POLYGON_ORIGIN}${path}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetch(`${POLYGON_ORIGIN}${secondPath}?${secondParams}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetchMassiveStockSnapshot(symbol),
    fetchMassiveLastTrade(symbol),
  ]);
  if (!response.ok) {
    throw new Error(`Stock chart provider returned ${response.status}.`);
  }

  const payload = (await response.json()) as PolygonPayload;
  const results = Array.isArray(payload.results)
    ? (payload.results as PolygonAggregate[])
    : [];
  const minuteBars = normalizeMarketBars(
      results.map((bar) => ({
        time: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      })),
    );
  let secondBars: MarketChartBar[] = [];
  if (secondResponse.ok) {
    const secondPayload = (await secondResponse.json()) as PolygonPayload;
    const secondResults = Array.isArray(secondPayload.results)
      ? (secondPayload.results as PolygonAggregate[])
      : [];
    secondBars = rollupMarketBars(
      normalizeMarketBars(
        secondResults.map((bar) => ({
          time: bar.t,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        })),
      ),
    );
  }
  const display = resolveStockDisplayPrice(snapshot, lastTrade);
  const displayPrice = display?.price ?? 0;
  const displayAsOf = display?.asOf ?? null;
  const mergedBars = selectLatestEasternSessionBars(
    mergeVerifiedTradeIntoBars(
      mergeMarketBars(minuteBars, secondBars),
      displayPrice > 0 && displayAsOf
        ? {
            price: displayPrice,
            size: display?.size ?? null,
            timestamp: displayAsOf,
          }
        : null,
    ),
  );
  const clock = getStockMarketClock();
  const displayQuote = snapshot && displayPrice > 0 && displayAsOf
    ? {
        price: Number(displayPrice.toFixed(6)),
        changePercent: resolveSnapshotChangePercent(snapshot, displayPrice),
        asOf: displayAsOf,
        live: display!.priceKind === "trade" && clock.active && secondResponse.ok && isActiveMarketTimestampUsable(displayAsOf, Date.now(), DISPLAY_LIVE_MAX_AGE_MS),
        changeBasis: "previous_close" as const,
        source: display!.source,
        priceKind: display!.priceKind,
      }
    : undefined;
  return {
    bars: mergedBars,
    realTimeSeconds: secondResponse.ok,
    displayQuote,
  };
}

export async function GET(request: Request) {
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

    if (asset === "stock") {
      const stockFeed = await fetchStockBars(symbol);
      bars = stockFeed.bars;
      displayQuote = stockFeed.displayQuote;
      sourceLabel = stockFeed.realTimeSeconds
        ? "Massive real-time minute + second aggregates"
        : "Massive minute aggregates";
      const latest = bars.at(-1);
      windowLabel = stockHistoryLabel(latest ? new Date(latest.time * 1_000).toISOString() : null);
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
    if (!summary || !latest || bars.length < 2) {
      return errorResponse(
        "Verified price history is not available yet.",
        404,
        rateLimit.headers,
      );
    }

    return responseWithCache({
      success: true,
      asset,
      symbol,
      ...(productId ? { productId } : {}),
      windowLabel,
      sourceLabel,
      dataMode: asset === "stock"
        ? (sourceLabel.includes("real-time") ? "real_time" : "delayed")
        : undefined,
      ...(displayQuote ? { displayQuote } : {}),
      latestAt: new Date(latest.time * 1_000).toISOString(),
      summary,
      bars,
      intervalSeconds,
    }, rateLimit.headers);
  } catch (error) {
    console.error("Market chart fetch failed", {
      asset,
      symbol,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return errorResponse(
      "Verified price history is temporarily unavailable.",
      502,
      rateLimit.headers,
    );
  }
}
