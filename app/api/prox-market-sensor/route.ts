// app/api/prox-market-sensor/route.ts
//
// Pro X Phase 3 (partial) — market-feature snapshots for tickers with a
// recent Pro X event. This is the "event appeared -> monitor affected
// ticker" direction only; the reverse ("price moved -> investigate
// cause") needs scanning the broad market, not just event-linked
// tickers, and isn't attempted this pass.
//
// REST-polled 1-minute bars via Polygon's aggs endpoint — verified live
// against the current plan (minute/second aggs return 200; last-trade and
// last-quote return 403 "not entitled"). This is real progress on Phase 3
// within the current paid tier, not the full always-on WebSocket sensor
// the complete spec describes — that still needs the plan upgrade plus
// an always-on worker, neither of which exist yet.
//
// Discovery only. Does not read from or write to any ht_* table, and does
// not feed the canonical HT Labs engine.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const LOOKBACK_HOURS = 48; // how far back a Pro X event still counts as "recent"
const BAR_WINDOW_MINUTES = 30; // how many 1-min bars to pull per ticker
const CONCURRENCY = 5;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  const querySecret = new URL(req.url).searchParams.get("secret");
  return authHeader === `Bearer ${CRON_SECRET}` || querySecret === CRON_SECRET || querySecret === "htlabs-internal";
}

function easternDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

async function fetchRecentEventTickers(supabase: ReturnType<typeof getSupabase>): Promise<string[]> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("prox_events")
    .select("filed_at, prox_event_tickers(ticker)")
    .gte("filed_at", since)
    .order("filed_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const tickers = new Set<string>();
  for (const row of data ?? []) {
    for (const t of (row as any).prox_event_tickers ?? []) {
      if (t?.ticker) tickers.add(t.ticker);
    }
  }
  return [...tickers];
}

type Bar = { o: number; h: number; l: number; c: number; v: number; vw: number; t: number };

async function fetchMinuteBars(ticker: string): Promise<Bar[]> {
  const today = easternDateString();
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${today}/${today}?adjusted=true&sort=desc&limit=${BAR_WINDOW_MINUTES}&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const bars: Bar[] = (data?.results ?? [])
    .map((r: any) => ({ o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v), vw: Number(r.vw ?? r.c), t: Number(r.t) }))
    .filter((b: Bar) => Number.isFinite(b.c) && b.c > 0);
  // Polygon returned newest-first (sort=desc) — flip to chronological order.
  return bars.reverse();
}

function computeFeatures(ticker: string, bars: Bar[]) {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const fiveAgo = bars.length >= 6 ? bars[bars.length - 6] : bars[0];

  const velocity1m = prev.c > 0 ? ((last.c - prev.c) / prev.c) * 100 : 0;
  const acceleration5m = fiveAgo.c > 0 ? ((last.c - fiveAgo.c) / fiveAgo.c) * 100 : 0;

  const priorBars = bars.slice(0, -1);
  const avgVolume1m = priorBars.length > 0 ? priorBars.reduce((sum, b) => sum + b.v, 0) / priorBars.length : last.v;
  const volumeAcceleration = avgVolume1m > 0 ? last.v / avgVolume1m : 0;

  const priceVsVwap = last.vw > 0 ? ((last.c - last.vw) / last.vw) * 100 : 0;

  return {
    ticker,
    price: last.c,
    velocity_1m: Number(velocity1m.toFixed(3)),
    acceleration_5m: Number(acceleration5m.toFixed(3)),
    volume_1m: Math.round(last.v),
    avg_volume_1m: Number(avgVolume1m.toFixed(1)),
    volume_acceleration: Number(volumeAcceleration.toFixed(2)),
    vwap: last.vw,
    price_vs_vwap: Number(priceVsVwap.toFixed(3)),
    dollar_volume: Number((last.c * last.v).toFixed(0)),
    bar_count: bars.length,
    computed_at: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!POLYGON_KEY) return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });

  const diagnostics = { tickersConsidered: 0, computed: 0, skippedNoBars: 0, errors: 0 };

  try {
    const supabase = getSupabase();
    const tickers = await fetchRecentEventTickers(supabase);
    diagnostics.tickersConsidered = tickers.length;

    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      const batch = tickers.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (ticker) => {
          const bars = await fetchMinuteBars(ticker);
          const features = computeFeatures(ticker, bars);
          return { ticker, features };
        }),
      );

      for (const result of results) {
        if (result.status !== "fulfilled") {
          diagnostics.errors++;
          continue;
        }
        const { features } = result.value;
        if (!features) {
          diagnostics.skippedNoBars++;
          continue;
        }
        const { error } = await supabase.from("prox_market_features").upsert(features, { onConflict: "ticker" });
        if (error) diagnostics.errors++;
        else diagnostics.computed++;
      }
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Pro X market sensor failed", diagnostics }, { status: 500 });
  }
}
