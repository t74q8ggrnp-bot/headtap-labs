import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getPaperServiceClient, type PaperServerContext } from "@/lib/paper-trading/server";
import { runHtAgentCycle } from "@/lib/ht-agent/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const service = getPaperServiceClient();
  const profiles = await service.from("ht_agent_profiles")
    .select("user_id,mode,status,kill_switch")
    .eq("status", "active");
  if (profiles.error) return NextResponse.json({ ok: false, error: profiles.error.message }, { status: 503 });
  const results: Array<Record<string, unknown>> = [];
  for (const profile of profiles.data ?? []) {
    const context: PaperServerContext = {
      service,
      user: { id: profile.user_id } as User,
    };
    try {
      results.push({ userId: profile.user_id, ...(await runHtAgentCycle(context)) });
    } catch (error) {
      results.push({ userId: profile.user_id, error: error instanceof Error ? error.message : "Cycle failed" });
    }
  }
  return NextResponse.json({
    ok: results.every((result) => !result.error),
    authority: "ht_labs_paper_only",
    liveBrokerage: false,
    profiles: results.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
