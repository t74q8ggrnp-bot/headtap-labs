// app/api/signal-memory-writer/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface CatalystSignalInput {
  ticker: string;
  price: number;
  changePercent: number;
  relativeVolume: number;
  htScore: number;
  catalystScore: number;
  momentumScore: number;
  crowdScore: number;
  trapScore: number;
  pattern: string;
  state: string;
  hasFDAEvent: boolean;
  hasInsiderBuy: boolean;
  catalystKeywords: string[];
}

function buildMemoryPayload(signal: CatalystSignalInput) {
  const now = new Date().toISOString();
  const opportunityWindow = signal.hasFDAEvent || signal.hasInsiderBuy || signal.catalystScore >= 30 ? "Early Window" : "Developing";
  const patternName = signal.pattern.includes("Catalyst") ? "Quiet Accumulation" : signal.pattern.includes("Momentum") ? "Continuation Stack" : "Quiet Accumulation";
  const discoveryScore = Math.min(99, Math.round(signal.catalystScore * 1.5 + (100 - signal.crowdScore) * 0.3 + Math.min(20, signal.relativeVolume * 4)));
  const accelerationScore = Math.min(99, Math.round(signal.momentumScore * 0.8 + signal.catalystScore * 0.4));

  return {
    user_id: "ht_system",
    symbol: signal.ticker,
    picked_at: now,
    entry_price: signal.price,
    change_percent: signal.changePercent,
    ht_score: signal.htScore,
    final_score: signal.htScore + signal.catalystScore,
    discovery_score: discoveryScore,
    acceleration_score: accelerationScore,
    fingerprint_score: signal.catalystScore,
    crowd_saturation_score: signal.crowdScore,
    opportunity_window: opportunityWindow,
    opportunity_window_open: true,
    pattern: patternName,
    contender_status: signal.catalystScore >= 24 ? "Top Contender" : "Contender",
    quality_gate: signal.hasFDAEvent || signal.hasInsiderBuy ? "Pass" : "Watch",
    trap_risk: signal.trapScore,
    entry_quality: Math.min(99, Math.round((100 - signal.trapScore) * 0.7 + signal.catalystScore * 0.5)),
    participation: Math.min(99, Math.round(signal.relativeVolume * 15)),
    continuation: Math.min(99, Math.round(signal.catalystScore * 1.2)),
    consumer_label: "Top Conviction",
    discovery_read: signal.hasFDAEvent
      ? `FDA catalyst event detected for ${signal.ticker} — binary outcome could drive significant move. Catalyst score: ${signal.catalystScore}.`
      : signal.hasInsiderBuy
      ? `Insider buy detected for ${signal.ticker} via Form 4 filing. Catalyst score: ${signal.catalystScore}.`
      : `Catalyst signal detected for ${signal.ticker}: ${signal.catalystKeywords.join(", ")}. Score: ${signal.catalystScore}.`,
    internal_reason: [
      signal.hasFDAEvent ? "FDA_EVENT" : null,
      signal.hasInsiderBuy ? "INSIDER_BUY" : null,
      signal.catalystKeywords.length > 0 ? `KEYWORDS:${signal.catalystKeywords.slice(0, 3).join(",")}` : null,
      `CATALYST_SCORE:${signal.catalystScore}`,
      `STATE:${signal.state}`,
    ].filter(Boolean).join("|"),
    status: "tracking",
    outcome_status: null,
    max_gain: null,
    max_drawdown: null,
    price_1d: null,
    price_3d: null,
    price_5d: null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const signals: CatalystSignalInput[] = body.signals ?? [];
    if (!signals.length) return NextResponse.json({ written: 0, message: "No signals provided" });

    const catalystSignals = signals.filter(s => s.catalystScore >= 20);
    if (!catalystSignals.length) return NextResponse.json({ written: 0, message: "No catalyst signals to write" });

    const results = { written: 0, skipped: 0, errors: 0, tickers: [] as string[] };

    for (const signal of catalystSignals) {
      try {
        const since = new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString();
        const { data: existing } = await getSupabase()
          .from("ht_signal_memory")
          .select("id")
          .eq("symbol", signal.ticker)
          .eq("user_id", "ht_system")
          .gte("picked_at", since)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        const { error } = await getSupabase()
          .from("ht_signal_memory")
          .insert(buildMemoryPayload(signal));

        if (error) {
          console.error(`[Signal Memory] INSERT ERROR for ${signal.ticker}:`, error.message);
          results.errors++;
        } else {
          results.written++;
          results.tickers.push(signal.ticker);
        }
      } catch (err) {
        console.error(`[Signal Memory] ERROR for ${signal.ticker}:`, err);
        results.errors++;
      }
    }

    return NextResponse.json({
      ...results,
      message: `Signal memory: ${results.written} written, ${results.skipped} skipped, ${results.errors} errors`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Signal Memory Writer] Route error:", err);
    return NextResponse.json({ error: "Signal memory writer failed" }, { status: 500 });
  }
}
