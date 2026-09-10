import { createHash } from "node:crypto";

export const HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION =
  "agent-x-visual-plan-generator-v2-risk-reward-cancellation" as const;

export function visualPlanIdempotencyKey(input: {
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
