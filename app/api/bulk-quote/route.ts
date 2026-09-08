import { NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { buildMarketDataTimingReceipt } from "@/lib/market-data-time";
import { massiveStocksUrl, probeMassiveRealtimeEntitlement } from "@/lib/massive-stocks";
import { getStockMarketClock } from "@/lib/stock-market-session";
import { DISPLAY_LIVE_MAX_AGE_MS } from "@/lib/live-market-view";
import {
  resolveSnapshotChangePercent,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import { resolveStockDisplayPrice } from "@/lib/stock-display-price";
import { publishStockDisplayFrames } from "@/lib/stock-display-frame-server";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MAX_SYMBOLS = 250;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

type BulkQuote = {
  price: number;
  change: number;
  volume: number;
  prevVolume: number;
  prevClose: number;
  avgVolume: number;
  volumeBaseline: "previous_session_proxy";
  asOf: string | null;
  live: boolean;
  dataMode: "real_time" | "delayed" | "unavailable";
  source: "massive_polygon_last_trade" | "massive_polygon_snapshot";
  priceKind: "trade" | "minute_aggregate";
  displayFrame: {
    id: string;
    version: "stock-display-frame-v1";
    bucket: number;
    coordination: "database" | "instance_fallback";
    issue?: "not_configured" | "rpc_error" | "invalid_rpc_response" | "transport_error";
  } | null;
  timing: ReturnType<typeof buildMarketDataTimingReceipt>;
};

async function fetchSnapshotBatch(
  symbols: string[],
  dataMode: BulkQuote["dataMode"],
  requestStartedAt: Date,
): Promise<Record<string, BulkQuote>> {
  const response = await fetch(
    massiveStocksUrl(
      "/v2/snapshot/locale/us/markets/stocks/tickers",
      { tickers: symbols.join(","), include_otc: false },
    ),
    { cache: "no-store", signal: AbortSignal.timeout(12_000) },
  );
  if (!response.ok) {
    throw new Error(`Massive snapshot returned ${response.status}.`);
  }
  const receivedAt = new Date();
  const payload = (await response.json()) as { tickers?: PolygonSnapshotRow[] };
  const rows = new Map<string, { row: PolygonSnapshotRow; display: NonNullable<ReturnType<typeof resolveStockDisplayPrice>> }>();
  for (const row of payload.tickers ?? []) {
    const symbol = String(row.ticker ?? "").trim().toUpperCase();
    const display = resolveStockDisplayPrice(row, null, receivedAt.getTime());
    if (!SYMBOL_PATTERN.test(symbol) || !display) continue;
    rows.set(symbol, { row, display });
  }
  const frames = await publishStockDisplayFrames(
    [...rows].map(([symbol, value]) => ({ symbol, display: value.display })),
    requestStartedAt,
  );
  const result: Record<string, BulkQuote> = {};
  for (const [symbol, value] of rows) {
    const { row } = value;
    const display = frames[symbol] ?? value.display;
    const price = display.price;
    const marketAsOf = display.asOf;
    const timestampMs = Date.parse(marketAsOf);
    const previousVolume = Number(row.prevDay?.v || 0);
    result[symbol] = {
      price,
      change: resolveSnapshotChangePercent(row, price),
      volume: Number(row.day?.v || 0),
      prevVolume: previousVolume,
      prevClose: Number(row.prevDay?.c || 0),
      // Compatibility field only. It is explicitly labeled as a previous-
      // session proxy so the UI cannot mistake it for a measured 10-day mean.
      avgVolume: previousVolume,
      volumeBaseline: "previous_session_proxy",
      asOf: marketAsOf,
      live: display.priceKind === "trade" && dataMode === "real_time" && getStockMarketClock(receivedAt).active &&
        receivedAt.getTime() - timestampMs >= -2_000 && receivedAt.getTime() - timestampMs <= DISPLAY_LIVE_MAX_AGE_MS,
      dataMode,
      source: display.source,
      priceKind: display.priceKind,
      displayFrame: "frameId" in display ? {
        id: display.frameId,
        version: display.frameVersion,
        bucket: display.frameBucket,
        coordination: display.coordination,
        ...(display.coordinationIssue ? { issue: display.coordinationIssue } : {}),
      } : null,
      timing: buildMarketDataTimingReceipt({ marketAsOf, receivedAt }),
    };
  }
  return result;
}

export async function POST(request: Request) {
  const requestStartedAt = new Date();
  const rateLimit = checkApiRateLimit(request, {
    namespace: "public-bulk-quote",
    limit: 30,
    windowMs: 60_000,
  });
  const headers = { ...NO_STORE_HEADERS, ...rateLimit.headers };
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many bulk quote requests.", quotes: {} },
      { status: 429, headers },
    );
  }

  try {
    const body = (await request.json()) as { symbols?: unknown };
    const rawSymbols = Array.isArray(body.symbols) ? body.symbols : [];
    const symbols = [...new Set(
      rawSymbols
        .map((value) => String(value).trim().toUpperCase())
        .filter((symbol) => SYMBOL_PATTERN.test(symbol)),
    )].slice(0, MAX_SYMBOLS);
    if (symbols.length === 0) {
      return NextResponse.json(
        { error: "At least one valid stock symbol is required.", quotes: {} },
        { status: 400, headers },
      );
    }

    const entitlement = await probeMassiveRealtimeEntitlement();
    if (!entitlement.snapshot) {
      console.error("[bulk-quote] Massive snapshot entitlement unavailable", {
        errors: entitlement.errors,
      });
      return NextResponse.json(
        {
          error: "Verified Massive snapshot data is unavailable.",
          quotes: {},
          provider: "massive_polygon",
          dataMode: entitlement.dataMode,
        },
        { status: 502, headers },
      );
    }

    const merged: Record<string, BulkQuote> = {};
    const errors: string[] = [];
    for (let index = 0; index < symbols.length; index += 100) {
      const batch = symbols.slice(index, index + 100);
      try {
        Object.assign(
          merged,
          await fetchSnapshotBatch(batch, entitlement.dataMode, requestStartedAt),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        errors.push(message);
        console.error("[bulk-quote] Massive batch failed", {
          batchSize: batch.length,
          message,
        });
      }
    }

    const missingSymbols = symbols.filter((symbol) => !merged[symbol]);
    const degraded = errors.length > 0 || missingSymbols.length > 0;
    if (Object.keys(merged).length === 0) {
      return NextResponse.json(
        {
          error: "Massive returned no verified quotes.",
          quotes: {},
          missingSymbols,
          provider: "massive_polygon",
          dataMode: entitlement.dataMode,
          degraded: true,
          errors,
        },
        { status: 502, headers },
      );
    }

    return NextResponse.json({
      quotes: merged,
      requestedCount: symbols.length,
      returnedCount: Object.keys(merged).length,
      missingSymbols,
      provider: "massive_polygon",
      dataMode: entitlement.dataMode,
      degraded,
      errors,
      entitlementCheckedAt: entitlement.checkedAt,
      processedAt: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    console.error("[bulk-quote] Request failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Bulk quote request failed.", quotes: {} },
      { status: 500, headers },
    );
  }
}
