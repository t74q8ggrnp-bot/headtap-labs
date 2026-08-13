// app/api/prox-market-sensor/route.ts
//
// Pro X Phase 3 (partial) — market-feature snapshots for tickers with a
// recent Pro X event, an independent direct-market discovery, or the latest
// promoted canonical opportunity run. This covers both directions: event ->
// monitor price and price anomaly -> investigate the pulse, without granting
// execution authority.
//
// REST-polled 1-minute bars via Polygon's aggs endpoint — verified live
// against the current plan (minute/second aggs return 200; last-trade and
// last-quote return 403 "not entitled"). This is real progress on Phase 3
// within the current paid tier, not the full always-on WebSocket sensor
// the complete spec describes — that still needs the plan upgrade plus
// an always-on worker, neither of which exist yet.
//
// Reads canonical tickers to decide what to monitor. The resulting market
// pulse can inform HT Labs opportunity ranking, but this route has no order
// or execution authority.

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
const CANONICAL_QUALITY_LANE_LIMIT = 30;
const CANONICAL_MOMENTUM_LANE_LIMIT = 20;
const CANONICAL_VOLUME_LANE_LIMIT = 10;
const EVENT_SENSOR_LIMIT = 30;
const DIRECT_DISCOVERY_SENSOR_LIMIT = 40;
const MAX_SENSOR_TICKERS = 130;

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

  const baseQuery = () =>
    supabase
      .from("ht_signal_run_rows")
      .select("ticker")
      .eq("scan_run_id", run.id)
      .or(
        "retrieved_for_sm.eq.true,retrieved_for_btc.eq.true,retrieved_for_catalyst.eq.true",
      );
  const [qualityLane, momentumLane, volumeLane] = await Promise.all([
    baseQuery()
      .order("ht_score", { ascending: false })
      .limit(CANONICAL_QUALITY_LANE_LIMIT),
    baseQuery()
      .order("momentum_score", { ascending: false })
      .limit(CANONICAL_MOMENTUM_LANE_LIMIT),
    baseQuery()
      .order("relative_volume", { ascending: false })
      .limit(CANONICAL_VOLUME_LANE_LIMIT),
  ]);
  if (qualityLane.error || momentumLane.error || volumeLane.error) return [];

  // Pro X must observe both the safest current names and the fastest emerging
  // names. Ranking this sensor only by HT score created a circular blind spot:
  // explosive early movers could be penalized before Pro X ever saw their tape.
  return [
    ...(qualityLane.data ?? []),
    ...(momentumLane.data ?? []),
    ...(volumeLane.data ?? []),
  ]
    .map((row) => String(row.ticker ?? "").toUpperCase().trim())
    .filter(Boolean)
    .filter((ticker, index, tickers) => tickers.indexOf(ticker) === index)
    .slice(0, CANONICAL_SENSOR_LIMIT);
}

async function fetchDirectDiscoveryTickers(
  supabase: ReturnType<typeof getSupabase>,
): Promise<{ tickers: string[]; unavailable: string | null }> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("prox_research_queue")
    .select("ticker,research_priority,last_detected_at,status")
    .in("status", ["queued", "observing"])
    .gte("last_detected_at", since)
    .order("research_priority", { ascending: false })
    .order("last_detected_at", { ascending: false })
    .limit(DIRECT_DISCOVERY_SENSOR_LIMIT);
  if (error) {
    return { tickers: [], unavailable: error.message };
  }
  return {
    tickers: (data ?? [])
      .map((row) => String(row.ticker ?? "").toUpperCase().trim())
      .filter(Boolean),
    unavailable: null,
  };
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
    .map((r) => {
      const close = Number(r.c);
      const high = Number(r.h);
      const low = Number(r.l);
      const volume = Number(r.v);
      const vwap = Number(r.vw);
      return {
        o: Number(r.o),
        h: Number.isFinite(high) ? high : close,
        l: Number.isFinite(low) ? low : close,
        c: close,
        v: Number.isFinite(volume) ? volume : 0,
        vw: Number.isFinite(vwap) && vwap > 0 ? vwap : close,
        t: Number(r.t),
      };
    })
    .filter(
      (bar: Bar) =>
        Number.isFinite(bar.c) &&
        bar.c > 0 &&
        Number.isFinite(bar.t) &&
        bar.t > 0,
    );
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

  const totalWindowVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
  const windowVwap =
    totalWindowVolume > 0
      ? bars.reduce((sum, bar) => sum + bar.vw * bar.v, 0) /
        totalWindowVolume
      : last.vw;
  const priceVsVwap =
    windowVwap > 0 ? ((last.c - windowVwap) / windowVwap) * 100 : 0;
  const averageBarRangePercent =
    bars.reduce(
      (sum, bar) =>
        sum +
        (bar.c > 0
          ? (Math.max(0, bar.h - bar.l) / bar.c) * 100
          : 0),
      0,
    ) / bars.length;
  const peakBar = bars.reduce(
    (peak, bar) => (bar.h >= peak.h ? bar : peak),
    bars[0],
  );
  const windowHighPrice = Number.isFinite(peakBar.h)
    ? Math.max(peakBar.h, last.c)
    : last.c;
  const pullbackFromWindowHighPercent =
    windowHighPrice > 0
      ? Math.max(0, ((windowHighPrice - last.c) / windowHighPrice) * 100)
      : 0;
  const minutesSinceWindowHigh = Math.max(
    0,
    (last.t - peakBar.t) / 60_000,
  );

  return {
    ticker,
    price: last.c,
    velocity_1m: Number(velocity1m.toFixed(3)),
    acceleration_5m: Number(acceleration5m.toFixed(3)),
    volume_1m: Math.round(last.v),
    avg_volume_1m: Number(avgVolume1m.toFixed(1)),
    volume_acceleration: Number(volumeAcceleration.toFixed(2)),
    vwap: Number(windowVwap.toFixed(4)),
    price_vs_vwap: Number(priceVsVwap.toFixed(3)),
    dollar_volume: Number((last.c * last.v).toFixed(0)),
    window_high_price: Number(windowHighPrice.toFixed(4)),
    pullback_from_window_high_percent: Number(
      pullbackFromWindowHighPercent.toFixed(3),
    ),
    minutes_since_window_high: Number(minutesSinceWindowHigh.toFixed(1)),
    average_bar_range_percent: Number(averageBarRangePercent.toFixed(3)),
    bar_count: bars.length,
    computed_at: new Date().toISOString(),
  };
}

function omitPeakRetentionFeatures<T extends Record<string, unknown>>(
  features: T,
) {
  const {
    window_high_price: _windowHighPrice,
    pullback_from_window_high_percent: _pullback,
    minutes_since_window_high: _minutesSinceHigh,
    average_bar_range_percent: _averageBarRange,
    ...legacyFeatures
  } = features;
  void _windowHighPrice;
  void _pullback;
  void _minutesSinceHigh;
  void _averageBarRange;
  return legacyFeatures;
}

async function supportsPeakRetentionColumns(
  supabase: ReturnType<typeof getSupabase>,
  table: "prox_market_features" | "prox_market_feature_history",
) {
  const { error } = await supabase
    .from(table)
    .select(
      "window_high_price,pullback_from_window_high_percent,minutes_since_window_high,average_bar_range_percent",
    )
    .limit(1);
  return !error;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!POLYGON_KEY) return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });

  const diagnostics = {
    tickersConsidered: 0,
    eventTickers: 0,
    canonicalTickers: 0,
    directDiscoveryTickers: 0,
    directDiscoveryObserved: 0,
    directDiscoveryUnavailable: null as string | null,
    computed: 0,
    historyPersisted: 0,
    historyUnavailable: null as string | null,
    peakRetentionSchemaReady: false,
    peakRetentionHistorySchemaReady: false,
    skippedNoBars: 0,
    errors: 0,
  };

  try {
    const supabase = getSupabase();
    const [peakRetentionSchemaReady, peakRetentionHistorySchemaReady] =
      await Promise.all([
        supportsPeakRetentionColumns(supabase, "prox_market_features"),
        supportsPeakRetentionColumns(
          supabase,
          "prox_market_feature_history",
        ),
      ]);
    diagnostics.peakRetentionSchemaReady = peakRetentionSchemaReady;
    diagnostics.peakRetentionHistorySchemaReady =
      peakRetentionHistorySchemaReady;
    const [eventTickers, canonicalTickers, directDiscovery] = await Promise.all([
      fetchRecentEventTickers(supabase),
      fetchCanonicalOpportunityTickers(supabase),
      fetchDirectDiscoveryTickers(supabase),
    ]);
    diagnostics.eventTickers = eventTickers.length;
    diagnostics.canonicalTickers = canonicalTickers.length;
    diagnostics.directDiscoveryTickers = directDiscovery.tickers.length;
    diagnostics.directDiscoveryUnavailable = directDiscovery.unavailable;
    const tickers = [
      ...new Set([
        ...eventTickers.slice(0, EVENT_SENSOR_LIMIT),
        ...directDiscovery.tickers,
        ...canonicalTickers,
      ]),
    ].slice(0, MAX_SENSOR_TICKERS);
    diagnostics.tickersConsidered = tickers.length;
    const computedTickers = new Set<string>();

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
        const latestFeatures = peakRetentionSchemaReady
          ? features
          : omitPeakRetentionFeatures(features);
        const { error } = await supabase
          .from("prox_market_features")
          .upsert(latestFeatures, { onConflict: "ticker" });
        if (error) {
          diagnostics.errors++;
          continue;
        }
        diagnostics.computed++;
        computedTickers.add(features.ticker);

        // The latest-snapshot table powers fast reads. The append-only
        // history powers Pro X memory and later calibration. Until migration
        // 0005 is applied, history failure is reported but never allowed to
        // disrupt the existing live pulse.
        if (!diagnostics.historyUnavailable) {
          const { error: historyError } = await supabase
            .from("prox_market_feature_history")
            .upsert(
              peakRetentionHistorySchemaReady
                ? features
                : omitPeakRetentionFeatures(features),
              {
              onConflict: "ticker,computed_at",
              ignoreDuplicates: true,
              },
            );
          if (historyError) {
            diagnostics.historyUnavailable = historyError.message;
          } else {
            diagnostics.historyPersisted++;
          }
        }
      }
    }

    const directDiscoveryObserved = directDiscovery.tickers.filter((ticker) =>
      computedTickers.has(ticker),
    );
    diagnostics.directDiscoveryObserved = directDiscoveryObserved.length;
    if (directDiscoveryObserved.length > 0) {
      const { error: queueUpdateError } = await supabase
        .from("prox_research_queue")
        .update({
          status: "observing",
          updated_at: new Date().toISOString(),
        })
        .in("ticker", directDiscoveryObserved)
        .eq("status", "queued");
      if (queueUpdateError) {
        diagnostics.directDiscoveryUnavailable = queueUpdateError.message;
      }
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pro X market sensor failed", diagnostics }, { status: 500 });
  }
}
