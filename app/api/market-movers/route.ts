// app/api/market-movers/route.ts

import { NextResponse } from "next/server";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import { getErrorMessage } from "@/lib/error-message";
import { hydrateSnapshotLeaders } from "@/lib/intraday-snapshot-hydration";

export const dynamic = "force-dynamic";

const POLYGON_KEY = process.env.POLYGON_API_KEY!;

const EXCLUDED = new Set([
  "SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL",
  "LABD","LABU","TZA","TNA","FAZ","FAS","SDOW","UDOW",
  "SPXU","UPRO","QID","QLD","DXD","TWM","ERY","ERX",
]);

function getEasternSession() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  if (weekday === "Sat" || weekday === "Sun") return "closed" as const;
  if (minutes >= 240 && minutes < 570) return "pre_market" as const;
  if (minutes >= 570 && minutes < 960) return "regular" as const;
  if (minutes >= 960 && minutes < 1200) return "after_hours" as const;
  return "closed" as const;
}

export async function GET() {
  try {
    if (!POLYGON_KEY) {
      return NextResponse.json({ movers: [], count: 0, error: "No API key" });
    }

    const base = "https://api.polygon.io/v2/snapshot/locale/us/markets/stocks";
    const [gainersRes, losersRes] = await Promise.allSettled([
      fetch(`${base}/gainers?include_otc=false&apiKey=${POLYGON_KEY}`, { cache: "no-store" }),
      fetch(`${base}/losers?include_otc=false&apiKey=${POLYGON_KEY}`, { cache: "no-store" }),
    ]);
    let tickers: PolygonSnapshotRow[] = [];

    if (gainersRes.status === "fulfilled" && gainersRes.value.ok) {
      const data = await gainersRes.value.json();
      const gainers = data.tickers ?? [];
      console.log(`[market-movers] Gainers: ${gainers.length} tickers`);
      tickers.push(...gainers);
    } else {
      console.warn("[market-movers] Gainers failed");
    }

    if (losersRes.status === "fulfilled" && losersRes.value.ok) {
      const data = await losersRes.value.json();
      const losers = data.tickers ?? [];
      console.log(`[market-movers] Losers: ${losers.length} tickers`);
      tickers.push(...losers);
    } else {
      console.warn("[market-movers] Losers failed");
    }

    let source = "snapshot-movers";
    if (tickers.length === 0) {
      const fullSnapshot = await fetch(
        `${base}/tickers?include_otc=false&apiKey=${POLYGON_KEY}`,
        { cache: "no-store" },
      );
      if (fullSnapshot.ok) {
        const data = await fullSnapshot.json();
        tickers = data.tickers ?? [];
        source = "full-snapshot-fallback";
      }
    }

    const session = getEasternSession();
    const hydratedLeaders = await hydrateSnapshotLeaders(
      tickers,
      POLYGON_KEY,
      session,
      { maxCandidates: 80 },
    );

    const seen = new Set<string>();
    const movers: { symbol: string; price: number; change: number; volume: number; prevVolume: number }[] = [];
    for (const t of tickers) {
      const ticker = String(t.ticker ?? "");
      if (!ticker || seen.has(ticker) || EXCLUDED.has(ticker)) continue;
      seen.add(ticker);
      const hydrated = hydratedLeaders.get(ticker);
      const price = hydrated?.price ?? resolveSnapshotPrice(t);
      const change = resolveSnapshotChangePercent(t, price);
      const volume = Math.max(
        Number(t.day?.v || 0),
        Number(t.min?.av || 0),
        hydrated?.currentVolume ?? 0,
      );
      const prevVolume = Number(t.prevDay?.v || 1);
      if (price <= 0 || volume < 10_000 || price * volume < 100_000) continue;
      movers.push({ symbol: ticker, price, change, volume, prevVolume });
    }

    movers.sort((left, right) => right.change - left.change);

    return NextResponse.json({
      movers,
      count: movers.length,
      source,
      hydrated: hydratedLeaders.size,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = getErrorMessage(err, "Market movers request failed");
    console.error("[market-movers] Fatal error:", message);
    return NextResponse.json({ movers: [], count: 0, error: message });
  }
}
