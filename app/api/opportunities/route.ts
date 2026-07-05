// ─────────────────────────────────────────────────────────────
//  app/api/opportunities/route.ts
//
//  HT LABS OPPORTUNITIES API — the backend owns eligibility & ranking.
//
//  Philosophy (explicitly requested):
//  - No hard bans on individual stocks. META, AAPL, HOOD, TSM, NVDA —
//    any of them can win Spot Momentum or Before The Crowd on a day
//    they genuinely earn it.
//  - The ONLY category-level exclusion is index/leveraged ETFs — because
//    "before the crowd" and "catalyst" don't structurally apply to a
//    basket of hundreds of companies. That's an asset-class distinction,
//    not a judgment about any single company.
//  - Everything else is decided by the same intelligence used across
//    the product: crowd earliness, catalyst quality, extension/trap
//    risk, pattern quality, and liquidity — mirroring getOpportunityScore()
//    in the frontend, so backend and frontend never disagree.
//
//  Structural awareness (the honest replacement for name-based bans):
//  A stock's day-to-day computed "crowd saturation" can look artificially
//  LOW on a quiet-volume day even for a mega-cap that is, structurally,
//  never early — everyone already watches it. We correct for that with
//  a continuous "structural awareness" floor derived from average dollar
//  volume (price × baseline daily share volume), NOT from ticker identity.
//  A small, genuinely obscure stock gets zero floor. A mega-cap gets a
//  high floor. A big name with a real catalyst can still win — the
//  catalyst bonus is additive on top of, not blocked by, this floor.
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

// ── Asset-class exclusion ONLY — not a stock-specific ban ─────────────────
// Index funds and leveraged/inverse products are baskets, not companies.
// "Before the crowd" and "catalyst" don't apply the same way to a basket.
const ETF_INDEX_EXCLUSIONS = new Set([
  "SPY","QQQ","IWM","DIA","VTI","VOO","VEA","VWO",
  "XLK","XLF","XLE","XLI","XLV","XLY","XLC","XLB","XLRE","XLU","XLP",
  "SMH","SOXX","ARKK","ARKG","ARKW",
  "GLD","SLV","TLT","HYG","LQD",
  "TQQQ","SQQQ","SOXL","SOXS","UVXY","SVXY","SPXL","SPXS",
  "LABD","LABU","TZA","TNA","FAZ","FAS","SDOW","UDOW","SPXU","UPRO",
  "QID","QLD","DXD","TWM","ERY","ERX",
]);

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
  if (age <= 1) return "Live Scan";
  if (age <= 8) return "Recent Scan";
  return "Last Verified Signal";
}

// ── Structural awareness — continuous, not a name lookup ───────────────────
// avgDollarVolume = price × baseline (previous-day) share volume.
// This approximates "how liquid / widely covered / institutionally known
// is this name" without ever checking what the ticker actually is.
function getStructuralAwareness(avgDollarVolume: number): number {
  if (avgDollarVolume <= 0) return 0;               // no data — no penalty
  if (avgDollarVolume < 1_000_000) return 0;          // obscure micro-float
  if (avgDollarVolume < 10_000_000) return Math.round(((avgDollarVolume - 1_000_000) / 9_000_000) * 30);       // 0-30
  if (avgDollarVolume < 100_000_000) return Math.round(30 + ((avgDollarVolume - 10_000_000) / 90_000_000) * 35); // 30-65
  if (avgDollarVolume < 1_000_000_000) return Math.round(65 + ((avgDollarVolume - 100_000_000) / 900_000_000) * 20); // 65-85
  return Math.min(99, Math.round(85 + Math.log10(avgDollarVolume / 1_000_000_000) * 7)); // 85-99, mega-cap territory
}

function classifyCatalystCategory(state: string): { label: string; weight: number } {
  if (state.includes("FDA")) return { label: "FDA / PDUFA", weight: 0.55 };
  if (state.includes("M&A")) return { label: "Acquisition / Merger", weight: 0.45 };
  if (state.includes("Earnings")) return { label: "Earnings", weight: 0.40 };
  if (state.includes("Regulatory") || state.includes("Legal")) return { label: "Regulatory / Legal", weight: 0.38 };
  if (state.includes("Partnership")) return { label: "Commercial Event", weight: 0.28 };
  if (state.includes("Analyst")) return { label: "Analyst Event", weight: 0.20 };
  return { label: "Verified Catalyst", weight: 0.25 };
}

function buildCatalystTags(state: string, catalystScore: number) {
  const tags: string[] = [];
  if (state.includes("FDA")) tags.push("FDA Event");
  if (state.includes("M&A")) tags.push("M&A Activity");
  if (state.includes("Earnings")) tags.push("Earnings Catalyst");
  if (state.includes("Partnership")) tags.push("Partnership");
  if (state.includes("Analyst")) tags.push("Analyst Upgrade");
  if (catalystScore >= 20 && tags.length === 0) tags.push("Catalyst Watch");
  return tags;
}

// ── Core opportunity scoring — mirrors getOpportunityScore(stock, mode) ────
// on the frontend, so backend and frontend rank things the same way.
// mode: "spot_momentum" rewards activity happening NOW.
//       "before_the_crowd" rewards earliness more heavily.
function computeOpportunityScore(row: {
  htScore: number;
  changePercent: number;
  relativeVolume: number;
  catalystScore: number;
  catalystState: string;
  trapScore: number;
  pattern: string;
  price: number;
  effectiveCrowdScore: number;
}, mode: "spot_momentum" | "before_the_crowd"): number {
  const { htScore, changePercent, relativeVolume, catalystScore, catalystState,
    trapScore, pattern, price, effectiveCrowdScore } = row;

  const absChange = Math.abs(changePercent);
  const hce = catalystScore >= 35;
  let score = htScore;

  // Catalyst weight — scaled by event type, additive on top of everything else.
  // This is exactly what lets a "structurally aware" mega-cap still win when
  // it has a genuinely rare setup — the whole point of not banning names.
  if (hce) {
    const { weight } = classifyCatalystCategory(catalystState);
    score += Math.min(28, catalystScore * weight);
  } else if (catalystScore >= 20) {
    score += Math.min(8, catalystScore * 0.12);
  }

  // Crowd earliness — BTC mode weights this far more heavily.
  if (effectiveCrowdScore < 35) score += mode === "before_the_crowd" ? 14 : 5;
  else if (effectiveCrowdScore < 45) score += mode === "before_the_crowd" ? 9 : 3;
  else if (effectiveCrowdScore < 55) score += mode === "before_the_crowd" ? 4 : 1;
  else if (effectiveCrowdScore > 70) score -= mode === "before_the_crowd" ? 12 : 4;
  else if (effectiveCrowdScore > 80) score -= mode === "before_the_crowd" ? 18 : 8;

  // Activity confirmation — a flat stock never beats one that's actually moving.
  if (relativeVolume >= 3.0) score += 10;
  else if (relativeVolume >= 2.0) score += 7;
  else if (relativeVolume >= 1.5) score += 4;
  else if (relativeVolume >= 1.2) score += 2;
  else if (relativeVolume < 0.8) score -= 8;

  if (absChange >= 5) score += 6;
  else if (absChange >= 2) score += 3;
  else if (absChange >= 0.5) score += 1;
  else if (absChange < 0.2 && !hce) score -= 6;

  // Extension / trap risk — reuses trap_score as the proxy already computed
  // upstream by signal-writer (extended-move + no-catalyst logic baked in).
  if (trapScore >= 85) score -= hce ? 8 : 18;
  else if (trapScore >= 70) score -= hce ? 5 : 12;
  else if (trapScore >= 55) score -= hce ? 2 : 6;
  else if (trapScore < 30) score += 4;

  // Liquidity quality proxy.
  if (price < 1) score -= 10;
  else if (price < 2) score -= 5;
  else if (price > 5 && relativeVolume >= 1.2) score += 2;

  // Pattern quality.
  if (pattern === "Pressure Coil" || pattern === "Quiet Accumulation") score += 8;
  else if (pattern === "Catalyst Momentum") score += 6;
  else if (pattern === "Catalyst Building") score += 4;
  else if (pattern === "Crowd Ignition") score += 3;
  else if (pattern === "Exhaustion Risk") score -= 14;

  return Math.max(0, Math.min(150, Math.round(score)));
}

function buildOpportunityFromRow(row: any, mode: "spot_momentum" | "before_the_crowd"): HTOpportunity | null {
  const ticker = String(row.ticker ?? "").trim().toUpperCase();
  const price = n(row.price);
  const change = n(row.change_percent);
  const relativeVolume = n(row.relative_volume, 1);
  const catalystScore = n(row.catalyst_score);
  const htScore = n(row.ht_score, 0);
  const crowdScore = n(row.crowd_score, 50);
  const trapScore = n(row.trap_score, 50);
  const momentumScore = n(row.momentum_score);
  const avgVolume = n(row.avg_volume, 0);
  const state = String(row.state ?? "");
  const pattern = String(row.pattern ?? "Standard");
  const signalState = String(row.signal_state ?? "");
  const scannedAt = row.scanned_at ? String(row.scanned_at) : null;

  // Asset-class exclusion only — ETFs/index products, never individual stocks.
  if (ETF_INDEX_EXCLUSIONS.has(ticker)) return null;

  // Safety filters — data quality, not identity.
  if (!ticker) return null;
  if (price <= 0) return null;
  if (change <= 0 && catalystScore < 20) return null;
  if (relativeVolume <= 0) return null;
  if (hoursSince(scannedAt) > MAX_SIGNAL_AGE_HOURS) return null;
  if (pattern.includes("Exhaustion") && catalystScore < 20) return null;
  // Liquidity floor — tradability, not a name check.
  if (avgVolume > 0 && avgVolume < 50_000 && catalystScore < 35) return null;

  // ── Structural awareness — the honest, continuous replacement for
  // name-based mega-cap exclusion. Computed from liquidity, not identity.
  const avgDollarVolume = price * avgVolume;
  const structuralAwareness = getStructuralAwareness(avgDollarVolume);
  // A stock can't look "earlier" than its structural awareness suggests —
  // but if today's actual crowd_score is even higher (already extended
  // further than its normal baseline), that higher number wins instead.
  const effectiveCrowdScore = Math.max(crowdScore, Math.round(structuralAwareness * 0.9));

  const momentumOppScore = computeOpportunityScore(
    { htScore, changePercent: change, relativeVolume, catalystScore, catalystState: state, trapScore, pattern, price, effectiveCrowdScore },
    "spot_momentum"
  );
  const beforeCrowdOppScore = computeOpportunityScore(
    { htScore, changePercent: change, relativeVolume, catalystScore, catalystState: state, trapScore, pattern, price, effectiveCrowdScore },
    "before_the_crowd"
  );
  const opportunityScore = mode === "before_the_crowd" ? beforeCrowdOppScore : momentumOppScore;

  let opportunityType: HTOpportunity["opportunityType"] = "watch";
  if (catalystScore >= 20) opportunityType = "catalyst";
  else if (change >= 5 || momentumScore >= 60 || relativeVolume >= 3) opportunityType = "breakout";
  else if (change > 0) opportunityType = "momentum";

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
  if (effectiveCrowdScore < 45) signals.push("Before crowd saturation");
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
    if (effectiveCrowdScore < 45) whyItMatters += " before broad crowd saturation";
    whyItMatters += ".";
  }

  let whatChanged = "Verified signal from the latest HT Labs scan.";
  if (catalystScore >= 20 && state) whatChanged = `${state} detected in the signal stack.`;
  else if (relativeVolume >= 3) whatChanged = `Volume expanded to ${relativeVolume.toFixed(1)}x normal.`;
  else if (change >= 2) whatChanged = `Price moved +${change.toFixed(1)}% with positive participation.`;

  let riskNote = "Momentum must hold. A failed volume follow-through weakens the setup.";
  if (trapScore >= 75) riskNote = "Extended move risk is elevated. Entry timing matters.";
  else if (catalystScore >= 60) riskNote = "Catalyst-driven setup. Position sizing matters because news can reverse quickly.";
  else if (effectiveCrowdScore >= 75) riskNote = "Crowd saturation is elevated. Avoid chasing late entries.";

  const confidence = Math.min(99, Math.round(htScore * 0.7 + opportunityScore * 0.3));
  const crowdStage = effectiveCrowdScore < 30 ? 1 : effectiveCrowdScore < 50 ? 2 : effectiveCrowdScore < 65 ? 3 : effectiveCrowdScore < 80 ? 4 : 5;

  // Before-crowd eligibility — continuous, structural-awareness aware.
  // Mirrors qualifiesForBeforeTheCrowd() on the frontend, minus the name list.
  const isBeforeCrowd =
    (catalystScore >= 55 && effectiveCrowdScore < 60) ||   // extraordinary catalyst can open a window even on an "aware" name
    (catalystScore >= 35 && relativeVolume >= 0.9 && effectiveCrowdScore < 55) ||
    (effectiveCrowdScore < 45 && relativeVolume >= 1.3) ||
    ((pattern === "Quiet Accumulation" || pattern === "Pressure Coil") && effectiveCrowdScore < 55);

  return {
    ticker,
    price,
    change,
    opportunityType,
    opportunityScore,
    momentumScore,
    recoveryScore: 0,
    attentionScore: effectiveCrowdScore,
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
  if (type === "recovery") return [];
  return opportunities;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10)));

  // BTC requests rank by the before-the-crowd flavored score.
  // Everything else ranks by the spot-momentum flavored score.
  const mode: "spot_momentum" | "before_the_crowd" = type === "before_crowd" ? "before_the_crowd" : "spot_momentum";

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
      .map((row) => buildOpportunityFromRow(row, mode))
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
    return NextResponse.json({ error: "Failed to fetch opportunities", opportunities: [] }, { status: 500 });
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
    avg_volume: raw.avgVolume ?? raw.avg_volume,
    pattern: raw.pattern,
    state: raw.signal_state ?? raw.state ?? "",
    scanned_at: raw.scanned_at ?? new Date().toISOString(),
  }, "spot_momentum") ?? {
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
