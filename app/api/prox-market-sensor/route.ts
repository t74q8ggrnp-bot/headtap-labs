// app/api/prox-market-sensor/route.ts
//
// Pro X Phase 3 (partial) — market-feature snapshots for tickers with a
// recent Pro X event or the latest promoted canonical opportunity run.
// This covers both directions: event -> monitor price and price move ->
// investigate the pulse, without granting execution authority.
//
// REST-polled 1-minute bars via Polygon's aggs endpoint — verified live
// against the current plan (minute/second aggs return 200; last-trade and
// last-quote return 403 "not entitled"). This is real progress on Phase 3
// within the current paid tier, not the full always-on WebSocket sensor
// the complete spec describes — that still needs the plan upgrade plus
// an always-on worker, neither of which exist yet.
//
// Does not read from or write to any ht_* table. Its output can be attached
// to canonical opportunities as versioned Pro X shadow context, but cannot
// change canonical eligibility, scoring, or execution.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const LOOKBACK_HOURS = 48; // how far back a Pro X event still counts as "recent"
const BAR_WINDOW_MINUTES = 30; // how many 1-min bars to pull per ticker
const CONCURRENCY = 5;
const CANONICAL_SENSOR_LIMIT = 60;
const MAX_SENSOR_TICKERS = 100;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${CRON_SECRET}`;
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
  for (const row of (data ?? []) as Array<{
    prox_event_tickers?: Array<{ ticker?: string | null }> | null;
  }>) {
    for (const t of row.prox_event_tickers ?? []) {
      if (t?.ticker) tickers.add(t.ticker);
    }
  }
  return [...tickers];
}

async function fetchCanonicalOpportunityTickers(
  supabase: ReturnType<typeof getSupabase>,
): Promise<string[]> {
  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .select("id")
    .eq("run_type", "signal_writer_v3")
    .eq("status", "success")
    .eq("promoted", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError || !run?.id) return [];

  const { data, error } = await supabase
    .from("ht_signal_run_rows")
    .select("ticker")
    .eq("scan_run_id", run.id)
    .or(
      "retrieved_for_sm.eq.true,retrieved_for_btc.eq.true,retrieved_for_catalyst.eq.true",
    )
    .order("ht_score", { ascending: false })
    .limit(CANONICAL_SENSOR_LIMIT);
  if (error) return [];
  return (data ?? [])
    .map((row) => String(row.ticker ?? "").toUpperCase().trim())
    .filter(Boolean);
}

type Bar = { o: number; h: number; l: number; c: number; v: number; vw: number; t: number };
type PolygonAggregate = {
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
  v?: unknown;
  vw?: unknown;
  t?: unknown;
};

async function fetchMinuteBars(ticker: string): Promise<Bar[]> {
  const today = easternDateString();
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${today}/${today}?adjusted=true&sort=desc&limit=${BAR_WINDOW_MINUTES}&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const results =
    data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)
      ? ((data as { results: PolygonAggregate[] }).results)
      : [];
  const bars: Bar[] = results
    .map((r) => ({ o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v), vw: Number(r.vw ?? r.c), t: Number(r.t) }))
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

  const diagnostics = {
    tickersConsidered: 0,
    eventTickers: 0,
    canonicalTickers: 0,
    computed: 0,
    historyPersisted: 0,
    historyUnavailable: null as string | null,
    skippedNoBars: 0,
    errors: 0,
  };

  try {
    const supabase = getSupabase();
    const [eventTickers, canonicalTickers] = await Promise.all([
      fetchRecentEventTickers(supabase),
      fetchCanonicalOpportunityTickers(supabase),
    ]);
    diagnostics.eventTickers = eventTickers.length;
    diagnostics.canonicalTickers = canonicalTickers.length;
    const tickers = [
      ...new Set([...canonicalTickers, ...eventTickers]),
    ].slice(0, MAX_SENSOR_TICKERS);
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
        if (error) {
          diagnostics.errors++;
          continue;
        }
        diagnostics.computed++;

        // The latest-snapshot table powers fast reads. The append-only
        // history powers Pro X memory and later calibration. Until migration
        // 0005 is applied, history failure is reported but never allowed to
        // disrupt the existing live pulse.
        if (!diagnostics.historyUnavailable) {
          const { error: historyError } = await supabase
            .from("prox_market_feature_history")
            .upsert(features, {
              onConflict: "ticker,computed_at",
              ignoreDuplicates: true,
            });
          if (historyError) {
            diagnostics.historyUnavailable = historyError.message;
          } else {
            diagnostics.historyPersisted++;
          }
        }
      }
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pro X market sensor failed", diagnostics }, { status: 500 });
  }
}
