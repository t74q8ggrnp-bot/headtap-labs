import { NextResponse } from "next/server";

const POLYGON_KEY = process.env.POLYGON_API_KEY;

// Returns trading dates — skips weekends
function getDateRange(daysBack: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  // Add extra calendar days to account for weekends/holidays
  from.setDate(from.getDate() - daysBack * 2);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

// ATR(14) = average of true ranges over 14 periods
// True range = max(high-low, |high-prevClose|, |low-prevClose|)
function computeATR14(bars: { o: number; h: number; l: number; c: number }[]): number {
  if (bars.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Use last 14 true ranges
  const last14 = trueRanges.slice(-14);
  const atr = last14.reduce((sum, tr) => sum + tr, 0) / last14.length;
  return Number(atr.toFixed(4));
}

// Recent support/resistance — swing highs and lows from last 20 bars
function computeSupportResistance(
  bars: { h: number; l: number; c: number }[],
  currentPrice: number
): { support: number; resistance: number } {
  const last20 = bars.slice(-20);
  const highs = last20.map(b => b.h);
  const lows = last20.map(b => b.l);

  // Resistance = highest high below 120% of current price
  const resistance = Math.max(...highs.filter(h => h > currentPrice), currentPrice * 1.05);

  // Support = highest low that's below current price
  const support = Math.max(...lows.filter(l => l < currentPrice), currentPrice * 0.9);

  return {
    support: Number(support.toFixed(2)),
    resistance: Number(resistance.toFixed(2)),
  };
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  if (!POLYGON_KEY) {
    return NextResponse.json({ error: "Polygon key not configured" }, { status: 500 });
  }

  try {
    const { from, to } = getDateRange(20);
    const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=30&apiKey=${POLYGON_KEY}`;

    const res = await fetch(url, { next: { revalidate: 3600 } }); // cache 1hr
    if (!res.ok) throw new Error(`Polygon bars ${res.status}`);

    const data = await res.json();
    const bars: { o: number; h: number; l: number; c: number; v: number }[] =
      (data.results || []).map((r: any) => ({
        o: r.o,
        h: r.h,
        l: r.l,
        c: r.c,
        v: r.v,
      }));

    if (bars.length < 5) {
      return NextResponse.json({
        ticker,
        atr14: 0,
        support: 0,
        resistance: 0,
        barCount: bars.length,
        error: "insufficient_bars",
      });
    }

    const atr14 = computeATR14(bars);
    const currentPrice = bars[bars.length - 1].c;
    const { support, resistance } = computeSupportResistance(bars, currentPrice);

    // 20-day volatility (std dev of daily returns) for context
    const returns = bars.slice(1).map((b, i) => (b.c - bars[i].c) / bars[i].c);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length;
    const volatility20d = Number((Math.sqrt(variance) * 100).toFixed(2));

    return NextResponse.json({
      ticker,
      atr14,
      support,
      resistance,
      volatility20d,
      barCount: bars.length,
      computedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error(`[trade-framework] ${ticker}:`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
