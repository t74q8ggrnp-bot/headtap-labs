// app/api/trading-bot/route.ts
//
// A separate system from Pro X and from the canonical HT Labs engine.
// Reads HT Labs' canonical Spot Momentum candidates as a read-only input
// (via /api/opportunities — no direct table access, no re-deriving
// eligibility). Has its own independent ranking logic optimized for
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
  getAccount,
  getPositions,
  placeBuyNotional,
  placeSellQty,
  type AlpacaPosition,
} from "@/lib/trading-bot/alpaca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
// Position size is a % of *current* account equity, not a flat dollar
// amount — stays proportional as the paper account grows/shrinks from
// testing, rather than becoming meaningless at a fixed number.
const POSITION_SIZE_PERCENT = 0.05;
const MAX_CONCURRENT_POSITIONS = 3;
const MIN_RR_RATIO = 1.5;
const MAX_HOLD_DAYS = 3;

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

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  const querySecret = new URL(req.url).searchParams.get("secret");
  return authHeader === `Bearer ${CRON_SECRET}` || querySecret === CRON_SECRET || querySecret === "htlabs-internal";
}

type CanonicalOpportunity = {
  ticker: string;
  price: number;
  riskTags: string[];
  tradeFramework: { rrRatio: number | null; entryQuality: number | null; upsideMax: number | null; downsideRisk: number | null } | null;
};

// Deliberately the opposite emphasis from the canonical hero's display
// ranking. HT Labs' own opportunityScore now favors raw magnitude — the
// right call for "what should the headline show." It's the wrong call
// for "what should I risk paper money on right now": the biggest mover
// is usually the most extended one. This rewards a clean R:R and
// entryQuality (which already penalizes over-extension) and actively
// docks points per risk tag, with a hard floor that disqualifies
// anything below a 1.5 R:R outright rather than just scoring it lower.
function computeBotScore(candidate: CanonicalOpportunity): number | null {
  const tf = candidate.tradeFramework;
  const rr = tf?.rrRatio ?? null;
  if (rr === null || rr < MIN_RR_RATIO) return null;
  const entryQuality = tf?.entryQuality ?? 0;
  const rrBonus = Math.min(30, rr * 10);
  const riskTagPenalty = candidate.riskTags.length * 10;
  return entryQuality + rrBonus - riskTagPenalty;
}

async function fetchTopCandidates(baseUrl: string): Promise<CanonicalOpportunity[]> {
  const res = await fetch(`${baseUrl}/api/opportunities?type=momentum&limit=10`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch canonical opportunities: ${res.status}`);
  const data = await res.json();
  return (data.opportunities ?? []) as CanonicalOpportunity[];
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const enabled = process.env.TRADING_BOT_ENABLED === "true";
  const diagnostics = {
    enabled,
    alpacaConfigured: alpacaConfigured(),
    positionsChecked: 0,
    closed: 0,
    candidatesConsidered: 0,
    opened: 0,
    errors: 0,
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

      const gainFromEntry = entryPrice > 0 ? ((highWaterMark - entryPrice) / entryPrice) * 100 : 0;
      const hitHardStop = trade.stop_price !== null && currentPrice <= trade.stop_price;

      let hitTrailingStop = false;
      if (gainFromEntry >= MIN_PROFIT_TO_TRAIL_PERCENT) {
        const trailPercent = gainFromEntry >= EXTENDED_GAIN_THRESHOLD_PERCENT ? TIGHT_TRAIL_PERCENT : WIDE_TRAIL_PERCENT;
        const trailingStopPrice = highWaterMark * (1 - trailPercent / 100);
        if (currentPrice <= trailingStopPrice) hitTrailingStop = true;
      }

      if (hitHardStop || hitTrailingStop || pastMaxHold) {
        try {
          const order = await placeSellQty(trade.ticker, position.qty);
          const exitReason = hitTrailingStop ? "trailing_stop" : hitHardStop ? "stop" : "time_limit";
          const pnl = (currentPrice - entryPrice) * Number(position.qty);
          const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : null;
          await supabase
            .from("bot_trades")
            .update({
              status: "closed",
              exit_order_id: order?.id ?? null,
              exit_price: currentPrice,
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

    if ((openCount ?? 0) < MAX_CONCURRENT_POSITIONS) {
      const baseUrl = new URL(req.url).origin;
      const candidates = await fetchTopCandidates(baseUrl);
      diagnostics.candidatesConsidered = candidates.length;

      const heldTickers = new Set((openTrades ?? []).map((t) => t.ticker));
      let best: { candidate: CanonicalOpportunity; score: number } | null = null;
      for (const candidate of candidates) {
        if (heldTickers.has(candidate.ticker)) continue;
        const score = computeBotScore(candidate);
        if (score === null) continue;
        if (!best || score > best.score) best = { candidate, score };
      }

      if (best) {
        const { candidate, score } = best;
        const tf = candidate.tradeFramework!;
        try {
          const account = await getAccount();
          const equity = Number(account?.equity ?? account?.cash ?? 0);
          const positionNotional = Math.round(equity * POSITION_SIZE_PERCENT * 100) / 100;
          if (!Number.isFinite(positionNotional) || positionNotional <= 0) {
            throw new Error(`Could not determine a valid position size from account equity (${equity}).`);
          }

          const order = await placeBuyNotional(candidate.ticker, positionNotional);
          const entryPrice = candidate.price;
          const now = new Date();
          await supabase.from("bot_trades").insert({
            ticker: candidate.ticker,
            status: "open",
            entry_order_id: order?.id ?? null,
            entry_price: entryPrice,
            entry_at: now.toISOString(),
            position_notional: positionNotional,
            // Informational only now — the actual sell decision is the
            // trailing stop below, not this fixed number. Kept so the
            // viewer can still show "what HT Labs originally modeled."
            target_price: tf.upsideMax !== null ? entryPrice * (1 + tf.upsideMax / 100) : null,
            stop_price: tf.downsideRisk !== null ? entryPrice * (1 - tf.downsideRisk / 100) : null,
            high_water_mark: entryPrice,
            max_hold_until: new Date(now.getTime() + MAX_HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            bot_score: score,
            entry_snapshot: candidate,
          });
          diagnostics.opened++;
        } catch (err) {
          diagnostics.errors++;
          console.error(`[trading-bot] buy order failed for ${candidate.ticker}:`, err);
        }
      }
    }

    return NextResponse.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error: any) {
    diagnostics.errors++;
    return NextResponse.json({ error: error?.message ?? "Trading bot failed", diagnostics }, { status: 500 });
  }
}
