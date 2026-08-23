// app/api/trading-bot-stop-simulation/route.ts
//
// Read-only: for every "stop"-exit trade, replays real Polygon minute bars
// from entry through the original max-hold window and simulates what would
// have happened under wider stop-loss floors (e.g. 8%, 10%, 12%, 15%)
// instead of the current 5% floor — did a wider stop still get hit, and if
// so, was the eventual loss actually worse, or did giving the trade more
// room let it reach the trailing-stop's profitable territory instead? No
// writes, no effect on current trading logic — pure historical replay.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CANDIDATE_FLOORS = [5, 8, 10, 12, 15];
// Mirrors the live bot's trailing-stop shape (MIN_PROFIT_TO_TRAIL_PERCENT=8,
// WIDE_TRAIL_PERCENT=15, EXTENDED_GAIN_THRESHOLD_PERCENT=25, TIGHT_TRAIL_PERCENT=5)
const MIN_PROFIT_TO_TRAIL_PERCENT = 8;
const WIDE_TRAIL_PERCENT = 15;
const EXTENDED_GAIN_THRESHOLD_PERCENT = 25;
const TIGHT_TRAIL_PERCENT = 5;
const MAX_HOLD_DAYS = 3;

// Same CRON_SECRET bearer-token check used everywhere else in this
// codebase for internal-only routes — this was reachable with no auth.
const CRON_SECRET = process.env.CRON_SECRET;
function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  return req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

type Bar = { t: number; h: number; l: number; c: number };

async function fetchMinuteBars(ticker: string, fromMs: number, toMs: number): Promise<Bar[]> {
  if (!POLYGON_KEY) return [];
  const from = new Date(fromMs).toISOString().slice(0, 10);
  const to = new Date(toMs).toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/5/minute/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return ((data?.results ?? []) as Array<{ t: number; h: number; l: number; c: number }>)
    .map((row) => ({ t: row.t, h: row.h, l: row.l, c: row.c }))
    .filter((bar) => bar.t >= fromMs && bar.t <= toMs)
    .sort((a, b) => a.t - b.t);
}

// Replays one trade's actual bar path under a hypothetical stop floor,
// using the same trailing-stop shape as the live bot, to see what exit
// reason and pnl% that floor would actually have produced.
function simulate(
  bars: Bar[],
  entryPrice: number,
  stopFloorPercent: number,
  maxHoldUntilMs: number,
) {
  const stopPrice = entryPrice * (1 - stopFloorPercent / 100);
  let highWaterMark = entryPrice;
  for (const bar of bars) {
    if (bar.t > maxHoldUntilMs) break;
    highWaterMark = Math.max(highWaterMark, bar.h);
    const gainFromEntry = ((highWaterMark - entryPrice) / entryPrice) * 100;
    let hitTrailingStop = false;
    if (gainFromEntry >= MIN_PROFIT_TO_TRAIL_PERCENT) {
      const trailPercent = gainFromEntry >= EXTENDED_GAIN_THRESHOLD_PERCENT ? TIGHT_TRAIL_PERCENT : WIDE_TRAIL_PERCENT;
      const trailingStopPrice = highWaterMark * (1 - trailPercent / 100);
      if (bar.l <= trailingStopPrice) hitTrailingStop = true;
    }
    const hitHardStop = bar.l <= stopPrice;
    if (hitHardStop || hitTrailingStop) {
      const exitPrice = hitTrailingStop
        ? highWaterMark * (1 - (gainFromEntry >= EXTENDED_GAIN_THRESHOLD_PERCENT ? TIGHT_TRAIL_PERCENT : WIDE_TRAIL_PERCENT) / 100)
        : stopPrice;
      return {
        exitReason: hitTrailingStop ? "trailing_stop" : "stop",
        exitPrice: Math.round(exitPrice * 10000) / 10000,
        pnlPercent: Math.round(((exitPrice - entryPrice) / entryPrice) * 1000) / 10,
      };
    }
  }
  const lastBar = bars[bars.length - 1];
  const exitPrice = lastBar ? lastBar.c : entryPrice;
  return {
    exitReason: "time_limit",
    exitPrice: Math.round(exitPrice * 10000) / 10000,
    pnlPercent: Math.round(((exitPrice - entryPrice) / entryPrice) * 1000) / 10,
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(69, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "69", 10) || 69));
    if (!POLYGON_KEY) {
      return NextResponse.json({ error: "Missing POLYGON_API_KEY." }, { status: 500 });
    }
    const supabase = getSupabase();
    const { data: stops, error } = await supabase
      .from("bot_trades")
      .select("ticker, entry_price, entry_at, exit_at, pnl_percent")
      .eq("exit_reason", "stop")
      .not("entry_at", "is", null)
      .order("exit_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const perFloorResults = new Map<number, { pnlPercents: number[]; reasons: Record<string, number> }>();
    for (const floor of CANDIDATE_FLOORS) {
      perFloorResults.set(floor, { pnlPercents: [], reasons: {} });
    }
    const perTradeDetail: unknown[] = [];
    let skippedNoData = 0;

    for (const trade of stops ?? []) {
      const entryPrice = Number(trade.entry_price);
      const entryAtMs = new Date(trade.entry_at as string).getTime();
      const maxHoldUntilMs = entryAtMs + MAX_HOLD_DAYS * 24 * 60 * 60 * 1000;
      // Cap the fetch window at "now" for very recent trades still within
      // their 3-day hold — can't replay bars that haven't happened yet.
      const fetchEndMs = Math.min(maxHoldUntilMs, Date.now());
      const bars = await fetchMinuteBars(trade.ticker as string, entryAtMs, fetchEndMs);
      if (bars.length === 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
        skippedNoData++;
        continue;
      }
      const perFloor: Record<number, { exitReason: string; pnlPercent: number }> = {};
      for (const floor of CANDIDATE_FLOORS) {
        const outcome = simulate(bars, entryPrice, floor, maxHoldUntilMs);
        perFloor[floor] = { exitReason: outcome.exitReason, pnlPercent: outcome.pnlPercent };
        const bucket = perFloorResults.get(floor)!;
        bucket.pnlPercents.push(outcome.pnlPercent);
        bucket.reasons[outcome.exitReason] = (bucket.reasons[outcome.exitReason] ?? 0) + 1;
      }
      perTradeDetail.push({
        ticker: trade.ticker,
        actualPnlPercent: trade.pnl_percent,
        simulated: perFloor,
      });
    }

    const summary = CANDIDATE_FLOORS.map((floor) => {
      const bucket = perFloorResults.get(floor)!;
      const total = bucket.pnlPercents.reduce((sum, v) => sum + v, 0);
      return {
        stopFloorPercent: floor,
        tradesSimulated: bucket.pnlPercents.length,
        avgPnlPercent: bucket.pnlPercents.length ? Math.round((total / bucket.pnlPercents.length) * 10) / 10 : null,
        exitReasonCounts: bucket.reasons,
      };
    });

    return NextResponse.json({
      tradesRequested: (stops ?? []).length,
      tradesSimulated: (stops ?? []).length - skippedNoData,
      skippedNoData,
      summaryByFloor: summary,
      perTradeDetail,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[trading-bot-stop-simulation] failed:", error);
    return NextResponse.json({ error: getErrorMessage(error, "Failed to simulate stop floors") }, { status: 500 });
  }
}
