import {
  easternDateString,
  mergeMarketBars,
  normalizeMarketBars,
  rollupMarketBars,
  selectLatestEasternSessionBars,
  summarizeMarketBars,
  type MarketChartAsset,
  type MarketChartBar,
  type MarketChartResponse,
} from "@/lib/market-chart";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

const POLYGON_ORIGIN = "https://api.polygon.io";
const COINBASE_ORIGIN = "https://api.exchange.coinbase.com";
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
  const [response, secondResponse] = await Promise.all([
    fetch(`${POLYGON_ORIGIN}${path}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
    fetch(`${POLYGON_ORIGIN}${secondPath}?${secondParams}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }),
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
  return {
    bars: selectLatestEasternSessionBars(
      mergeMarketBars(minuteBars, secondBars),
    ),
    realTimeSeconds: secondResponse.ok,
  };
}

async function fetchCryptoBars(productId: string): Promise<MarketChartBar[]> {
  const params = new URLSearchParams({ granularity: "300" });
  const response = await fetch(
    `${COINBASE_ORIGIN}/products/${encodeURIComponent(productId)}/candles?${params}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "HT-Labs-Crypto-Research/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Crypto chart provider returned ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];
  return normalizeMarketBars(
    payload.map((bar) => {
      const candle = Array.isArray(bar) ? bar : [];
      return {
        time: candle[0],
        low: candle[1],
        high: candle[2],
        open: candle[3],
        close: candle[4],
        volume: candle[5],
      };
    }),
  ).slice(-288);
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

    if (asset === "stock") {
      const stockFeed = await fetchStockBars(symbol);
      bars = stockFeed.bars;
      sourceLabel = stockFeed.realTimeSeconds
        ? "Massive real-time minute + second aggregates"
        : "Massive minute aggregates";
      const latest = bars.at(-1);
      windowLabel = latest && easternDateString(latest.time * 1_000) === easternDateString(new Date())
        ? "Current session"
        : "Latest verified session";
    } else {
      productId = searchParams.get("productId")?.trim().toUpperCase() ?? "";
      if (!CRYPTO_PRODUCT_PATTERN.test(productId)) {
        return errorResponse(
          "A valid USD crypto product is required.",
          400,
          rateLimit.headers,
        );
      }
      bars = await fetchCryptoBars(productId);
      sourceLabel = "Coinbase 5-minute candles";
      windowLabel = "Rolling 24 hours";
    }

    const summary = summarizeMarketBars(bars);
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
      latestAt: new Date(latest.time * 1_000).toISOString(),
      summary,
      bars,
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
