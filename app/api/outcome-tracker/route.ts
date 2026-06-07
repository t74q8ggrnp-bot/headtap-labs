import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============================================================
// HT LABS — SIGNAL OUTCOME TRACKER
// Runs on a schedule (or manual trigger via GET)
// Checks prices for pending signals at 1d, 3d, 5d intervals
// Grades each signal: winner / neutral / failed
// This is how HT Labs learns from its own history
// ============================================================

async function getCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`,
        { cache: "no-store", signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.c && data.c > 0) return data.c;
      }
    }
    // Yahoo fallback
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price && price > 0) return price;
    }
    return null;
  } catch {
    return null;
  }
}

function gradeOutcome(entryPrice: number, currentPrice: number, daysElapsed: number): string {
  const gain = ((currentPrice - entryPrice) / entryPrice) * 100;
  // Grade based on days elapsed and gain threshold
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
  // 5+ days
  if (gain >= 7) return "winner";
  if (gain <= -7) return "failed";
  return "neutral";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const mode = searchParams.get("mode") ?? "check";

  // Basic security — require secret for cron calls
  if (secret !== process.env.CRON_SECRET && secret !== "htlabs-internal") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const results = {
      checked: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    // Pull signals that need outcome tracking
    // Look at ht_market_behavior for signals without outcomes yet
    const { data: signals, error } = await supabase
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

    // Process each signal
    for (const signal of signals) {
      try {
        const signalDate = new Date(signal.signaled_at);
        const daysElapsed = (now.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24);

        // Skip if less than 1 hour old
        if (daysElapsed < 0.04) {
          results.skipped++;
          continue;
        }

        const currentPrice = await getCurrentPrice(signal.ticker);
        if (!currentPrice || !signal.price_at_signal) {
          results.skipped++;
          continue;
        }

        const entryPrice = signal.price_at_signal;
        const gain = ((currentPrice - entryPrice) / entryPrice) * 100;
        const outcome = gradeOutcome(entryPrice, currentPrice, daysElapsed);

        // Build update payload based on days elapsed
        const updatePayload: Record<string, number | string | null> = {
          outcome,
        };

        if (daysElapsed >= 1 && !signal.gain_1d) {
          updatePayload.price_1d = currentPrice;
          updatePayload.gain_1d = Math.round(gain * 100) / 100;
        }
        if (daysElapsed >= 3 && !signal.gain_3d) {
          updatePayload.price_3d = currentPrice;
          updatePayload.gain_3d = Math.round(gain * 100) / 100;
        }
        if (daysElapsed >= 5) {
          updatePayload.price_5d = currentPrice;
          updatePayload.gain_5d = Math.round(gain * 100) / 100;
          // Max gain approximation
          updatePayload.max_gain = Math.max(gain, signal.gain_1d ?? 0, signal.gain_3d ?? 0);
          updatePayload.max_drawdown = Math.min(gain, signal.gain_1d ?? 0, signal.gain_3d ?? 0);
        }

        const { error: updateError } = await supabase
          .from("ht_market_behavior")
          .update(updatePayload)
          .eq("id", signal.id);

        if (updateError) {
          results.errors++;
          console.error(`Update error for ${signal.ticker}:`, updateError);
        } else {
          results.updated++;

          // Also upsert into ht_signal_outcomes for clean historical record
          await supabase.from("ht_signal_outcomes").upsert({
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

        // Small delay to avoid rate limiting
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

// POST — manually log an outcome for a specific signal
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { signalId, ticker, entryPrice, currentPrice, daysElapsed } = body;

    if (!ticker || !entryPrice || !currentPrice) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const gain = ((currentPrice - entryPrice) / entryPrice) * 100;
    const outcome = gradeOutcome(entryPrice, currentPrice, daysElapsed ?? 1);

    const { error } = await supabase.from("ht_signal_outcomes").insert({
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
