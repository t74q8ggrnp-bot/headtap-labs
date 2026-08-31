import { NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { fetchMassiveMarketMovers } from "@/lib/massive-market-movers";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
  resolveSnapshotTimestampMs,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import { probeMassiveRealtimeEntitlement } from "@/lib/massive-stocks";
import { getStockMarketClock, type StockMarketSession } from "@/lib/stock-market-session";

export const dynamic = "force-dynamic";

const EXCLUDED = new Set([
  "SQQQ", "TQQQ", "SOXS", "SOXL", "UVXY", "SVXY", "SPXS", "SPXL",
  "LABD", "LABU", "TZA", "TNA", "FAZ", "FAS", "YANG", "YINN",
  "SDOW", "UDOW", "ERY", "ERX", "HIBL", "HIBS", "DRIP", "GUSH",
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
  sessionType: StockMarketSession;
  marketAsOf: string | null;
};

function sessionLabel(session: StockMarketSession) {
  if (session === "pre_market") return "Premarket Intelligence";
  if (session === "after_hours") return "After Hours Intelligence";
  if (session === "regular") return "Session Movers";
  return "Market Closed — Last Verified Movers";
}

function classify(row: PolygonSnapshotRow, session: StockMarketSession): PremarketMover | null {
  const symbol = String(row.ticker ?? "").trim().toUpperCase();
  const price = resolveSnapshotPrice(row);
  if (!symbol || EXCLUDED.has(symbol) || price <= 0 || price > 5_000) return null;
  const changePercent = resolveSnapshotChangePercent(row, price);
  if (Math.abs(changePercent) < 1) return null;
  const previousClose = Number(row.prevDay?.c ?? 0);
  const volume = Math.max(Number(row.day?.v ?? 0), Number(row.min?.av ?? 0));
  const absoluteMove = Math.abs(changePercent);
  let score = Math.min(35, absoluteMove * 2.5);
  if (volume > 1_000_000) score += 8;
  if (volume > 5_000_000) score += 5;
  if (absoluteMove >= 5) score += 8;
  if (absoluteMove >= 10) score += 7;
  if (absoluteMove >= 20) score -= 10;
  score = Math.min(99, Math.max(0, Math.round(score)));
  if (score < 20) return null;

  const opportunityType = changePercent > 3
    ? "gap_up"
    : changePercent < -3
      ? "gap_down"
      : "continuation";
  const movement = `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%`;
  const sessionText = session === "pre_market"
    ? "premarket"
    : session === "after_hours"
      ? "after hours"
      : session === "closed"
        ? "in the last verified session"
        : "today";
  const timestampMs = resolveSnapshotTimestampMs(row);
  return {
    symbol,
    price,
    extendedPrice: price,
    extendedChange: previousClose > 0 ? price - previousClose : 0,
    extendedChangePercent: changePercent,
    regularChangePercent: changePercent,
    htPremarketScore: score,
    opportunityType,
    signal: `${movement} ${sessionText}`,
    whyItMatters: `${symbol} moved ${movement} ${sessionText}; this secondary view observes Massive movers and does not control canonical ranking.`,
    riskNote: absoluteMove >= 15
      ? "Extended move — elevated reversal and execution risk."
      : absoluteMove >= 8
        ? "Significant move — verify liquidity and continuation."
        : "Observation only — confirm current conditions before acting.",
    sessionType: session,
    marketAsOf: timestampMs ? new Date(timestampMs).toISOString() : null,
  };
}

export async function GET(request: Request) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "premarket-observation",
    limit: 30,
    windowMs: 60_000,
  });
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    ...rateLimit.headers,
  };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Premarket observation rate limit reached.", movers: [] },
      { status: 429, headers },
    );
  }

  const type = new URL(request.url).searchParams.get("type") ?? "all";
  const clock = getStockMarketClock();
  try {
    const [source, entitlement] = await Promise.all([
      fetchMassiveMarketMovers(),
      probeMassiveRealtimeEntitlement(),
    ]);
    const unique = new Map<string, PremarketMover>();
    for (const row of [...source.gainers, ...source.losers]) {
      const mover = classify(row, clock.session);
      if (mover && !unique.has(mover.symbol)) unique.set(mover.symbol, mover);
    }
    let movers = [...unique.values()].sort(
      (left, right) => right.htPremarketScore - left.htPremarketScore,
    );
    if (type !== "all") {
      movers = movers.filter((mover) => mover.opportunityType === type);
    }
    const degraded = source.errors.length > 0;
    return NextResponse.json({
      movers: movers.slice(0, 20),
      total: movers.length,
      marketStatus: clock.session,
      sessionLabel: sessionLabel(clock.session),
      timestamp: new Date().toISOString(),
      provider: "massive_polygon",
      dataMode: entitlement.dataMode,
      authority: "qa_observation_only",
      degraded,
      degradedReasons: source.errors,
    }, { status: degraded && movers.length === 0 ? 503 : 200, headers });
  } catch (error) {
    console.error("[premarket] Massive mover read failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Verified premarket observations are unavailable.",
        movers: [],
        marketStatus: clock.session,
      },
      { status: 503, headers },
    );
  }
}
