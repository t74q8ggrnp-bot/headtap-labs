import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTradeFramework } from "@/lib/canonical-trade-framework";
import {
  CANONICAL_OPPORTUNITY_VERSION,
  evaluateCanonicalOpportunity,
  getMomentumReferenceChange,
  isConfirmedContinuationRunner,
  mapSignalRow,
  type OpportunityCandidate,
  type OpportunityStrategy,
  type SignalRow,
} from "@/lib/canonical-opportunity";
import { loadProxIntelligencePackets } from "@/lib/prox/intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 20;
const RUN_ROW_PAGE_SIZE = 1_000;
const PROX_LOOKUP_BATCH_SIZE = 100;
type RequestType = "all" | "momentum" | "catalyst" | "before_crowd";
const OPPORTUNITY_CACHE_HEADERS = {
  // Spot Momentum and Before The Crowd must resolve the same latest promoted
  // run. A stale-while-revalidate window allowed the two query variants to
  // temporarily serve different run IDs after promotion, so canonical reads
  // now bypass edge storage. Expensive historical features remain cached in
  // Supabase by the trade-framework layer.
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  "Vercel-Cache-Tag": "canonical-opportunities",
};

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

async function loadAllRunRows(
  supabase: ReturnType<typeof getSupabase>,
  sourceRunId: string,
): Promise<SignalRow[]> {
  const rows: SignalRow[] = [];

  // Supabase projects commonly cap a single select at 1,000 rows. A promoted
  // run can be larger than that, so one unpaged query silently drops valid
  // candidates before canonical scoring ever sees them. Order by ticker to
  // keep page boundaries deterministic while the immutable run is read.
  for (let from = 0; ; from += RUN_ROW_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ht_signal_run_rows")
      .select("*")
      .eq("scan_run_id", sourceRunId)
      .order("ticker", { ascending: true })
      .range(from, from + RUN_ROW_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as SignalRow[];
    rows.push(...page);
    if (page.length < RUN_ROW_PAGE_SIZE) break;
  }

  return rows;
}

async function evaluateAll(
  supabase: ReturnType<typeof getSupabase>,
  candidates: OpportunityCandidate[],
  strategy: OpportunityStrategy,
  sourceRunId: string,
) {
  const proxPacketBatches = await Promise.all(
    Array.from(
      { length: Math.ceil(candidates.length / PROX_LOOKUP_BATCH_SIZE) },
      (_, index) =>
        loadProxIntelligencePackets(
          supabase,
          candidates
            .slice(
              index * PROX_LOOKUP_BATCH_SIZE,
              (index + 1) * PROX_LOOKUP_BATCH_SIZE,
            )
            .map((candidate) => candidate.ticker),
        ),
    ),
  );
  const proxPackets = new Map(
    proxPacketBatches.flatMap((packets) => [...packets.entries()]),
  );
  const output: ReturnType<typeof evaluateCanonicalOpportunity>[] = [];
  for (let index = 0; index < candidates.length; index += CONCURRENCY) {
    const batch = candidates.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (candidate) =>
        evaluateCanonicalOpportunity(
          candidate,
          await getTradeFramework(
            supabase,
            candidate.ticker,
            candidate.price,
            getMomentumReferenceChange(candidate),
            isConfirmedContinuationRunner(candidate, strategy),
          ),
          strategy,
          sourceRunId,
          proxPackets.get(candidate.ticker) ?? null,
        ),
      ),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") output.push(result.value);
      else console.error("[opportunities] evaluation failed:", result.reason);
    }
  }
  return output;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedType = (url.searchParams.get("type") ??
    "all") as RequestType;
  const strategy: OpportunityStrategy =
    requestedType === "before_crowd"
      ? "before_the_crowd"
      : "spot_momentum";
  const parsedLimit = Number.parseInt(
    url.searchParams.get("limit") ?? "10",
    10,
  );
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 10;

  try {
    const supabase = getSupabase();
    const { data: run, error: runError } = await supabase
      .from("ht_scan_runs")
      .select("id,completed_at,candidate_counts,engine_version")
      .eq("run_type", "signal_writer_v3")
      .eq("status", "success")
      .eq("promoted", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) {
      return NextResponse.json(
        {
          opportunities: [],
          message: "No completed authoritative signal run is available yet.",
          strategy,
          engineVersion: CANONICAL_OPPORTUNITY_VERSION,
        },
        { headers: OPPORTUNITY_CACHE_HEADERS },
      );
    }

    const rows = await loadAllRunRows(supabase, String(run.id));

    const candidates = rows
      .map(mapSignalRow)
      .filter((candidate) =>
        strategy === "spot_momentum"
          ? candidate.retrievedForSm || candidate.retrievedForCatalyst
          : candidate.retrievedForBtc || candidate.retrievedForCatalyst,
      );
    const evaluated = await evaluateAll(
      supabase,
      candidates,
      strategy,
      String(run.id),
    );
    const ranked = evaluated.sort(
      (left, right) =>
        Number(right.displayEligibility.eligible) -
          Number(left.displayEligibility.eligible) ||
        right.strategyScore - left.strategyScore ||
        right.signalStrength - left.signalStrength ||
        right.relativeVolume - left.relativeVolume,
    );
    let eligible = ranked.filter(
      (candidate) => candidate.displayEligibility.eligible,
    );
    if (requestedType === "catalyst") {
      eligible = eligible.filter(
        (candidate) => candidate.catalystScore >= 20,
      );
    }
    if (requestedType === "before_crowd") {
      eligible = eligible.filter((candidate) => candidate.isBeforeCrowd);
    }

    const debug = url.searchParams.get("debug") === "1";
    const includeContinuation =
      url.searchParams.get("includeContinuation") === "1";
    const continuationCandidates = ranked
      .filter((candidate) => candidate.continuationEligible)
      .sort(
        (left, right) =>
          (right.explosionAssessment.paperTradeScore ?? 0) -
          (left.explosionAssessment.paperTradeScore ?? 0),
      )
      .slice(0, 10);

    return NextResponse.json(
      {
        opportunities: eligible.slice(0, limit),
        strategy,
        sourceRun: {
          id: run.id,
          completedAt: run.completed_at,
          engineVersion: run.engine_version,
          candidateCounts: run.candidate_counts,
        },
        diagnostics: {
          runRows: rows.length,
          strategyCandidates: candidates.length,
          evaluated: evaluated.length,
          eligible: eligible.length,
          rejected: evaluated.length - eligible.length,
          strictCanonicalEligible: evaluated.filter(
            (candidate) => candidate.eligibility.eligible,
          ).length,
          verifiedPriceDiscoveryVisible: evaluated.filter(
            (candidate) =>
              candidate.visibilityState === "verified_price_discovery",
          ).length,
        },
        ...(debug
          ? {
              rejectedSample: ranked
                .filter(
                  (candidate) => !candidate.displayEligibility.eligible,
                )
                .slice(0, 30)
                .map((candidate) => ({
                  ticker: candidate.ticker,
                  change: candidate.change,
                  relativeVolume: candidate.relativeVolume,
                  crowdScore: candidate.crowdScore,
                  trapScore: candidate.trapScore,
                  strategyScore: candidate.strategyScore,
                  reasons: candidate.eligibility.reasons,
                })),
            }
          : {}),
        ...(includeContinuation ? { continuationCandidates } : {}),
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
        timestamp: new Date().toISOString(),
      },
      { headers: OPPORTUNITY_CACHE_HEADERS },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to produce opportunities.",
        opportunities: [],
        engineVersion: CANONICAL_OPPORTUNITY_VERSION,
      },
      { status: 500 },
    );
  }
}
