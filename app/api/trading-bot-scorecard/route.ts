// app/api/trading-bot-scorecard/route.ts
//
// Read-only: aggregates real bot_trades history -- win rate, average
// win/loss size, and a breakdown by exit_reason (target/stop/time_limit/
// manual/order_failed) so "is it losing more than winning" can be answered
// with real numbers instead of a gut read. No writes.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import {
  buildBotPerformanceScorecard,
  getBotEntryPath,
  type BotTradeScorecardRow,
} from "@/lib/trading-bot/scorecard";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const supabase = getSupabase();
    const { data: closedTrades, error: closedError } = await supabase
      .from("bot_trades")
      .select(
        "id,ticker,status,entry_price,entry_at,exit_price,exit_at,exit_reason,pnl,pnl_percent,bot_score,bot_logic_version,entry_snapshot",
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

    const trades = (closedTrades ?? []) as BotTradeScorecardRow[];
    const scorecard = buildBotPerformanceScorecard(trades);
    const {
      realizedTrades,
      operationalClosures,
      entryLogicSummary,
      allRealizedSummary,
      byLogicVersion,
      byEntryPath,
      byScoreBucket,
      byExitReason,
      operationalClosuresByReason,
    } = scorecard;

    return NextResponse.json({
      openTradeCount: openCount ?? 0,
      failedTradeCount: failedCount ?? 0,
      closedTradeCount: trades.length,
      realizedTradeCount: realizedTrades.length,
      operationalClosureCount: operationalClosures.length,
      winCount: entryLogicSummary.wins,
      lossCount: entryLogicSummary.losses,
      flatCount: entryLogicSummary.flat,
      winRatePercent: entryLogicSummary.winRatePercent,
      totalPnl: entryLogicSummary.totalPnl,
      expectancyPerTrade: entryLogicSummary.averagePnl,
      entryLogicPerformance: entryLogicSummary,
      allRealizedPerformance: allRealizedSummary,
      byLogicVersion,
      byEntryPath,
      byScoreBucket,
      byExitReason,
      operationalClosuresByReason,
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
        botLogicVersion: t.bot_logic_version,
        entryPath: getBotEntryPath(t),
        realized: t.pnl !== null && t.exit_price !== null,
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
