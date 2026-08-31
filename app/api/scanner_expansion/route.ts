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

export const dynamic = "force-dynamic";

const EXCLUDED = new Set([
  "SQQQ", "TQQQ", "SOXS", "SOXL", "UVXY", "SVXY", "SPXS", "SPXL",
  "LABD", "LABU", "TZA", "TNA", "FAZ", "FAS", "YANG", "YINN",
  "SDOW", "UDOW", "ERY", "ERX", "HIBL", "HIBS", "DRIP", "GUSH",
]);

type ScannedTicker = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  volumeBaseline: "previous_session_proxy";
  source: "massive_polygon_snapshot_movers";
  marketAsOf: string | null;
};

function normalize(row: PolygonSnapshotRow): ScannedTicker | null {
  const symbol = String(row.ticker ?? "").trim().toUpperCase();
  const price = resolveSnapshotPrice(row);
  if (!symbol || EXCLUDED.has(symbol) || price <= 0) return null;
  const changePercent = resolveSnapshotChangePercent(row, price);
  const previousClose = Number(row.prevDay?.c ?? 0);
  const timestampMs = resolveSnapshotTimestampMs(row);
  return {
    symbol,
    price,
    change: previousClose > 0 ? price - previousClose : 0,
    changePercent,
    volume: Math.max(Number(row.day?.v ?? 0), Number(row.min?.av ?? 0)),
    // Compatibility only. A true time-of-day baseline is a separate phase.
    avgVolume: Number(row.prevDay?.v ?? 0),
    volumeBaseline: "previous_session_proxy",
    source: "massive_polygon_snapshot_movers",
    marketAsOf: timestampMs ? new Date(timestampMs).toISOString() : null,
  };
}

export async function GET(request: Request) {
  const rateLimit = checkApiRateLimit(request, {
    namespace: "scanner-expansion",
    limit: 30,
    windowMs: 60_000,
  });
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    ...rateLimit.headers,
  };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Scanner expansion rate limit reached.", tickers: [] },
      { status: 429, headers },
    );
  }

  const type = new URL(request.url).searchParams.get("type") ?? "all";
  try {
    const [movers, entitlement] = await Promise.all([
      fetchMassiveMarketMovers(),
      probeMassiveRealtimeEntitlement(),
    ]);
    const sourceRows = type === "gainers"
      ? movers.gainers
      : type === "losers"
        ? movers.losers
        : [...movers.gainers, ...movers.losers];
    const unique = new Map<string, ScannedTicker>();
    for (const row of sourceRows) {
      const normalized = normalize(row);
      if (normalized && !unique.has(normalized.symbol)) {
        unique.set(normalized.symbol, normalized);
      }
    }
    const tickers = [...unique.values()];
    tickers.sort(
      type === "active"
        ? (left, right) => right.volume - left.volume
        : (left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent),
    );
    const degraded = movers.errors.length > 0;
    return NextResponse.json({
      tickers: tickers.slice(0, 50),
      total: tickers.length,
      timestamp: new Date().toISOString(),
      provider: "massive_polygon",
      dataMode: entitlement.dataMode,
      authority: "secondary_discovery_only",
      degraded,
      degradedReasons: movers.errors,
    }, { status: degraded && tickers.length === 0 ? 503 : 200, headers });
  } catch (error) {
    console.error("[scanner-expansion] Massive mover read failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Verified mover data is unavailable.", tickers: [] },
      { status: 503, headers },
    );
  }
}
