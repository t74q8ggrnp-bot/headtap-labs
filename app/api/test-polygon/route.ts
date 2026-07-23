// app/api/test-polygon/route.ts
// Tests if specific tickers return data from Polygon snapshot
// Visit /api/test-polygon?tickers=BNRG,IMTE,CRSP after deploy
// DELETE THIS FILE after testing

import { NextResponse } from "next/server";
import { resolveSnapshotPrice } from "@/lib/polygon-snapshot";

export const dynamic = "force-dynamic";

const POLYGON_KEY = process.env.POLYGON_API_KEY!;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickers = searchParams.get("tickers") || "BNRG,IMTE,CRSP,WHLR";

  // Test 1: Snapshot with specific tickers (what bulk-quote uses)
  const snap1 = await fetch(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${POLYGON_KEY}`,
    { cache: "no-store" }
  ).then(r => r.json()).catch(e => ({ error: e.message }));

  // Test 2: Grouped daily (fallback in bulk-quote)
  const today = new Date();
  today.setDate(today.getDate() - 1);
  const dateStr = today.toISOString().split("T")[0];
  const grouped = await fetch(
    `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&apiKey=${POLYGON_KEY}`,
    { cache: "no-store" }
  ).then(r => r.json()).catch(e => ({ error: e.message }));

  const tickerList = tickers.split(",");
  const groupedResults: Record<string, any> = {};
  for (const r of grouped.results ?? []) {
    if (tickerList.includes(r.T)) groupedResults[r.T] = r;
  }

  return NextResponse.json({
    snapshotResults: (snap1.tickers ?? []).map((t: any) => ({
      ticker: t.ticker,
      price: resolveSnapshotPrice(t),
      rawLastTrade: t.lastTrade?.p ?? null,
      rawDayClose: t.day?.c ?? null,
      change: t.todaysChangePerc,
      dayVolume: t.day?.v,
      prevDayVolume: t.prevDay?.v,
      hasData: resolveSnapshotPrice(t) > 0,
    })),
    snapshotCount: snap1.tickers?.length ?? 0,
    groupedResults,
    groupedDate: dateStr,
  });
}
