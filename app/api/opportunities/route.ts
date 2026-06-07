import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type HTOpportunity = {
  ticker: string;
  price: number;
  change: number;
  opportunityType: "momentum" | "recovery" | "breakout" | "social_surge" | "watch";
  opportunityScore: number;
  momentumScore: number;
  recoveryScore: number;
  attentionScore: number;
  riskScore: number;
  patternScore: number;
  stage: string;
  stageEmoji: string;
  confidence: number;
  whyItMatters: string;
  whatChanged: string;
  riskNote: string;
  signals: string[];
  crowdStage: number;
  relativeVolume: number;
  isBeforeCrowd: boolean;
};

type RawTickerData = {
  ticker: string;
  price: number;
  change: number;
  relativeVolume: number;
  attentionScore: number;
  trapRisk: number;
  htScore: number;
  pattern: string;
  crowdSaturation: number;
  socialScore?: number;
  newsArticles?: number;
  newsVelocity?: number;
};

function calcMomentumScore(d: RawTickerData): number {
  if (d.change <= 0) return 0;
  // Heavily penalize exhaustion/extended moves
  if (d.pattern.includes("Exhaustion") || d.change >= 20 || d.crowdSaturation >= 80) return 0;
  let score = 0;
  score += Math.min(35, d.change * 3.5);
  score += Math.min(25, d.relativeVolume * 6);
  score += Math.min(20, d.attentionScore * 0.22);
  score += d.htScore >= 80 ? 15 : d.htScore >= 65 ? 8 : 0;
  score += d.crowdSaturation < 45 ? 10 : d.crowdSaturation < 60 ? 3 : -10;
  // Penalize high trap risk
  if (d.trapRisk >= 65) score -= 20;
  if (d.trapRisk >= 80) score -= 30;
  return Math.min(99, Math.max(0, Math.round(score)));
}

function calcRecoveryScore(d: RawTickerData): number {
  if (d.change >= 0) return 0;
  const drop = Math.abs(d.change);
  if (drop < 2 || drop > 35) return 0;
  let score = 0;
  score += Math.min(35, drop * 2.2);
  score += d.relativeVolume >= 1.5 && d.relativeVolume < 5 ? 20 : 0;
  score += d.attentionScore >= 55 ? 15 : 0;
  score += d.trapRisk < 50 ? 15 : d.trapRisk < 65 ? 5 : 0;
  score += d.htScore >= 55 ? 10 : 0;
  score += (d.socialScore ?? 0) >= 30 ? 5 : 0;
  return Math.min(99, Math.max(0, Math.round(score)));
}

function calcAttentionScore(d: RawTickerData): number {
  let score = d.attentionScore * 0.5;
  score += Math.min(25, (d.socialScore ?? 0) * 0.35);
  score += Math.min(15, (d.newsVelocity ?? 0) * 5);
  score += d.relativeVolume >= 2 ? 10 : 0;
  return Math.min(99, Math.max(0, Math.round(score)));
}

function calcRiskScore(d: RawTickerData): number {
  let risk = d.trapRisk * 0.5;
  risk += d.change >= 15 ? 35 : d.change >= 10 ? 22 : d.change >= 7 ? 12 : 0;
  risk += d.crowdSaturation >= 75 ? 28 : d.crowdSaturation >= 60 ? 15 : 0;
  risk += d.pattern.includes("Exhaustion") ? 30 : 0;
  risk += d.relativeVolume >= 8 ? 10 : 0;
  return Math.min(99, Math.max(0, Math.round(risk)));
}

function calcPatternScore(d: RawTickerData): number {
  if (d.pattern.includes("Exhaustion")) return 10; // Heavily penalize
  const weights: Record<string, number> = {
    "Quiet Accumulation": 88,
    "Pressure Coil": 85,
    "Continuation Stack": 78,
    "Crowd Ignition": 72,
    "Reclaim Setup": 68,
    "Standard": 50,
  };
  return weights[d.pattern] ?? 50;
}

function calcOpportunityScore(d: RawTickerData, scores: {
  momentum: number; recovery: number; attention: number; risk: number; pattern: number;
}): number {
  // Hard filter — exhaustion or extreme risk never qualifies as top opportunity
  if (d.pattern.includes("Exhaustion") || d.trapRisk >= 80 || d.crowdSaturation >= 85) return 0;

  const isRecovery = d.change < 0;
  if (isRecovery) {
    return Math.round(
      scores.recovery * 0.45 +
      scores.attention * 0.25 +
      scores.pattern * 0.20 +
      (99 - scores.risk) * 0.10
    );
  }
  return Math.round(
    scores.momentum * 0.40 +
    scores.attention * 0.25 +
    scores.pattern * 0.20 +
    (99 - scores.risk) * 0.15
  );
}

function getOpportunityType(d: RawTickerData, scores: ReturnType<typeof buildScores>): HTOpportunity["opportunityType"] {
  if (d.pattern.includes("Exhaustion") || d.crowdSaturation >= 80) return "watch";
  if (d.change < 0 && scores.recovery >= 40) return "recovery";
  if ((d.socialScore ?? 0) >= 60 && scores.attention >= 65) return "social_surge";
  if (d.pattern === "Pressure Coil" && scores.momentum >= 70) return "breakout";
  if (scores.momentum >= 55) return "momentum";
  return "watch";
}

function getStage(d: RawTickerData, type: HTOpportunity["opportunityType"]): { stage: string; emoji: string } {
  if (type === "recovery") {
    const s = calcRecoveryScore(d);
    if (s >= 80) return { stage: "Recovery Confirmed", emoji: "✅" };
    if (s >= 65) return { stage: "Recovery Beginning", emoji: "🌱" };
    if (s >= 45) return { stage: "Stabilizing", emoji: "⚖️" };
    return { stage: "Capitulation", emoji: "📉" };
  }
  if (d.pattern.includes("Exhaustion")) return { stage: "Exhaustion Risk", emoji: "⚠️" };
  if (d.crowdSaturation >= 75) return { stage: "Crowd Arrived", emoji: "🔥" };
  if (d.crowdSaturation >= 60) return { stage: "Crowd Arriving", emoji: "🔥" };
  if (d.relativeVolume >= 3 && d.htScore >= 80) return { stage: "Acceleration", emoji: "⚡" };
  if (d.relativeVolume >= 2) return { stage: "Discovery", emoji: "👀" };
  return { stage: "Early Watch", emoji: "🌱" };
}

function buildWhyItMatters(d: RawTickerData, type: HTOpportunity["opportunityType"]): string {
  const parts: string[] = [];
  if (type === "recovery") {
    parts.push(`Stock is down ${Math.abs(d.change).toFixed(1)}% today.`);
    if (d.relativeVolume >= 1.5 && d.relativeVolume < 5) parts.push(`Volume is ${d.relativeVolume.toFixed(1)}x normal — selling may be exhausting.`);
    if (d.attentionScore >= 65) parts.push(`Attention is increasing as traders watch the level.`);
    if (d.trapRisk < 45) parts.push(`Recovery signals are strengthening.`);
  } else {
    if (d.relativeVolume >= 2) parts.push(`Volume is ${d.relativeVolume.toFixed(1)}x above average.`);
    if (d.change >= 3) parts.push(`Up ${d.change.toFixed(1)}% with price structure intact.`);
    if (d.crowdSaturation < 45) parts.push(`Crowd has not fully arrived yet — still early.`);
    if ((d.socialScore ?? 0) >= 40) parts.push(`Social attention is accelerating.`);
    if (d.htScore >= 80) parts.push(`HT confidence is strong at ${d.htScore}%.`);
  }
  return parts.join(" ") || "HT detected early signals worth monitoring.";
}

function buildWhatChanged(d: RawTickerData): string {
  if (d.relativeVolume >= 3) return `Volume surged to ${d.relativeVolume.toFixed(1)}x normal — unusual activity detected.`;
  if (Math.abs(d.change) >= 5) return `Price moved ${d.change > 0 ? "+" : ""}${d.change.toFixed(1)}% with elevated participation.`;
  if ((d.socialScore ?? 0) >= 50) return "Social mention velocity increased significantly.";
  if (d.change < 0) return `Dropped ${Math.abs(d.change).toFixed(1)}% — watching for stabilization signals.`;
  return "Multiple signals aligned within the last scan cycle.";
}

function buildRiskNote(d: RawTickerData, riskScore: number): string {
  if (d.pattern.includes("Exhaustion")) return "Move is extended and crowd has arrived. High risk of reversal — avoid chasing.";
  if (riskScore >= 70) return "High risk — extended move with crowd saturation. Entry timing is critical.";
  if (riskScore >= 50) return "Moderate risk — monitor volume closely. Set a clear invalidation level.";
  if (d.change < 0) return "Recovery setup — wait for volume confirmation before acting.";
  return "Risk appears controlled. Volume must hold for the thesis to stay valid.";
}

function buildScores(d: RawTickerData) {
  const momentum = calcMomentumScore(d);
  const recovery = calcRecoveryScore(d);
  const attention = calcAttentionScore(d);
  const risk = calcRiskScore(d);
  const pattern = calcPatternScore(d);
  const opportunity = calcOpportunityScore(d, { momentum, recovery, attention, risk, pattern });
  return { momentum, recovery, attention, risk, pattern, opportunity };
}

export function scoreOpportunity(raw: RawTickerData): HTOpportunity {
  const scores = buildScores(raw);
  const type = getOpportunityType(raw, scores);
  const { stage, emoji } = getStage(raw, type);
  const confidence = Math.min(99, Math.round((scores.opportunity * 0.6 + raw.htScore * 0.4)));

  const signals: string[] = [];
  if (raw.relativeVolume >= 3) signals.push(`${raw.relativeVolume.toFixed(1)}x relative volume`);
  if (raw.crowdSaturation < 40) signals.push("Before crowd saturation");
  if ((raw.socialScore ?? 0) >= 40) signals.push("Social momentum building");
  if (scores.pattern >= 80) signals.push(`Strong ${raw.pattern} pattern`);
  if (scores.recovery >= 60) signals.push("Recovery signals forming");

  return {
    ticker: raw.ticker,
    price: raw.price,
    change: raw.change,
    opportunityType: type,
    opportunityScore: scores.opportunity,
    momentumScore: scores.momentum,
    recoveryScore: scores.recovery,
    attentionScore: scores.attention,
    riskScore: scores.risk,
    patternScore: scores.pattern,
    stage,
    stageEmoji: emoji,
    confidence,
    whyItMatters: buildWhyItMatters(raw, type),
    whatChanged: buildWhatChanged(raw),
    riskNote: buildRiskNote(raw, scores.risk),
    signals,
    crowdStage: raw.crowdSaturation < 30 ? 1 : raw.crowdSaturation < 50 ? 2 : raw.crowdSaturation < 65 ? 3 : raw.crowdSaturation < 80 ? 4 : 5,
    relativeVolume: raw.relativeVolume,
    isBeforeCrowd: raw.crowdSaturation < 45 && raw.relativeVolume >= 1.5,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";
  const limit = Math.min(20, parseInt(searchParams.get("limit") ?? "10"));

  try {
    const { data: scanData, error } = await supabase
      .from("ht_scan_log")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(200);

    if (error || !scanData?.length) {
      return NextResponse.json({
        opportunities: [],
        message: "No scan data yet. The app logs signals every 30 seconds.",
        totalScanned: 0,
      });
    }

    // Dedupe to latest per ticker
    const latestByTicker = new Map<string, typeof scanData[0]>();
    for (const row of scanData) {
      if (!latestByTicker.has(row.ticker)) {
        latestByTicker.set(row.ticker, row);
      }
    }

    const opportunities: HTOpportunity[] = [];
    for (const [, row] of latestByTicker) {
      // Parse change from state/decision context
      const isDown = row.state?.includes("Buyers Needed") || row.state?.includes("Pullback") || row.state?.includes("Recovery");
      const estimatedChange = isDown ? -Math.abs((row.volume_score ?? 10) * 0.3) : Math.abs((row.volume_score ?? 10) * 0.3);

      const raw: RawTickerData = {
        ticker: row.ticker,
        price: row.price ?? 0,
        change: estimatedChange,
        relativeVolume: Math.max(0.5, (row.volume_score ?? 10) / 10),
        attentionScore: row.crowd_score ?? 50,
        trapRisk: row.trap_score ?? 50,
        htScore: row.ht_confidence ?? 50,
        pattern: row.state?.includes("Accumulation") ? "Quiet Accumulation" :
                 row.state?.includes("Coil") || row.state?.includes("Pressure") ? "Pressure Coil" :
                 row.state?.includes("Wave") || row.state?.includes("Momentum") ? "Continuation Stack" :
                 row.state?.includes("Igniting") || row.state?.includes("Crowd") ? "Crowd Ignition" :
                 row.state?.includes("Exhaustion") || row.state?.includes("Avoid") ? "Exhaustion Risk" :
                 row.state?.includes("Reclaim") || row.state?.includes("Buyers") ? "Reclaim Setup" : "Standard",
        crowdSaturation: row.crowd_score ?? 50,
        socialScore: 0,
        newsArticles: 0,
        newsVelocity: 0,
      };

      const scored = scoreOpportunity(raw);
      // Only include real opportunities — skip exhaustion and watch
      if (scored.opportunityScore >= 25 && scored.opportunityType !== "watch") {
        opportunities.push(scored);
      }
    }

    let filtered = [...opportunities].sort((a, b) => b.opportunityScore - a.opportunityScore);
    if (type === "momentum") filtered = filtered.filter(o => o.opportunityType === "momentum" || o.opportunityType === "breakout" || o.opportunityType === "social_surge");
    if (type === "recovery") filtered = filtered.filter(o => o.opportunityType === "recovery");
    if (type === "before_crowd") filtered = filtered.filter(o => o.isBeforeCrowd);

    return NextResponse.json({
      opportunities: filtered.slice(0, limit),
      totalScanned: latestByTicker.size,
      timestamp: new Date().toISOString(),
      type,
    });

  } catch (error) {
    console.error("Opportunities API error:", error);
    return NextResponse.json({ error: "Failed to fetch opportunities" }, { status: 500 });
  }
}
