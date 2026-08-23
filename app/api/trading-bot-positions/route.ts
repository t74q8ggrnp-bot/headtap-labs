// app/api/trading-bot-positions/route.ts
//
// Read-only cross-check: every position Alpaca actually holds in the paper
// account, next to every ticker bot_trades has an open row for. Exists to
// answer one question directly — is there anything Alpaca is holding that
// bot_trades never recorded (an orphaned position: the bot's own buy order
// filled but the database insert failed, or something entered the account
// through some other path entirely). Calls only getAccount()/getPositions(),
// both plain GETs against Alpaca — no order is placed, no position is
// touched, no bot_trades row is written or changed.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { alpacaConfigured, getAccount, getPositions } from "@/lib/trading-bot/alpaca";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

// Real account equity, cash, and positions — was reachable with no auth at
// all. Same CRON_SECRET bearer-token check used everywhere else in this
// codebase for internal-only routes.
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
    if (!alpacaConfigured()) {
      return NextResponse.json({ error: "Alpaca is not configured." }, { status: 500 });
    }
    const [account, positions] = await Promise.all([getAccount(), getPositions()]);

    const supabase = getSupabase();
    const { data: openTrades, error } = await supabase
      .from("bot_trades")
      .select("ticker, entry_price, entry_at, bot_score")
      .eq("status", "open");
    if (error) throw error;

    const trackedTickers = new Set((openTrades ?? []).map((t) => t.ticker));
    const orphaned = positions.filter((p) => !trackedTickers.has(p.symbol));

    return NextResponse.json({
      accountEquity: account?.equity ?? null,
      accountCash: account?.cash ?? null,
      alpacaPositionCount: positions.length,
      trackedOpenTradeCount: (openTrades ?? []).length,
      // Positions Alpaca actually holds with no matching open row in
      // bot_trades — the bot has no idea these exist, so no stop-loss,
      // no trailing stop, no max-hold exit applies to them at all.
      orphanedPositions: orphaned.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avg_entry_price: p.avg_entry_price,
        current_price: p.current_price,
        unrealized_pl: p.unrealized_pl,
        unrealized_plpc: p.unrealized_plpc,
      })),
      allPositions: positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        avg_entry_price: p.avg_entry_price,
        current_price: p.current_price,
        unrealized_pl: p.unrealized_pl,
        unrealized_plpc: p.unrealized_plpc,
        trackedByBot: trackedTickers.has(p.symbol),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load trading bot positions") }, { status: 500 });
  }
}
