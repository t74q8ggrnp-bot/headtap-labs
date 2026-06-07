import { NextResponse } from "next/server";

const EXCLUDED = new Set([
  "SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL",
  "LABD","LABU","TZA","TNA","FAZ","FAS","YANG","YINN",
  "SDOW","UDOW","ERY","ERX","HIBL","HIBS","DRIP","GUSH",
]);

type PremarketMover = {
  symbol: string;
  price: number;
  extendedPrice: number;
  extendedChange: number;
  extendedChangePercent: number;
  regularChangePercent: number;
  htPremarketScore: number;
  opportunityType: "gap_up" | "gap_down" | "continuation" | "reversal";
  signal: string;
  whyItMatters: string;
  riskNote: string;
  sessionType: "pre_market" | "after_hours" | "regular";
};

function getMarketSession(): { session: string; label: string } {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  const min = et.getMinutes();
  const totalMin = hour * 60 + min;

  if (totalMin >= 240 && totalMin < 570) return { session: "premarket", label: "⏰ Premarket Intelligence" };
  if (totalMin >= 960 && totalMin < 1200) return { session: "after_hours", label: "🌙 After Hours Intelligence" };
  if (totalMin >= 570 && totalMin < 960) return { session: "regular", label: "📋 Session Movers" };
  return { session: "closed", label: "💤 Market Closed" };
}

async function getMoversWithExtended(screenerIds: string[]): Promise<any[]> {
  const allQuotes: any[] = [];

  for (const scrId of screenerIds) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=25&fields=symbol,regularMarketPrice,regularMarketChange,regularMarketChangePercent,preMarketPrice,preMarketChange,preMarketChangePercent,postMarketPrice,postMarketChange,postMarketChangePercent,regularMarketVolume,marketCap`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            "Accept": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(7000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const quotes = data?.finance?.result?.[0]?.quotes ?? [];
      allQuotes.push(...quotes);
    } catch {
      continue;
    }
  }

  return allQuotes;
}

function scoreAndClassify(q: any, session: string): PremarketMover | null {
  const symbol = q.symbol;
  if (!symbol || EXCLUDED.has(symbol)) return null;

  const regularPrice = q.regularMarketPrice ?? 0;
  if (regularPrice < 1 || regularPrice > 5000) return null;

  const regularChangePct = q.regularMarketChangePercent ?? 0;

  // Get extended hours data based on session
  let extPrice = 0, extChange = 0, extChangePct = 0;
  let sessionType: PremarketMover["sessionType"] = "regular";

  if (session === "premarket" && q.preMarketPrice) {
    extPrice = q.preMarketPrice;
    extChange = q.preMarketChange ?? 0;
    extChangePct = q.preMarketChangePercent ?? 0;
    sessionType = "pre_market";
  } else if (session === "after_hours" && q.postMarketPrice) {
    extPrice = q.postMarketPrice;
    extChange = q.postMarketChange ?? 0;
    extChangePct = q.postMarketChangePercent ?? 0;
    sessionType = "after_hours";
  } else {
    // Regular hours — use regular market data
    extPrice = regularPrice;
    extChange = q.regularMarketChange ?? 0;
    extChangePct = regularChangePct;
    sessionType = "regular";
  }

  if (Math.abs(extChangePct) < 1 && session !== "regular") return null;
  if (Math.abs(extChangePct) < 2 && session === "regular") return null;

  // Score
  let score = 0;
  const absMove = Math.abs(extChangePct);
  score += Math.min(35, absMove * 2.5);

  const sameDir = (extChangePct > 0 && regularChangePct > 0) || (extChangePct < 0 && regularChangePct < 0);
  if (sameDir) score += 12;

  const marketCap = q.marketCap ?? 0;
  if (marketCap > 0 && marketCap < 2e9) score += 15;
  else if (marketCap > 0 && marketCap < 10e9) score += 8;

  const volume = q.regularMarketVolume ?? 0;
  if (volume > 1000000) score += 8;
  if (volume > 5000000) score += 5;

  if (absMove >= 5) score += 8;
  if (absMove >= 10) score += 7;
  if (absMove >= 20) score -= 10;

  score = Math.min(99, Math.max(0, Math.round(score)));
  if (score < 20) return null;

  // Classify
  let opportunityType: PremarketMover["opportunityType"] = "continuation";
  if (extChangePct > 3) opportunityType = "gap_up";
  else if (extChangePct < -3) opportunityType = "gap_down";
  else if (extChangePct > 0 && regularChangePct < 0) opportunityType = "reversal";
  else if (extChangePct < 0 && regularChangePct > 0) opportunityType = "reversal";

  const sessionLabel = sessionType === "pre_market" ? "premarket" : sessionType === "after_hours" ? "after hours" : "today";

  const signal =
    opportunityType === "gap_up" ? `Gap up ${extChangePct.toFixed(1)}% ${sessionLabel}` :
    opportunityType === "gap_down" ? `Gap down ${Math.abs(extChangePct).toFixed(1)}% ${sessionLabel}` :
    opportunityType === "reversal" ? `Reversal forming ${sessionLabel}` :
    `${extChangePct > 0 ? "+" : ""}${extChangePct.toFixed(1)}% ${sessionLabel}`;

  const whyItMatters =
    opportunityType === "gap_up"
      ? `${symbol} is up ${extChangePct.toFixed(1)}% ${sessionLabel}. Watch for volume confirmation at open to see if the move holds.`
      : opportunityType === "gap_down"
      ? `${symbol} is down ${Math.abs(extChangePct).toFixed(1)}% ${sessionLabel}. Watch for stabilization — gap fills can create fast recovery opportunities.`
      : opportunityType === "reversal"
      ? `${symbol} is reversing ${sessionLabel}, moving opposite to the regular session. Sentiment may be shifting.`
      : `${symbol} is continuing its move ${sessionLabel} with ${extChangePct > 0 ? "buyers" : "sellers"} still in control.`;

  const riskNote =
    absMove >= 15 ? "Extended move — high risk of reversal. Wait for volume confirmation before acting." :
    absMove >= 8 ? "Significant move — can fade fast. Watch the first few minutes carefully." :
    "Normal extended hours activity. Follow standard entry rules.";

  return {
    symbol,
    price: regularPrice,
    extendedPrice: extPrice,
    extendedChange: extChange,
    extendedChangePercent: extChangePct,
    regularChangePercent: regularChangePct,
    htPremarketScore: score,
    opportunityType,
    signal,
    whyItMatters,
    riskNote,
    sessionType,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";

  const { session, label } = getMarketSession();

  try {
    const quotes = await getMoversWithExtended([
      "day_gainers", "day_losers", "most_actives"
    ]);

    // Dedupe
    const seen = new Set<string>();
    const unique = quotes.filter(q => {
      if (!q?.symbol || seen.has(q.symbol)) return false;
      seen.add(q.symbol);
      return true;
    });

    const movers: PremarketMover[] = [];
    for (const q of unique) {
      const m = scoreAndClassify(q, session);
      if (m) movers.push(m);
    }

    movers.sort((a, b) => b.htPremarketScore - a.htPremarketScore);

    let filtered = movers;
    if (type === "gap_up") filtered = movers.filter(m => m.opportunityType === "gap_up");
    if (type === "gap_down") filtered = movers.filter(m => m.opportunityType === "gap_down");
    if (type === "reversal") filtered = movers.filter(m => m.opportunityType === "reversal");

    return NextResponse.json({
      movers: filtered.slice(0, 20),
      total: filtered.length,
      marketStatus: session,
      sessionLabel: label,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Premarket error:", error);
    return NextResponse.json({ error: "Data unavailable", movers: [], marketStatus: session }, { status: 500 });
  }
}
