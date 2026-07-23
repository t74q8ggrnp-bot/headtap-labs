// app/api/opportunity-ticker/route.ts
//
// Single-ticker opportunity endpoint.
// Uses the latest successful run-scoped signal when available and the
// canonical server-side trade framework. It does not import or duplicate
// the legacy scoreOpportunity() function.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getTradeFramework,
  type TradeFrameworkResult,
} from "@/lib/canonical-trade-framework";
import { isSupportedType } from "@/lib/security-type-policy";
import { getBreakoutPotential } from "@/lib/breakout-potential";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Strategy = "spot_momentum" | "before_the_crowd";
const ACTIVE_SESSION_MAX_SIGNAL_AGE_MS = 20 * 60 * 1000;

type SignalRow = {
  ticker: string;
  price: number | string | null;
  change_percent: number | string | null;
  relative_volume: number | string | null;
  avg_volume: number | string | null;
  ht_score: number | string | null;
  momentum_score: number | string | null;
  crowd_score: number | string | null;
  trap_score: number | string | null;
  catalyst_score: number | string | null;
  pattern: string | null;
  state: string | null;
  signal_state: string | null;
  scanned_at: string | null;
  retrieved_for_sm?: boolean | null;
  retrieved_for_btc?: boolean | null;
  retrieved_for_catalyst?: boolean | null;
  security_type?: string | null;
  scan_run_id?: string | null;
};

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing server-side Supabase service credentials.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isActiveMarketSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || weekday === "Sat" || weekday === "Sun") return false;
  const minutes = hour * 60 + minute;
  return minutes >= 240 && minutes < 1200;
}

function chooseStrategy(row: SignalRow, requested: string | null): Strategy {
  if (requested === "before_crowd" || requested === "before_the_crowd") {
    return "before_the_crowd";
  }
  if (requested === "momentum" || requested === "spot_momentum") {
    return "spot_momentum";
  }
  if (row.retrieved_for_sm) return "spot_momentum";
  if (row.retrieved_for_btc) return "before_the_crowd";
  return "spot_momentum";
}

function getSignalStrength(row: SignalRow, strategy: Strategy): number {
  const htScore = n(row.ht_score);
  const momentumScore = n(row.momentum_score);
  const crowdScore = n(row.crowd_score, 50);
  const catalystScore = n(row.catalyst_score);
  const relativeVolume = n(row.relative_volume, 1);

  if (strategy === "spot_momentum") {
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          htScore * 0.55 +
            momentumScore * 0.25 +
            Math.min(100, relativeVolume * 12) * 0.2,
        ),
      ),
    );
  }

  const earliness = Math.max(0, 100 - crowdScore);
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        htScore * 0.45 +
          earliness * 0.3 +
          Math.min(100, relativeVolume * 10) * 0.15 +
          catalystScore * 0.1,
      ),
    ),
  );
}

function buildOpportunity(
  row: SignalRow,
  strategy: Strategy,
  framework: TradeFrameworkResult,
) {
  const ticker = String(row.ticker ?? "").toUpperCase();
  const price = n(row.price);
  const change = n(row.change_percent);
  const relativeVolume = n(row.relative_volume, 1);
  const momentumScore = n(row.momentum_score);
  const crowdScore = n(row.crowd_score, 50);
  const trapScore = n(row.trap_score, 50);
  const catalystScore = n(row.catalyst_score);
  const pattern = String(row.pattern ?? "Standard");
  const state = String(row.state ?? "");
  const signalState = String(row.signal_state ?? "");

  const rejectionReasons = [...framework.hardFailures];
  // Mirrors app/api/opportunities/route.ts: resistance-distance upside is
  // small by definition for a stock that hasn't broken out yet — the exact
  // profile Before The Crowd wants. Only Spot Momentum treats it as a hard
  // gate.
  if (strategy === "spot_momentum" && framework.magnitudeQuality === "negligible") {
    rejectionReasons.push("Reward magnitude is negligible.");
  }
  if (!isSupportedType(row.security_type)) {
    rejectionReasons.push(row.security_type
      ? `Unsupported security type: ${row.security_type}.`
      : "Security type is unverified; production eligibility fails closed.");
  }
  const scannedAtMs = new Date(String(row.scanned_at ?? "")).getTime();
  const signalAgeMs = Date.now() - scannedAtMs;
  if (
    isActiveMarketSession() &&
    (!Number.isFinite(scannedAtMs) || signalAgeMs < 0 || signalAgeMs > ACTIVE_SESSION_MAX_SIGNAL_AGE_MS)
  ) {
    rejectionReasons.push("Signal is too old to qualify during an active market session.");
  }

  if (strategy === "spot_momentum") {
    if (!row.retrieved_for_sm && !row.retrieved_for_catalyst) {
      rejectionReasons.push("Ticker did not qualify for Spot Momentum retrieval.");
    }
    if (change <= 0) {
      rejectionReasons.push("Spot Momentum requires positive price movement.");
    }
    if (crowdScore >= 65) {
      rejectionReasons.push(
        `Crowd saturation (${Math.round(crowdScore)}) is already late for Spot Momentum.`,
      );
    }
    if (trapScore >= 70) {
      rejectionReasons.push(
        `Trap risk (${Math.round(trapScore)}) exceeds the Spot Momentum ceiling.`,
      );
    }
  } else {
    if (!row.retrieved_for_btc && !row.retrieved_for_catalyst) {
      rejectionReasons.push("Ticker did not qualify for Before The Crowd retrieval.");
    }
    if (crowdScore >= 60) {
      rejectionReasons.push("Crowd saturation is too high for the Before The Crowd thesis.");
    }
    if (trapScore >= 55) {
      rejectionReasons.push("Trap risk exceeds the Before The Crowd ceiling.");
    }
  }

  const eligible = rejectionReasons.length === 0;
  const signalStrength = getSignalStrength(row, strategy);

  const tradeQuality =
    framework.rrRatio === null
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              Math.min(1, framework.rrRatio / 3) * 55 +
                (framework.magnitudeQuality === "meaningful" ? 25 : 0) +
                Math.max(0, 100 - (framework.extensionRisk ?? 100)) * 0.2,
            ),
          ),
        );

  const qualityScore = Math.round(
    signalStrength * 0.55 +
      tradeQuality * 0.3 +
      (framework.entryQuality ?? 0) * 0.15,
  );
  const breakout = getBreakoutPotential({
    change, relativeVolume, momentumScore, crowdScore, trapScore, catalystScore,
  }, framework);
  const strategyScore = Math.round(qualityScore * 0.65 + breakout.score * 0.35);

  let tier: "scanner" | "watch" | "feature" | "hero" = "scanner";
  if (eligible && strategyScore >= 80 && (framework.entryQuality ?? 0) >= 70) {
    tier = "hero";
  } else if (eligible && strategyScore >= 68) {
    tier = "feature";
  } else if (eligible) {
    tier = "watch";
  }

  const displayedConfidence = eligible
    ? Math.min(99, strategyScore)
    : Math.min(49, Math.round(signalStrength * 0.5));

  const opportunityType =
    catalystScore >= 20
      ? "catalyst"
      : change >= 5 || momentumScore >= 60 || relativeVolume >= 3
        ? "breakout"
        : change > 0
          ? "momentum"
          : "watch";

  const signals: string[] = [];
  if (change > 0) signals.push(`Up ${change.toFixed(1)}%`);
  if (relativeVolume >= 1.2) signals.push(`${relativeVolume.toFixed(1)}x relative volume`);
  if (catalystScore >= 20) signals.push(`Catalyst score: ${Math.round(catalystScore)}`);
  if (pattern && pattern !== "Standard") signals.push(pattern);
  if (framework.rrRatio !== null) signals.push(`${framework.rrRatio.toFixed(2)}:1 risk/reward`);

  const whyItMatters = eligible
    ? `${ticker} currently qualifies for ${strategy === "spot_momentum" ? "Spot Momentum" : "Before The Crowd"} evaluation with a ${tier} tier.`
    : `${ticker} has an active signal, but it does not currently pass the full opportunity gate.`;

  const whatChanged =
    catalystScore >= 20 && state
      ? `${state} is active in the signal stack.`
      : relativeVolume >= 3
        ? `Volume expanded to ${relativeVolume.toFixed(1)}x normal.`
        : change > 0
          ? `Price is up ${change.toFixed(1)}% with positive participation.`
          : "No verified positive momentum change is currently available.";

  const riskNote =
    rejectionReasons[0] ||
    framework.warnings[0] ||
    "Momentum and volume must continue to hold. Entry timing still matters.";

  const stage =
    tier === "hero"
      ? "High-Quality Opportunity"
      : tier === "feature"
        ? "Qualified Opportunity"
        : tier === "watch"
          ? "Watch"
          : "Scanner Only";

  const stageEmoji =
    tier === "hero" ? "🔥" : tier === "feature" ? "⚡" : tier === "watch" ? "👀" : "🔎";

  return {
    ticker,
    price,
    change,
    relativeVolume,
    avgVolume: n(row.avg_volume),
    opportunityType,
    opportunityScore: strategyScore,
    qualityScore,
    breakoutPotentialScore: breakout.score,
    breakoutPotentialLabel: breakout.label,
    breakoutPotentialComponents: breakout.components,
    floatDataStatus: breakout.floatDataStatus,
    signalStrength,
    tradeQuality,
    entryQuality: framework.entryQuality,
    momentumScore,
    attentionScore: crowdScore,
    riskScore: trapScore,
    catalystScore,
    pattern,
    state: signalState || state,
    strategy,
    tier,
    confidence: displayedConfidence,
    eligible,
    rejectionReasons,
    eligibility: { eligible, reasons: rejectionReasons },
    stage,
    stageEmoji,
    whyItMatters,
    whatChanged,
    riskNote,
    signals,
    tradeFramework: framework,
    scannedAt: row.scanned_at,
    freshnessLabel:
      !Number.isFinite(signalAgeMs) || signalAgeMs > 8 * 60 * 60 * 1000
        ? "Last Verified Signal"
        : signalAgeMs > 60 * 60 * 1000
          ? "Recent Scan"
          : "Live Scan",
    engineVersion: "opportunity-ticker-v2-canonical",
  };
}

async function getLatestSignalRow(
  supabase: ReturnType<typeof getSupabase>,
  ticker: string,
): Promise<{ row: SignalRow | null; sourceTable: string; sourceRunId: string | null }> {
  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .select("id")
    .eq("run_type", "signal_writer_v3")
    .eq("status", "success")
    .eq("promoted", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    console.warn("[opportunity-ticker] latest run lookup failed:", runError.message);
  }

  if (run?.id) {
    const { data: runRow, error: runRowError } = await supabase
      .from("ht_signal_run_rows")
      .select("*")
      .eq("scan_run_id", run.id)
      .eq("ticker", ticker)
      .maybeSingle();

    if (runRowError) {
      console.warn("[opportunity-ticker] run-scoped row lookup failed:", runRowError.message);
    }

    if (runRow) {
      return {
        row: runRow as SignalRow,
        sourceTable: "ht_signal_run_rows",
        sourceRunId: String(run.id),
      };
    }
  }

  const { data: legacyRows, error: legacyError } = await supabase
    .from("ht_signals")
    .select("*")
    .eq("ticker", ticker)
    .order("scanned_at", { ascending: false })
    .limit(1);

  if (legacyError) throw legacyError;

  return {
    row: (legacyRows?.[0] as SignalRow | undefined) ?? null,
    sourceTable: "ht_signals",
    sourceRunId: null,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase().trim();
  const mode = searchParams.get("mode") ?? "full";
  const requestedStrategy = searchParams.get("strategy");

  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker param" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();

    if (mode === "history") {
      const { data: history, error: historyError } = await supabase
        .from("ht_market_behavior")
        .select("signaled_at, ht_score, signal_state, pattern, price_at_signal, gain_1d, gain_3d, gain_5d, outcome")
        .eq("ticker", ticker)
        .order("signaled_at", { ascending: false })
        .limit(10);

      if (historyError) throw historyError;

      return NextResponse.json({
        ticker,
        history: history ?? [],
        totalSignals: history?.length ?? 0,
        winRate: history?.length
          ? Math.round((history.filter((item: any) => item.outcome === "winner").length / history.length) * 100)
          : null,
      });
    }

    const { row: latest, sourceTable, sourceRunId } =
      await getLatestSignalRow(supabase, ticker);

    if (!latest) {
      return NextResponse.json({
        ticker,
        message: "No data available for this ticker in the latest verified signal state.",
        opportunityScore: 0,
      });
    }

    const strategy = chooseStrategy(latest, requestedStrategy);
    const price = n(latest.price);
    const change = n(latest.change_percent);
    const framework = await getTradeFramework(supabase, ticker, price, change);
    const opportunity = buildOpportunity(latest, strategy, framework);

    if (mode === "explain") {
      return NextResponse.json({
        ticker,
        explanation: {
          summary: opportunity.whyItMatters,
          whatChanged: opportunity.whatChanged,
          riskNote: opportunity.riskNote,
          stage: `${opportunity.stageEmoji} ${opportunity.stage}`,
          confidence: `${opportunity.confidence}% confidence`,
          signals: opportunity.signals,
          eligibility: opportunity.eligible,
          rejectionReasons: opportunity.rejectionReasons,
          strategy: opportunity.strategy,
          tier: opportunity.tier,
          verdict: opportunity.eligible
            ? `HT currently classifies ${ticker} as a ${opportunity.tier} opportunity for ${opportunity.strategy}.`
            : `HT is monitoring ${ticker}, but it does not currently pass the complete opportunity gate.`,
        },
        tradeFramework: framework,
        sourceTable,
        sourceRunId,
      });
    }

    return NextResponse.json({
      ticker,
      opportunity,
      scannedAt: latest.scanned_at,
      sourceTable,
      sourceRunId,
      latestSignalAt: latest.scanned_at,
    });
  } catch (error: any) {
    console.error(`Opportunity ticker error for ${ticker}:`, error);
    return NextResponse.json(
      {
        error: "Failed to fetch opportunity",
        detail: error?.message ?? "Unknown error",
      },
      { status: 500 },
    );
  }
}
