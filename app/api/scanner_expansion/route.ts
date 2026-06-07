import { NextResponse } from "next/server";

// ============================================================
// HT LABS — EXPANDED SCANNER
// Pulls broader market data from Finnhub:
// - Top gainers
// - Top losers  
// - Most active (unusual volume)
// - News-driven movers
// Returns normalized ticker list for HT scoring
// ============================================================

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

// Tickers to always exclude
const EXCLUDED = new Set([
  "SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL",
  "LABD","LABU","TZA","TNA","FAZ","FAS","YANG","YINN",
  "SDOW","UDOW","ERY","ERX","HIBL","HIBS","DRIP","GUSH",
]);

type ScannedTicker = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  source: string;
};

async function getTopMovers(): Promise<ScannedTicker[]> {
  if (!FINNHUB_KEY) return [];
  try {
    // Finnhub market status + top movers via news/earnings scan
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/market-status?exchange=US&token=${FINNHUB_KEY}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    // Use Yahoo Finance for top movers — more reliable
    const gainersRes = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=25",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!gainersRes.ok) return [];
    const data = await gainersRes.json();
    const quotes = data?.finance?.result?.[0]?.quotes ?? [];
    return quotes
      .filter((q: any) => q.symbol && !EXCLUDED.has(q.symbol) && q.regularMarketPrice > 1)
      .map((q: any) => ({
        symbol: q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        volume: q.regularMarketVolume,
        source: "gainers",
      }));
  } catch {
    return [];
  }
}

async function getMostActive(): Promise<ScannedTicker[]> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=25",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const quotes = data?.finance?.result?.[0]?.quotes ?? [];
    return quotes
      .filter((q: any) => q.symbol && !EXCLUDED.has(q.symbol) && q.regularMarketPrice > 1)
      .map((q: any) => ({
        symbol: q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        volume: q.regularMarketVolume,
        source: "most_active",
      }));
  } catch {
    return [];
  }
}

async function getTopLosers(): Promise<ScannedTicker[]> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers&count=15",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const quotes = data?.finance?.result?.[0]?.quotes ?? [];
    return quotes
      .filter((q: any) => q.symbol && !EXCLUDED.has(q.symbol) && q.regularMarketPrice > 1)
      .map((q: any) => ({
        symbol: q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        volume: q.regularMarketVolume,
        source: "losers",
      }));
  } catch {
    return [];
  }
}

async function getUnusualVolume(): Promise<ScannedTicker[]> {
  if (!FINNHUB_KEY) return [];
  try {
    // Finnhub unusual volume scan
    const res = await fetch(
      `https://finnhub.io/api/v1/scanner/pattern?resolution=D&token=${FINNHUB_KEY}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const patterns = data?.data ?? [];
    return patterns
      .filter((p: any) => p.symbol && !EXCLUDED.has(p.symbol))
      .slice(0, 15)
      .map((p: any) => ({
        symbol: p.symbol,
        price: 0, // will be enriched
        change: 0,
        changePercent: 0,
        source: "pattern",
      }));
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";

  try {
    let tickers: ScannedTicker[] = [];

    if (type === "gainers") {
      tickers = await getTopMovers();
    } else if (type === "active") {
      tickers = await getMostActive();
    } else if (type === "losers") {
      tickers = await getTopLosers();
    } else {
      // All sources in parallel
      const [gainers, active, losers] = await Promise.all([
        getTopMovers(),
        getMostActive(),
        getTopLosers(),
      ]);

      // Dedupe by symbol, priority: gainers > active > losers
      const seen = new Set<string>();
      for (const t of [...gainers, ...active, ...losers]) {
        if (!seen.has(t.symbol)) {
          seen.add(t.symbol);
          tickers.push(t);
        }
      }
    }

    // Sort by absolute % change
    tickers.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

    return NextResponse.json({
      tickers: tickers.slice(0, 50),
      total: tickers.length,
      timestamp: new Date().toISOString(),
      sources: ["yahoo_gainers", "yahoo_active", "yahoo_losers"],
    });

  } catch (error) {
    console.error("Scanner expansion error:", error);
    return NextResponse.json({ error: "Scanner failed", tickers: [] }, { status: 500 });
  }
}
