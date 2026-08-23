// app/api/trading-bot-stop-postmortem/route.ts
//
// Read-only: for every "stop"-exit trade in bot_trades, fetches real
// Polygon minute bars covering the 24 hours after the stop fired and
// checks whether price ever recovered back above the exit price
// (whipsawed — the stop was too tight for how the stock actually moves)
// versus never recovering (the entry/direction was genuinely wrong).
// No writes, no effect on trading logic — pure post-mortem measurement.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLYGON_KEY = process.env.POLYGON_API_KEY;

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
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/5/minute/${from}/${to}?adjusted=true&sort=asc&limit=500&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return ((data?.results ?? []) as Array<{ t: number; h: number; l: number; c: number }>)
    .map((row) => ({ t: row.t, h: row.h, l: row.l, c: row.c }))
    .filter((bar) => bar.t >= fromMs && bar.t <= toMs);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(69, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "25", 10) || 25));
    if (!POLYGON_KEY) {
      return NextResponse.json({ error: "Missing POLYGON_API_KEY." }, { status: 500 });
    }
    const supabase = getSupabase();
    const { data: stops, error } = await supabase
      .from("bot_trades")
      .select("ticker, entry_price, exit_price, exit_at, pnl_percent")
      .eq("exit_reason", "stop")
      .not("exit_at", "is", null)
      .order("exit_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const results = [];
    let whipsawed = 0;
    let keptFalling = 0;
    let noData = 0;

    for (const trade of stops ?? []) {
      const exitAtMs = new Date(trade.exit_at as string).getTime();
      const windowEndMs = Math.min(Date.now(), exitAtMs + 24 * 60 * 60 * 1000);
      const bars = await fetchMinuteBars(trade.ticker as string, exitAtMs, windowEndMs);
      if (bars.length === 0) {
        noData++;
        results.push({ ticker: trade.ticker, exitAt: trade.exit_at, exitPrice: trade.exit_price, verdict: "no_data" });
        continue;
      }
      const exitPrice = Number(trade.exit_price);
      const maxHighAfter = Math.max(...bars.map((b) => b.h));
      const maxRecoveryPercent = exitPrice > 0 ? ((maxHighAfter - exitPrice) / exitPrice) * 100 : 0;
      const lastClose = bars[bars.length - 1].c;
      const netDriftPercent = exitPrice > 0 ? ((lastClose - exitPrice) / exitPrice) * 100 : 0;
      const recovered = maxHighAfter > exitPrice;
      if (recovered) whipsawed++;
      else keptFalling++;
      results.push({
        ticker: trade.ticker,
        exitAt: trade.exit_at,
        exitPrice,
        stopPnlPercent: trade.pnl_percent,
        maxHighAfter24h: Math.round(maxHighAfter * 10000) / 10000,
        maxRecoveryPercent: Math.round(maxRecoveryPercent * 10) / 10,
        lastCloseIn24h: Math.round(lastClose * 10000) / 10000,
        netDriftPercent: Math.round(netDriftPercent * 10) / 10,
        verdict: recovered ? "whipsawed_back_above_exit" : "kept_falling",
      });
    }

    return NextResponse.json({
      sampledCount: (stops ?? []).length,
      whipsawed,
      keptFalling,
      noData,
      whipsawRatePercent: whipsawed + keptFalling > 0 ? Math.round((whipsawed / (whipsawed + keptFalling)) * 1000) / 10 : null,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[trading-bot-stop-postmortem] failed:", error);
    return NextResponse.json({ error: getErrorMessage(error, "Failed to build stop postmortem") }, { status: 500 });
  }
}
