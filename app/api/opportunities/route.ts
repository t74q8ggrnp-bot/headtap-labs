// ─────────────────────────────────────────────────────────────
//  app/api/opportunities/route.ts
//  FINAL VERSION — reads directly from ht_signals
//  No re-scoring. No external calls. Pure Polygon data.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type HTOpportunity = {
  ticker: string;
  price: number;
  change: number;
  opportunityType: "momentum" | "recovery" | "breakout" | "social_surge" | "catalyst" | "watch";
  opportunityScore: number;
  momentumScore: number;
  recoveryScore: number;
  attentionScore: number;
  riskScore: number;
  patternScore: number;
  catalystScore: number;
  catalystTags: string[];
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

function buildOpportunityFromRow(row: any): HTOpportunity | null {
  const ticker = row.ticker;
  const price = row.price ?? 0;
  const change = row.change_percent ?? 0;
  const relativeVolume = row.relative_volume ?? 1;
  const catalystScore = row.catalyst_score ?? 0;
  const htScore = row.ht_score ?? 50;
  const crowdScore = row.crowd_score ?? 50;
  const trapScore = row.trap_score ?? 50;
  const momentumScore = row.momentum_score ?? 0;
  const state = row.state ?? "";
  const pattern = row.pattern ?? "Standard";

  if (pattern.includes("Exhaustion") && catalystScore < 20) return null;

  let opportunityType: HTOpportunity["opportunityType"] = "watch";
  if (catalystScore >= 20) {
    opportunityType = "catalyst";
  } else if (change >= 2 && relativeVolume >= 1.5 && crowdScore < 75) {
    opportunityType = momentumScore >= 60 ? "breakout" : "momentum";
  } else if (change < 0 && relativeVolume >= 1.5) {
    opportunityType = "recovery";
  }

  if (opportunityType === "watch" && catalystScore < 20) return null;

  let opportunityScore = 0;
  if (catalystScore >= 20) {
    opportunityScore = catalystScore + Math.min(40, momentumScore);
  } else if (change >= 0) {
    opportunityScore = Math.round(
      momentumScore * 0.45 +
      Math.min(30, relativeVolume * 8) * 0.3 +
      (100 - crowdScore) * 0.25
    );
  } else {
    const dropScore = Math.min(35, Math.abs(change) * 2.2);
    opportunityScore = Math.round(dropScore * 0.5 + (100 - trapScore) * 0.3 + Math.min(25, relativeVolume * 8) * 0.2);
  }

  if (opportunityScore < 15 && catalystScore < 20) return null;

  let stage = "Developing";
  let stageEmoji = "👀";
  if (state.includes("Catalyst")) {
    stage = state.includes("FDA") ? "FDA Catalyst Active" : "Catalyst Building";
    stageEmoji = "⚡";
  } else if (state.includes("Insider")) {
    stage = "Insider Conviction";
    stageEmoji = "🎯";
  } else if (relativeVolume >= 3) {
    stage = "Acceleration";
    stageEmoji = "⚡";
  } else if (relativeVolume >= 2) {
    stage = "Discovery";
    stageEmoji = "👀";
  } else if (change < 0 && relativeVolume >= 1.5) {
    stage = "Recovery Beginning";
    stageEmoji = "🌱";
  }

  const catalystTags: string[] = [];
  if (state.includes("FDA Event")) catalystTags.push("FDA Event");
  if (state.includes("Insider Buy")) catalystTags.push("Insider Buying");
  if (catalystScore >= 20 && catalystTags.length === 0) catalystTags.push("Catalyst Watch");

  const signals: string[] = [];
  if (relativeVolume >= 3) signals.push(`${relativeVolume.toFixed(1)}x relative volume`);
  if (crowdScore < 40) signals.push("Before crowd saturation");
  if (state.includes("FDA Event")) signals.push("FDA catalyst event");
  if (state.includes("Insider Buy")) signals.push("Insider Form 4 buy detected");
  if (catalystScore >= 20) signals.push(`Catalyst score: ${catalystScore}`);

  let whyItMatters = "";
  if (state.includes("FDA Event")) {
    whyItMatters = `FDA catalyst event detected for ${ticker} — binary outcome could drive a significant price move. `;
  }
  if (state.includes("Insider Buy")) {
    whyItMatters += `Insider bought shares recently via Form 4 — insiders rarely buy without conviction. `;
  }
  if (change >= 2) {
    whyItMatters += `Up ${change.toFixed(1)}% with ${relativeVolume.toFixed(1)}x normal volume`;
    if (crowdScore < 45) whyItMatters += " — crowd has not fully arrived yet.";
    else whyItMatters += ".";
  } else if (change < 0) {
    whyItMatters += `Down ${Math.abs(change).toFixed(1)}% — volume is ${relativeVolume.toFixed(1)}x normal, selling may be exhausting.`;
  }
  if (!whyItMatters) whyItMatters = "HT detected early signals worth monitoring.";

  let whatChanged = "";
  if (state.includes("FDA Event")) whatChanged = "FDA catalyst event identified — binary outcome approaching.";
  else if (state.includes("Insider Buy")) whatChanged = "Form 4 insider buy detected recently.";
  else if (relativeVolume >= 3) whatChanged = `Volume surged to ${relativeVolume.toFixed(1)}x normal.`;
  else if (Math.abs(change) >= 5) whatChanged = `Price moved ${change > 0 ? "+" : ""}${change.toFixed(1)}% with elevated participation.`;
  else whatChanged = "Multiple signals aligned within the last scan cycle.";

  let riskNote = "";
  if (state.includes("FDA Event")) riskNote = "Binary FDA event — position sizing is critical. A negative outcome could cause significant decline.";
  else if (trapScore >= 70) riskNote = "High risk — extended move. Entry timing is critical.";
  else if (change < 0) riskNote = "Recovery setup — wait for volume confirmation before acting.";
  else riskNote = "Risk appears controlled. Volume must hold for the thesis to stay valid.";

  const confidence = Math.min(99, Math.round(opportunityScore * 0.6 + htScore * 0.4));
  const crowdStage = crowdScore < 30 ? 1 : crowdScore < 50 ? 2 : crowdScore < 65 ? 3 : crowdScore < 80 ? 4 : 5;
  const isBeforeCrowd = crowdScore < 45 && (relativeVolume >= 1.5 || catalystScore >= 20);

  return {
    ticker,
    price,
    change,
    opportunityType,
    opportunityScore,
    momentumScore,
    recoveryScore: change < 0 ? Math.min(99, Math.round(Math.abs(change) * 2.2 + relativeVolume * 10)) : 0,
    attentionScore: crowdScore,
    riskScore: trapScore,
    patternScore: 50,
    catalystScore,
    catalystTags,
    stage,
    stageEmoji,
    confidence,
    whyItMatters,
    whatChanged,
    riskNote,
    signals,
    crowdStage,
    relativeVolume,
    isBeforeCrowd,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";
  const limit = Math.min(20, parseInt(searchParams.get("limit") ?? "10"));

  try {
    const { data: scanData, error } = await getSupabase()
      .from("ht_signals")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(300);

    if (error || !scanData?.length) {
      return NextResponse.json({
        opportunities: [],
        message: "No scan data yet. The app logs signals every 30 seconds.",
        totalScanned: 0,
      });
    }

    const latestByTicker = new Map<string, any>();
    for (const row of scanData) {
      if (!latestByTicker.has(row.ticker)) latestByTicker.set(row.ticker, row);
    }

    const opportunities: HTOpportunity[] = [];
    for (const [, row] of latestByTicker) {
      const opp = buildOpportunityFromRow(row);
      if (opp) opportunities.push(opp);
    }

    let filtered = [...opportunities].sort((a, b) => b.opportunityScore - a.opportunityScore);

    if (type === "momentum") {
      filtered = filtered.filter(o => o.opportunityType === "momentum" || o.opportunityType === "breakout");
    }
    if (type === "recovery") {
      filtered = filtered.filter(o => o.opportunityType === "recovery");
    }
    if (type === "catalyst") {
      filtered = filtered
        .filter(o => o.catalystScore >= 20)
        .sort((a, b) => {
          if (b.catalystScore !== a.catalystScore) return b.catalystScore - a.catalystScore;
          if (Math.abs(b.change) !== Math.abs(a.change)) return Math.abs(b.change) - Math.abs(a.change);
          if ((b.relativeVolume ?? 1) !== (a.relativeVolume ?? 1)) return (b.relativeVolume ?? 1) - (a.relativeVolume ?? 1);
          return a.price - b.price;
        });
    }
    if (type === "before_crowd") {
      filtered = filtered.filter(o => o.isBeforeCrowd);
    }

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

export function scoreOpportunity(raw: any): any {
  return buildOpportunityFromRow({
    ticker: raw.ticker,
    price: raw.price,
    change_percent: raw.change,
    relative_volume: raw.relativeVolume,
    crowd_score: raw.crowdSaturation,
    trap_score: raw.trapRisk,
    ht_score: raw.htScore,
    momentum_score: raw.momentumScore ?? 0,
    catalyst_score: raw.catalystScore ?? 0,
    pattern: raw.pattern,
    state: raw.signal_state ?? raw.state ?? "",
    volume_score: raw.relativeVolume ? raw.relativeVolume * 10 : 10,
  }) ?? {
    ticker: raw.ticker,
    price: raw.price,
    change: raw.change,
    opportunityType: "watch",
    opportunityScore: 0,
    momentumScore: 0,
    recoveryScore: 0,
    attentionScore: raw.attentionScore ?? 50,
    riskScore: raw.trapRisk ?? 50,
    patternScore: 50,
    catalystScore: raw.catalystScore ?? 0,
    catalystTags: [],
    stage: "Watch",
    stageEmoji: "👀",
    confidence: 0,
    whyItMatters: "Monitoring.",
    whatChanged: "No significant change.",
    riskNote: "No clear signal yet.",
    signals: [],
    crowdStage: 3,
    relativeVolume: raw.relativeVolume ?? 1,
    isBeforeCrowd: false,
  };
}
