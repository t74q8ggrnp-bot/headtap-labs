// ─────────────────────────────────────────────────────────────
//  app/api/opportunities/route.ts
//
//  HT LABS OPPORTUNITIES API
//
//  Purpose:
//  - Read directly from ht_signals.
//  - Do NOT rescan the market.
//  - Do NOT call Polygon.
//  - Do NOT create a second scoring engine.
//  - Treat signal-writer as the source of truth.
//  - Format verified signals for the UI/homepage.
//  - Uses service key server-side so Supabase RLS does not hide signals.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;
const MAX_SIGNAL_AGE_HOURS = 96;

const getSupabase = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars for opportunities API.");
  }

  return createClient(supabaseUrl, supabaseKey);
};

export type HTOpportunity = {
  ticker: string;
  price: number;
  change: number;
  opportunityType: "momentum" | "breakout" | "catalyst" | "watch";
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
  scannedAt: string | null;
  freshnessLabel: "Live Scan" | "Recent Scan" | "Last Verified Signal";
};

function n(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hoursSince(dateValue: any) {
  if (!dateValue) return Infinity;
  const timestamp = new Date(dateValue).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return (Date.now() - timestamp) / (1000 * 60 * 60);
}

function getFreshnessLabel(scannedAt: string | null): HTOpportunity["freshnessLabel"] {
  const age = hoursSince(scannedAt);

  // Fresh enough to be considered live.
  if (age <= 1) return "Live Scan";

  // Same-session / same-day scan.
  if (age <= 8) return "Recent Scan";

  // Quiet market, pre-market, after-hours, weekend, or holiday.
  // We are intentionally holding the last verified opportunity.
  return "Last Verified Signal";
}

function buildCatalystTags(state: string, catalystScore: number) {
  const tags: string[] = [];

  if (state.includes("FDA")) tags.push("FDA Event");
  if (state.includes("M&A")) tags.push("M&A Activity");
  if (state.includes("Earnings")) tags.push("Earnings Catalyst");
  if (state.includes("Partnership")) tags.push("Partnership");
  if (state.includes("Analyst")) tags.push("Analyst Upgrade");

  if (catalystScore >= 20 && tags.length === 0) {
    tags.push("Catalyst Watch");
  }

  return tags;
}

function buildOpportunityFromRow(row: any): HTOpportunity | null {
  const ticker = String(row.ticker ?? "").trim().toUpperCase();
  const price = n(row.price);
  const change = n(row.change_percent);
  const relativeVolume = n(row.relative_volume, 1);
  const catalystScore = n(row.catalyst_score);
  const htScore = n(row.ht_score, 50);
  const crowdScore = n(row.crowd_score, 50);
  const trapScore = n(row.trap_score, 50);
  const momentumScore = n(row.momentum_score);
  const state = String(row.state ?? "");
  const pattern = String(row.pattern ?? "Standard");
  const signalState = String(row.signal_state ?? "");
  const scannedAt = row.scanned_at ? String(row.scanned_at) : null;

  // Safety filters only. The scanner decides what is worthy.
  if (!ticker) return null;
  if (price <= 0) return null;
  if (change <= 0 && catalystScore < 20) return null;
  if (relativeVolume <= 0) return null;
  if (hoursSince(scannedAt) > MAX_SIGNAL_AGE_HOURS) return null;
  if (pattern.includes("Exhaustion") && catalystScore < 20) return null;

  let opportunityType: HTOpportunity["opportunityType"] = "watch";

  if (catalystScore >= 20) {
    opportunityType = "catalyst";
  } else if (change >= 5 || momentumScore >= 60 || relativeVolume >= 3) {
    opportunityType = "breakout";
  } else if (change > 0) {
    opportunityType = "momentum";
  }

  const opportunityScore = Math.min(
    99,
    Math.round(
      htScore * 0.58 +
      momentumScore * 0.22 +
      Math.min(99, relativeVolume * 10) * 0.12 +
      catalystScore * 0.08
    )
  );

  let stage = signalState || "Developing";
  let stageEmoji = "👀";

  if (catalystScore >= 60 || state.includes("FDA") || state.includes("M&A")) {
    stage = state || "Catalyst Active";
    stageEmoji = "⚡";
  } else if (relativeVolume >= 5 && change >= 5) {
    stage = "Momentum Ignition";
    stageEmoji = "🔥";
  } else if (relativeVolume >= 3) {
    stage = "Acceleration";
    stageEmoji = "⚡";
  } else if (relativeVolume >= 1.5) {
    stage = "Discovery";
    stageEmoji = "👀";
  }

  const catalystTags = buildCatalystTags(state, catalystScore);

  const signals: string[] = [];
  if (change > 0) signals.push(`Up ${change.toFixed(1)}%`);
  if (relativeVolume >= 1.3) signals.push(`${relativeVolume.toFixed(1)}x relative volume`);
  if (crowdScore < 45) signals.push("Before crowd saturation");
  if (catalystScore >= 20) signals.push(`Catalyst score: ${catalystScore}`);
  if (pattern && pattern !== "Standard") signals.push(pattern);

  let whyItMatters = "";
  if (catalystScore >= 20) {
    whyItMatters = `${ticker} has an active catalyst signal`;
    if (change > 0) whyItMatters += ` while trading up ${change.toFixed(1)}%`;
    if (relativeVolume >= 1.3) whyItMatters += ` on ${relativeVolume.toFixed(1)}x normal volume`;
    whyItMatters += ".";
  } else {
    whyItMatters = `${ticker} is showing verified positive momentum`;
    if (change > 0) whyItMatters += `, up ${change.toFixed(1)}%`;
    if (relativeVolume >= 1.3) whyItMatters += ` with ${relativeVolume.toFixed(1)}x relative volume`;
    if (crowdScore < 45) whyItMatters += " before broad crowd saturation";
    whyItMatters += ".";
  }

  let whatChanged = "Verified signal from the latest HT Labs scan.";
  if (catalystScore >= 20 && state) {
    whatChanged = `${state} detected in the signal stack.`;
  } else if (relativeVolume >= 3) {
    whatChanged = `Volume expanded to ${relativeVolume.toFixed(1)}x normal.`;
  } else if (change >= 2) {
    whatChanged = `Price moved +${change.toFixed(1)}% with positive participation.`;
  }

  let riskNote = "Momentum must hold. A failed volume follow-through weakens the setup.";
  if (trapScore >= 75) {
    riskNote = "Extended move risk is elevated. Entry timing matters.";
  } else if (catalystScore >= 60) {
    riskNote = "Catalyst-driven setup. Position sizing matters because news can reverse quickly.";
  } else if (crowdScore >= 75) {
    riskNote = "Crowd saturation is elevated. Avoid chasing late entries.";
  }

  const confidence = Math.min(99, Math.round(htScore * 0.7 + opportunityScore * 0.3));
  const crowdStage = crowdScore < 30 ? 1 : crowdScore < 50 ? 2 : crowdScore < 65 ? 3 : crowdScore < 80 ? 4 : 5;
  const isBeforeCrowd = crowdScore < 45 && (relativeVolume >= 1.3 || catalystScore >= 20);

  return {
    ticker,
    price,
    change,
    opportunityType,
    opportunityScore,
    momentumScore,
    recoveryScore: 0,
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
    scannedAt,
    freshnessLabel: getFreshnessLabel(scannedAt),
  };
}

function filterByType(opportunities: HTOpportunity[], type: string) {
  if (type === "momentum") {
    return opportunities.filter((o) => o.opportunityType === "momentum" || o.opportunityType === "breakout");
  }

  if (type === "catalyst") {
    return opportunities.filter((o) => o.catalystScore >= 20);
  }

  if (type === "before_crowd") {
    return opportunities.filter((o) => o.isBeforeCrowd);
  }

  if (type === "recovery") {
    return [];
  }

  return opportunities;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10)));

  try {
    const { data: scanData, error } = await getSupabase()
      .from("ht_signals")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    if (!scanData?.length) {
      return NextResponse.json({
        opportunities: [],
        message: "No verified signals found yet.",
        totalScanned: 0,
        type,
        timestamp: new Date().toISOString(),
      });
    }

    const latestByTicker = new Map<string, any>();

    for (const row of scanData) {
      if (row?.ticker && !latestByTicker.has(row.ticker)) {
        latestByTicker.set(row.ticker, row);
      }
    }

    const opportunities = [...latestByTicker.values()]
      .map(buildOpportunityFromRow)
      .filter(Boolean) as HTOpportunity[];

    const filtered = filterByType(opportunities, type).sort((a, b) => {
      if (b.opportunityScore !== a.opportunityScore) return b.opportunityScore - a.opportunityScore;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.change !== a.change) return b.change - a.change;
      return b.relativeVolume - a.relativeVolume;
    });

    return NextResponse.json({
      opportunities: filtered.slice(0, limit),
      totalScanned: latestByTicker.size,
      returned: Math.min(filtered.length, limit),
      timestamp: new Date().toISOString(),
      type,
    });
  } catch (error: any) {
    console.error("[opportunities] API error:", error?.message || error);

    return NextResponse.json(
      {
        error: "Failed to fetch opportunities",
        opportunities: [],
      },
      { status: 500 }
    );
  }
}

export function scoreOpportunity(raw: any): any {
  return buildOpportunityFromRow({
    ticker: raw.ticker,
    price: raw.price,
    change_percent: raw.change ?? raw.change_percent,
    relative_volume: raw.relativeVolume ?? raw.relative_volume,
    crowd_score: raw.crowdSaturation ?? raw.crowd_score,
    trap_score: raw.trapRisk ?? raw.trap_score,
    ht_score: raw.htScore ?? raw.ht_score,
    momentum_score: raw.momentumScore ?? raw.momentum_score,
    catalyst_score: raw.catalystScore ?? raw.catalyst_score,
    pattern: raw.pattern,
    state: raw.signal_state ?? raw.state ?? "",
    scanned_at: raw.scanned_at ?? new Date().toISOString(),
  }) ?? {
    ticker: raw.ticker,
    price: raw.price,
    change: raw.change ?? 0,
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
    whatChanged: "No verified opportunity.",
    riskNote: "No clear signal yet.",
    signals: [],
    crowdStage: 3,
    relativeVolume: raw.relativeVolume ?? 1,
    isBeforeCrowd: false,
    scannedAt: raw.scanned_at ?? null,
    freshnessLabel: "Last Verified Signal",
  };
}
