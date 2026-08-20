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
const PRODUCTS = ["BTC-USD", "ETH-USD", "HYPE-USD", "XRP-USD"];

type CoinbaseCandle = [number, number, number, number, number, number];

async function fetchLatestCandle(productId: string) {
  const fetchStartedAt = Date.now();
  const url = `${COINBASE_ORIGIN}/products/${encodeURIComponent(productId)}/candles?granularity=60&limit=5`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "HT-Labs-Crypto-Research/1.0" },
    cache: "no-store",
  });
  const fetchCompletedAt = Date.now();
  if (!response.ok) {
    return { productId, error: `Coinbase responded ${response.status}` };
  }
  const payload = (await response.json()) as CoinbaseCandle[];
  const sorted = [...payload].sort((a, b) => b[0] - a[0]);
  const latest = sorted[0];
  if (!latest) return { productId, error: "No candles returned" };
  const [timeSeconds] = latest;
  const bucketEndMs = (timeSeconds + 60) * 1000;
  const now = Date.now();
  return {
    productId,
    fetchDurationMs: fetchCompletedAt - fetchStartedAt,
    latestCandleTime: new Date(timeSeconds * 1000).toISOString(),
    bucketEndTime: new Date(bucketEndMs).toISOString(),
    nowAtCompute: new Date(now).toISOString(),
    ageSecondsFromBucketEnd: Math.round((now - bucketEndMs) / 1000),
    wouldBeFreshUnder180s: (now - bucketEndMs) / 1000 <= 180,
    candleCount: payload.length,
  };
}

export async function GET() {
  try {
    const results = await Promise.all(PRODUCTS.map(fetchLatestCandle));
    return NextResponse.json({ results, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
