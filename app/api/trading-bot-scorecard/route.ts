// app/api/trading-bot-scorecard/route.ts
//
// Read-only: aggregates real bot_trades history -- win rate, average
// win/loss size, and a breakdown by exit_reason (target/stop/time_limit/
// manual/order_failed) so "is it losing more than winning" can be answered
// with real numbers instead of a gut read. No writes.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data: closedTrades, error: closedError } = await supabase
      .from("bot_trades")
      .select(
        "id,ticker,status,entry_price,entry_at,exit_price,exit_at,exit_reason,pnl,pnl_percent,bot_score",
      )
      .eq("status", "closed")
      .order("exit_at", { ascending: false })
      .limit(2000);
    if (closedError) throw closedError;

    const { count: openCount, error: openError } = await supabase
      .from("bot_trades")
      .select("*", { count: "exact", head: true })
      .eq("status", "open");
    if (openError) throw openError;

    const { count: failedCount, error: failedError } = await supabase
      .from("bot_trades")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed");
    if (failedError) throw failedError;

    const trades = closedTrades ?? [];
    const wins = trades.filter((t) => (t.pnl ?? 0) > 0);
    const losses = trades.filter((t) => (t.pnl ?? 0) < 0);
    const flat = trades.filter((t) => (t.pnl ?? 0) === 0);

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const avgWinPnl = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / wins.length
      : null;
    const avgLossPnl = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / losses.length
      : null;
    const avgWinPercent = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.pnl_percent ?? 0), 0) / wins.length
      : null;
    const avgLossPercent = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.pnl_percent ?? 0), 0) / losses.length
      : null;

    const byExitReason = new Map<
      string,
      { count: number; wins: number; losses: number; totalPnl: number }
    >();
    for (const trade of trades) {
      const reason = trade.exit_reason ?? "unknown";
      const group = byExitReason.get(reason) ?? { count: 0, wins: 0, losses: 0, totalPnl: 0 };
      group.count += 1;
      if ((trade.pnl ?? 0) > 0) group.wins += 1;
      if ((trade.pnl ?? 0) < 0) group.losses += 1;
      group.totalPnl += trade.pnl ?? 0;
      byExitReason.set(reason, group);
    }

    const expectancy =
      wins.length + losses.length > 0
        ? ((wins.length / trades.length) * (avgWinPnl ?? 0)) +
          ((losses.length / trades.length) * (avgLossPnl ?? 0))
        : null;

    return NextResponse.json({
      openTradeCount: openCount ?? 0,
      failedTradeCount: failedCount ?? 0,
      closedTradeCount: trades.length,
      winCount: wins.length,
      lossCount: losses.length,
      flatCount: flat.length,
      winRatePercent: trades.length > 0 ? round((wins.length / trades.length) * 100) : null,
      totalPnl: round(totalPnl),
      avgWinPnl: avgWinPnl === null ? null : round(avgWinPnl),
      avgLossPnl: avgLossPnl === null ? null : round(avgLossPnl),
      avgWinPercent: avgWinPercent === null ? null : round(avgWinPercent),
      avgLossPercent: avgLossPercent === null ? null : round(avgLossPercent),
      winLossRatio:
        avgWinPnl !== null && avgLossPnl !== null && avgLossPnl !== 0
          ? round(Math.abs(avgWinPnl / avgLossPnl))
          : null,
      expectancyPerTrade: expectancy === null ? null : round(expectancy),
      byExitReason: Object.fromEntries(
        [...byExitReason.entries()].map(([reason, g]) => [
          reason,
          { ...g, totalPnl: round(g.totalPnl) },
        ]),
      ),
      recentTrades: trades.slice(0, 20).map((t) => ({
        ticker: t.ticker,
        entryAt: t.entry_at,
        exitAt: t.exit_at,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        exitReason: t.exit_reason,
        pnl: t.pnl,
        pnlPercent: t.pnl_percent,
        botScore: t.bot_score,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
