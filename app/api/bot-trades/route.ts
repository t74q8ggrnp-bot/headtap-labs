// app/api/bot-trades/route.ts
//
// Read-only view into the trading bot's paper trades. Separate system
// from Pro X and from canonical HT Labs data — this only ever reads
// bot_trades.

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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "100", 10) || 100));
    // Opt-in only — entry_snapshot is the full candidate payload at entry
    // time (tradeFramework, explosionAssessment, isContinuationEntry, etc.),
    // large enough that including it by default would bloat every normal
    // /trading-bot page load for the sake of an occasional deep-dive.
    const includeSnapshot = searchParams.get("includeSnapshot") === "1";
    const supabase = getSupabase();

    const baseColumns = "id, ticker, status, entry_price, entry_at, position_notional, target_price, stop_price, high_water_mark, max_hold_until, exit_price, exit_at, exit_reason, pnl, pnl_percent, bot_score"
      + (includeSnapshot ? ", entry_snapshot" : "");
    const analyticsColumns = "bot_logic_version, source_run_id, post_exit_price, post_exit_change_percent, post_exit_checked_at";

    type TradeRow = { status: string; pnl: number | null } & Record<string, unknown>;
    let trades: TradeRow[] | null = null;
    const { data: withAnalytics, error: withAnalyticsError } = await supabase
      .from("bot_trades")
      .select(`${baseColumns}, ${analyticsColumns}`)
      .order("entry_at", { ascending: false })
      .limit(limit);
    if (withAnalyticsError) {
      // Migration 0009 (bot_logic_version / source_run_id / post_exit_*)
      // may not be applied yet — fall back to the original column set
      // rather than 500ing the whole endpoint over columns that don't
      // exist yet.
      const { data: baseOnly, error: baseError } = await supabase
        .from("bot_trades")
        .select(baseColumns)
        .order("entry_at", { ascending: false })
        .limit(limit);
      if (baseError) throw baseError;
      trades = baseOnly as unknown as TradeRow[] | null;
    } else {
      trades = withAnalytics as unknown as TradeRow[] | null;
    }

    const closedTrades = (trades ?? []).filter((t) => t.status === "closed" && t.pnl !== null);
    const winners = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    return NextResponse.json({
      trades: trades ?? [],
      summary: {
        openCount: (trades ?? []).filter((t) => t.status === "open").length,
        closedCount: closedTrades.length,
        winCount: winners.length,
        winRate: closedTrades.length > 0 ? Math.round((winners.length / closedTrades.length) * 100) : null,
        totalPnl: Number(totalPnl.toFixed(2)),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load bot trades"), trades: [] }, { status: 500 });
  }
}
