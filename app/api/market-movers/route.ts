// app/api/market-movers/route.ts

import { NextResponse } from "next/server";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
} from "@/lib/polygon-snapshot";

export const dynamic = "force-dynamic";

const POLYGON_KEY = process.env.POLYGON_API_KEY!;

const EXCLUDED = new Set([
  "SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL",
  "LABD","LABU","TZA","TNA","FAZ","FAS","SDOW","UDOW",
  "SPXU","UPRO","QID","QLD","DXD","TWM","ERY","ERX",
]);

export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ movers: [], count: 0, error: "No API key" });
    }

    const base = "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks";
    const [gainersRes, losersRes] = await Promise.allSettled([
      fetch(`${base}/gainers?include_otc=false&apiKey=${POLYGON_KEY}`, { cache: "no-store" }),
      fetch(`${base}/losers?include_otc=false&apiKey=${POLYGON_KEY}`, { cache: "no-store" }),
    ]);
    const tickers: any[] = [];

    if (gainersRes.status === "fulfilled" && gainersRes.value.ok) {
      const data = await gainersRes.value.json();
      const gainers = data.tickers ?? [];
      console.log(`[market-movers] Gainers: ${gainers.length} tickers`);
      tickers.push(...gainers);
    } else {
      console.warn("[market-movers] Gainers failed");
    }

    if (losersRes.status === "fulfilled" && losersRes.value.ok) {
      const data = await losersRes.value.json();
      const losers = data.tickers ?? [];
      console.log(`[market-movers] Losers: ${losers.length} tickers`);
      tickers.push(...losers);
    } else {
      console.warn("[market-movers] Losers failed");
    }

    const seen = new Set<string>();
    const movers: { symbol: string; price: number; change: number; volume: number; prevVolume: number }[] = [];
    for (const t of tickers) {
      if (!t.ticker || seen.has(t.ticker) || EXCLUDED.has(t.ticker)) continue;
      seen.add(t.ticker);
      const price = resolveSnapshotPrice(t);
      const change = resolveSnapshotChangePercent(t, price);
      const volume = Number(t.day?.v || 0);
      const prevVolume = Number(t.prevDay?.v || 1);
      if (price < 1 || volume < 10000) continue;
      movers.push({ symbol: t.ticker, price, change, volume, prevVolume });
    }

    return NextResponse.json({
      movers,
      count: movers.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[market-movers] Fatal error:", err.message);
    return NextResponse.json({ movers: [], count: 0, error: err.message });
  }
}
