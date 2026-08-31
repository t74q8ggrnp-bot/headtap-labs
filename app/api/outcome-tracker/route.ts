// app/api/outcome-tracker/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchMassiveLastTrade,
  fetchMassiveStockSnapshot,
} from "@/lib/massive-stocks";
import { resolveSnapshotDisplayPrice } from "@/lib/polygon-snapshot";

const getSupabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Server-owned Supabase credentials are unavailable.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

async function getCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const [trade, snapshot] = await Promise.all([
      fetchMassiveLastTrade(ticker),
      fetchMassiveStockSnapshot(ticker),
    ]);
    if (trade?.price && trade.price > 0) return trade.price;
    if (snapshot) {
      const price = resolveSnapshotDisplayPrice(snapshot);
      if (price > 0) return price;
    }
    console.warn("[outcome-tracker] Massive returned no price", { ticker });
    return null;
  } catch (error) {
    console.error("[outcome-tracker] Massive quote failed", {
      ticker,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

function gradeOutcome(entryPrice: number, currentPrice: number, daysElapsed: number): string {
  const gain = ((currentPrice - entryPrice) / entryPrice) * 100;
  if (daysElapsed <= 1) {
    if (gain >= 3) return "winner";
    if (gain <= -3) return "failed";
    return "neutral";
  }
  if (daysElapsed <= 3) {
    if (gain >= 5) return "winner";
    if (gain <= -5) return "failed";
    return "neutral";
  }
  if (gain >= 7) return "winner";
  if (gain <= -7) return "failed";
  return "neutral";
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const results = { checked: 0, updated: 0, skipped: 0, errors: 0 };

    const { data: signals, error } = await getSupabase()
      .from("ht_market_behavior")
      .select("id, ticker, signaled_at, price_at_signal, outcome, gain_1d, gain_3d, gain_5d")
      .or("outcome.eq.pending,outcome.is.null")
      .not("price_at_signal", "is", null)
      .gt("price_at_signal", 0)
      .order("signaled_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!signals?.length) {
      return NextResponse.json({ message: "No pending signals to check", ...results });
    }

    results.checked = signals.length;

    for (const signal of signals) {
      try {
        const signalDate = new Date(signal.signaled_at);
        const daysElapsed = (now.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysElapsed < 0.04) { results.skipped++; continue; }

        const currentPrice = await getCurrentPrice(signal.ticker);
        if (!currentPrice || !signal.price_at_signal) { results.skipped++; continue; }

        const entryPrice = signal.price_at_signal;
        const gain = ((currentPrice - entryPrice) / entryPrice) * 100;
        const outcome = gradeOutcome(entryPrice, currentPrice, daysElapsed);

        const updatePayload: Record<string, number | string | null> = { outcome };
        if (daysElapsed >= 1 && !signal.gain_1d) { updatePayload.price_1d = currentPrice; updatePayload.gain_1d = Math.round(gain * 100) / 100; }
        if (daysElapsed >= 3 && !signal.gain_3d) { updatePayload.price_3d = currentPrice; updatePayload.gain_3d = Math.round(gain * 100) / 100; }
        if (daysElapsed >= 5) {
          updatePayload.price_5d = currentPrice;
          updatePayload.gain_5d = Math.round(gain * 100) / 100;
          updatePayload.max_gain = Math.max(gain, signal.gain_1d ?? 0, signal.gain_3d ?? 0);
          updatePayload.max_drawdown = Math.min(gain, signal.gain_1d ?? 0, signal.gain_3d ?? 0);
        }

        const { error: updateError } = await getSupabase()
          .from("ht_market_behavior")
          .update(updatePayload)
          .eq("id", signal.id);

        if (updateError) {
          results.errors++;
          console.error(`Update error for ${signal.ticker}:`, updateError);
        } else {
          results.updated++;
          await getSupabase().from("ht_signal_outcomes").upsert({
            signal_id: signal.id,
            ticker: signal.ticker,
            entry_price: entryPrice,
            price_1d: daysElapsed >= 1 ? currentPrice : null,
            price_3d: daysElapsed >= 3 ? currentPrice : null,
            price_5d: daysElapsed >= 5 ? currentPrice : null,
            gain_1d: daysElapsed >= 1 ? Math.round(gain * 100) / 100 : null,
            gain_3d: daysElapsed >= 3 ? Math.round(gain * 100) / 100 : null,
            gain_5d: daysElapsed >= 5 ? Math.round(gain * 100) / 100 : null,
            max_gain: daysElapsed >= 5 ? Math.round(Math.max(gain, 0) * 100) / 100 : null,
            max_drawdown: daysElapsed >= 5 ? Math.round(Math.min(gain, 0) * 100) / 100 : null,
            outcome,
            checked_at: now.toISOString(),
            signaled_at: signal.signaled_at,
          }, { onConflict: "signal_id" });
        }

        await new Promise(r => setTimeout(r, 200));
      } catch (signalError) {
        results.errors++;
        console.error(`Error processing signal ${signal.ticker}:`, signalError);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      ...results,
      message: `Checked ${results.checked} signals. Updated ${results.updated}. Skipped ${results.skipped}.`,
    });

  } catch (error) {
    console.error("Outcome tracker error:", error);
    return NextResponse.json({ error: "Outcome tracker failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { signalId, ticker, entryPrice, currentPrice, daysElapsed } = body;

    if (!ticker || !entryPrice || !currentPrice) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const gain = ((currentPrice - entryPrice) / entryPrice) * 100;
    const outcome = gradeOutcome(entryPrice, currentPrice, daysElapsed ?? 1);

    const { error } = await getSupabase().from("ht_signal_outcomes").insert({
      signal_id: signalId ?? null,
      ticker,
      entry_price: entryPrice,
      gain_1d: daysElapsed >= 1 ? gain : null,
      gain_3d: daysElapsed >= 3 ? gain : null,
      gain_5d: daysElapsed >= 5 ? gain : null,
      outcome,
      checked_at: new Date().toISOString(),
    });

    if (error) throw error;
    return NextResponse.json({ success: true, outcome, gain: Math.round(gain * 100) / 100 });

  } catch (error) {
    console.error("Manual outcome error:", error);
    return NextResponse.json({ error: "Failed to log outcome" }, { status: 500 });
  }
}
