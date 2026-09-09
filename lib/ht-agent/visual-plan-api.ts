import type { HtChartObject } from "@/lib/chart-objects";
import type { AgentPlanLifecycleState, AgentXVisualPlanDefinition } from "./visual-plan";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_AGENT_VISUAL_PLAN_API_VERSION } from "./contracts.ts";

export type AgentXVisualPlanRead = {
  contractVersion: typeof HT_AGENT_VISUAL_PLAN_API_VERSION;
  ok: true;
  symbol: string;
  rolloutMode: "off" | "shadow" | "visible";
  visible: boolean;
  unavailableReason: string | null;
  chartObjects: HtChartObject[];
  plan: null | {
    planId: string;
    planVersionId: string;
    versionNumber: number;
    lifecycleState: AgentPlanLifecycleState;
    stateProviderTimestamp: string;
    lastEvaluatedCandleAt: string | null;
    definition: AgentXVisualPlanDefinition;
    chartObjects: HtChartObject[];
    paperHandoffEligible: boolean;
    paperHandoffReason: string | null;
  };
  servedAt: string;
};

export function visualPlanObjectFreshness(timestamp: string, nowMs = Date.now()) {
  const providerMs = Date.parse(timestamp);
  const ageMs = nowMs - providerMs;
  if (!Number.isFinite(providerMs) || !Number.isFinite(nowMs) || ageMs < -5_000 || ageMs > 5 * 60_000) {
    return "stale" as const;
  }
  if (ageMs > 2 * 60_000) return "aging" as const;
  return "fresh" as const;
}

export function visualPlanPaperUrl(input: {
  symbol: string;
  planVersionId: string;
}) {
  const query = new URLSearchParams({
    symbol: input.symbol,
    source: "ht_agent",
    agentPlanVersion: input.planVersionId,
  });
  return `/paper?${query.toString()}`;
}
