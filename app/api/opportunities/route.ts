// app/api/opportunities/route.ts
// Reads one latest successful promoted run only.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTradeFramework, type TradeFrameworkResult } from "@/lib/canonical-trade-framework";
import { isSupportedType } from "@/lib/security-type-policy";
import { getBreakoutPotential } from "@/lib/breakout-potential";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENGINE_VERSION = "opportunities-v3-run-scoped";
const CONCURRENCY = 20;
const ACTIVE_SESSION_MAX_SIGNAL_AGE_MS = 20 * 60 * 1000;
// A verified, high-volume move this large is the thesis working, not a
// reason to hide it. Below this bar the crowd/trap ceilings still apply —
// this isn't a general loosening, it's a dedicated lane for the moves that
// were getting excluded specifically for being "too much of a real move."
const EXTREME_MOMENTUM_MIN_CHANGE = 25;
const EXTREME_MOMENTUM_MIN_RVOL = 3;
// R:R/resistance-distance math was built for a stock trading inside a normal
// range — it was never going to work for one that's already blown through
// every level above it, no matter how the numbers get capped or tuned.
// Confirmed live across three different attempts to patch this with R:R-
// adjacent math (an unconditional bypass, then a downside cap): each one
// either let through a genuinely bad trade (DCX/STKH: real ~24% downside,
// R:R as low as 0.21) or still labeled a stalled-out mover "Strong Momentum"
// off a technically-small-but-real downside (XRX: 6.34% down for only
// 1.75-3.25% up). The R:R ruler is the wrong tool for this class of stock,
// not a tuning problem. What actually distinguishes "still exploding" from
// "already exhausted" is whether the move is still confirming — the same
// question the trading bot's continuation path already answers (see
// app/api/trading-bot/route.ts's computeContinuationScore): real volume
// (guaranteed by the thresholds above) plus not showing this codebase's own
// existing "Exhaustion Risk" label (big move, no catalyst behind it) plus
// momentum still reading strong right now, not already cooling off.
const CONTINUATION_MIN_MOMENTUM_SCORE = 70;
// Mirrors SEASONED_BAR_COUNT in canonical-trade-framework.ts — below this,
// the trade framework still computes (see MIN_BARS_HARD_FLOOR there) but the
// read is on a recent listing/uplisting, worth naming explicitly.
const SEASONED_BAR_COUNT = 21;
type Strategy = "spot_momentum" | "before_the_crowd";
type RequestType = "all" | "momentum" | "catalyst" | "before_crowd";

// Shared by evaluateAll (decides whether to ask the trade framework to skip
// its extension-compression discount, see canonical-trade-framework.ts) and
// evaluate() (decides eligibility) — same question, computed once so the two
// can't drift apart. Only depends on fields already on the raw candidate
// (change/relativeVolume/pattern/momentumScore/signalState), not on tf, so
// it's available before the framework fetch happens.
function isConfirmedContinuationRunner(c: Candidate, strategy: Strategy): boolean {
  const isExtremeMomentum = strategy === "spot_momentum"
    && c.change >= EXTREME_MOMENTUM_MIN_CHANGE
    && c.relativeVolume >= EXTREME_MOMENTUM_MIN_RVOL;
  return isExtremeMomentum
    && c.pattern !== "Exhaustion Risk"
    && (c.momentumScore >= CONTINUATION_MIN_MOMENTUM_SCORE || c.signalState === "Strong Momentum");
}

type Candidate = {
  ticker: string; price: number; change: number; relativeVolume: number; avgVolume: number;
  htScore: number; momentumScore: number; crowdScore: number; trapScore: number; catalystScore: number;
  pattern: string; state: string; signalState: string; scannedAt: string;
  retrievedForSm: boolean; retrievedForBtc: boolean; retrievedForCatalyst: boolean; securityType: string | null;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function mapRow(row: any): Candidate {
  return {
    ticker: String(row.ticker ?? "").toUpperCase(), price: num(row.price), change: num(row.change_percent),
    relativeVolume: num(row.relative_volume, 1), avgVolume: num(row.avg_volume), htScore: num(row.ht_score),
    momentumScore: num(row.momentum_score), crowdScore: num(row.crowd_score, 50), trapScore: num(row.trap_score, 50),
    catalystScore: num(row.catalyst_score), pattern: String(row.pattern ?? "Standard"), state: String(row.state ?? ""),
    signalState: String(row.signal_state ?? ""), scannedAt: String(row.scanned_at ?? ""),
    retrievedForSm: Boolean(row.retrieved_for_sm), retrievedForBtc: Boolean(row.retrieved_for_btc),
    retrievedForCatalyst: Boolean(row.retrieved_for_catalyst), securityType: row.security_type ? String(row.security_type) : null,
  };
}

function signalStrength(c: Candidate, strategy: Strategy) {
  if (strategy === "spot_momentum") return Math.max(0, Math.min(100, Math.round(c.htScore * 0.55 + c.momentumScore * 0.25 + Math.min(100, c.relativeVolume * 12) * 0.2)));
  const earliness = Math.max(0, 100 - c.crowdScore);
  return Math.max(0, Math.min(100, Math.round(c.htScore * 0.45 + earliness * 0.3 + Math.min(100, c.relativeVolume * 10) * 0.15 + c.catalystScore * 0.1)));
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

function evaluate(c: Candidate, tf: TradeFrameworkResult, strategy: Strategy) {
  const isExtremeMomentum = strategy === "spot_momentum"
    && c.change >= EXTREME_MOMENTUM_MIN_CHANGE
    && c.relativeVolume >= EXTREME_MOMENTUM_MIN_RVOL;

  // A verified, high-volume move this large already IS the thesis working —
  // same principle as the crowd/trap bypass below, extended to the R:R/
  // magnitude hard gate itself. That gate measures upside as distance to the
  // nearest resistance level in the last 20 daily bars, which reads as ~zero
  // once a stock has already blown through every recent high (confirmed
  // live: INLF ran 40-70%+ intraday and never appeared anywhere in Spot
  // Momentum, hero tier or otherwise, because of exactly this). That's a gap
  // in what the model measures, not evidence the move isn't real. Insufficient-
  // data and stale-price hard failures are NOT bypassed here — those are
  // actual data-quality problems, unrelated to how extended the move is.
  //
  // Gated on the move still confirming, not on any R:R-adjacent number
  // (see CONTINUATION_MIN_MOMENTUM_SCORE above for why — R:R math doesn't
  // apply to this class of stock at all, tuning its cap doesn't fix that).
  // "Exhaustion Risk" is this codebase's own existing label for a big move
  // with no catalyst behind it — a real, already-tracked red flag that the
  // print is stale. Momentum still reading strong right now is the
  // "still going," not "already happened," half of the check.
  const isMagnitudeRelatedHardFailure = (r: string) =>
    r.startsWith("R:R ") || r === "Modeled downside is excessive in absolute and volatility-relative terms.";
  const isConfirmedRunner = isConfirmedContinuationRunner(c, strategy);
  const reasons = isConfirmedRunner
    ? tf.hardFailures.filter((r) => !isMagnitudeRelatedHardFailure(r))
    : [...tf.hardFailures];
  if (strategy === "spot_momentum" && tf.magnitudeQuality === "negligible" && !isConfirmedRunner) {
    reasons.push("Reward magnitude is negligible.");
  }
  if (!isSupportedType(c.securityType)) {
    reasons.push(c.securityType
      ? `Unsupported security type: ${c.securityType}.`
      : "Security type is unverified; production eligibility fails closed.");
  }
  const scannedAtMs = new Date(c.scannedAt).getTime();
  const ageMs = Date.now() - scannedAtMs;
  if (
    isActiveMarketSession() &&
    (!Number.isFinite(scannedAtMs) || ageMs < 0 || ageMs > ACTIVE_SESSION_MAX_SIGNAL_AGE_MS)
  ) {
    reasons.push("Signal is too old to rank during an active market session.");
  }
  if (strategy === "spot_momentum") {
    if (!c.retrievedForSm && !c.retrievedForCatalyst) reasons.push("Did not qualify for Spot Momentum retrieval.");
    if (c.change <= 0) reasons.push("Spot Momentum requires positive movement.");
    if (!isExtremeMomentum) {
      if (c.crowdScore >= 65) {
        reasons.push(`Crowd saturation (${Math.round(c.crowdScore)}) is already late for Spot Momentum.`);
      }
      if (c.trapScore >= 70) {
        reasons.push(`Trap risk (${Math.round(c.trapScore)}) exceeds the Spot Momentum ceiling.`);
      }
    }
  } else {
    if (!c.retrievedForBtc && !c.retrievedForCatalyst) reasons.push("Did not qualify for Before The Crowd retrieval.");
    if (c.crowdScore >= 60) reasons.push("Crowd saturation is too high for the Before The Crowd thesis.");
    if (c.trapScore >= 55) reasons.push("Trap risk exceeds the Before The Crowd ceiling.");
  }
  const eligible = reasons.length === 0;
  // A genuinely clean extreme-momentum candidate — every gate other than the
  // (now-bypassed-above) magnitude one passes. For most of these `eligible`
  // above is already true, since the bypass already dropped the R:R/downside
  // reasons from `reasons` directly. This flag stays independent of that
  // (not `!eligible`) so the trading bot's separate continuation-scoring
  // pool (see /api/trading-bot — it can't use modeled R:R here either, since
  // upsideMax is the same near-zero number) still gets populated even in the
  // rarer case something else on top still blocks full eligibility.
  const extremeMomentumEligible = strategy === "spot_momentum" && isExtremeMomentum && reasons.length === 0;
  const strength = signalStrength(c, strategy);
  const tradeQuality = tf.rrRatio === null ? 0 : Math.max(0, Math.min(100, Math.round(Math.min(1, tf.rrRatio / 3) * 55 + (tf.magnitudeQuality === "meaningful" ? 25 : 0) + Math.max(0, 100 - (tf.extensionRisk ?? 100)) * 0.2)));
  // No separate entryQuality term here — tradeQuality above already folds in
  // the same three inputs entryQuality itself is built from (rr-ratio,
  // magnitude, extensionRisk), so adding entryQuality on top double-counted
  // them rather than contributing independent information. Weight
  // redistributed proportionally between strength and tradeQuality.
  const qualityScore = Math.round(strength * 0.65 + tradeQuality * 0.35);
  const breakout = getBreakoutPotential({
    change: c.change, relativeVolume: c.relativeVolume, momentumScore: c.momentumScore,
    crowdScore: c.crowdScore, trapScore: c.trapScore, catalystScore: c.catalystScore,
  }, tf, strategy);
  // Spot Momentum is "catch it while it's happening." qualityScore and even
  // breakout.score still carry enough R:R/crowd/trap residue that a mild,
  // clean 6% mover with capped-out volume can out-arithmetic a genuine 27%+
  // mover on points alone — that happened in production (PETS beat AEHL).
  // Anchoring half the score directly to raw move size makes "the bigger
  // real move wins" a guarantee, not a coin flip of component weights.
  // Before The Crowd keeps quality-first: its whole thesis is entry timing
  // ahead of the crowd, not size of the move already made.
  const magnitudeCore = Math.max(0, Math.min(100, c.change * 3));
  const strategyScore = strategy === "spot_momentum"
    ? Math.round(magnitudeCore * 0.5 + breakout.score * 0.35 + qualityScore * 0.15)
    : Math.round(qualityScore * 0.65 + breakout.score * 0.35);
  const tier = eligible && strategyScore >= 80 && ((tf.entryQuality ?? 0) >= 70 || isConfirmedRunner) ? "hero"
    : eligible && strategyScore >= 68 ? "feature" : eligible ? "watch" : "scanner";
  const riskTags: string[] = [];
  if (c.change >= 50) riskTags.push("Parabolic Move");
  else if (isExtremeMomentum) riskTags.push("Extreme Momentum");
  if ((tf.extensionRisk ?? 0) >= 75) riskTags.push("Extended — Chasing Risk");
  if ((tf.volatility20d ?? 0) >= 8) riskTags.push("High Volatility");
  if (tf.barCount !== null && tf.barCount < SEASONED_BAR_COUNT) riskTags.push("New Listing / Limited History");
  const freshnessLabel = !Number.isFinite(ageMs) || ageMs > 8 * 60 * 60 * 1000
    ? "Last Verified Signal"
    : ageMs > 60 * 60 * 1000 ? "Recent Scan" : "Live Scan";
  const isBeforeCrowd = c.retrievedForBtc && c.crowdScore < 60 && c.trapScore < 55;
  const opportunityType = c.catalystScore >= 20
    ? "catalyst"
    : c.change >= 5 || c.momentumScore >= 60 || c.relativeVolume >= 3
      ? "breakout"
      : "momentum";
  return {
    ...c, strategy, signalStrength: strength, strategyScore, qualityScore,
    breakoutPotentialScore: breakout.score,
    breakoutPotentialLabel: breakout.label,
    breakoutPotentialComponents: breakout.components,
    floatDataStatus: breakout.floatDataStatus,
    displayedConfidence: eligible ? Math.min(99, strategyScore) : Math.min(49, Math.round(strength * 0.5)),
    tier, eligibility: { eligible, reasons }, tradeFramework: tf, engineVersion: ENGINE_VERSION,
    extremeMomentumEligible,
    opportunityScore: strategyScore,
    opportunityType,
    riskTags,
    attentionScore: c.crowdScore,
    riskScore: c.trapScore,
    confidence: eligible ? Math.min(99, strategyScore) : Math.min(49, Math.round(strength * 0.5)),
    relativeVolume: c.relativeVolume,
    isBeforeCrowd,
    catalystTags: c.catalystScore >= 20 ? [c.state || "Verified Catalyst"] : [],
    stage: c.signalState || c.state || "Developing",
    stageEmoji: c.catalystScore >= 20 ? "⚡" : c.relativeVolume >= 3 ? "🔥" : "👀",
    whyItMatters: c.catalystScore >= 20
      ? `${c.ticker} has a verified catalyst with ${c.relativeVolume.toFixed(1)}x pace-adjusted relative volume.`
      : `${c.ticker} is up ${c.change.toFixed(1)}% with ${c.relativeVolume.toFixed(1)}x pace-adjusted relative volume.`,
    signals: [
      `Up ${c.change.toFixed(1)}%`,
      `${c.relativeVolume.toFixed(1)}x relative volume`,
      ...(isBeforeCrowd ? ["Before crowd saturation"] : []),
    ],
    freshnessLabel,
  };
}

async function evaluateAll(supabase: ReturnType<typeof getSupabase>, candidates: Candidate[], strategy: Strategy) {
  const output: any[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(async (candidate) => evaluate(
      candidate,
      await getTradeFramework(supabase, candidate.ticker, candidate.price, candidate.change, isConfirmedContinuationRunner(candidate, strategy)),
      strategy,
    )));
    for (const result of settled) if (result.status === "fulfilled") output.push(result.value); else console.error("[opportunities] evaluation failed:", result.reason);
  }
  return output;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedType = (url.searchParams.get("type") ?? "all") as RequestType;
  const strategy: Strategy = requestedType === "before_crowd" ? "before_the_crowd" : "spot_momentum";
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 10;
  try {
    const supabase = getSupabase();
    const { data: run, error: runError } = await supabase.from("ht_scan_runs")
      .select("id,completed_at,candidate_counts,engine_version")
      .eq("run_type", "signal_writer_v3").eq("status", "success").eq("promoted", true)
      .order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (runError) throw runError;
    if (!run) return NextResponse.json({ opportunities: [], message: "No completed authoritative signal run is available yet.", strategy, engineVersion: ENGINE_VERSION });

    const { data: rows, error: rowError } = await supabase.from("ht_signal_run_rows").select("*").eq("scan_run_id", run.id);
    if (rowError) throw rowError;
    const candidates = (rows ?? []).map(mapRow).filter((c) => strategy === "spot_momentum" ? c.retrievedForSm || c.retrievedForCatalyst : c.retrievedForBtc || c.retrievedForCatalyst);
    const evaluated = await evaluateAll(supabase, candidates, strategy);
    const ranked = evaluated.sort((a, b) => Number(b.eligibility.eligible) - Number(a.eligibility.eligible) || b.strategyScore - a.strategyScore || b.signalStrength - a.signalStrength || b.relativeVolume - a.relativeVolume);
    let eligible = ranked.filter((c) => c.eligibility.eligible);
    if (requestedType === "catalyst") eligible = eligible.filter((c) => c.catalystScore >= 20);
    if (requestedType === "before_crowd") eligible = eligible.filter((c) => c.isBeforeCrowd);
    // Opt-in only, never affects the default response shape. Bounded sample
    // of rejected candidates and why, same pattern as shadow-retrieval's
    // exclusionSamples — for investigating gate behavior, not for the UI.
    const debug = url.searchParams.get("debug") === "1";
    // Also opt-in only, and additive — never merged into `opportunities`.
    // Full objects (not the trimmed rejectedSample shape) since a consumer
    // evaluating continuation potential needs pattern/momentumScore/crowdScore/
    // trapScore/tradeFramework, not just the headline numbers.
    const includeExtreme = url.searchParams.get("includeExtreme") === "1";
    return NextResponse.json({
      opportunities: eligible.slice(0, limit), strategy,
      sourceRun: { id: run.id, completedAt: run.completed_at, engineVersion: run.engine_version, candidateCounts: run.candidate_counts },
      diagnostics: { runRows: rows?.length ?? 0, strategyCandidates: candidates.length, evaluated: evaluated.length, eligible: eligible.length, rejected: evaluated.length - eligible.length },
      ...(debug ? {
        rejectedSample: ranked.filter((c) => !c.eligibility.eligible).slice(0, 30).map((c) => ({
          ticker: c.ticker, change: c.change, relativeVolume: c.relativeVolume,
          crowdScore: c.crowdScore, trapScore: c.trapScore, strategyScore: c.strategyScore,
          reasons: c.eligibility.reasons,
        })),
      } : {}),
      ...(includeExtreme ? {
        extremeCandidates: ranked.filter((c) => c.extremeMomentumEligible).sort((a, b) => b.change - a.change).slice(0, 10),
      } : {}),
      engineVersion: ENGINE_VERSION, timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Failed to produce opportunities.", opportunities: [], engineVersion: ENGINE_VERSION }, { status: 500 });
  }
}
