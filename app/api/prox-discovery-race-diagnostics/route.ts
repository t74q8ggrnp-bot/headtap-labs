// app/api/prox-discovery-race-diagnostics/route.ts
//
// Read-only: surfaces the last few prox_market_discovery_runs rows exactly
// as system-health sees them, regardless of status/complete, plus the exact
// observation-count comparison used by prox_direct_market_discovery and
// prox_security_type_routing. Exists to catch the recurring flash-then-clear
// pattern on those two checks in the act -- is the most recent run simply
// not complete yet at read time, is it aging out, or is expected/persisted/
// actual count mismatched. No writes.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";
import { PROX_MARKET_DISCOVERY_VERSION } from "@/lib/prox/market-discovery";

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
    const now = new Date();

    const { data: recentRuns, error: recentError } = await supabase
      .from("prox_market_discovery_runs")
      .select(
        "id,started_at,completed_at,status,complete,engine_version,snapshot_count,expected_observation_count,persisted_observation_count",
      )
      .order("started_at", { ascending: false })
      .limit(5);
    if (recentError) throw recentError;

    const { data: latestComplete, error: latestError } = await supabase
      .from("prox_market_discovery_runs")
      .select("id,started_at,completed_at,status,complete,engine_version")
      .eq("engine_version", PROX_MARKET_DISCOVERY_VERSION)
      .eq("status", "success")
      .eq("complete", true)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    let actualCount: number | null = null;
    if (latestComplete) {
      const { count, error: countError } = await supabase
        .from("prox_market_discovery_observations")
        .select("*", { count: "exact", head: true })
        .eq("run_id", latestComplete.id);
      if (countError) throw countError;
      actualCount = count ?? 0;
    }

    return NextResponse.json({
      now: now.toISOString(),
      expectedEngineVersion: PROX_MARKET_DISCOVERY_VERSION,
      recentRuns: (recentRuns ?? []).map((r) => ({
        ...r,
        ageMinutesFromCompletedAt: r.completed_at
          ? Number(((now.getTime() - new Date(r.completed_at).getTime()) / 60000).toFixed(2))
          : null,
        ageMinutesFromStartedAt: r.started_at
          ? Number(((now.getTime() - new Date(r.started_at).getTime()) / 60000).toFixed(2))
          : null,
      })),
      latestCompleteMatchingHealthCheckQuery: latestComplete
        ? {
            ...latestComplete,
            ageMinutes: latestComplete.completed_at
              ? Number(
                  ((now.getTime() - new Date(latestComplete.completed_at).getTime()) / 60000).toFixed(2),
                )
              : null,
            actualObservationCount: actualCount,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, "Unknown error.") },
      { status: 500 },
    );
  }
}
