import { NextResponse } from "next/server";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
} from "@/lib/polygon-snapshot";

const POLYGON_KEY = process.env.POLYGON_API_KEY;

// avgVolume: 10-day average daily volume — better baseline for relative volume
// than a single previous day (which can itself be unusual). Populated from
// Yahoo when available; Polygon snapshot doesn't expose an average volume field.
type Quote = {
  price: number;
  change: number;
  volume: number;
  prevVolume: number;
  prevClose: number;
  avgVolume: number; // 10-day avg — use this as the relative volume denominator
};

function getLastTradingDate(): string {
  const now = new Date();
  const day = now.getUTCDay();
  let daysBack = 1;
  if (day === 0) daysBack = 2;
  if (day === 1) daysBack = 3;
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().split("T")[0];
}

function getPrevTradingDate(): string {
  const now = new Date();
  const day = now.getUTCDay();
  let daysBack = 2;
  if (day === 0) daysBack = 3;
  if (day === 1) daysBack = 4;
  if (day === 2) daysBack = 4;
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().split("T")[0];
}

async function fetchPolygonGroupedDaily(
  date: string
): Promise<Record<string, { close: number; volume: number; open: number }>> {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Grouped daily failed: ${res.status}`);
  const data = await res.json();
  const out: Record<string, { close: number; volume: number; open: number }> = {};
  for (const r of data?.results ?? []) {
    out[r.T] = { close: Number(r.c || 0), volume: Number(r.v || 0), open: Number(r.o || 0) };
  }
  return out;
}

async function fetchPolygonSnapshot(symbols: string[]): Promise<Record<string, Quote>> {
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbols.join(",")}&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
  const data = await res.json();
  const result: Record<string, Quote> = {};
  for (const t of data?.tickers ?? []) {
    const price = resolveSnapshotPrice(t);
    const prevClose = Number(t?.prevDay?.c || 0);
    const change = resolveSnapshotChangePercent(t, price);

    // Volume: current day volume and previous day volume from Polygon.
    // avgVolume starts at 0 here — Yahoo pass below will fill it in for
    // tickers that go through the fallback, or we'll use prevDay.v as proxy.
    const currentVolume = Number(t?.day?.v || 0);
    const prevDayVolume = Number(t?.prevDay?.v || 0);

    if (price > 0) {
      result[t.ticker] = {
        price,
        change,
        volume: currentVolume,
        prevVolume: prevDayVolume,
        prevClose,
        // Use prevDay.v as initial avgVolume proxy — Yahoo will overwrite
        // with the real 10-day average for any ticker it covers.
        avgVolume: prevDayVolume,
      };
    }
  }
  return result;
}

async function fetchYahooBulk(symbols: string[]): Promise<Record<string, Quote>> {
  // Request averageDailyVolume10Day explicitly — this is the right baseline
  // for relative volume. A single previous day's volume can itself be unusual
  // and would make today look normal when it isn't (or vice versa).
  const fields = [
    "regularMarketPrice",
    "regularMarketChangePercent",
    "regularMarketVolume",
    "regularMarketPreviousClose",
    "averageDailyVolume10Day",
  ].join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}&fields=${fields}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!res.ok) throw new Error("Yahoo failed");
  const result: Record<string, Quote> = {};
  for (const q of (await res.json())?.quoteResponse?.result ?? []) {
    const currentVol = Number(q.regularMarketVolume ?? 0);
    const avgVol = Number(q.averageDailyVolume10Day ?? 0);
    const prevClose = Number(q.regularMarketPreviousClose ?? 0);
    result[q.symbol] = {
      price: Number(q.regularMarketPrice ?? 0),
      change: Number(q.regularMarketChangePercent ?? 0),
      volume: currentVol,
      prevVolume: prevClose > 0 ? avgVol : 0, // prevVolume kept for back-compat
      prevClose,
      avgVolume: avgVol, // real 10-day average — use this for rvol
    };
  }
  return result;
}

// After Polygon and Yahoo both run, merge avgVolume from Yahoo into Polygon
// results so every ticker gets the best available volume baseline.
async function enrichWithYahooAvgVolume(
  merged: Record<string, Quote>,
  symbols: string[]
): Promise<void> {
  // Only fetch Yahoo avg volume for tickers where avgVolume is still 0 or
  // where we only have prevDay.v (a single-day proxy). Run in batches of 50.
  const needsEnrichment = symbols.filter(s => merged[s] && merged[s].avgVolume === merged[s].prevVolume);
  if (!needsEnrichment.length) return;

  for (let i = 0; i < needsEnrichment.length; i += 50) {
    const batch = needsEnrichment.slice(i, i + 50);
    try {
      const fields = "regularMarketVolume,averageDailyVolume10Day,regularMarketPreviousClose";
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(",")}&fields=${fields}`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
      if (!res.ok) continue;
      for (const q of (await res.json())?.quoteResponse?.result ?? []) {
        const avgVol = Number(q.averageDailyVolume10Day ?? 0);
        if (avgVol > 0 && merged[q.symbol]) {
          merged[q.symbol].avgVolume = avgVol;
        }
      }
    } catch { /* silent — enrichment is best-effort */ }
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbols: string[] = body.symbols ?? [];
    if (!symbols.length) return NextResponse.json({ error: "No symbols" }, { status: 400 });

    const merged: Record<string, Quote> = {};

    if (POLYGON_KEY) {
      // Primary: Polygon snapshot (real-time price + today/prev day volume)
      for (let i = 0; i < symbols.length; i += 100) {
        try {
          Object.assign(merged, await fetchPolygonSnapshot(symbols.slice(i, i + 100)));
        } catch {}
      }

      // Fallback for any tickers Polygon missed
      const missing = symbols.filter(s => !merged[s] || merged[s].price === 0);
      if (missing.length > 0) {
        try {
          const [lastDay, prevDay] = await Promise.all([
            fetchPolygonGroupedDaily(getLastTradingDate()),
            fetchPolygonGroupedDaily(getPrevTradingDate()),
          ]);
          for (const symbol of missing) {
            const last = lastDay[symbol];
            const prev = prevDay[symbol];
            if (last?.close > 0) {
              const prevClose = prev?.close || last.open || 0;
              merged[symbol] = {
                price: last.close,
                change: prevClose > 0 ? ((last.close - prevClose) / prevClose) * 100 : 0,
                volume: last.volume,
                prevVolume: prev?.volume || 0,
                prevClose,
                avgVolume: prev?.volume || 0, // will be overwritten by Yahoo enrichment
              };
            }
          }
        } catch (err) { console.warn("Grouped daily failed", err); }
      }

      // Enrich all Polygon results with Yahoo's 10-day avg volume
      await enrichWithYahooAvgVolume(merged, symbols);
    }

    // Full Yahoo fallback for anything still missing
    const stillMissing = symbols.filter(s => !merged[s] || merged[s].price === 0);
    if (stillMissing.length > 0) {
      for (let i = 0; i < stillMissing.length; i += 100) {
        try {
          Object.assign(merged, await fetchYahooBulk(stillMissing.slice(i, i + 100)));
        } catch {}
      }
    }

    return NextResponse.json({ quotes: merged });
  } catch (error) {
    return NextResponse.json({ error: "Failed", quotes: {} }, { status: 500 });
  }
}
