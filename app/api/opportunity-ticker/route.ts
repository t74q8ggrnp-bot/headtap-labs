import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTradeFramework } from "@/lib/canonical-trade-framework";
import {
  CANONICAL_OPPORTUNITY_VERSION,
  chooseOpportunityStrategy,
  evaluateCanonicalOpportunity,
  getMomentumReferenceChange,
  isConfirmedContinuationRunner,
  mapSignalRow,
  type SignalRow,
} from "@/lib/canonical-opportunity";
import { loadProxIntelligencePackets } from "@/lib/prox/intelligence";
import {
  attachOpportunityDisplayQuote,
  loadOpportunityDisplayQuotes,
} from "@/lib/opportunity-display-quotes";
import { applyOpportunityDecisionQuote } from "@/lib/opportunity-decision-quote";
import {
  findOpportunityInDecisionFrame,
  getRollingCanonicalDecisionFrame,
} from "@/lib/canonical-decision-frame";
import {
  describeTopMoverDisposition,
  findTopMoverDisposition,
  type TopMoverDisposition,
} from "@/lib/top-mover-disposition";

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
): Promise<{
  row: SignalRow | null;
  sourceRunId: string | null;
  disposition: TopMoverDisposition | null;
}> {
  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .select("id,candidate_counts")
    .eq("run_type", "signal_writer_v3")
    .eq("status", "success")
    .eq("promoted", true)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!run?.id) return { row: null, sourceRunId: null, disposition: null };

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
    disposition: findTopMoverDisposition(
      (run.candidate_counts as { topMoverDispositions?: unknown } | null)
        ?.topMoverDispositions,
      ticker,
    ),
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

    const { row, sourceRunId, disposition } = await getCanonicalSignalRow(
      supabase,
      ticker,
    );
    if (!row || !sourceRunId) {
      const dispositionSummary = disposition
        ? describeTopMoverDisposition(disposition)
        : null;
      if (mode === "explain" && disposition) {
        return NextResponse.json({
          ticker,
          explanation: {
            summary: dispositionSummary,
            whatChanged:
              "The ticker was observed by the market-mover audit, but it did not produce a promoted canonical row.",
            riskNote: dispositionSummary,
            stage:
              disposition.status === "excluded"
                ? "Excluded Before Canonical Evaluation"
                : "Canonical Pipeline Inconsistency",
            confidence: "Disposition receipt",
            signals: [
              `Market move +${disposition.changePercent.toFixed(1)}%`,
              disposition.reason,
            ],
            eligibility: false,
            rejectionReasons: [dispositionSummary],
            dataQualityWarnings:
              disposition.status === "canonical_candidate"
                ? [
                    "The scan receipt says canonical candidate, but the promoted run row is missing.",
                  ]
                : [],
            strategy: "spot_momentum",
            tier: "scanner",
            explosionAssessment: null,
            proxIntelligence: null,
            verdict: dispositionSummary,
          },
          disposition,
          engineVersion: CANONICAL_OPPORTUNITY_VERSION,
          sourceTable: "ht_scan_runs.candidate_counts.topMoverDispositions",
          sourceRunId,
        });
      }
      return NextResponse.json({
        ticker,
        message: dispositionSummary ??
          "No data is available for this ticker in the latest promoted canonical signal run.",
        disposition,
        opportunityScore: 0,
        sourceRunId,
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
      });
    }

    const promotedCandidate = mapSignalRow(row);
    const decisionQuotes = await loadOpportunityDisplayQuotes([ticker]);
    const candidate = applyOpportunityDecisionQuote(
      promotedCandidate,
      decisionQuotes.get(ticker),
    );
    const strategy = chooseOpportunityStrategy(
      candidate,
      requestedStrategy,
    );
    const preferredFrameType = strategy === "spot_momentum"
      ? "momentum" as const
      : "before_crowd" as const;
    let decisionFrame = await getRollingCanonicalDecisionFrame(
      preferredFrameType,
    );
    let framedOpportunity = findOpportunityInDecisionFrame(
      decisionFrame,
      ticker,
    ) as ReturnType<typeof evaluateCanonicalOpportunity> | null;
    if (!framedOpportunity && !requestedStrategy) {
      const alternateFrame = await getRollingCanonicalDecisionFrame(
        preferredFrameType === "momentum" ? "before_crowd" : "momentum",
      );
      const alternateOpportunity = findOpportunityInDecisionFrame(
        alternateFrame,
        ticker,
      ) as ReturnType<typeof evaluateCanonicalOpportunity> | null;
      if (alternateOpportunity) {
        decisionFrame = alternateFrame;
        framedOpportunity = alternateOpportunity;
      }
    }
    if (framedOpportunity) {
      const framedFramework = framedOpportunity.tradeFramework;
      const framedEligibility = framedOpportunity.displayEligibility;
      if (mode === "explain") {
        return NextResponse.json({
          ticker,
          explanation: {
            summary: framedOpportunity.whyItMatters,
            whatChanged: framedOpportunity.whatChanged,
            riskNote: framedOpportunity.riskNote,
            stage: `${framedOpportunity.stageEmoji} ${framedOpportunity.stage}`,
            confidence: `${framedOpportunity.confidence}% confidence`,
            signals: framedOpportunity.signals,
            eligibility: framedEligibility.eligible,
            rejectionReasons: framedEligibility.reasons,
            dataQualityWarnings: framedOpportunity.rejectionReasons,
            strategy: framedOpportunity.strategy,
            tier: framedOpportunity.tier,
            explosionAssessment: framedOpportunity.explosionAssessment,
            proxIntelligence: framedOpportunity.proxIntelligence,
            verdict: framedEligibility.eligible
              ? `HT currently classifies ${ticker} as a ${framedOpportunity.tier} opportunity for ${framedOpportunity.strategy}.`
              : `HT is monitoring ${ticker}, but it does not currently pass the complete opportunity gate.`,
          },
          tradeFramework: framedFramework,
          decisionFrame: decisionFrame.decisionFrame,
          engineVersion: CANONICAL_OPPORTUNITY_VERSION,
          sourceTable: "rolling_canonical_decision_frame",
          sourceRunId: framedOpportunity.sourceRunId,
        });
      }

      return NextResponse.json({
        ticker,
        opportunity: framedOpportunity,
        scannedAt: framedOpportunity.scannedAt,
        sourceTable: "rolling_canonical_decision_frame",
        sourceRunId: framedOpportunity.sourceRunId,
        latestSignalAt: framedOpportunity.scannedAt,
        decisionFrame: decisionFrame.decisionFrame,
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
      });
    }
    const framework = await getTradeFramework(
      supabase,
      ticker,
      candidate.price,
      getMomentumReferenceChange(candidate),
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
    const displayedOpportunity = attachOpportunityDisplayQuote(
      opportunity,
      decisionQuotes,
    );
    const displayEligibility = opportunity.displayEligibility;

    if (mode === "explain") {
      return NextResponse.json({
        ticker,
        explanation: {
          summary: displayedOpportunity.whyItMatters,
          whatChanged: displayedOpportunity.whatChanged,
          riskNote: displayedOpportunity.riskNote,
          stage: `${displayedOpportunity.stageEmoji} ${displayedOpportunity.stage}`,
          confidence: `${displayedOpportunity.confidence}% confidence`,
          signals: displayedOpportunity.signals,
          eligibility: displayEligibility.eligible,
          rejectionReasons: displayEligibility.reasons,
          dataQualityWarnings: opportunity.rejectionReasons,
          strategy: displayedOpportunity.strategy,
          tier: displayedOpportunity.tier,
          explosionAssessment: displayedOpportunity.explosionAssessment,
          proxIntelligence: displayedOpportunity.proxIntelligence,
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
      opportunity: displayedOpportunity,
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
