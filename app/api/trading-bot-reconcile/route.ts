// app/api/trading-bot-reconcile/route.ts
//
// One-time (but safe to re-run — idempotent) reconciliation: for every
// Alpaca position with no matching open row in bot_trades (see
// /api/trading-bot-positions), insert one that reflects Alpaca's real,
// current state as the ground truth. These positions became orphaned by
// the fill-detection race condition fixed in pollForFill (see
// app/api/trading-bot/route.ts) — the original buy filled on Alpaca but
// was never recorded, so nothing has ever applied a stop-loss, trailing
// stop, or max-hold exit to them.
//
// Deliberately does NOT try to reconstruct the original entry timestamp or
// candidate data — that's genuinely not recoverable (the same bug that
// orphaned the position also meant its entry_snapshot was never captured).
// entry_price is Alpaca's real avg_entry_price (accurate cost basis);
// entry_at is the moment this reconciliation ran (the moment real
// management starts, not a false claim about when the position actually
// opened). stop_price is set 5% below CURRENT price, not the old entry —
// a stop below the original entry is meaningless for a position already
// deep underwater; this protects against further loss from here forward,
// which is the only protection that's actually still possible.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { alpacaConfigured, getPositions } from "@/lib/trading-bot/alpaca";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

const RECONCILIATION_STOP_PERCENT = 5;
const MAX_HOLD_DAYS = 3;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

export async function POST() {
  try {
    if (!alpacaConfigured()) {
      return NextResponse.json({ error: "Alpaca is not configured." }, { status: 500 });
    }
    const supabase = getSupabase();
    const positions = await getPositions();

    const { data: openTrades, error: openTradesError } = await supabase
      .from("bot_trades")
      .select("ticker")
      .eq("status", "open");
    if (openTradesError) throw openTradesError;
    const trackedTickers = new Set((openTrades ?? []).map((t) => t.ticker));

    const orphaned = positions.filter((p) => !trackedTickers.has(p.symbol));
    const now = new Date();
    const inserted: string[] = [];
    const skipped: { ticker: string; reason: string }[] = [];

    for (const position of orphaned) {
      const entryPrice = Number(position.avg_entry_price);
      const currentPrice = Number(position.current_price);
      const qty = Number(position.qty);
      if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice) || !Number.isFinite(qty) || qty <= 0) {
        skipped.push({ ticker: position.symbol, reason: "Invalid price/qty data from Alpaca." });
        continue;
      }
      // Re-check right before inserting — this endpoint is safe to call more
      // than once, and a position discovered in an earlier call may have
      // already been reconciled.
      const { data: alreadyTracked } = await supabase
        .from("bot_trades")
        .select("id")
        .eq("ticker", position.symbol)
        .eq("status", "open")
        .maybeSingle();
      if (alreadyTracked) {
        skipped.push({ ticker: position.symbol, reason: "Already has an open bot_trades row." });
        continue;
      }

      const { error: insertError } = await supabase.from("bot_trades").insert({
        ticker: position.symbol,
        status: "open",
        entry_order_id: null,
        entry_price: entryPrice,
        entry_at: now.toISOString(),
        position_notional: Math.round(qty * entryPrice * 100) / 100,
        target_price: null,
        stop_price: Math.round(currentPrice * (1 - RECONCILIATION_STOP_PERCENT / 100) * 1000000) / 1000000,
        high_water_mark: currentPrice,
        max_hold_until: new Date(now.getTime() + MAX_HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        bot_score: null,
        bot_logic_version: "orphan-reconciliation-2026-08-11",
        entry_snapshot: {
          backfilled: true,
          reason: "orphaned_position_reconciliation",
          note: "Original buy order filled on Alpaca but was never recorded, due to a fill-detection race condition in pollForFill (now fixed). Original entry timestamp and candidate/scoring data are not recoverable — entry_price is Alpaca's real avg_entry_price (accurate cost basis); entry_at is when this reconciliation ran, not the true original entry time.",
          alpacaQtyAtReconciliation: qty,
          alpacaCurrentPriceAtReconciliation: currentPrice,
          alpacaUnrealizedPlAtReconciliation: position.unrealized_pl,
          reconciledAt: now.toISOString(),
        },
      });
      if (insertError) {
        skipped.push({ ticker: position.symbol, reason: insertError.message });
        continue;
      }
      inserted.push(position.symbol);
    }

    return NextResponse.json({
      orphanedFound: orphaned.length,
      inserted,
      skipped,
      timestamp: now.toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to reconcile trading bot positions") }, { status: 500 });
  }
}
