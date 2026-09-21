import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { checkDurableApiRateLimit, recordExternalRequestTelemetry } from "@/lib/durable-api-guard";
import { probeMassiveRealtimeEntitlement } from "@/lib/massive-stocks";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
  resolveSnapshotTimestampMs,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";

export const dynamic = "force-dynamic";

type ContextQuote = {
  price: number;
  change: number;
  rvol: number | null;
  asOf: string;
};

function parseSnapshot(tickerMap: Record<string, PolygonSnapshotRow>, symbol: string): ContextQuote | null {
  const row = tickerMap[symbol];
  if (!row) return null;
  const price = resolveSnapshotPrice(row);
  const change = resolveSnapshotChangePercent(row, price);
  const timestampMs = resolveSnapshotTimestampMs(row);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change) || !timestampMs) return null;
  const volume = Number(row.day?.v || 0);
  const previousVolume = Number(row.prevDay?.v || 0);
  return {
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    rvol: volume > 0 && previousVolume > 0 ? Number((volume / previousVolume).toFixed(2)) : null,
    asOf: new Date(timestampMs).toISOString(),
  };
}

async function loadMarketContext() {
  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) throw new Error("market-data credential unavailable");
  const url = new URL("https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers");
  url.searchParams.set("tickers", "SPY,QQQ,IWM,VIXY");
  const [response, entitlement] = await Promise.all([
    fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    }),
    probeMassiveRealtimeEntitlement(),
  ]);
  if (!response.ok) throw new Error(`market-context provider status ${response.status}`);
  const data = await response.json();
  const tickerMap: Record<string, PolygonSnapshotRow> = {};
  for (const row of (Array.isArray(data?.tickers) ? data.tickers : []) as PolygonSnapshotRow[]) {
    const ticker = String(row.ticker ?? "");
    if (ticker) tickerMap[ticker] = row;
  }
  const spy = parseSnapshot(tickerMap, "SPY");
  const qqq = parseSnapshot(tickerMap, "QQQ");
  const iwm = parseSnapshot(tickerMap, "IWM");
  const vix = parseSnapshot(tickerMap, "VIXY");
  if (!spy || !qqq || !iwm) throw new Error("market-context core snapshot incomplete");

  const averageChange = (spy.change + qqq.change) / 2;
  const mood = averageChange >= 0.5 ? "Risk On" : averageChange <= -0.5 ? "Risk Off" : "Neutral";
  const moodColor = mood === "Risk On" ? "green" : mood === "Risk Off" ? "red" : "zinc";
  const measuredRvol = [spy.rvol, qqq.rvol].filter((value): value is number => value !== null);
  const averageRvol = measuredRvol.length > 0
    ? measuredRvol.reduce((sum, value) => sum + value, 0) / measuredRvol.length
    : null;
  const volumeEnv = averageRvol === null
    ? "Unavailable"
    : averageRvol >= 1.3 ? "Heavy" : averageRvol >= 0.85 ? "Normal" : "Light";
  return {
    spy,
    qqq,
    iwm,
    vix,
    mood,
    moodColor,
    volumeEnv,
    avgRvol: averageRvol === null ? null : Number(averageRvol.toFixed(2)),
    provider: "massive_polygon",
    dataMode: entitlement.dataMode,
    providerCheckedAt: entitlement.checkedAt,
    sourceTimestamp: [spy.asOf, qqq.asOf, iwm.asOf].sort().at(-1) ?? null,
    collectedAt: new Date().toISOString(),
    providerRequests: 1,
  };
}

const cachedMarketContext = unstable_cache(loadMarketContext, ["market-context-v2"], {
  revalidate: 60,
  tags: ["market-context"],
});

export async function GET(request: Request) {
  const rateLimit = await checkDurableApiRateLimit(request, {
    namespace: "public-market-context",
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: "unavailable", error: "Market context is temporarily unavailable." },
      { status: 429, headers: rateLimit.headers },
    );
  }
  try {
    const payload = await cachedMarketContext();
    void recordExternalRequestTelemetry({
      endpoint: "/api/market-context",
      provider: "massive",
      operation: "market_snapshot",
      requestCount: payload.providerRequests,
      outcome: "success",
      sourceTimestamp: payload.sourceTimestamp,
      metadata: { dataMode: payload.dataMode },
    });
    return NextResponse.json(payload, {
      headers: {
        ...rateLimit.headers,
        "Cache-Control": "public, max-age=15, s-maxage=60, stale-while-revalidate=60",
        "X-HT-Provider-Requests": String(payload.providerRequests),
      },
    });
  } catch (error) {
    console.error("[market-context] provider frame unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    void recordExternalRequestTelemetry({
      endpoint: "/api/market-context",
      provider: "massive",
      operation: "market_snapshot",
      requestCount: 1,
      outcome: "unavailable",
    });
    return NextResponse.json(
      { status: "unavailable", error: "Verified market context is temporarily unavailable." },
      { status: 503, headers: rateLimit.headers },
    );
  }
}
