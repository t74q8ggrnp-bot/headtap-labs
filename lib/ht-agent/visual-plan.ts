// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_CHART_OBJECT_VERSION, type HtChartObject } from "../chart-objects.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_VISUAL_PLAN_CANCELLATION_VERSION, HT_AGENT_VISUAL_PLAN_POLICY_VERSION, HT_AGENT_VISUAL_PLAN_RISK_REWARD_VERSION, HT_AGENT_VISUAL_PLAN_VERSION, type HtAgentDecision, type HtAgentDecisionFrame, type HtAgentMode } from "./contracts.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { buildHtTradePlan } from "./trade-plan.ts";

export type AgentPlanLifecycleState =
  | "watching"
  | "triggered"
  | "target_reached"
  | "invalidated"
  | "expired"
  | "needs_review_ambiguous";

export type AgentPlanCancellationCondition =
  | {
      code: "stop_touched";
      evidence: "completed_provider_minute";
      field: "low";
      operator: "lte";
      value: number;
      transition: "invalidated";
    }
  | {
      code: "plan_expiration_reached";
      evidence: "completed_provider_minute";
      field: "closedAt";
      operator: "gte";
      value: string;
      transition: "expired";
    }
  | {
      code: "intraminute_order_unprovable";
      evidence: "completed_provider_minute";
      field: "high_low_range";
      operator: "contains_conflicting_thresholds";
      value: null;
      transition: "needs_review_ambiguous";
    };

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
  riskReward: {
    policyVersion: typeof HT_AGENT_VISUAL_PLAN_RISK_REWARD_VERSION;
    entryBasis: "least_favorable_permitted_entry";
    entryPrice: number;
    riskPerShare: number;
    targetOne: number;
    targetTwo: number | null;
  };
  /** Backward-compatible alias for Target 1 R/R. */
  estimatedRiskReward: number;
  cancellation: {
    policyVersion: typeof HT_AGENT_VISUAL_PLAN_CANCELLATION_VERSION;
    conditions: AgentPlanCancellationCondition[];
  };
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

function riskRewardAtTarget(target: number, leastFavorableEntry: number, stop: number) {
  return (target - leastFavorableEntry) / (leastFavorableEntry - stop);
}

export function visualPlanCancellationContractMatches(
  definition: Pick<AgentXVisualPlanDefinition, "stopPrice" | "expiresAt" | "cancellation">,
) {
  const conditions = definition.cancellation?.conditions;
  if (
    definition.cancellation?.policyVersion !== HT_AGENT_VISUAL_PLAN_CANCELLATION_VERSION ||
    !Array.isArray(conditions) ||
    conditions.length !== 3
  ) return false;
  const [stop, expiration, ambiguous] = conditions;
  return stop?.code === "stop_touched" &&
    stop.evidence === "completed_provider_minute" &&
    stop.field === "low" &&
    stop.operator === "lte" &&
    stop.transition === "invalidated" &&
    stop.value === definition.stopPrice &&
    expiration?.code === "plan_expiration_reached" &&
    expiration.evidence === "completed_provider_minute" &&
    expiration.field === "closedAt" &&
    expiration.operator === "gte" &&
    expiration.transition === "expired" &&
    expiration.value === definition.expiresAt &&
    ambiguous?.code === "intraminute_order_unprovable" &&
    ambiguous.evidence === "completed_provider_minute" &&
    ambiguous.field === "high_low_range" &&
    ambiguous.operator === "contains_conflicting_thresholds" &&
    ambiguous.transition === "needs_review_ambiguous" &&
    ambiguous.value === null;
}

function sameRoundedNumber(left: unknown, right: number) {
  return typeof left === "number" && Number.isFinite(left) &&
    Math.abs(left - rounded(right)) <= 0.000001;
}

export function visualPlanReleaseContractMatches(
  definition: AgentXVisualPlanDefinition,
) {
  if (
    definition?.schemaVersion !== HT_AGENT_VISUAL_PLAN_VERSION ||
    definition.policyVersion !== HT_AGENT_VISUAL_PLAN_POLICY_VERSION ||
    definition.riskReward?.policyVersion !== HT_AGENT_VISUAL_PLAN_RISK_REWARD_VERSION ||
    definition.riskReward.entryBasis !== "least_favorable_permitted_entry" ||
    !finitePositive(definition.entryZone?.low) ||
    !finitePositive(definition.entryZone?.high) ||
    !finitePositive(definition.triggerPrice) ||
    !finitePositive(definition.stopPrice) ||
    !finitePositive(definition.targetOne) ||
    definition.entryZone.high < definition.entryZone.low ||
    definition.stopPrice >= definition.entryZone.low ||
    definition.triggerPrice < definition.entryZone.low ||
    definition.targetOne <= Math.max(definition.entryZone.high, definition.triggerPrice) ||
    !visualPlanCancellationContractMatches(definition)
  ) return false;
  const leastFavorableEntry = Math.max(
    definition.entryZone.high,
    definition.triggerPrice,
  );
  const riskPerShare = leastFavorableEntry - definition.stopPrice;
  const targetOneRiskReward = riskRewardAtTarget(
    definition.targetOne,
    leastFavorableEntry,
    definition.stopPrice,
  );
  if (
    !sameRoundedNumber(definition.riskReward.entryPrice, leastFavorableEntry) ||
    !sameRoundedNumber(definition.riskReward.riskPerShare, riskPerShare) ||
    !sameRoundedNumber(definition.riskReward.targetOne, targetOneRiskReward) ||
    !sameRoundedNumber(definition.estimatedRiskReward, targetOneRiskReward)
  ) return false;
  if (definition.targetTwo === null) return definition.riskReward.targetTwo === null;
  return definition.targetTwo > definition.targetOne &&
    sameRoundedNumber(
      definition.riskReward.targetTwo,
      riskRewardAtTarget(definition.targetTwo, leastFavorableEntry, definition.stopPrice),
    );
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
  const roundedEntryHigh = rounded(entryZone.high);
  const roundedTrigger = rounded(trigger);
  const roundedStop = rounded(stop);
  const roundedTargetOne = rounded(targetOne);
  const candidateTargetTwo = rawTargetTwo === null ? null : rounded(rawTargetTwo);
  const roundedTargetTwo = candidateTargetTwo !== null && candidateTargetTwo > roundedTargetOne
    ? candidateTargetTwo
    : null;
  const leastFavorableEntry = Math.max(roundedEntryHigh, roundedTrigger);
  const riskPerShare = leastFavorableEntry - roundedStop;
  const targetOneRiskReward = riskRewardAtTarget(roundedTargetOne, leastFavorableEntry, roundedStop);
  const targetTwoRiskReward = roundedTargetTwo === null
    ? null
    : riskRewardAtTarget(roundedTargetTwo, leastFavorableEntry, roundedStop);
  if (
    !Number.isFinite(riskPerShare) || riskPerShare <= 0 ||
    !Number.isFinite(targetOneRiskReward) || targetOneRiskReward <= 0 ||
    (targetTwoRiskReward !== null && (!Number.isFinite(targetTwoRiskReward) || targetTwoRiskReward <= targetOneRiskReward))
  ) {
    return { available: false, code: "levels_unavailable", reason: "The measurable levels do not form positive reward relative to risk." };
  }
  const cancellation: AgentXVisualPlanDefinition["cancellation"] = {
    policyVersion: HT_AGENT_VISUAL_PLAN_CANCELLATION_VERSION,
    conditions: [
      {
        code: "stop_touched",
        evidence: "completed_provider_minute",
        field: "low",
        operator: "lte",
        value: roundedStop,
        transition: "invalidated",
      },
      {
        code: "plan_expiration_reached",
        evidence: "completed_provider_minute",
        field: "closedAt",
        operator: "gte",
        value: expiresAt,
        transition: "expired",
      },
      {
        code: "intraminute_order_unprovable",
        evidence: "completed_provider_minute",
        field: "high_low_range",
        operator: "contains_conflicting_thresholds",
        value: null,
        transition: "needs_review_ambiguous",
      },
    ],
  };
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
    ...(roundedTargetTwo === null ? [] : [{
      ...baseObject({ ...objectCommon, id: `${decisionId}-target-two`, label: "Target 2" }),
      type: "price_line" as const,
      role: "target_2" as const,
      price: roundedTargetTwo,
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
      entryZone: { low: rounded(entryZone.low), high: roundedEntryHigh },
      triggerPrice: roundedTrigger,
      stopPrice: roundedStop,
      targetOne: roundedTargetOne,
      targetTwo: roundedTargetTwo,
      riskReward: {
        policyVersion: HT_AGENT_VISUAL_PLAN_RISK_REWARD_VERSION,
        entryBasis: "least_favorable_permitted_entry",
        entryPrice: rounded(leastFavorableEntry),
        riskPerShare: rounded(riskPerShare),
        targetOne: rounded(targetOneRiskReward),
        targetTwo: targetTwoRiskReward === null ? null : rounded(targetTwoRiskReward),
      },
      estimatedRiskReward: rounded(targetOneRiskReward),
      cancellation,
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
