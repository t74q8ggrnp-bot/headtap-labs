// TEMPORARY — one-time widen of GLOB/ARAY stop_price to the new 5% floor
// (they were opened before MIN_STOP_LOSS_PERCENT existed). Delete after use.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MIN_STOP_LOSS_PERCENT = 5;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!,
  );
  const { data: openTrades, error } = await supabase
    .from("bot_trades")
    .select("id, ticker, entry_price, stop_price")
    .eq("status", "open")
    .in("ticker", ["GLOB", "ARAY"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const updates = [];
  for (const trade of openTrades ?? []) {
    const entryPrice = Number(trade.entry_price);
    const newStop = Math.round(entryPrice * (1 - MIN_STOP_LOSS_PERCENT / 100) * 10000) / 10000;
    const { error: updateError } = await supabase
      .from("bot_trades")
      .update({ stop_price: newStop, updated_at: new Date().toISOString() })
      .eq("id", trade.id);
    updates.push({ ticker: trade.ticker, oldStop: trade.stop_price, newStop, error: updateError?.message ?? null });
  }
  return NextResponse.json({ updates });
}
