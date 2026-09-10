import { createHash } from "node:crypto";
import type { HtChartObject } from "../chart-objects";
import type { AgentPlanLifecycleState, AgentXVisualPlanDefinition } from "./visual-plan";

export const HT_AGENT_VISUAL_PLAN_SYNC_VERSION =
  "agent-x-plan-sync-v1-server-snapshot" as const;

export function visualPlanSyncFingerprint(input: {
  planId: string;
  planVersionId: string;
  versionNumber: number;
  lifecycleState: AgentPlanLifecycleState;
  stateVersion: number;
  stateProviderTimestamp: string;
  definition: AgentXVisualPlanDefinition;
  chartObjects: readonly HtChartObject[];
}) {
  return createHash("sha256").update(JSON.stringify({
    syncVersion: HT_AGENT_VISUAL_PLAN_SYNC_VERSION,
    ...input,
  })).digest("hex");
}
