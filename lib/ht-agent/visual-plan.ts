// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_CHART_OBJECT_VERSION, type HtChartObject } from "../chart-objects.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_VISUAL_PLAN_POLICY_VERSION, HT_AGENT_VISUAL_PLAN_VERSION, type HtAgentDecision, type HtAgentDecisionFrame, type HtAgentMode } from "./contracts.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { buildHtTradePlan } from "./trade-plan.ts";

export type AgentPlanLifecycleState =
  | "watching"
  | "triggered"
  | "target_reached"
  | "invalidated"
  | "expired"
  | "needs_review_ambiguous";

export type AgentXVisualPlanDefinition = {
  schemaVersion: typeof HT_AGENT_VISUAL_PLAN_VERSION;
  policyVersion: typeof HT_AGENT_VISUAL_PLAN_POLICY_VERSION;
  decisionId: string;
  frameId: string;
  symbol: string;
  direction: "long";
  lifecycleState: "watching";
  entryCondition: "crosses_above_trigger";
  entryZone: { low: number; high: number };
  triggerPrice: number;
  stopPrice: number;
  targetOne: number;
  targetTwo: number | null;
  estimatedRiskReward: number;
  positionRisk: {
    quantity: number;
    estimatedNotional: number;
    maximumRisk: number;
    riskPolicyVersion: string;
  };
  explanation: {
    whyThisPlanExists: string;
    whatCancelsThisPlan: string;
    riskNote: string;
  };
  provenance: {
    marketProviderAt: string;
    canonicalDecisionAt: string;
    canonicalProviderAt: string | null;
    canonicalSourceRunId: string;
    canonicalLane: "momentum" | "before_crowd" | null;
    proxComputedAt: string | null;
    proxSourceRunId: string | null;
    proxStance: "support" | "warn" | "veto" | "abstain";
    frameVersion: string;
    decisionVersion: string;
  };
  validFrom: string;
  expiresAt: string;
  paperOnly: true;
  executionAuthority: "none";
  chartObjects: HtChartObject[];
};

export type AgentXVisualPlanUnavailableCode =
  | "closed_session"
  | "canonical_unavailable"
  | "prox_veto"
  | "risk_not_allowed"
  | "position_already_open"
  | "levels_unavailable"
  | "timestamp_unavailable"
  | "session_boundary_unavailable";

export type AgentXVisualPlanBuildResult =
  | { available: true; plan: AgentXVisualPlanDefinition }
  | { available: false; code: AgentXVisualPlanUnavailableCode; reason: string };

function finitePositive(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) > 0;
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function nextMinute(timestampMs: number) {
  return Math.ceil(timestampMs / 60_000) * 60_000;
}

export function resolveAgentXVisualPlanExpiration(input: {
  providerTimestamp: string;
  sessionBoundary: string;
}) {
  const providerMs = Date.parse(input.providerTimestamp);
  const boundaryMs = Date.parse(input.sessionBoundary);
  if (!Number.isFinite(providerMs) || !Number.isFinite(boundaryMs) || boundaryMs <= providerMs) {
    return null;
  }
  const fifteenCompletedProviderMinutes = nextMinute(providerMs) + 15 * 60_000;
  return new Date(Math.min(fifteenCompletedProviderMinutes, boundaryMs)).toISOString();
}

function baseObject(input: {
  id: string;
  authority: "prox" | "agent";
  symbol: string;
  label: string;
  sourceKind: "independent_prox_edge" | "agent_x_visual_plan";
  sourceId: string;
  sourceVersion: string;
  marketEvidenceAt: string;
  sourceComputedAt: string | null;
  session: "regular" | "premarket" | "after_hours";
  confidence: number | null;
}) {
  return {
    id: input.id,
    schemaVersion: HT_CHART_OBJECT_VERSION,
    authority: input.authority,
    symbol: input.symbol,
    status: "active" as const,
    label: input.label,
    source: {
      kind: input.sourceKind,
      id: input.sourceId,
      version: input.sourceVersion,
    },
    timing: {
      marketEvidenceAt: input.marketEvidenceAt,
      sourceComputedAt: input.sourceComputedAt,
      session: input.session,
      evidenceInterval: "1m" as const,
      freshness: "fresh" as const,
    },
    confidence: {
      value: input.confidence,
      authority: input.authority === "prox" ? "prox" as const : null,
    },
  };
}

export function buildProxChartContext(
  frame: HtAgentDecisionFrame,
  decisionId: string,
): HtChartObject[] {
  const structure = frame.prox.structure;
  if (
    !structure?.measurable ||
    !frame.prox.runId ||
    !frame.prox.decisionTimestamp ||
    frame.prox.stance === "veto" ||
    frame.market.marketSession === "closed"
  ) return [];
  const common = {
    authority: "prox" as const,
    symbol: frame.market.symbol,
    sourceKind: "independent_prox_edge" as const,
    sourceId: frame.prox.runId,
    sourceVersion: "independent-prox-edge-structure-v1",
    marketEvidenceAt: frame.market.providerTimestamp,
    sourceComputedAt: frame.prox.decisionTimestamp,
    session: frame.market.marketSession,
    confidence: finitePositive(frame.prox.evidenceConfidence)
      ? Math.min(100, frame.prox.evidenceConfidence)
      : null,
  };
  const objects: HtChartObject[] = [];
  if (finitePositive(structure.structuralSupport)) {
    objects.push({
      ...baseObject({ ...common, id: `${decisionId}-prox-support`, label: "ProX support" }),
      type: "price_line",
      role: "support",
      price: rounded(structure.structuralSupport),
    });
  }
  if (finitePositive(structure.resistancePrice)) {
    objects.push({
      ...baseObject({ ...common, id: `${decisionId}-prox-resistance`, label: "ProX resistance" }),
      type: "price_line",
      role: "resistance",
      price: rounded(structure.resistancePrice),
    });
  }
  if (finitePositive(structure.invalidationPrice)) {
    objects.push({
      ...baseObject({ ...common, id: `${decisionId}-prox-invalidation`, label: "ProX invalidation" }),
      type: "price_line",
      role: "stop_invalidation",
      price: rounded(structure.invalidationPrice),
    });
  }
  return objects;
}

export function buildAgentXVisualPlan(input: {
  decisionId: string;
  frame: HtAgentDecisionFrame;
  decision: HtAgentDecision;
  mode: HtAgentMode;
  sessionBoundary: string;
}): AgentXVisualPlanBuildResult {
  const { decisionId, frame, decision, mode } = input;
  if (frame.market.marketSession === "closed") {
    return { available: false, code: "closed_session", reason: "The applicable market session is closed." };
  }
  if (!frame.canonical.eligible) {
    return { available: false, code: "canonical_unavailable", reason: "Canonical did not authorize a current setup." };
  }
  if (frame.prox.stance === "veto") {
    return { available: false, code: "prox_veto", reason: "Independent ProX vetoed the current structure." };
  }
  if (!decision.risk.allowed) {
    return { available: false, code: "risk_not_allowed", reason: "The deterministic paper-risk gate did not authorize the setup." };
  }
  if (frame.paper.symbolPositionQuantity !== 0) {
    return { available: false, code: "position_already_open", reason: "An existing paper position is already being managed." };
  }
  const providerMs = Date.parse(frame.market.providerTimestamp);
  if (!Number.isFinite(providerMs)) {
    return { available: false, code: "timestamp_unavailable", reason: "Provider market time is unavailable." };
  }
  const legacyPlan = buildHtTradePlan(frame, decision, mode);
  const entryZone = legacyPlan.entryZone;
  const trigger = legacyPlan.confirmationTrigger;
  const stop = legacyPlan.invalidation;
  const targetOne = legacyPlan.targetOne;
  const rawTargetTwo = legacyPlan.targetTwo;
  if (
    !entryZone ||
    !finitePositive(entryZone.low) ||
    !finitePositive(entryZone.high) ||
    entryZone.high < entryZone.low ||
    !finitePositive(trigger) ||
    !finitePositive(stop) ||
    !finitePositive(targetOne) ||
    !(stop < entryZone.low && targetOne > Math.max(entryZone.high, trigger) && trigger >= entryZone.low) ||
    (rawTargetTwo !== null && !finitePositive(rawTargetTwo))
  ) {
    return { available: false, code: "levels_unavailable", reason: "Entry, invalidation and target levels are not completely measurable and correctly ordered." };
  }
  const expiresAt = resolveAgentXVisualPlanExpiration({
    providerTimestamp: frame.market.providerTimestamp,
    sessionBoundary: input.sessionBoundary,
  });
  if (!expiresAt) {
    return { available: false, code: "session_boundary_unavailable", reason: "The applicable provider-time session boundary is unavailable." };
  }
  const validFrom = new Date(nextMinute(providerMs)).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(validFrom)) {
    return { available: false, code: "session_boundary_unavailable", reason: "No complete provider minute remains before the applicable session boundary." };
  }
  const riskReward = (targetOne - entryZone.high) / (entryZone.high - stop);
  if (!Number.isFinite(riskReward) || riskReward <= 0) {
    return { available: false, code: "levels_unavailable", reason: "The measurable levels do not form positive reward relative to risk." };
  }
  const objectCommon = {
    authority: "agent" as const,
    symbol: frame.market.symbol,
    sourceKind: "agent_x_visual_plan" as const,
    sourceId: decisionId,
    sourceVersion: HT_AGENT_VISUAL_PLAN_VERSION,
    marketEvidenceAt: frame.market.providerTimestamp,
    sourceComputedAt: frame.capturedAt,
    session: frame.market.marketSession,
    confidence: null,
  };
  // A second target must add information. Equal or lower legacy targets stay
  // explicitly unavailable instead of rendering duplicate chart levels.
  const targetTwo = rawTargetTwo !== null && rawTargetTwo > targetOne
    ? rawTargetTwo
    : null;
  const chartObjects: HtChartObject[] = [
    {
      ...baseObject({ ...objectCommon, id: `${decisionId}-entry-zone`, label: "Entry zone" }),
      type: "price_zone",
      role: "entry_zone",
      low: rounded(entryZone.low),
      high: rounded(entryZone.high),
      validFrom,
      validUntil: expiresAt,
    },
    {
      ...baseObject({ ...objectCommon, id: `${decisionId}-trigger`, label: "Trigger" }),
      type: "price_line",
      role: "entry_trigger",
      price: rounded(trigger),
    },
    {
      ...baseObject({ ...objectCommon, id: `${decisionId}-stop`, label: "Invalidation" }),
      type: "price_line",
      role: "stop_invalidation",
      price: rounded(stop),
    },
    {
      ...baseObject({ ...objectCommon, id: `${decisionId}-target-one`, label: "Target 1" }),
      type: "price_line",
      role: "target_1",
      price: rounded(targetOne),
    },
    ...(targetTwo === null ? [] : [{
      ...baseObject({ ...objectCommon, id: `${decisionId}-target-two`, label: "Target 2" }),
      type: "price_line" as const,
      role: "target_2" as const,
      price: rounded(targetTwo),
    }]),
    ...buildProxChartContext(frame, decisionId),
  ];

  return {
    available: true,
    plan: {
      schemaVersion: HT_AGENT_VISUAL_PLAN_VERSION,
      policyVersion: HT_AGENT_VISUAL_PLAN_POLICY_VERSION,
      decisionId,
      frameId: frame.frameId,
      symbol: frame.market.symbol,
      direction: "long",
      lifecycleState: "watching",
      entryCondition: "crosses_above_trigger",
      entryZone: { low: rounded(entryZone.low), high: rounded(entryZone.high) },
      triggerPrice: rounded(trigger),
      stopPrice: rounded(stop),
      targetOne: rounded(targetOne),
      targetTwo: targetTwo === null ? null : rounded(targetTwo),
      estimatedRiskReward: rounded(riskReward),
      positionRisk: {
        quantity: decision.risk.quantity,
        estimatedNotional: decision.risk.estimatedNotional,
        maximumRisk: decision.risk.maximumRisk,
        riskPolicyVersion: decision.risk.policyVersion,
      },
      explanation: {
        whyThisPlanExists: legacyPlan.whyNow,
        whatCancelsThisPlan: legacyPlan.whatInvalidates,
        riskNote: legacyPlan.whyCouldLose,
      },
      provenance: {
        marketProviderAt: frame.market.providerTimestamp,
        canonicalDecisionAt: frame.canonical.decisionTimestamp,
        canonicalProviderAt: frame.canonical.sourceProviderTimestamp ?? null,
        canonicalSourceRunId: frame.canonical.sourceRunId,
        canonicalLane: frame.canonical.sourceLane ?? null,
        proxComputedAt: frame.prox.decisionTimestamp,
        proxSourceRunId: frame.prox.runId,
        proxStance: frame.prox.stance,
        frameVersion: frame.version,
        decisionVersion: decision.version,
      },
      validFrom,
      expiresAt,
      paperOnly: true,
      executionAuthority: "none",
      chartObjects,
    },
  };
}
