// app/api/trading-bot-diagnostics/route.ts
//
// Read-only historical trace for one ticker: every cycle the trading bot's
// candidate pool included it (via prox_bot_shadow_observations, which gets
// a row every cycle for any candidate carrying ProX intelligence data —
// this table predates today's changes, so it has coverage back further
// than bot_cycle_candidates does) plus, once bot_cycles/bot_cycle_candidates
// exist, the full scoring detail for cycles logged after migration 0009.
// Exists to answer "did the bot actually see this ticker today, and when,"
// with real timestamps instead of a single current-moment snapshot.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

// Same CRON_SECRET bearer-token check used everywhere else in this
// codebase for internal-only routes — this was reachable with no auth.
const CRON_SECRET = process.env.CRON_SECRET;
function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  return req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json({ error: "?ticker= is required" }, { status: 400 });
    }
    const since = searchParams.get("since") ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const supabase = getSupabase();

    const { data: shadowObservations, error: shadowError } = await supabase
      .from("prox_bot_shadow_observations")
      .select("ticker, source_run_id, canonical_eligible, canonical_strategy_score, canonical_opportunity_score, prox_status, prox_composite_score, prox_would_veto, reasons, observed_at")
      .eq("ticker", ticker)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true });

    let cycleCandidates: unknown[] = [];
    let cycleTableError: string | null = null;
    const { data: cycleData, error: cycleErr } = await supabase
      .from("bot_cycle_candidates")
      .select("ticker, is_continuation, score, entry_quality, rr_ratio, downside_percent, picked, cycle_id, bot_cycles!inner(started_at)")
      .eq("ticker", ticker)
      .gte("bot_cycles.started_at", since)
      .order("cycle_id", { ascending: true });
    if (cycleErr) {
      cycleTableError = cycleErr.message;
    } else {
      cycleCandidates = cycleData ?? [];
    }

    return NextResponse.json({
      ticker,
      since,
      shadowObservations: shadowObservations ?? [],
      shadowObservationsError: shadowError?.message ?? null,
      cycleCandidates,
      cycleCandidatesError: cycleTableError,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load trading bot diagnostics") }, { status: 500 });
  }
}
