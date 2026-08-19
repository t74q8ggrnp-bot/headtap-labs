// app/api/prox-shadow-board-compare/route.ts
//
// Read-only side-by-side: the latest independent ProX shadow board run
// (prox_shadow_board_runs / prox_shadow_board_members — scored with zero
// canonical inputs, shadow_research_only authority) next to what canonical
// Spot Momentum is showing right now, by ticker. No writes, no effect on
// either system — purely for comparing the two independent opinions.

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
      .select("id, decision_at, completed_at, candidate_count, status")
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
      .select("ticker, decision_price, edge_score, continuation_probability, reward_risk_asymmetry, evidence_confidence, readiness, entry_qualified, role, disposition, rank, disposition_reason")
      .eq("run_id", latestRun.id)
      .order("rank", { ascending: true, nullsFirst: false });
    if (membersError) throw membersError;

    const canonicalRes = await fetch("https://gethtlabs.com/api/opportunities?type=momentum&limit=100");
    const canonicalData = canonicalRes.ok ? await canonicalRes.json() : { opportunities: [] };
    const canonicalByTicker = new Map<string, { tier: string; change: number; opportunityScore: number }>(
      (canonicalData.opportunities ?? []).map((o: { ticker: string; tier: string; change: number; opportunityScore: number }) => [
        o.ticker,
        { tier: o.tier, change: o.change, opportunityScore: o.opportunityScore },
      ]),
    );

    const selected = (members ?? []).filter((m) => m.disposition === "selected");
    const rows = (members ?? []).map((m) => {
      const canonical = canonicalByTicker.get(m.ticker) ?? null;
      return {
        ticker: m.ticker,
        proxRole: m.role,
        proxDisposition: m.disposition,
        proxRank: m.rank,
        proxEdgeScore: m.edge_score,
        proxContinuationProbability: m.continuation_probability,
        proxReadiness: m.readiness,
        proxDispositionReason: m.disposition_reason,
        canonicalTier: canonical?.tier ?? "not_in_top_100",
        canonicalChange: canonical?.change ?? null,
        canonicalOpportunityScore: canonical?.opportunityScore ?? null,
        bothAgreeOnHighConviction: m.disposition === "selected" && (canonical?.tier === "hero" || canonical?.tier === "feature"),
      };
    });

    return NextResponse.json({
      shadowRun: latestRun,
      selectedByProx: selected.map((m) => m.ticker),
      canonicalHero: (canonicalData.opportunities ?? [])[0]?.ticker ?? null,
      rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[prox-shadow-board-compare] failed:", error);
    return NextResponse.json({ error: getErrorMessage(error, "Failed to build shadow board comparison") }, { status: 500 });
  }
}
