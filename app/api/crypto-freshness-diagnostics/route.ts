// app/api/crypto-freshness-diagnostics/route.ts
//
// Read-only: measures the raw lag between "now" and the latest available
// 1-minute candle from Coinbase's public candles endpoint, for a few liquid
// products, completely independent of our own batching/pipeline. Exists to
// find out whether every crypto ProX packet reading fresh:false is caused by
// inherent exchange publishing latency (a calibration issue) versus
// something in our own fetch pipeline (a timing bug). No writes.

import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

const COINBASE_ORIGIN = "https://api.exchange.coinbase.com";
const PRODUCTS = [
  "BTC-USD",
  "ETH-USD",
  "HYPE-USD",
  "XRP-USD",
  "PEPE-USD",
  "USELESS-USD",
  "PUMP-USD",
  "MON-USD",
];

type CoinbaseCandle = [number, number, number, number, number, number];

async function fetchLatestCandle(
  productId: string,
  cacheMode: "no-store" | "revalidate-60",
) {
  const fetchStartedAt = Date.now();
  const url = `${COINBASE_ORIGIN}/products/${encodeURIComponent(productId)}/candles?granularity=60&limit=5`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "HT-Labs-Crypto-Research/1.0" },
    ...(cacheMode === "no-store"
      ? { cache: "no-store" as const }
      : { next: { revalidate: 60 } }),
  });
  const fetchCompletedAt = Date.now();
  if (!response.ok) {
    return { productId, cacheMode, error: `Coinbase responded ${response.status}` };
  }
  const payload = (await response.json()) as CoinbaseCandle[];
  const sorted = [...payload].sort((a, b) => b[0] - a[0]);
  const latest = sorted[0];
  if (!latest) return { productId, cacheMode, error: "No candles returned" };
  const [timeSeconds] = latest;
  const bucketEndMs = (timeSeconds + 60) * 1000;
  const now = Date.now();
  return {
    productId,
    cacheMode,
    fetchDurationMs: fetchCompletedAt - fetchStartedAt,
    latestCandleTime: new Date(timeSeconds * 1000).toISOString(),
    bucketEndTime: new Date(bucketEndMs).toISOString(),
    ageSecondsFromBucketEnd: Math.round((now - bucketEndMs) / 1000),
    wouldBeFreshUnder180s: (now - bucketEndMs) / 1000 <= 180,
    candleCount: payload.length,
  };
}

export async function GET() {
  try {
    const noStore = await Promise.all(
      PRODUCTS.map((p) => fetchLatestCandle(p, "no-store")),
    );
    const cached = await Promise.all(
      PRODUCTS.map((p) => fetchLatestCandle(p, "revalidate-60")),
    );
    const comparison = PRODUCTS.map((productId) => {
      const live = noStore.find((r) => r.productId === productId);
      const withCache = cached.find((r) => r.productId === productId);
      return {
        productId,
        liveAgeSeconds: "ageSecondsFromBucketEnd" in live! ? live.ageSecondsFromBucketEnd : null,
        cachedAgeSeconds:
          "ageSecondsFromBucketEnd" in withCache!
            ? withCache.ageSecondsFromBucketEnd
            : null,
        cachedLatestCandleTime:
          "latestCandleTime" in withCache! ? withCache.latestCandleTime : null,
        liveLatestCandleTime: "latestCandleTime" in live! ? live.latestCandleTime : null,
        matches:
          "latestCandleTime" in live! &&
          "latestCandleTime" in withCache! &&
          live.latestCandleTime === withCache.latestCandleTime,
      };
    });
    return NextResponse.json({
      comparison,
      noStore,
      cached,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
