import "server-only";

import { createHash } from "node:crypto";
import type { PaperServerContext } from "@/lib/paper-trading/server";
import type { HtAgentDecision, HtAgentDecisionFrame, HtAgentMode } from "./contracts";
import { getHtAgentVisualPlanSessionBoundary } from "./time";
import { buildAgentXVisualPlan } from "./visual-plan";
import { visualPlanSymbolInScope } from "./visual-plan-rollout";

export const HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION =
  "agent-x-visual-plan-generator-v1" as const;

function definitionHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyKey(input: {
  profileId: string;
  frameHash: string;
  decisionId: string;
}) {
  return createHash("sha256").update([
    input.profileId,
    input.frameHash,
    input.decisionId,
    HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION,
  ].join("|")).digest("hex");
}

export async function persistAgentXVisualPlan(input: {
  context: PaperServerContext;
  profileId: string;
  decisionId: string;
  frameHash: string;
  frame: HtAgentDecisionFrame;
  decision: HtAgentDecision;
  mode: HtAgentMode;
}) {
  const { context, frame, decision } = input;
  const gate = await context.service.from("ht_agent_global_control")
    .select("visual_plan_mode,visual_plan_symbol_scope")
    .eq("id", "global")
    .single();
  if (gate.error) {
    if (["PGRST204", "PGRST205", "42703"].includes(gate.error.code ?? "")) {
      return { created: false, reason: "phase2_migration_unavailable" };
    }
    throw gate.error;
  }
  if (gate.data.visual_plan_mode === "off") {
    return { created: false, reason: "visual_plan_mode_off" };
  }
  if (!visualPlanSymbolInScope(gate.data.visual_plan_symbol_scope, frame.market.symbol)) {
    return { created: false, reason: "symbol_out_of_scope" };
  }
  const sessionBoundary = getHtAgentVisualPlanSessionBoundary(
    frame.market.providerTimestamp,
    frame.market.marketSession,
  );
  const result = buildAgentXVisualPlan({
    decisionId: input.decisionId,
    frame,
    decision,
    mode: input.mode,
    sessionBoundary: sessionBoundary ?? "",
  });
  if (!result.available) {
    const journal = await context.service.from("ht_agent_decision_events").insert({
      decision_id: input.decisionId,
      profile_id: input.profileId,
      user_id: context.user.id,
      event_type: "visual_plan_unavailable",
      detail: {
        code: result.code,
        reason: result.reason,
        generator_version: HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION,
      },
    });
    if (journal.error) throw journal.error;
    return { created: false, reason: result.code };
  }
  const hash = definitionHash(result.plan);
  const persisted = await context.service.rpc("ht_agent_create_visual_plan", {
    p_decision_id: input.decisionId,
    p_frame_id: frame.frameId,
    p_idempotency_key: idempotencyKey({
      profileId: input.profileId,
      frameHash: input.frameHash,
      decisionId: input.decisionId,
    }),
    p_definition_hash: hash,
    p_generator_version: HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION,
    p_definition: result.plan,
  });
  if (persisted.error) {
    // Phase 1 must continue to work until the forward-only Phase 2 migration
    // is installed. Any other database error remains release-blocking.
    if (persisted.error.code === "PGRST202" || persisted.error.code === "42883") {
      return { created: false, reason: "phase2_migration_unavailable" };
    }
    throw persisted.error;
  }
  return persisted.data as Record<string, unknown>;
}
