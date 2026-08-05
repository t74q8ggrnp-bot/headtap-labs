import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTradeFramework } from "@/lib/canonical-trade-framework";
import {
  CANONICAL_OPPORTUNITY_VERSION,
  chooseOpportunityStrategy,
  evaluateCanonicalOpportunity,
  isConfirmedContinuationRunner,
  mapSignalRow,
  type SignalRow,
} from "@/lib/canonical-opportunity";
import { loadProxIntelligencePackets } from "@/lib/prox/intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

async function getCanonicalSignalRow(
  supabase: ReturnType<typeof getSupabase>,
  ticker: string,
): Promise<{ row: SignalRow | null; sourceRunId: string | null }> {
  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .select("id")
    .eq("run_type", "signal_writer_v3")
    .eq("status", "success")
    .eq("promoted", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!run?.id) return { row: null, sourceRunId: null };

  const { data: runRow, error: runRowError } = await supabase
    .from("ht_signal_run_rows")
    .select("*")
    .eq("scan_run_id", run.id)
    .eq("ticker", ticker)
    .maybeSingle();
  if (runRowError) throw runRowError;
  return {
    row: (runRow as SignalRow | null) ?? null,
    sourceRunId: String(run.id),
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
        .select(
          "signaled_at, ht_score, signal_state, pattern, price_at_signal, gain_1d, gain_3d, gain_5d, outcome",
        )
        .eq("ticker", ticker)
        .order("signaled_at", { ascending: false })
        .limit(10);
      if (historyError) throw historyError;

      return NextResponse.json({
        ticker,
        history: history ?? [],
        totalSignals: history?.length ?? 0,
        winRate: history?.length
          ? Math.round(
              (history.filter(
                (item) =>
                  (item as { outcome?: string | null }).outcome === "winner",
              )
                .length /
                history.length) *
                100,
            )
          : null,
      });
    }

    const { row, sourceRunId } = await getCanonicalSignalRow(
      supabase,
      ticker,
    );
    if (!row || !sourceRunId) {
      return NextResponse.json({
        ticker,
        message:
          "No data is available for this ticker in the latest promoted canonical signal run.",
        opportunityScore: 0,
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
      });
    }

    const candidate = mapSignalRow(row);
    const strategy = chooseOpportunityStrategy(
      candidate,
      requestedStrategy,
    );
    const framework = await getTradeFramework(
      supabase,
      ticker,
      candidate.price,
      candidate.change,
      isConfirmedContinuationRunner(candidate, strategy),
    );
    const proxPackets = await loadProxIntelligencePackets(supabase, [ticker]);
    const opportunity = evaluateCanonicalOpportunity(
      candidate,
      framework,
      strategy,
      sourceRunId,
      proxPackets.get(ticker) ?? null,
    );
    const displayEligibility = opportunity.displayEligibility;

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
          eligibility: displayEligibility.eligible,
          rejectionReasons: displayEligibility.reasons,
          dataQualityWarnings: opportunity.rejectionReasons,
          strategy: opportunity.strategy,
          tier: opportunity.tier,
          explosionAssessment: opportunity.explosionAssessment,
          proxIntelligence: opportunity.proxIntelligence,
          verdict: displayEligibility.eligible
            ? `HT currently classifies ${ticker} as a ${opportunity.tier} opportunity for ${opportunity.strategy}.`
            : `HT is monitoring ${ticker}, but it does not currently pass the complete opportunity gate.`,
        },
        tradeFramework: framework,
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
        sourceTable: "ht_signal_run_rows",
        sourceRunId,
      });
    }

    return NextResponse.json({
      ticker,
      opportunity,
      scannedAt: row.scanned_at,
      sourceTable: "ht_signal_run_rows",
      sourceRunId,
      latestSignalAt: row.scanned_at,
      engineVersion: CANONICAL_OPPORTUNITY_VERSION,
    });
  } catch (error: unknown) {
    console.error(`Opportunity ticker error for ${ticker}:`, error);
    return NextResponse.json(
      {
        error: "Failed to fetch opportunity",
        detail: error instanceof Error ? error.message : "Unknown error",
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
      },
      { status: 500 },
    );
  }
}
