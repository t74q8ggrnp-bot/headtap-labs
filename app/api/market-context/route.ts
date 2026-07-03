// app/api/market-context/route.ts

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const POLYGON_KEY = process.env.POLYGON_API_KEY!;

const EXCLUDED_FROM_VIX = new Set(["SQQQ","TQQQ","UVXY","SVXY"]);

export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ error: "No API key" }, { status: 500 });
    }

    // Fetch SPY, QQQ, IWM and VIXY in one snapshot call
    const tickers = ["SPY", "QQQ", "IWM", "VIXY"];
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(",")}&apiKey=${POLYGON_KEY}`;

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      return NextResponse.json({ error: `Polygon failed: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    const tickerMap: Record<string, any> = {};
    for (const t of data?.tickers ?? []) {
      tickerMap[t.ticker] = t;
    }

    const parse = (symbol: string) => {
      const t = tickerMap[symbol];
      if (!t) return null;
      const price = Number(t.lastTrade?.p || t.day?.c || t.prevDay?.c || 0);
      const prevClose = Number(t.prevDay?.c || 0);
      const change = prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : Number(t.todaysChangePerc || 0);
      const volume = Number(t.day?.v || 0);
      const prevVolume = Number(t.prevDay?.v || 1);
      const rvol = prevVolume > 0 ? volume / prevVolume : 1;
      return {
        price: Number(price.toFixed(2)),
        change: Number(change.toFixed(2)),
        rvol: Number(rvol.toFixed(2)),
      };
    };

    const spy = parse("SPY");
    const qqq = parse("QQQ");
    const iwm = parse("IWM");
    const vixy = parse("VIXY");

    const avgChange = ((spy?.change ?? 0) + (qqq?.change ?? 0)) / 2;
    const mood = avgChange >= 0.5 ? "Risk On" : avgChange <= -0.5 ? "Risk Off" : "Neutral";
    const moodColor = mood === "Risk On" ? "green" : mood === "Risk Off" ? "red" : "zinc";

    const avgRvol = ((spy?.rvol ?? 1) + (qqq?.rvol ?? 1)) / 2;
    const volumeEnv = avgRvol >= 1.3 ? "Heavy" : avgRvol >= 0.85 ? "Normal" : "Light";

    return NextResponse.json({
      spy: spy ?? { price: 0, change: 0, rvol: 1 },
      qqq: qqq ?? { price: 0, change: 0, rvol: 1 },
      iwm: iwm ?? { price: 0, change: 0, rvol: 1 },
      vix: vixy,
      mood,
      moodColor,
      volumeEnv,
      avgRvol: Number(avgRvol.toFixed(2)),
      timestamp: new Date().toISOString(),
    });

  } catch (err: any) {
    console.error("[market-context]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
