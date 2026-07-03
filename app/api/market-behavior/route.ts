import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getMarketSession(hour: number): string {
  if (hour < 9 || (hour === 9 && true)) return "pre_market";
  if (hour < 10) return "open";
  if (hour >= 15) return "power_hour";
  return "mid_session";
}

// POST — log a new signal
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();

    const payload = {
      ticker: body.ticker,
      signaled_at: now.toISOString(),
      day_of_week: day,
      day_name: DAY_NAMES[day],
      hour_of_day: hour,
      market_session: getMarketSession(hour),
      ht_score: body.htScore ?? 0,
      momentum_score: body.momentumScore ?? 0,
      volume_score: body.volumeScore ?? 0,
      social_score: body.socialScore ?? 0,
      crowd_stage: body.crowdStage ?? 1,
      signal_state: body.signalState ?? "",
      pattern: body.pattern ?? "",
      price_at_signal: body.price ?? 0,
      price_1h: null,
      price_1d: null,
      price_3d: null,
      price_5d: null,
      gain_1h: null,
      gain_1d: null,
      gain_3d: null,
      gain_5d: null,
      outcome: "pending",
      max_gain: null,
      max_drawdown: null,
      user_id: body.userId ?? null,
    };

    const { data, error } = await getSupabase()
      .from("ht_market_behavior")
      .insert(payload)
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Market behavior POST error:", error);
    return NextResponse.json({ error: "Failed to log signal" }, { status: 500 });
  }
}

// GET — fetch patterns and intelligence
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "patterns";

  try {
    if (mode === "patterns") {
      const { data, error } = await getSupabase()
        .from("ht_market_behavior")
        .select("*")
        .neq("outcome", "pending")
        .order("signaled_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      if (!data || data.length < 5) {
        return NextResponse.json({
          patterns: [],
          insights: ["Building pattern database... Signal more tickers to unlock Market Intelligence."],
          totalSignals: data?.length ?? 0,
          dayStats: [],
        });
      }

      const dayStats = DAY_NAMES.map((dayName, dayIndex) => {
        const daySignals = data.filter((s) => s.day_of_week === dayIndex);
        if (daySignals.length === 0) return null;
        const winners = daySignals.filter((s) => s.outcome === "winner").length;
        const winRate = Math.round((winners / daySignals.length) * 100);
        const avgGain1d = daySignals
          .filter((s) => s.gain_1d !== null)
          .reduce((sum, s, _, arr) => sum + s.gain_1d / arr.length, 0);
        const avgGain3d = daySignals
          .filter((s) => s.gain_3d !== null)
          .reduce((sum, s, _, arr) => sum + s.gain_3d / arr.length, 0);
        return {
          day: dayName,
          signals: daySignals.length,
          winRate,
          avgGain1d: Math.round(avgGain1d * 10) / 10,
          avgGain3d: Math.round(avgGain3d * 10) / 10,
        };
      }).filter(Boolean);

      const sessionStats = ["pre_market", "open", "mid_session", "power_hour"].map((session) => {
        const sessionSignals = data.filter((s) => s.market_session === session);
        if (sessionSignals.length < 2) return null;
        const winners = sessionSignals.filter((s) => s.outcome === "winner").length;
        const winRate = Math.round((winners / sessionSignals.length) * 100);
        return { session: session.replace("_", " "), signals: sessionSignals.length, winRate };
      }).filter(Boolean);

      const patternStats = [...new Set(data.map((s) => s.pattern))].map((pattern) => {
        const patternSignals = data.filter((s) => s.pattern === pattern);
        if (patternSignals.length < 2) return null;
        const winners = patternSignals.filter((s) => s.outcome === "winner").length;
        const winRate = Math.round((winners / patternSignals.length) * 100);
        const avgGain = patternSignals
          .filter((s) => s.gain_1d !== null)
          .reduce((sum, s, _, arr) => sum + s.gain_1d / arr.length, 0);
        return { pattern, signals: patternSignals.length, winRate, avgGain: Math.round(avgGain * 10) / 10 };
      }).filter(Boolean).sort((a: any, b: any) => b.winRate - a.winRate);

      const insights: string[] = [];

      const sortedDays = [...dayStats].sort((a: any, b: any) => b.winRate - a.winRate);
      if (sortedDays.length >= 2) {
        const best = sortedDays[0] as any;
        const worst = sortedDays[sortedDays.length - 1] as any;
        if (best.signals >= 3) insights.push(`${best.day} signals have the highest win rate at ${best.winRate}%.`);
        if (worst.signals >= 3 && worst.winRate < best.winRate - 15)
          insights.push(`${worst.day} signals underperform by ${best.winRate - worst.winRate}% compared to ${best.day}.`);
      }

      const sortedSessions = [...sessionStats].sort((a: any, b: any) => b.winRate - a.winRate);
      if (sortedSessions.length >= 2) {
        const bestSession = sortedSessions[0] as any;
        if (bestSession.signals >= 3)
          insights.push(`${bestSession.session.replace("_", " ")} signals outperform with ${bestSession.winRate}% win rate.`);
      }

      if (patternStats.length >= 2) {
        const bestPattern = patternStats[0] as any;
        if (bestPattern.signals >= 3)
          insights.push(`${bestPattern.pattern} setups win ${bestPattern.winRate}% of the time with avg ${bestPattern.avgGain > 0 ? "+" : ""}${bestPattern.avgGain}% gain.`);
      }

      const highSocial = data.filter((s) => s.social_score >= 60);
      const lowSocial = data.filter((s) => s.social_score < 30);
      if (highSocial.length >= 3 && lowSocial.length >= 3) {
        const socialWinRate = Math.round((highSocial.filter(s => s.outcome === "winner").length / highSocial.length) * 100);
        const volWinRate = Math.round((lowSocial.filter(s => s.outcome === "winner").length / lowSocial.length) * 100);
        if (socialWinRate > volWinRate + 10)
          insights.push(`Social momentum signals outperform volume-only signals by ${socialWinRate - volWinRate}%.`);
      }

      const totalWinners = data.filter((s) => s.outcome === "winner").length;
      const overallWinRate = Math.round((totalWinners / data.length) * 100);
      insights.push(`Overall HT signal win rate: ${overallWinRate}% across ${data.length} tracked signals.`);

      return NextResponse.json({
        patterns: patternStats.slice(0, 5),
        insights,
        totalSignals: data.length,
        dayStats,
        sessionStats,
        overallWinRate,
      });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    console.error("Market behavior GET error:", error);
    return NextResponse.json({ error: "Failed to fetch patterns" }, { status: 500 });
  }
}
