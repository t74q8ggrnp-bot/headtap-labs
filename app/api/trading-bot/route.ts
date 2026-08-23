// app/api/trading-bot/route.ts
//
// A separate execution system from Pro X and from the canonical HT Labs engine.
// Reads HT Labs' canonical Spot Momentum candidates as a read-only input
// (via /api/opportunities — no direct table access, no re-deriving
// eligibility). Records attached Pro X intelligence in shadow mode, but
// Pro X cannot change ranking, sizing, exits, or orders. The bot has its
// own independent ranking logic optimized for
// "safest probable trade," not "biggest headline mover" — those are
// deliberately different questions. Paper trading only, via Alpaca.
//
// Position management has two safety gates:
// 1. ALPACA_API_KEY / ALPACA_SECRET_KEY must be set (paper keys only —
//    see lib/trading-bot/alpaca.ts, which hardcodes the paper base URL).
// 2. TRADING_BOT_ENABLED must be the literal string "true". Absent or
//    anything else, the bot manages nothing and places no orders. This
//    is deliberate: adding the code and adding the keys should not, by
//    themselves, cause a single trade to happen.
// New entries have a third, independent gate:
// 3. TRADING_BOT_ENTRY_ENABLED must be the literal string "true". When it
//    is absent or false, existing paper positions are still managed and the
//    v3 candidate board is still recorded in shadow mode, but no buy occurs.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  alpacaConfigured,
  cancelOrder,
  getAccount,
  getOrder,
  getPositions,
  placeBuyNotional,
  placeBuyQty,
  placeSellQty,
  type AlpacaPosition,
} from "@/lib/trading-bot/alpaca";
import {
  CANONICAL_OPPORTUNITY_VERSION,
  type ExplosionAssessment,
} from "@/lib/canonical-opportunity";
import type { ProxIntelligencePacket } from "@/lib/prox/intelligence";
import {
  BOT_DECISION_VERSION,
  evaluateBotEntry,
  getBotEntryControlSkipReason,
  isBotCandidateReady,
  type BotEntryDecision,
  type BotEntryPath,
} from "@/lib/trading-bot/decision";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
// Bumped whenever entry/exit scoring logic changes, and stamped onto every
// trade and cycle row. Without this, trades from different formula eras
// blur together in bot_trades with no way to separate them once the logic
// changes again — this is the only thing that keeps "did the new formula
// actually help" answerable later.
const BOT_LOGIC_VERSION = "bot-v3-unified-observed-quality";
// Position size is a % of *current* account equity, not a flat dollar
// amount — stays proportional as the paper account grows/shrinks from
// testing, rather than becoming meaningless at a fixed number.
const POSITION_SIZE_PERCENT = 0.05;
// Six normal-size positions cap paper exposure at roughly 30% of account
// equity (continuation entries remain half-size). This is capacity only:
// every candidate still has to clear the existing canonical entry gates.
const MAX_CONCURRENT_POSITIONS = 6;
const MAX_HOLD_DAYS = 3;
// Hard floor under the canonical framework's own downsideRisk. That number
// comes from ATR/support-distance on daily bars and can come out under 1% —
// which on names volatile enough to swing double digits inside a minute
// means getting stopped out by ordinary noise before a real move even starts
// (confirmed happening live: MDT and LU both got stopped at <2% moves within
// the same hour they were bought). A tight downsideRisk also mechanically
// inflates R:R (it's upside ÷ downside), so without this floor the scoring
// was structurally biased toward picking the most fragile stops, not the
// safest trades. User's explicit ask: "four to five percent before it even
// looks like it might go down" — 5% chosen, the wider end of that range.
// Capacity is never a purchase target. New entries are intentionally paced so
// an unchanged board cannot make the bot walk down into weaker leftovers.
const MAX_NEW_POSITIONS_PER_ROLLING_24_HOURS = 3;
const MIN_MINUTES_BETWEEN_ENTRIES = 30;
const CANDIDATE_PERSISTENCE_LOOKBACK_MINUTES = 15;

// Trailing-stop exit, confirmed with the user against real math before
// building it. A single fixed take-profit computed once at entry sells a
// real winner the moment it clears a small target — this instead trails
// behind the peak price since entry, tightening only once a move is
// genuinely extended, so it locks in gains without capping the upside of
// a real run. The original stop-loss (from downsideRisk) stays active as
// an absolute floor the whole time regardless of trailing state.
const MIN_PROFIT_TO_TRAIL_PERCENT = 8; // below this, no trailing yet — just the hard stop
const WIDE_TRAIL_PERCENT = 15; // pullback from peak allowed while gain is 8-25%
const EXTENDED_GAIN_THRESHOLD_PERCENT = 25;
const TIGHT_TRAIL_PERCENT = 5; // pullback from peak allowed once gain exceeds 25% (user: "4-5%, lock in profits")
const TRAILING_BREAKEVEN_LOCK_PERCENT = 0.5;

// User's explicit, informed call on 2026-07-29 (both positions at a loss:
// ANY -6.2%, GLOB -1.6%): don't let the hard/trailing stop force a sale on
// these two specifically while under water — hold and hope for recovery
// instead. Deliberately scoped to just these trade IDs, not a global change
// to how the bot manages risk — every other/future trade still uses normal
// stops. max_hold_until is NOT paused — it's the one exit that was never
// part of this ask, so it still applies as the last backstop. Remove this
// once these two are closed or the user asks to resume normal stops.
const STOP_LOSS_PAUSED_TRADE_IDS = new Set([
  "a37c914c-4403-4418-8ba2-7584d3fa6eb0", // ANY
  "3800ea2c-0124-43a6-8f66-d1667f842f44", // GLOB
]);

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

// No hardcoded fallback secret here (unlike other routes in this codebase) —
// this route places real orders against the paper account, and the repo is
// public, so a guessable bypass string would let anyone force trades outside
// the cron schedule. Vercel auto-injects the real Authorization header on its
// own cron calls, so this alone is sufficient for the schedule to keep working.
function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${CRON_SECRET}`;
}

function isRegularMarketSession(now = new Date()) {
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
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    weekday === "Sat" ||
    weekday === "Sun"
  ) {
    return false;
  }
  const minutes = hour * 60 + minute;
  return minutes >= 570 && minutes < 960;
}

// Market orders on Alpaca's paper API usually fill within a second when
// placed during regular market hours — but a "day" order placed outside
// regular hours (no extended_hours flag is set anywhere in this file) simply
// never fills, full stop. Confirmed live: a sell submitted 5 minutes after
// the 4pm ET close never filled, yet the old code fell back to a snapshot
// price and declared it closed anyway — bot_trades said "sold, -5.35%" while
// the position sat fully open and unmonitored on Alpaca for hours afterward,
// because a row marked closed never gets checked again. Returning whether it
// actually filled (instead of silently substituting a fallback price and
// assuming success) lets the caller refuse to lie about order state.
//
// Confirmed live, the more serious version of this same problem: MSGY and
// 11 other tickers exist as real, currently-held Alpaca positions with zero
// row in bot_trades — the original buy orders filled in the gap between the
// last poll attempt and the subsequent cancelOrder call below, which either
// 404s (too late, already filled) or "succeeds" while the fill still posts
// moments later. The old code treated "poll gave up" as "never happened"
// and cancelOrder swallowed every outcome, so nothing ever caught the real
// fill. This now does one final getOrder check AFTER attempting the cancel,
// specifically to catch that race — only after that check still shows no
// fill does this return filled:false.
async function pollForFill(orderId: string): Promise<{ filled: true; price: number; qty: number | null } | { filled: false; price: null; qty: null }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const order = await getOrder(orderId);
      const filledPrice = Number(order?.filled_avg_price);
      if (order?.status === "filled" && Number.isFinite(filledPrice) && filledPrice > 0) {
        const filledQty = Number(order?.filled_qty);
        return { filled: true, price: filledPrice, qty: Number.isFinite(filledQty) && filledQty > 0 ? filledQty : null };
      }
    } catch (err) {
      console.error(`[trading-bot] order status poll failed for ${orderId}:`, err);
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await cancelOrder(orderId);
  // The order may have filled in the exact gap between the last poll above
  // and this cancel call — cancelOrder swallows that outcome entirely (see
  // its own comment), so this is the only remaining chance to catch it
  // before the caller assumes nothing happened and walks away.
  try {
    const finalCheck = await getOrder(orderId);
    const finalPrice = Number(finalCheck?.filled_avg_price);
    if (
      (finalCheck?.status === "filled" || finalCheck?.status === "partially_filled") &&
      Number.isFinite(finalPrice) &&
      finalPrice > 0
    ) {
      const finalQty = Number(finalCheck?.filled_qty);
      console.error(`[trading-bot] order ${orderId} filled in the poll/cancel race window — recording it instead of discarding it`);
      return { filled: true, price: finalPrice, qty: Number.isFinite(finalQty) && finalQty > 0 ? finalQty : null };
    }
  } catch (err) {
    console.error(`[trading-bot] final post-cancel order check failed for ${orderId}:`, err);
  }
  return { filled: false, price: null, qty: null };
}

// Some assets Alpaca lists reject notional (dollar-amount) orders outright —
// "asset X is not fractionable" — which previously meant the bot's top pick
// silently failed and it did nothing that whole cycle, every cycle, for as
// long as that ticker stayed the best-scored candidate (confirmed live:
// APUS failed this way on back-to-back 5-minute cycles). Falling back to a
// whole-share order preserves the actual pick instead of skipping it over a
// pure execution-mechanics technicality that has nothing to do with trade
// quality.
type PlacedOrder = { id?: string };

async function placeBuyOrder(
  ticker: string,
  notional: number,
  price: number,
): Promise<{ order: PlacedOrder; qty: number | null }> {
  try {
    return { order: await placeBuyNotional(ticker, notional), qty: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("not fractionable")) throw err;
    const qty = Math.max(1, Math.floor(notional / price));
    return { order: await placeBuyQty(ticker, qty), qty };
  }
}

type CanonicalOpportunity = {
  ticker: string;
  price: number;
  change: number;
  changeFromOpenPercent: number | null;
  relativeVolume: number;
  signalState: string;
  riskTags: string[];
  tradeFramework: {
    rrRatio: number | null;
    entryQuality: number | null;
    upsideMax: number | null;
    downsideRisk: number | null;
    extensionRisk: number | null;
    atr14: number | null;
  } | null;
  strategy: "spot_momentum" | "before_the_crowd";
  eligibility: { eligible: boolean; reasons: string[] };
  visibilityState: string;
  engineVersion: string;
  sourceRunId: string | null;
  explosionAssessment: ExplosionAssessment | null;
  strategyScore: number;
  opportunityScore: number;
  proxIntelligence: ProxIntelligencePacket | null;
  setupType?: "standard" | "session_reclaim";
};

async function recordProxShadowObservations(
  supabase: ReturnType<typeof getSupabase>,
  candidates: CanonicalOpportunity[],
  sourceRunId: string,
) {
  const unique = new Map<string, CanonicalOpportunity>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.ticker)) unique.set(candidate.ticker, candidate);
  }
  const rows = [...unique.values()]
    .filter((candidate) => candidate.proxIntelligence)
    .map((candidate) => {
      const prox = candidate.proxIntelligence as ProxIntelligencePacket;
      return {
        source_run_id: sourceRunId,
        canonical_engine_version: CANONICAL_OPPORTUNITY_VERSION,
        ticker: candidate.ticker,
        packet_snapshot_key: prox.snapshotKey,
        packet_version: prox.packetVersion,
        canonical_eligible: candidate.eligibility.eligible,
        canonical_strategy_score: candidate.strategyScore,
        canonical_opportunity_score: candidate.opportunityScore,
        prox_status: prox.status,
        prox_composite_score: prox.scores.composite,
        prox_would_veto: prox.botPolicy.wouldVeto,
        prox_would_reduce_size: prox.botPolicy.wouldReduceSize,
        prox_rank_adjustment: prox.botPolicy.rankAdjustment,
        // This remains false until a separately reviewed paper-only
        // promotion explicitly allows Pro X to influence execution.
        executed_influence: false,
        reasons: prox.botPolicy.reasons,
        observed_at: new Date().toISOString(),
      };
    });
  if (rows.length === 0) {
    return {
      observed: 0,
      wouldVeto: 0,
      wouldReduceSize: 0,
      unavailableReason: null as string | null,
    };
  }
  const { error } = await supabase
    .from("prox_bot_shadow_observations")
    .upsert(rows, {
      onConflict: "source_run_id,ticker,packet_snapshot_key",
      ignoreDuplicates: true,
    });
  return {
    observed: rows.length,
    wouldVeto: rows.filter((row) => row.prox_would_veto).length,
    wouldReduceSize: rows.filter((row) => row.prox_would_reduce_size).length,
    unavailableReason: error?.message ?? null,
  };
}

// Deliberately NOT derived from req.url's origin. Vercel Cron invokes this
// route on a per-deployment *.vercel.app URL, which sits behind Vercel's
// Deployment Protection (SSO wall) — an internal fetch built from that origin
// gets redirected to a login page instead of real data, throws parsing invalid
// JSON, and 500s the whole cycle before a single candidate is ever evaluated.
// The custom domain isn't behind that wall, so it's hardcoded here instead.
const SITE_ORIGIN = "https://gethtlabs.com";

async function fetchTopCandidates(): Promise<{
  standard: CanonicalOpportunity[];
  continuation: CanonicalOpportunity[];
  priceDiscoveryFallback: CanonicalOpportunity[];
  sourceRunId: string;
}> {
  const res = await fetch(
    `${SITE_ORIGIN}/api/opportunities?type=momentum&limit=100&includeContinuation=1`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch canonical opportunities: ${res.status}`);
  const data: unknown = await res.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Canonical opportunity feed returned an invalid payload.");
  }
  const payload = data as Record<string, unknown>;
  if (payload.engineVersion !== CANONICAL_OPPORTUNITY_VERSION) {
    throw new Error(
      `Canonical opportunity version mismatch (${String(payload.engineVersion ?? "missing")}).`,
    );
  }
  const sourceRun =
    payload.sourceRun &&
    typeof payload.sourceRun === "object" &&
    !Array.isArray(payload.sourceRun)
      ? (payload.sourceRun as Record<string, unknown>)
      : null;
  const sourceRunId = String(sourceRun?.id ?? "");
  if (!sourceRunId) {
    throw new Error("Canonical opportunity feed did not identify its source run.");
  }
  const isCanonicalDecision = (
    candidate: unknown,
  ): candidate is CanonicalOpportunity => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const decision = candidate as Record<string, unknown>;
    const eligibility =
      decision.eligibility &&
      typeof decision.eligibility === "object" &&
      !Array.isArray(decision.eligibility)
        ? (decision.eligibility as Record<string, unknown>)
        : null;
    return Boolean(
      eligibility?.eligible === true &&
        decision.strategy === "spot_momentum" &&
        decision.engineVersion === CANONICAL_OPPORTUNITY_VERSION &&
        decision.sourceRunId === sourceRunId &&
        decision.setupType !== "session_reclaim" &&
        Array.isArray(decision.riskTags) &&
        decision.tradeFramework,
    );
  };
  // Same checks as isCanonicalDecision, but gated on visibilityState instead
  // of strict eligibility.eligible — which is structurally always false for
  // a verified price-discovery candidate. Bot v3 still evaluates it through
  // the same unified decision contract as every other entry path.
  // This is the only path these candidates can reach the bot through at
  // all; isCanonicalDecision above excludes them from `standard` by design.
  const isVerifiedPriceDiscoveryDecision = (
    candidate: unknown,
  ): candidate is CanonicalOpportunity => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const decision = candidate as Record<string, unknown>;
    return Boolean(
      decision.visibilityState === "verified_price_discovery" &&
        decision.strategy === "spot_momentum" &&
        decision.engineVersion === CANONICAL_OPPORTUNITY_VERSION &&
        decision.sourceRunId === sourceRunId &&
        decision.setupType !== "session_reclaim" &&
        Array.isArray(decision.riskTags) &&
        decision.tradeFramework,
    );
  };
  const opportunities = Array.isArray(payload.opportunities)
    ? payload.opportunities
    : [];
  const continuationCandidates = Array.isArray(payload.continuationCandidates)
    ? payload.continuationCandidates
    : [];
  return {
    standard: opportunities.filter(isCanonicalDecision),
    continuation: continuationCandidates.filter(isCanonicalDecision),
    priceDiscoveryFallback: opportunities.filter(isVerifiedPriceDiscoveryDecision),
    sourceRunId,
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const enabled = process.env.TRADING_BOT_ENABLED === "true";
  // Management and entry authority are deliberately separate. Missing or
  // false entry authorization still allows the bot to manage paper positions.
  const entriesEnabled = process.env.TRADING_BOT_ENTRY_ENABLED === "true";
  const diagnostics = {
    enabled,
    entriesEnabled,
    alpacaConfigured: alpacaConfigured(),
    paperOnly: true,
    botLogicVersion: BOT_LOGIC_VERSION,
    botDecisionVersion: BOT_DECISION_VERSION,
    canonicalFeedVersion: CANONICAL_OPPORTUNITY_VERSION,
    sourceRunId: null as string | null,
    entryWindowOpen: isRegularMarketSession(),
    entriesDeferredOutsideRegularSession: 0,
    positionsChecked: 0,
    closed: 0,
    candidatesConsidered: 0,
    candidatesQualified: 0,
    candidatesAwaitingPersistence: 0,
    opened: 0,
    unfilled: 0,
    errors: 0,
    proxShadowPacketsObserved: 0,
    proxShadowWouldVeto: 0,
    proxShadowWouldReduceSize: 0,
    proxShadowWriteUnavailable: null as string | null,
    proxExecutionAuthority: false,
    alpacaPositionCount: 0,
    orphanedAlpacaPositionCount: 0,
    newPositionsLast24Hours: 0,
    entryCooldownMinutesRemaining: 0,
  };

  if (!enabled || !alpacaConfigured()) {
    return NextResponse.json({
      success: true,
      message: !alpacaConfigured()
        ? "ALPACA_API_KEY / ALPACA_SECRET_KEY not set — bot manages nothing."
        : "TRADING_BOT_ENABLED is not \"true\" — bot manages nothing.",
      diagnostics,
    });
  }

  const supabase = getSupabase();

  // Cycle logging must never block management of real paper positions. New
  // entries are stricter: they fail closed when this decision receipt cannot
  // be created, because an untraceable purchase is not acceptable. A row per
  // cycle (bought something or not, and why) keeps "correctly found nothing"
  // distinguishable from "quietly broke."
  let cycleId: string | null = null;
  try {
    const { data: cycleRow, error: cycleInsertError } = await supabase
      .from("bot_cycles")
      .insert({
        bot_logic_version: BOT_LOGIC_VERSION,
        entry_window_open: diagnostics.entryWindowOpen,
        entries_enabled: entriesEnabled,
      })
      .select("id")
      .single();
    if (cycleInsertError) throw cycleInsertError;
    cycleId = cycleRow?.id ?? null;
  } catch (err) {
    console.error("[trading-bot] cycle logging insert failed (non-blocking):", err);
  }

  async function finalizeCycle(fields: {
    sourceRunId?: string | null;
    openPositionsCount?: number | null;
    candidatesConsidered?: number;
    pickedTicker?: string | null;
    pickedIsContinuation?: boolean | null;
    entryOpened?: boolean;
    skipReason?: string | null;
    error?: string | null;
  }) {
    if (!cycleId) return;
    try {
      const update = {
        completed_at: new Date().toISOString(),
        ...(fields.sourceRunId !== undefined
          ? { source_run_id: fields.sourceRunId }
          : {}),
        ...(fields.openPositionsCount !== undefined
          ? { open_positions_count: fields.openPositionsCount }
          : {}),
        ...(fields.candidatesConsidered !== undefined
          ? { candidates_considered: fields.candidatesConsidered }
          : {}),
        ...(fields.pickedTicker !== undefined
          ? { picked_ticker: fields.pickedTicker }
          : {}),
        ...(fields.pickedIsContinuation !== undefined
          ? { picked_is_continuation: fields.pickedIsContinuation }
          : {}),
        ...(fields.entryOpened !== undefined
          ? { entry_opened: fields.entryOpened }
          : {}),
        ...(fields.skipReason !== undefined
          ? { skip_reason: fields.skipReason }
          : {}),
        ...(fields.error !== undefined ? { error: fields.error } : {}),
      };
      await supabase
        .from("bot_cycles")
        .update(update)
        .eq("id", cycleId);
    } catch (err) {
      console.error("[trading-bot] cycle logging update failed (non-blocking):", err);
    }
  }

  async function logCycleCandidates(
    candidates: {
      candidate: CanonicalOpportunity;
      path: BotEntryPath;
      decision: BotEntryDecision;
      picked: boolean;
    }[],
  ) {
    if (!cycleId) return false;
    // An empty authoritative board is a valid audited result. There are no
    // candidate receipts to write, but the cycle itself records zero
    // considered and the no-qualified-candidate skip reason.
    if (candidates.length === 0) return true;
    try {
      const { error } = await supabase.from("bot_cycle_candidates").insert(
        candidates.map((c) => ({
          cycle_id: cycleId,
          ticker: c.candidate.ticker,
          is_continuation: c.path !== "standard",
          score: c.decision.score,
          entry_quality: c.candidate.tradeFramework?.entryQuality ?? null,
          rr_ratio: c.decision.effectiveRr,
          downside_percent: c.decision.effectiveDownsidePercent,
          picked: c.picked,
          decision_version: c.decision.version,
          entry_path: c.path,
          entry_qualified: c.decision.qualified,
          fast_entry_eligible: c.decision.fastEntryEligible,
          rejection_reasons: c.decision.hardFailures,
          component_scores: c.decision.components,
          effective_rr_ratio: c.decision.effectiveRr,
          effective_downside_percent:
            c.decision.effectiveDownsidePercent,
          continuation_capacity_percent:
            c.decision.continuationCapacityPercent,
          opportunity_score: c.candidate.opportunityScore,
          relative_volume: c.candidate.relativeVolume,
          change_from_open_percent: c.candidate.changeFromOpenPercent,
          signal_state: c.candidate.signalState,
        })),
      );
      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[trading-bot] cycle candidate logging failed:", err);
      return false;
    }
  }

  try {
    // ── 0. Backfill post-exit price checks for recently closed trades ──
    // Answers "did the exit hold up" — not knowable at exit time, so this
    // catches up once enough time has passed. Best-effort: a failure here
    // must never block position management or new entries below.
    try {
      const backfillWindowStart = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const backfillWindowEnd = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
      const { data: dueForCheck } = await supabase
        .from("bot_trades")
        .select("id, ticker, exit_price")
        .eq("status", "closed")
        .is("post_exit_checked_at", null)
        .not("exit_price", "is", null)
        .gte("exit_at", backfillWindowStart)
        .lte("exit_at", backfillWindowEnd)
        .limit(20);
      for (const trade of dueForCheck ?? []) {
        try {
          const res = await fetch(`${SITE_ORIGIN}/api/quote?symbol=${encodeURIComponent(trade.ticker)}`, { cache: "no-store" });
          if (!res.ok) continue;
          const quote = await res.json();
          const postExitPrice = Number(quote?.c);
          if (!Number.isFinite(postExitPrice) || postExitPrice <= 0) continue;
          const exitPrice = Number(trade.exit_price);
          const postExitChangePercent = exitPrice > 0 ? ((postExitPrice - exitPrice) / exitPrice) * 100 : null;
          await supabase
            .from("bot_trades")
            .update({
              post_exit_price: postExitPrice,
              post_exit_change_percent: postExitChangePercent,
              post_exit_checked_at: new Date().toISOString(),
            })
            .eq("id", trade.id);
        } catch (err) {
          console.error(`[trading-bot] post-exit check failed for ${trade.ticker} (non-blocking):`, err);
        }
      }
    } catch (err) {
      console.error("[trading-bot] post-exit backfill query failed (non-blocking):", err);
    }

    // ── 1. Manage open positions — exits first, before considering new entries ──
    const { data: openTrades, error: openTradesError } = await supabase
      .from("bot_trades")
      .select("*")
      .eq("status", "open");
    if (openTradesError) throw openTradesError;

    // Alpaca is the position source of truth. Read it every cycle even when
    // the database claims zero open trades so an orphaned/manual position can
    // block duplicate buying instead of remaining invisible to entry logic.
    const alpacaPositions: AlpacaPosition[] = await getPositions();
    diagnostics.alpacaPositionCount = alpacaPositions.length;
    const trackedOpenTickers = new Set(
      (openTrades ?? []).map((trade) => trade.ticker),
    );
    const orphanedAlpacaPositions = alpacaPositions.filter(
      (position) => !trackedOpenTickers.has(position.symbol),
    );
    diagnostics.orphanedAlpacaPositionCount = orphanedAlpacaPositions.length;
    const positionBySymbol = new Map(alpacaPositions.map((p) => [p.symbol, p]));

    for (const trade of openTrades ?? []) {
      diagnostics.positionsChecked++;
      const position = positionBySymbol.get(trade.ticker);
      const now = new Date();
      const pastMaxHold = trade.max_hold_until ? now >= new Date(trade.max_hold_until) : false;

      if (!position) {
        // Alpaca shows nothing held — either already closed some other way,
        // or the entry order never actually filled. Mark it so it stops
        // being tracked as open rather than checking it forever.
        await supabase
          .from("bot_trades")
          .update({ status: "closed", exit_reason: "no_position_found", updated_at: now.toISOString() })
          .eq("id", trade.id);
        diagnostics.closed++;
        continue;
      }

      const currentPrice = Number(position.current_price);
      const entryPrice = Number(trade.entry_price);
      const priorHighWaterMark = Number(trade.high_water_mark ?? entryPrice);
      const highWaterMark = Math.max(priorHighWaterMark, currentPrice);
      if (highWaterMark > priorHighWaterMark) {
        await supabase
          .from("bot_trades")
          .update({ high_water_mark: highWaterMark, updated_at: now.toISOString() })
          .eq("id", trade.id);
      }

      const stopPaused = STOP_LOSS_PAUSED_TRADE_IDS.has(trade.id);
      const gainFromEntry = entryPrice > 0 ? ((highWaterMark - entryPrice) / entryPrice) * 100 : 0;
      const hitHardStop = !stopPaused && trade.stop_price !== null && currentPrice <= trade.stop_price;

      let hitTrailingStop = false;
      if (!stopPaused && gainFromEntry >= MIN_PROFIT_TO_TRAIL_PERCENT) {
        const trailPercent = gainFromEntry >= EXTENDED_GAIN_THRESHOLD_PERCENT ? TIGHT_TRAIL_PERCENT : WIDE_TRAIL_PERCENT;
        // Once trailing protection activates, its intended trigger cannot sit
        // below breakeven. Execution can still slip on a fast market order,
        // but the decision itself no longer willingly turns a winner into a
        // full hard-stop loss.
        const trailingStopPrice = Math.max(
          highWaterMark * (1 - trailPercent / 100),
          entryPrice * (1 + TRAILING_BREAKEVEN_LOCK_PERCENT / 100),
        );
        if (currentPrice <= trailingStopPrice) hitTrailingStop = true;
      }

      if (hitHardStop || hitTrailingStop || pastMaxHold) {
        try {
          const order = await placeSellQty(trade.ticker, position.qty);
          const fillResult = order?.id
            ? await pollForFill(order.id)
            : ({ filled: false, price: null, qty: null } as const);

          if (!fillResult.filled) {
            // Do NOT mark this closed — it isn't. Likely cause: the order
            // was placed outside regular hours (no extended_hours flag set)
            // and simply won't fill until the next session. Leaving status
            // "open" means the next cycle re-checks it and retries the exit,
            // instead of the database claiming a sale that never happened
            // while the real position sits unmanaged. (pollForFill already
            // attempted cancelOrder and did a final post-cancel check itself
            // — reaching here means that already confirmed no fill happened.)
            diagnostics.unfilled++;
            console.error(`[trading-bot] sell for ${trade.ticker} did not fill (order ${order?.id ?? "none"}) — left open for retry`);
            continue;
          }

          const exitPrice = fillResult.price;
          const exitReason = hitTrailingStop ? "trailing_stop" : hitHardStop ? "stop" : "time_limit";
          const pnl = (exitPrice - entryPrice) * Number(position.qty);
          const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : null;
          await supabase
            .from("bot_trades")
            .update({
              status: "closed",
              exit_order_id: order?.id ?? null,
              exit_price: exitPrice,
              exit_at: now.toISOString(),
              exit_reason: exitReason,
              pnl,
              pnl_percent: pnlPercent,
              updated_at: now.toISOString(),
            })
            .eq("id", trade.id);
          diagnostics.closed++;
        } catch (err) {
          diagnostics.errors++;
          console.error(`[trading-bot] sell order failed for ${trade.ticker}:`, err);
        }
      }
    }

    // ── 2. Consider a new entry, only after every independent safety gate ──
    const { count: openCount, error: openCountError } = await supabase
      .from("bot_trades")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    if (openCountError) throw openCountError;
    const effectiveOpenCount = Math.max(
      openCount ?? 0,
      alpacaPositions.length,
    );

    const rollingEntryStart = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const { count: recentEntryCount, error: recentEntryCountError } =
      await supabase
        .from("bot_trades")
        .select("id", { count: "exact", head: true })
        .not("entry_order_id", "is", null)
        .gte("entry_at", rollingEntryStart);
    if (recentEntryCountError) throw recentEntryCountError;
    diagnostics.newPositionsLast24Hours = recentEntryCount ?? 0;

    const { data: latestEntry, error: latestEntryError } = await supabase
      .from("bot_trades")
      .select("entry_at")
      .not("entry_order_id", "is", null)
      .order("entry_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestEntryError) throw latestEntryError;
    const minutesSinceLatestEntry = latestEntry?.entry_at
      ? (Date.now() - new Date(latestEntry.entry_at).getTime()) / 60_000
      : Number.POSITIVE_INFINITY;
    diagnostics.entryCooldownMinutesRemaining = Number.isFinite(
      minutesSinceLatestEntry,
    )
      ? Math.max(
          0,
          Math.ceil(MIN_MINUTES_BETWEEN_ENTRIES - minutesSinceLatestEntry),
        )
      : 0;

    const entrySkipReason = getBotEntryControlSkipReason({
      entriesEnabled,
      entryWindowOpen: diagnostics.entryWindowOpen,
      decisionAuditAvailable: cycleId !== null,
      orphanedAlpacaPositionCount: orphanedAlpacaPositions.length,
      openPositionCount: effectiveOpenCount,
      maxConcurrentPositions: MAX_CONCURRENT_POSITIONS,
      recentEntryCount: recentEntryCount ?? 0,
      maxRecentEntries: MAX_NEW_POSITIONS_PER_ROLLING_24_HOURS,
      minutesSinceLatestEntry,
      minimumMinutesBetweenEntries: MIN_MINUTES_BETWEEN_ENTRIES,
    });
    if (!diagnostics.entryWindowOpen) {
      diagnostics.entriesDeferredOutsideRegularSession++;
    }

    const candidateEvaluationAvailable =
      diagnostics.entryWindowOpen && cycleId !== null;

    if (!candidateEvaluationAvailable) {
      await finalizeCycle({
        openPositionsCount: effectiveOpenCount,
        entryOpened: false,
        skipReason: entrySkipReason ?? "candidate_evaluation_unavailable",
      });
    } else {
      const {
        standard,
        continuation,
        priceDiscoveryFallback,
        sourceRunId,
      } = await fetchTopCandidates();
      diagnostics.sourceRunId = sourceRunId;

      const candidatesByTicker = new Map<
        string,
        { candidate: CanonicalOpportunity; path: BotEntryPath }
      >();
      for (const candidate of standard) {
        candidatesByTicker.set(candidate.ticker, {
          candidate,
          path: "standard",
        });
      }
      for (const candidate of continuation) {
        candidatesByTicker.set(candidate.ticker, {
          candidate,
          path: "continuation",
        });
      }
      for (const candidate of priceDiscoveryFallback) {
        candidatesByTicker.set(candidate.ticker, {
          candidate,
          path: "price_discovery",
        });
      }
      const candidateRecords = [...candidatesByTicker.values()];
      diagnostics.candidatesConsidered = candidateRecords.length;

      // Independent ProX remains observation-only. Its opinion is stored for
      // later outcome comparison and cannot alter the decisions below.
      const shadow = await recordProxShadowObservations(
        supabase,
        candidateRecords.map((record) => record.candidate),
        sourceRunId,
      );
      diagnostics.proxShadowPacketsObserved = shadow.observed;
      diagnostics.proxShadowWouldVeto = shadow.wouldVeto;
      diagnostics.proxShadowWouldReduceSize = shadow.wouldReduceSize;
      diagnostics.proxShadowWriteUnavailable = shadow.unavailableReason;

      const heldTickers = new Set([
        ...(openTrades ?? []).map((trade) => trade.ticker),
        ...alpacaPositions.map((position) => position.symbol),
      ]);
      const evaluated = candidateRecords.map(({ candidate, path }) => ({
        candidate,
        path,
        decision: evaluateBotEntry(candidate, path),
      }));
      const qualified = evaluated.filter(
        (record) =>
          record.decision.qualified &&
          record.decision.score !== null &&
          !heldTickers.has(record.candidate.ticker),
      );
      diagnostics.candidatesQualified = qualified.length;

      const persistenceSince = new Date(
        Date.now() - CANDIDATE_PERSISTENCE_LOOKBACK_MINUTES * 60_000,
      ).toISOString();
      const { data: recentCycles, error: recentCyclesError } = await supabase
        .from("bot_cycles")
        .select("id")
        .eq("bot_logic_version", BOT_LOGIC_VERSION)
        .gte("started_at", persistenceSince)
        .neq("id", cycleId);
      if (recentCyclesError) throw recentCyclesError;
      const recentCycleIds = (recentCycles ?? []).map((cycle) => cycle.id);
      let persistedTickers = new Set<string>();
      if (recentCycleIds.length > 0) {
        const { data: persistedRows, error: persistedRowsError } =
          await supabase
            .from("bot_cycle_candidates")
            .select("ticker")
            .eq("decision_version", BOT_DECISION_VERSION)
            .eq("entry_qualified", true)
            .in("cycle_id", recentCycleIds);
        if (persistedRowsError) throw persistedRowsError;
        persistedTickers = new Set(
          (persistedRows ?? []).map((row) => row.ticker),
        );
      }

      const ready = qualified.filter(
        (record) =>
          isBotCandidateReady(
            record.decision,
            persistedTickers.has(record.candidate.ticker),
          ),
      );
      diagnostics.candidatesAwaitingPersistence =
        qualified.length - ready.length;
      ready.sort(
        (a, b) => (b.decision.score ?? 0) - (a.decision.score ?? 0),
      );
      const best = ready[0] ?? null;

      const candidateAuditWritten = await logCycleCandidates(
        evaluated.map((record) => ({
          ...record,
          picked:
            entrySkipReason === null &&
            best !== null &&
            record.candidate.ticker === best.candidate.ticker &&
            record.path === best.path,
        })),
      );

      if (!candidateAuditWritten) {
        await finalizeCycle({
          sourceRunId,
          openPositionsCount: effectiveOpenCount,
          candidatesConsidered: diagnostics.candidatesConsidered,
          entryOpened: false,
          skipReason: "candidate_audit_write_failed",
        });
      } else if (entrySkipReason) {
        // Entry-disabled, cooldown, capacity, and reconciliation states are
        // execution gates only. The full decision board above is still
        // evaluated and persisted so the paper bot can run safely in shadow
        // mode without losing the evidence needed to validate this version.
        await finalizeCycle({
          sourceRunId,
          openPositionsCount: effectiveOpenCount,
          candidatesConsidered: diagnostics.candidatesConsidered,
          entryOpened: false,
          skipReason: entrySkipReason,
        });
      } else if (!best) {
        await finalizeCycle({
          sourceRunId,
          openPositionsCount: effectiveOpenCount,
          candidatesConsidered: diagnostics.candidatesConsidered,
          entryOpened: false,
          skipReason:
            qualified.length > 0
              ? "awaiting_candidate_persistence"
              : "no_entry_qualified_candidate",
        });
      } else {
        const { candidate, decision, path } = best;
        const score = decision.score;
        const isContinuation = path !== "standard";
        const tradeFramework = candidate.tradeFramework;
        if (
          score === null ||
          !tradeFramework ||
          decision.effectiveDownsidePercent === null
        ) {
          throw new Error(
            `Bot v3 decision for ${candidate.ticker} lost required entry evidence.`,
          );
        }
        try {
          const account = await getAccount();
          if (
            (account?.status && account.status !== "ACTIVE") ||
            account?.account_blocked ||
            account?.trading_blocked
          ) {
            throw new Error("Alpaca paper account is not active for trading.");
          }
          const equity = Number(account?.equity ?? account?.cash ?? 0);
          const sizePercent = isContinuation
            ? POSITION_SIZE_PERCENT / 2
            : POSITION_SIZE_PERCENT;
          const positionNotional =
            Math.round(equity * sizePercent * 100) / 100;
          if (!Number.isFinite(positionNotional) || positionNotional <= 0) {
            throw new Error(
              `Could not determine a valid position size from account equity (${equity}).`,
            );
          }

          const { order, qty } = await placeBuyOrder(
            candidate.ticker,
            positionNotional,
            candidate.price,
          );
          const fillResult = order?.id
            ? await pollForFill(order.id)
            : ({ filled: false, price: null, qty: null } as const);

          if (!fillResult.filled) {
            diagnostics.unfilled++;
            console.error(
              `[trading-bot] buy for ${candidate.ticker} did not fill (order ${order?.id ?? "none"}) — skipped`,
            );
            await finalizeCycle({
              sourceRunId,
              openPositionsCount: effectiveOpenCount,
              candidatesConsidered: diagnostics.candidatesConsidered,
              pickedTicker: candidate.ticker,
              pickedIsContinuation: isContinuation,
              entryOpened: false,
              skipReason: "buy_unfilled",
            });
            return NextResponse.json({
              success: true,
              diagnostics,
              timestamp: new Date().toISOString(),
            });
          }

          const entryPrice = fillResult.price;
          const now = new Date();
          const stopDownside = decision.effectiveDownsidePercent;
          const baseTradeRow = {
            ticker: candidate.ticker,
            status: "open",
            entry_order_id: order?.id ?? null,
            entry_price: entryPrice,
            entry_at: now.toISOString(),
            position_notional: (() => {
              const actualQty = fillResult.qty ?? qty;
              return actualQty !== null
                ? Math.round(actualQty * entryPrice * 100) / 100
                : positionNotional;
            })(),
            target_price:
              tradeFramework.upsideMax !== null
                ? entryPrice * (1 + tradeFramework.upsideMax / 100)
                : null,
            stop_price: entryPrice * (1 - stopDownside / 100),
            high_water_mark: entryPrice,
            max_hold_until: new Date(
              now.getTime() + MAX_HOLD_DAYS * 24 * 60 * 60 * 1000,
            ).toISOString(),
            bot_score: score,
            entry_snapshot: {
              ...candidate,
              isContinuationEntry: isContinuation,
              botEntryPath: path,
              botDecision: decision,
            },
          };
          // A filled paper order must always be tracked, even if optional
          // analytics columns are temporarily unavailable.
          const { error: insertError } = await supabase
            .from("bot_trades")
            .insert({
              ...baseTradeRow,
              bot_logic_version: BOT_LOGIC_VERSION,
              source_run_id: sourceRunId,
            });
          if (insertError) {
            console.error(
              "[trading-bot] insert with analytics columns failed, retrying without them:",
              insertError.message,
            );
            const { error: fallbackInsertError } = await supabase
              .from("bot_trades")
              .insert(baseTradeRow);
            if (fallbackInsertError) throw fallbackInsertError;
          }
          diagnostics.opened++;
          await finalizeCycle({
            sourceRunId,
            openPositionsCount: effectiveOpenCount,
            candidatesConsidered: diagnostics.candidatesConsidered,
            pickedTicker: candidate.ticker,
            pickedIsContinuation: isContinuation,
            entryOpened: true,
          });
        } catch (err) {
          diagnostics.errors++;
          console.error(
            `[trading-bot] buy order failed for ${candidate.ticker}:`,
            err,
          );
          await finalizeCycle({
            sourceRunId,
            openPositionsCount: effectiveOpenCount,
            candidatesConsidered: diagnostics.candidatesConsidered,
            pickedTicker: candidate.ticker,
            pickedIsContinuation: isContinuation,
            entryOpened: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: unknown) {
    diagnostics.errors++;
    const message = error instanceof Error ? error.message : "Trading bot failed";
    await finalizeCycle({ error: message });
    return NextResponse.json(
      {
        error: message,
        diagnostics,
      },
      { status: 500 },
    );
  }
}
