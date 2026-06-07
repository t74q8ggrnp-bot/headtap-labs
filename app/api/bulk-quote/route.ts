import { NextResponse } from "next/server";

const POLYGON_KEY = process.env.POLYGON_API_KEY;

type Quote = { price: number; change: number; volume: number; prevVolume: number; prevClose: number };

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

async function fetchPolygonGroupedDaily(date: string): Promise<Record<string, { close: number; volume: number; open: number }>> {
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
    const price = Number(t?.day?.c || t?.prevDay?.c || 0);
    const prevClose = Number(t?.prevDay?.c || 0);
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : Number(t?.todaysChangePerc || 0);
    if (price > 0) result[t.ticker] = { price, change, volume: Number(t?.day?.v || 0), prevVolume: Number(t?.prevDay?.v || 0), prevClose };
  }
  return result;
}

async function fetchYahooBulk(symbols: string[]): Promise<Record<string, Quote>> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,regularMarketPreviousClose`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!res.ok) throw new Error("Yahoo failed");
  const result: Record<string, Quote> = {};
  for (const q of (await res.json())?.quoteResponse?.result ?? []) {
    result[q.symbol] = { price: Number(q.regularMarketPrice ?? 0), change: Number(q.regularMarketChangePercent ?? 0), volume: Number(q.regularMarketVolume ?? 0), prevVolume: 0, prevClose: Number(q.regularMarketPreviousClose ?? 0) };
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbols: string[] = body.symbols ?? [];
    if (!symbols.length) return NextResponse.json({ error: "No symbols" }, { status: 400 });

    const merged: Record<string, Quote> = {};

    if (POLYGON_KEY) {
      for (let i = 0; i < symbols.length; i += 100) {
        try { Object.assign(merged, await fetchPolygonSnapshot(symbols.slice(i, i + 100))); } catch {}
      }
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
              merged[symbol] = { price: last.close, change: prevClose > 0 ? ((last.close - prevClose) / prevClose) * 100 : 0, volume: last.volume, prevVolume: prev?.volume || 0, prevClose };
            }
          }
        } catch (err) { console.warn("Grouped daily failed", err); }
      }
    }

    const stillMissing = symbols.filter(s => !merged[s] || merged[s].price === 0);
    if (stillMissing.length > 0) {
      for (let i = 0; i < stillMissing.length; i += 100) {
        try { Object.assign(merged, await fetchYahooBulk(stillMissing.slice(i, i + 100))); } catch {}
      }
    }

    return NextResponse.json({ quotes: merged });
  } catch (error) {
    return NextResponse.json({ error: "Failed", quotes: {} }, { status: 500 });
  }
}