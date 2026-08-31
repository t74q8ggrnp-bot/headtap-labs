// ProX direct microstructure observation lane.
//
// Captures Massive Advanced NBBO and recent consolidated trade prints for a
// bounded, independently discovered research set. These rows are append-only
// shadow evidence. This route cannot publish an HT score, change canonical
// eligibility/ranking, place an order, or grant ProX execution authority.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchMassiveLastQuoteResult,
  fetchMassiveRecentTrades,
  probeMassiveRealtimeEntitlement,
} from "@/lib/massive-stocks";
import { getProxEasternMarketClock } from "@/lib/prox/market-discovery";
import {
  PROX_MICROSTRUCTURE_AUTHORITY,
  PROX_MICROSTRUCTURE_VERSION,
  summarizeProxMicrostructure,
} from "@/lib/prox/microstructure";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const RESEARCH_LOOKBACK_HOURS = 6;
const TAPE_WINDOW_SECONDS = 120;
const TAPE_LIMIT = 1_000;
const MAX_TICKERS = 20;
const CONCURRENCY = 4;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing server-side Supabase service credentials.");
  }
  return createClient(url, key);
}

function isAuthorized(request: Request) {
  return Boolean(
    CRON_SECRET &&
      request.headers.get("authorization") === `Bearer ${CRON_SECRET}`,
  );
}

function observationMinute(date: Date) {
  const minute = new Date(date);
  minute.setUTCSeconds(0, 0);
  return minute.toISOString();
}

async function loadResearchTickers(
  supabase: ReturnType<typeof getSupabase>,
) {
  const since = new Date(
    Date.now() - RESEARCH_LOOKBACK_HOURS * 60 * 60 * 1_000,
  ).toISOString();
  const { data, error } = await supabase
    .from("prox_research_queue")
    .select("ticker,research_priority,last_detected_at,instrument_lane")
    .in("status", ["queued", "observing"])
    .eq("instrument_lane", "opportunity_equity")
    .gte("last_detected_at", since)
    .order("research_priority", { ascending: false })
    .order("last_detected_at", { ascending: false })
    .limit(MAX_TICKERS);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const ticker = String(row.ticker ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return [];
    return [{
      ticker,
      researchPriority: Number(row.research_priority) || 0,
      detectedAt: String(row.last_detected_at ?? ""),
    }];
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const marketClock = getProxEasternMarketClock();
  const now = new Date();
  if (marketClock.session === "closed") {
    return NextResponse.json({
      success: true,
      skipped: "market_closed",
      authority: PROX_MICROSTRUCTURE_AUTHORITY,
      timestamp: now.toISOString(),
    });
  }

  const supabase = getSupabase();
  const observedAt = now.toISOString();
  const minute = observationMinute(now);
  const runInsert = await supabase
    .from("prox_realtime_microstructure_runs")
    .insert({
      started_at: observedAt,
      observation_minute: minute,
      engine_version: PROX_MICROSTRUCTURE_VERSION,
      authority: PROX_MICROSTRUCTURE_AUTHORITY,
      market_session: marketClock.session,
      status: "running",
    })
    .select("id")
    .single();
  if (runInsert.error || !runInsert.data?.id) {
    const duplicate = await supabase
      .from("prox_realtime_microstructure_runs")
      .select("id,status,complete,completed_at")
      .eq("observation_minute", minute)
      .eq("engine_version", PROX_MICROSTRUCTURE_VERSION)
      .maybeSingle();
    if (duplicate.data) {
      return NextResponse.json({
        success: duplicate.data.complete === true,
        duplicate: true,
        run: duplicate.data,
        authority: PROX_MICROSTRUCTURE_AUTHORITY,
      });
    }
    return NextResponse.json(
      {
        error:
          runInsert.error?.message ??
          "Could not create ProX microstructure receipt; run migration 0027.",
      },
      { status: 500 },
    );
  }

  const runId = runInsert.data.id as string;
  try {
    const [entitlement, research] = await Promise.all([
      probeMassiveRealtimeEntitlement(),
      loadResearchTickers(supabase),
    ]);
    const tapeStart = new Date(
      now.getTime() - TAPE_WINDOW_SECONDS * 1_000,
    );
    const observations: Array<Record<string, unknown>> = [];
    let providerErrorCount = 0;
    let quoteObservationCount = 0;
    let tradeObservationCount = 0;
    let truncatedTapeCount = 0;
    const errors: Array<{ ticker: string; quote: string | null; trades: string | null }> = [];

    for (let index = 0; index < research.length; index += CONCURRENCY) {
      const batch = research.slice(index, index + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (candidate) => {
          const [quoteResult, tradeResult] = await Promise.all([
            fetchMassiveLastQuoteResult(candidate.ticker),
            fetchMassiveRecentTrades(candidate.ticker, {
              since: tapeStart,
              limit: TAPE_LIMIT,
            }),
          ]);
          return { candidate, quoteResult, tradeResult };
        }),
      );

      for (const result of results) {
        const summary = summarizeProxMicrostructure({
          ticker: result.candidate.ticker,
          quote: result.quoteResult.value,
          trades: result.tradeResult.value.trades,
        });
        const quoteAvailable = summary.quoteAsOf !== null;
        const tradesAvailable = summary.recentTradeCount > 0;
        if (quoteAvailable) quoteObservationCount += 1;
        if (tradesAvailable) tradeObservationCount += 1;
        if (result.tradeResult.value.truncated) truncatedTapeCount += 1;
        if (result.quoteResult.error || result.tradeResult.error) {
          providerErrorCount += 1;
          errors.push({
            ticker: result.candidate.ticker,
            quote: result.quoteResult.error,
            trades: result.tradeResult.error,
          });
        }
        observations.push({
          run_id: runId,
          ticker: summary.ticker,
          observed_at: observedAt,
          observation_minute: minute,
          engine_version: PROX_MICROSTRUCTURE_VERSION,
          authority: PROX_MICROSTRUCTURE_AUTHORITY,
          market_session: marketClock.session,
          research_priority: result.candidate.researchPriority,
          research_detected_at: result.candidate.detectedAt,
          quote_as_of: summary.quoteAsOf,
          trade_as_of: summary.tradeAsOf,
          market_as_of: summary.marketAsOf,
          bid_price: summary.bidPrice,
          ask_price: summary.askPrice,
          bid_size: summary.bidSize,
          ask_size: summary.askSize,
          midpoint_price: summary.midpointPrice,
          spread_dollars: summary.spreadDollars,
          spread_percent: summary.spreadPercent,
          last_trade_price: summary.lastTradePrice,
          last_trade_size: summary.lastTradeSize,
          tape_window_started_at: tapeStart.toISOString(),
          recent_trade_count: summary.recentTradeCount,
          recent_trade_volume: summary.recentTradeVolume,
          recent_trade_notional: summary.recentTradeNotional,
          largest_trade_size: summary.largestTradeSize,
          largest_trade_notional: summary.largestTradeNotional,
          exchange_count: summary.exchangeCount,
          condition_codes: summary.conditionCodes,
          tape_truncated: result.tradeResult.value.truncated,
          quote_available: quoteAvailable,
          trades_available: tradesAvailable,
          source_provider: "massive_polygon",
          source_data_mode: entitlement.dataMode,
        });
      }
    }

    let persistedCount = 0;
    for (let index = 0; index < observations.length; index += 50) {
      const { data, error } = await supabase
        .from("prox_realtime_microstructure_observations")
        .insert(observations.slice(index, index + 50))
        .select("id");
      if (error) throw error;
      persistedCount += data?.length ?? 0;
    }

    const complete = persistedCount === research.length;
    const latestMarketAsOf = observations
      .map((row) => String(row.market_as_of ?? ""))
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const completedAt = new Date().toISOString();
    const diagnostics = {
      scoringChanged: false,
      eligibilityChanged: false,
      executionAuthority: "none",
      quoteCoveragePercent:
        research.length > 0
          ? Number(((quoteObservationCount / research.length) * 100).toFixed(1))
          : 0,
      tradeCoveragePercent:
        research.length > 0
          ? Number(((tradeObservationCount / research.length) * 100).toFixed(1))
          : 0,
      tapeWindowSeconds: TAPE_WINDOW_SECONDS,
      tapeLimit: TAPE_LIMIT,
      errors: errors.slice(0, 10),
    };
    const { error: completionError } = await supabase
      .from("prox_realtime_microstructure_runs")
      .update({
        completed_at: completedAt,
        status: complete ? "success" : "failed",
        candidate_count: research.length,
        expected_observation_count: research.length,
        persisted_observation_count: persistedCount,
        quote_observation_count: quoteObservationCount,
        trade_observation_count: tradeObservationCount,
        provider_error_count: providerErrorCount,
        truncated_tape_count: truncatedTapeCount,
        latest_market_as_of: latestMarketAsOf,
        source_data_mode: entitlement.dataMode,
        complete,
        diagnostics,
      })
      .eq("id", runId);
    if (completionError) throw completionError;

    return NextResponse.json({
      success: complete,
      runId,
      authority: PROX_MICROSTRUCTURE_AUTHORITY,
      engineVersion: PROX_MICROSTRUCTURE_VERSION,
      marketSession: marketClock.session,
      candidateCount: research.length,
      persistedCount,
      quoteObservationCount,
      tradeObservationCount,
      providerErrorCount,
      latestMarketAsOf,
      sourceDataMode: entitlement.dataMode,
      diagnostics,
      timestamp: completedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ProX microstructure observation failed.";
    await supabase
      .from("prox_realtime_microstructure_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        complete: false,
        error_message: message,
      })
      .eq("id", runId);
    return NextResponse.json({ error: message, runId }, { status: 500 });
  }
}
