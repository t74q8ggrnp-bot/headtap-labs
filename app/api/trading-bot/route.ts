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
// Two safety gates, both required before this does anything:
// 1. ALPACA_API_KEY / ALPACA_SECRET_KEY must be set (paper keys only —
//    see lib/trading-bot/alpaca.ts, which hardcodes the paper base URL).
// 2. TRADING_BOT_ENABLED must be the literal string "true". Absent or
//    anything else, the bot manages nothing and places no orders. This
//    is deliberate: adding the code and adding the keys should not, by
//    themselves, cause a single trade to happen.

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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
// Position size is a % of *current* account equity, not a flat dollar
// amount — stays proportional as the paper account grows/shrinks from
// testing, rather than becoming meaningless at a fixed number.
const POSITION_SIZE_PERCENT = 0.05;
// Six normal-size positions cap paper exposure at roughly 30% of account
// equity (continuation entries remain half-size). This is capacity only:
// every candidate still has to clear the existing canonical entry gates.
const MAX_CONCURRENT_POSITIONS = 6;
const MIN_RR_RATIO = 1.5;
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
const MIN_STOP_LOSS_PERCENT = 5;

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
async function pollForFill(orderId: string): Promise<{ filled: true; price: number } | { filled: false; price: null }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const order = await getOrder(orderId);
      const filledPrice = Number(order?.filled_avg_price);
      if (order?.status === "filled" && Number.isFinite(filledPrice) && filledPrice > 0) {
        return { filled: true, price: filledPrice };
      }
    } catch (err) {
      console.error(`[trading-bot] order status poll failed for ${orderId}:`, err);
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { filled: false, price: null };
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
  riskTags: string[];
  tradeFramework: { rrRatio: number | null; entryQuality: number | null; upsideMax: number | null; downsideRisk: number | null } | null;
  strategy: "spot_momentum" | "before_the_crowd";
  eligibility: { eligible: boolean; reasons: string[] };
  engineVersion: string;
  sourceRunId: string | null;
  explosionAssessment: ExplosionAssessment;
  strategyScore: number;
  opportunityScore: number;
  proxIntelligence: ProxIntelligencePacket | null;
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

// Effective downside is never tighter than MIN_STOP_LOSS_PERCENT, regardless
// of what the framework's own downsideRisk says — this is the actual distance
// the bot will place its stop at (see entry construction below), so R:R and
// the eligibility floor both need to be judged against that real number, not
// the framework's optimistic tight-stop figure. Using tf.rrRatio directly
// here previously meant a stock with a razor-thin theoretical stop scored
// artificially high (tiny downside inflates upside÷downside), which is
// exactly backwards — it rewarded the most fragile setups, not the safest.
function effectiveDownsidePercent(tf: NonNullable<CanonicalOpportunity["tradeFramework"]>): number | null {
  if (tf.downsideRisk === null) return null;
  return Math.max(tf.downsideRisk, MIN_STOP_LOSS_PERCENT);
}

// Deliberately the opposite emphasis from the canonical hero's display
// ranking. HT Labs' own opportunityScore now favors raw magnitude — the
// right call for "what should the headline show." It's the wrong call
// for "what should I risk paper money on right now": the biggest mover
// is usually the most extended one. This rewards a clean R:R and
// entryQuality (which already penalizes over-extension) and actively
// docks points per risk tag, with a hard floor that disqualifies
// anything below a 1.5 R:R outright rather than just scoring it lower.
// "Extended — Chasing Risk" is set (see opportunities/route.ts) at the exact
// same extensionRisk>=75 threshold that already costs a candidate 50 points
// inside entryQuality itself — docking it again here penalized the same
// signal twice. Every other tag (Parabolic Move, Extreme Momentum, High
// Volatility, New Listing) reflects something entryQuality does NOT already
// account for, so those still count normally.
const DOUBLE_COUNTED_TAGS_IN_ENTRY_QUALITY = new Set(["Extended — Chasing Risk"]);

function computeBotScore(candidate: CanonicalOpportunity): number | null {
  const tf = candidate.tradeFramework;
  if (!tf || tf.upsideMax === null) return null;
  const downside = effectiveDownsidePercent(tf);
  const rr = downside && downside > 0 ? tf.upsideMax / downside : null;
  if (rr === null || rr < MIN_RR_RATIO) return null;
  const entryQuality = tf.entryQuality ?? 0;
  const rrBonus = Math.min(30, rr * 10);
  const riskTagPenalty = candidate.riskTags.filter((tag) => !DOUBLE_COUNTED_TAGS_IN_ENTRY_QUALITY.has(tag)).length * 10;
  return entryQuality + rrBonus - riskTagPenalty;
}

function computeContinuationScore(candidate: CanonicalOpportunity): number | null {
  const assessment = candidate.explosionAssessment;
  if (
    !candidate.tradeFramework ||
    !candidate.eligibility.eligible ||
    !assessment?.continuationConfirmed ||
    !assessment.paperEntryEligible
  ) {
    return null;
  }
  return assessment.paperTradeScore;
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
  sourceRunId: string;
}> {
  const res = await fetch(
    `${SITE_ORIGIN}/api/opportunities?type=momentum&limit=10&includeContinuation=1`,
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
    continuation: continuationCandidates
      .filter(isCanonicalDecision)
      .filter(
        (candidate) =>
          candidate.explosionAssessment?.paperEntryEligible === true,
      ),
    sourceRunId,
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const enabled = process.env.TRADING_BOT_ENABLED === "true";
  const diagnostics = {
    enabled,
    alpacaConfigured: alpacaConfigured(),
    paperOnly: true,
    canonicalFeedVersion: CANONICAL_OPPORTUNITY_VERSION,
    sourceRunId: null as string | null,
    entryWindowOpen: isRegularMarketSession(),
    entriesDeferredOutsideRegularSession: 0,
    positionsChecked: 0,
    closed: 0,
    candidatesConsidered: 0,
    opened: 0,
    unfilled: 0,
    errors: 0,
    proxShadowPacketsObserved: 0,
    proxShadowWouldVeto: 0,
    proxShadowWouldReduceSize: 0,
    proxShadowWriteUnavailable: null as string | null,
    proxExecutionAuthority: false,
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

  try {
    // ── 1. Manage open positions — exits first, before considering new entries ──
    const { data: openTrades, error: openTradesError } = await supabase
      .from("bot_trades")
      .select("*")
      .eq("status", "open");
    if (openTradesError) throw openTradesError;

    let alpacaPositions: AlpacaPosition[] = [];
    if ((openTrades ?? []).length > 0) {
      alpacaPositions = await getPositions();
    }
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
        const trailingStopPrice = highWaterMark * (1 - trailPercent / 100);
        if (currentPrice <= trailingStopPrice) hitTrailingStop = true;
      }

      if (hitHardStop || hitTrailingStop || pastMaxHold) {
        try {
          const order = await placeSellQty(trade.ticker, position.qty);
          const fillResult = order?.id
            ? await pollForFill(order.id)
            : ({ filled: false, price: null } as const);

          if (!fillResult.filled) {
            // Do NOT mark this closed — it isn't. Likely cause: the order
            // was placed outside regular hours (no extended_hours flag set)
            // and simply won't fill until the next session. Leaving status
            // "open" means the next cycle re-checks it and retries the exit,
            // instead of the database claiming a sale that never happened
            // while the real position sits unmanaged.
            if (order?.id) await cancelOrder(order.id);
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

    // ── 2. Consider a new entry, only if a slot is open ──
    const { count: openCount } = await supabase
      .from("bot_trades")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");

    if (
      (openCount ?? 0) < MAX_CONCURRENT_POSITIONS &&
      diagnostics.entryWindowOpen
    ) {
      const { standard, continuation, sourceRunId } = await fetchTopCandidates();
      diagnostics.sourceRunId = sourceRunId;
      diagnostics.candidatesConsidered = standard.length + continuation.length;
      const shadow = await recordProxShadowObservations(
        supabase,
        [...standard, ...continuation],
        sourceRunId,
      );
      diagnostics.proxShadowPacketsObserved = shadow.observed;
      diagnostics.proxShadowWouldVeto = shadow.wouldVeto;
      diagnostics.proxShadowWouldReduceSize = shadow.wouldReduceSize;
      diagnostics.proxShadowWriteUnavailable = shadow.unavailableReason;

      const heldTickers = new Set((openTrades ?? []).map((t) => t.ticker));
      const continuationTickers = new Set(
        continuation.map((candidate) => candidate.ticker),
      );
      let best: { candidate: CanonicalOpportunity; score: number; isContinuation: boolean } | null = null;
      for (const candidate of standard) {
        if (
          heldTickers.has(candidate.ticker) ||
          continuationTickers.has(candidate.ticker)
        ) {
          continue;
        }
        const score = computeBotScore(candidate);
        if (score === null) continue;
        if (!best || score > best.score) best = { candidate, score, isContinuation: false };
      }
      // Considered alongside, not instead of, standard picks — the "safest
      // probable trade" path stays the default; this only fills in when a
      // real continuation setup scores higher, or when nothing on the
      // standard path qualifies at all.
      for (const candidate of continuation) {
        if (heldTickers.has(candidate.ticker)) continue;
        const score = computeContinuationScore(candidate);
        if (score === null) continue;
        if (!best || score > best.score) best = { candidate, score, isContinuation: true };
      }

      if (best) {
        const { candidate, score, isContinuation } = best;
        const tf = candidate.tradeFramework;
        if (!tf) {
          throw new Error(
            `Canonical decision for ${candidate.ticker} has no trade framework.`,
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
          // Continuation entries are a higher-variance bet than the modeled
          // R:R path (no reliable upside number, just volume + momentum
          // still confirming) — half the normal size for the same reason
          // the stop-loss floor exists: real exposure, not a guess dressed
          // up as precision.
          const sizePercent = isContinuation ? POSITION_SIZE_PERCENT / 2 : POSITION_SIZE_PERCENT;
          const positionNotional = Math.round(equity * sizePercent * 100) / 100;
          if (!Number.isFinite(positionNotional) || positionNotional <= 0) {
            throw new Error(`Could not determine a valid position size from account equity (${equity}).`);
          }

          const { order, qty } = await placeBuyOrder(candidate.ticker, positionNotional, candidate.price);
          const fillResult = order?.id ? await pollForFill(order.id) : ({ filled: false, price: null } as const);

          if (!fillResult.filled) {
            // Same principle as the exit side: don't record a position that
            // isn't real. Most likely cause outside regular hours (no
            // extended_hours flag) is the order just never fills — cancel it
            // and let the next cycle try again with a fresh top candidate,
            // rather than inserting an "open" row for a position that was
            // never actually bought.
            if (order?.id) await cancelOrder(order.id);
            diagnostics.unfilled++;
            console.error(`[trading-bot] buy for ${candidate.ticker} did not fill (order ${order?.id ?? "none"}) — skipped`);
            return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
          }

          const entryPrice = fillResult.price;
          const now = new Date();
          await supabase.from("bot_trades").insert({
            ticker: candidate.ticker,
            status: "open",
            entry_order_id: order?.id ?? null,
            entry_price: entryPrice,
            entry_at: now.toISOString(),
            // Whole-share fallback (see placeBuyOrder) buys qty*price, not
            // the original notional target — record what was actually spent.
            position_notional: qty !== null ? Math.round(qty * entryPrice * 100) / 100 : positionNotional,
            // Informational only now — the actual sell decision is the
            // trailing stop below, not this fixed number. Kept so the
            // viewer can still show "what HT Labs originally modeled."
            target_price: tf.upsideMax !== null ? entryPrice * (1 + tf.upsideMax / 100) : null,
            stop_price: (() => {
              const downside = effectiveDownsidePercent(tf);
              return downside !== null ? entryPrice * (1 - downside / 100) : null;
            })(),
            high_water_mark: entryPrice,
            max_hold_until: new Date(now.getTime() + MAX_HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            bot_score: score,
            entry_snapshot: { ...candidate, isContinuationEntry: isContinuation },
          });
          diagnostics.opened++;
        } catch (err) {
          diagnostics.errors++;
          console.error(`[trading-bot] buy order failed for ${candidate.ticker}:`, err);
        }
      }
    } else if (
      (openCount ?? 0) < MAX_CONCURRENT_POSITIONS &&
      !diagnostics.entryWindowOpen
    ) {
      diagnostics.entriesDeferredOutsideRegularSession++;
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: unknown) {
    diagnostics.errors++;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Trading bot failed",
        diagnostics,
      },
      { status: 500 },
    );
  }
}
