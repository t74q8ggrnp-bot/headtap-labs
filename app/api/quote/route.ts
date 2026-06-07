import { NextResponse } from "next/server";

async function getPolygonQuote(symbol: string) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("Missing POLYGON_API_KEY");
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Polygon quote failed for ${symbol}: ${res.status}`);
  const data = await res.json();
  const t = data?.ticker;
  if (!t) throw new Error(`No ticker data from Polygon for ${symbol}`);
  const price = Number(t?.day?.c || t?.prevDay?.c || 0);
  const prevClose = Number(t?.prevDay?.c || 0);
  const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : Number(t?.todaysChangePerc || 0);
  if (!price) throw new Error(`Polygon returned no price for ${symbol}`);
  return { symbol, c: price, dp: change, pc: prevClose, high: Number(t?.day?.h || 0), low: Number(t?.day?.l || 0), open: Number(t?.day?.o || 0), volume: Number(t?.day?.v || 0), source: "polygon" };
}

async function getFinnhubQuote(symbol: string) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("Missing FINNHUB_API_KEY");
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub quote failed for ${symbol}`);
  const data = await res.json();
  const price = Number(data.c || 0);
  if (!price) throw new Error(`Finnhub returned no price for ${symbol}`);
  return { symbol, c: price, dp: Number(data.dp || 0), pc: Number(data.pc || 0), high: Number(data.h || 0), low: Number(data.l || 0), open: Number(data.o || 0), volume: 0, source: "finnhub" };
}

async function getYahooQuote(symbol: string) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo quote failed for ${symbol}`);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice || 0);
  const prevClose = Number(meta?.chartPreviousClose || meta?.previousClose || 0);
  const change = price && prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  return { symbol, c: price, dp: change, pc: prevClose, high: 0, low: 0, open: 0, volume: 0, source: "yahoo" };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol")?.toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "Missing symbol", c: 0, dp: 0 }, { status: 400 });

    try { return NextResponse.json(await getPolygonQuote(symbol)); } catch {}
    try { return NextResponse.json(await getFinnhubQuote(symbol)); } catch {}
    return NextResponse.json(await getYahooQuote(symbol));
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch quote", c: 0, dp: 0, symbol: null, source: "error" }, { status: 500 });
  }
}
