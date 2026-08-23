// app/api/prox-shadow-scorecard/route.ts
//
// Read-only comparison: does ProX's shadow-mode opinion (veto / reduce size /
// rank adjustment / composite score), which currently has zero real
// influence on ranking or execution, actually agree with what happened to
// each ticker afterward? Joins prox_bot_shadow_observations (what ProX
// would have done) against ht_opportunity_ledger (what actually happened)
// by ticker + trading date. No writes anywhere — this only answers whether
// ProX's current opinions are earning their keep before any decision about
// giving it real authority.

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

type ShadowRow = {
  ticker: string;
  observed_at: string;
  canonical_eligible: boolean;
  canonical_strategy_score: number | null;
  canonical_opportunity_score: number | null;
  prox_status: string | null;
  prox_composite_score: number | null;
  prox_would_veto: boolean;
  prox_would_reduce_size: boolean;
  prox_rank_adjustment: number | null;
};

type LedgerRow = {
  ticker: string;
  trading_date: string;
  strategy: string;
  max_gain_percent: number | null;
  max_drawdown_percent: number | null;
  regular_close_return_percent: number | null;
  hit_5_at: string | null;
  hit_10_at: string | null;
  hit_20_at: string | null;
  hit_minus_10_at: string | null;
};

function avg(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return Math.round((finite.reduce((sum, v) => sum + v, 0) / finite.length) * 100) / 100;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const sinceDays = Math.min(30, Math.max(1, Number.parseInt(searchParams.get("days") ?? "14", 10) || 14));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const supabase = getSupabase();

    const { data: shadowData, error: shadowError } = await supabase
      .from("prox_bot_shadow_observations")
      .select("ticker, observed_at, canonical_eligible, canonical_strategy_score, canonical_opportunity_score, prox_status, prox_composite_score, prox_would_veto, prox_would_reduce_size, prox_rank_adjustment")
      .gte("observed_at", since)
      .limit(5000);
    if (shadowError) throw shadowError;

    const { data: ledgerData, error: ledgerError } = await supabase
      .from("ht_opportunity_ledger")
      .select("ticker, trading_date, strategy, max_gain_percent, max_drawdown_percent, regular_close_return_percent, hit_5_at, hit_10_at, hit_20_at, hit_minus_10_at")
      .gte("trading_date", since.slice(0, 10))
      .limit(5000);
    if (ledgerError) throw ledgerError;

    const ledgerByKey = new Map<string, LedgerRow>();
    for (const row of (ledgerData ?? []) as LedgerRow[]) {
      ledgerByKey.set(`${row.ticker}:${row.trading_date}`, row);
    }

    type Matched = { shadow: ShadowRow; ledger: LedgerRow };
    const matched: Matched[] = [];
    let unmatchedShadowCount = 0;
    for (const shadow of (shadowData ?? []) as ShadowRow[]) {
      const tradingDate = shadow.observed_at.slice(0, 10);
      const ledger = ledgerByKey.get(`${shadow.ticker}:${tradingDate}`);
      if (ledger) matched.push({ shadow, ledger });
      else unmatchedShadowCount++;
    }

    const bucket = (predicate: (m: Matched) => boolean) => matched.filter(predicate);
    const summarize = (rows: Matched[]) => ({
      count: rows.length,
      avgMaxGainPercent: avg(rows.map((r) => Number(r.ledger.max_gain_percent))),
      avgMaxDrawdownPercent: avg(rows.map((r) => Number(r.ledger.max_drawdown_percent))),
      avgRegularCloseReturnPercent: avg(rows.map((r) => Number(r.ledger.regular_close_return_percent))),
      hit5Rate: rows.length ? Math.round((rows.filter((r) => r.ledger.hit_5_at !== null).length / rows.length) * 1000) / 10 : null,
      hit10Rate: rows.length ? Math.round((rows.filter((r) => r.ledger.hit_10_at !== null).length / rows.length) * 1000) / 10 : null,
      hitMinus10Rate: rows.length ? Math.round((rows.filter((r) => r.ledger.hit_minus_10_at !== null).length / rows.length) * 1000) / 10 : null,
    });

    const vetoed = bucket((m) => m.shadow.prox_would_veto === true);
    const reducedOnly = bucket((m) => m.shadow.prox_would_veto !== true && m.shadow.prox_would_reduce_size === true);
    const clean = bucket((m) => m.shadow.prox_would_veto !== true && m.shadow.prox_would_reduce_size !== true);

    const rankBoosted = bucket((m) => (m.shadow.prox_rank_adjustment ?? 0) > 0);
    const rankPenalized = bucket((m) => (m.shadow.prox_rank_adjustment ?? 0) < 0);
    const rankNeutral = bucket((m) => (m.shadow.prox_rank_adjustment ?? 0) === 0);

    const highComposite = bucket((m) => (m.shadow.prox_composite_score ?? 0) >= 60);
    const lowComposite = bucket((m) => (m.shadow.prox_composite_score ?? 0) < 30);

    return NextResponse.json({
      windowDays: sinceDays,
      totalShadowObservations: shadowData?.length ?? 0,
      matchedToOutcome: matched.length,
      unmatchedShadowCount,
      comparisons: {
        vetoDecision: {
          proxWouldVeto: summarize(vetoed),
          proxWouldReduceOnly: summarize(reducedOnly),
          proxClean: summarize(clean),
        },
        rankAdjustment: {
          proxBoosted: summarize(rankBoosted),
          proxPenalized: summarize(rankPenalized),
          proxNeutral: summarize(rankNeutral),
        },
        compositeScore: {
          highComposite60Plus: summarize(highComposite),
          lowCompositeUnder30: summarize(lowComposite),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[prox-shadow-scorecard] failed:", error);
    return NextResponse.json({ error: getErrorMessage(error, "Failed to build ProX shadow scorecard") }, { status: 500 });
  }
}
