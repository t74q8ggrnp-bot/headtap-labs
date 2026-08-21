// app/api/prox-peak-retention-diagnostics/route.ts
//
// Read-only: surfaces the latest ProX shadow board run's per-member
// structure_assessment / edge_assessment JSON so the peak-retention
// component (continuous score, weight, and the separate postPeakFailure
// hard-gate) can be inspected against real current pullback data instead of
// reasoning about the formula in the abstract. No writes.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data: latestRun, error: runError } = await supabase
      .from("prox_shadow_board_runs")
      .select("id, decision_at, hero_ticker")
      .eq("status", "success")
      .order("decision_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) throw runError;
    if (!latestRun) {
      return NextResponse.json({ error: "No completed shadow board run found yet." }, { status: 404 });
    }

    const { data: members, error: membersError } = await supabase
      .from("prox_shadow_board_members")
      .select(
        "ticker, role, disposition, rank, edge_score, continuation_probability, structure_assessment, edge_assessment, hard_failures",
      )
      .eq("run_id", latestRun.id)
      .order("rank", { ascending: true, nullsFirst: false });
    if (membersError) throw membersError;

    const rows = (members ?? []).map((m) => {
      const structure = m.structure_assessment as Record<string, unknown> | null;
      const edge = m.edge_assessment as Record<string, unknown> | null;
      const components = edge?.components as Record<string, unknown> | null;
      return {
        ticker: m.ticker,
        role: m.role,
        disposition: m.disposition,
        rank: m.rank,
        edgeScore: m.edge_score,
        continuationProbability: m.continuation_probability,
        peakRetentionComponent: components?.peakRetention ?? null,
        newsAttentionComponent: components?.newsAttention ?? null,
        edgeVersion: edge?.version ?? null,
        postPeakFailure: structure?.postPeakFailure ?? null,
        severePeakFailure: structure?.severePeakFailure ?? null,
        extended: structure?.extended ?? null,
        hardFailures: m.hard_failures,
      };
    });

    return NextResponse.json({
      runId: latestRun.id,
      decisionAt: latestRun.decision_at,
      heroTicker: latestRun.hero_ticker,
      rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
