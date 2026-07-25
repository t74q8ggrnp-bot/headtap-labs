// TEMPORARY — checks which Polygon endpoints the current plan actually
// allows, so we know what Phase 3 work is possible before any upgrade.
// Delete after use.
import { NextResponse } from "next/server";

const KEY = process.env.POLYGON_API_KEY;

async function check(label: string, url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    return { label, status: res.status, ok: res.ok, message: body?.error ?? body?.message ?? null };
  } catch (err: any) {
    return { label, status: 0, ok: false, message: err?.message };
  }
}

export async function GET() {
  if (!KEY) return NextResponse.json({ error: "no key" }, { status: 500 });
  const results = await Promise.all([
    check("minute_aggs", `https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/minute/2026-07-24/2026-07-24?adjusted=true&limit=5&apiKey=${KEY}`),
    check("second_aggs", `https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/second/2026-07-24/2026-07-24?adjusted=true&limit=5&apiKey=${KEY}`),
    check("real_time_snapshot", `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/AAPL?apiKey=${KEY}`),
    check("last_trade", `https://api.polygon.io/v2/last/trade/AAPL?apiKey=${KEY}`),
    check("last_quote", `https://api.polygon.io/v2/last/nbbo/AAPL?apiKey=${KEY}`),
  ]);
  return NextResponse.json({ results });
}
