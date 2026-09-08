import type { SupabaseClient } from "@supabase/supabase-js";

type RunCompletion = {
  decisionCount: number;
  orderCount: number;
  diagnostics: Record<string, unknown>;
};

async function persistRunState(
  service: SupabaseClient,
  runId: string,
  values: Record<string, unknown>,
) {
  const result = await service.from("ht_agent_runs")
    .update(values)
    .eq("id", runId)
    .eq("status", "running")
    .select("id,status")
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error("HT Agent run finalization did not match one running cycle.");
  }
  return result.data;
}

export async function completeHtAgentRun(
  service: SupabaseClient,
  runId: string,
  completion: RunCompletion,
) {
  return persistRunState(service, runId, {
    status: "success",
    completed_at: new Date().toISOString(),
    decision_count: completion.decisionCount,
    order_count: completion.orderCount,
    diagnostics: completion.diagnostics,
  });
}

export async function failHtAgentRun(
  service: SupabaseClient,
  runId: string,
  message: string,
) {
  return persistRunState(service, runId, {
    status: "failed",
    completed_at: new Date().toISOString(),
    error_message: message.slice(0, 500),
  });
}
