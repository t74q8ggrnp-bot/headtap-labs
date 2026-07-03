import { NextResponse } from "next/server";

// ============================================================
// HT LABS — EXPANDED SCANNER
// Pulls broader market data from Yahoo Finance screeners:
// - Top gainers
// - Top losers
// - Most active (unusual volume)
// Returns normalized ticker list with avgVolume included
// so relative volume can be computed correctly downstream.
//
// Finnhub pattern scanner removed — it returned symbols with
// no price/volume data and required enrichment that never ran.
// ============================================================

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
  volume: number;
  avgVolume: number; // 10-day average — correct rvol denominator
  source: string;
};

function mapQuote(q: any, source: string): ScannedTicker {
  return {
    symbol: q.symbol,
    price: Number(q.regularMarketPrice ?? 0),
    change: Number(q.regularMarketChange ?? 0),
    changePercent: Number(q.regularMarketChangePercent ?? 0),
    volume: Number(q.regularMarketVolume ?? 0),
    avgVolume: Number(q.averageDailyVolume10Day ?? 0),
    source,
  };
}

async function fetchScreener(scrId: string, count: number, source: string): Promise<ScannedTicker[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`,
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
      .map((q: any) => mapQuote(q, source));
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
      tickers = await fetchScreener("day_gainers", 25, "gainers");
    } else if (type === "active") {
      tickers = await fetchScreener("most_actives", 25, "most_active");
    } else if (type === "losers") {
      tickers = await fetchScreener("day_losers", 15, "losers");
    } else {
      // All sources in parallel
      const [gainers, active, losers] = await Promise.all([
        fetchScreener("day_gainers", 25, "gainers"),
        fetchScreener("most_actives", 25, "most_active"),
        fetchScreener("day_losers", 15, "losers"),
      ]);

      // Dedupe by symbol — gainers > active > losers priority
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
