export type AgentTargetPlanRow = {
  id: string;
  canonicalLane: string;
  targetTwo: number | null;
};

export type AgentTargetEventRow = {
  planVersionId: string;
  eventType: string;
  detail: Record<string, unknown>;
};

function ratePercent(numerator: number, denominator: number) {
  return denominator === 0
    ? null
    : Math.round(numerator / denominator * 10_000) / 100;
}

function summarize(
  plans: AgentTargetPlanRow[],
  events: AgentTargetEventRow[],
) {
  const planIds = new Set(plans.map((row) => row.id));
  const matchingEvents = events.filter((event) => planIds.has(event.planVersionId));
  const withEvent = (eventType: string) => new Set(
    matchingEvents
      .filter((event) => event.eventType === eventType)
      .map((event) => event.planVersionId),
  );
  const triggered = withEvent("entry_triggered");
  const targetOne = withEvent("target_reached");
  const targetTwo = new Set(
    matchingEvents
      .filter((event) =>
        event.eventType === "target_reached" &&
        event.detail.targetTwoReached === true)
      .map((event) => event.planVersionId),
  );
  const invalidated = withEvent("plan_invalidated");
  const expired = withEvent("plan_expired");
  const ambiguous = withEvent("price_order_ambiguous");
  const terminal = new Set([
    ...targetOne,
    ...invalidated,
    ...expired,
    ...ambiguous,
  ]);
  const targetTwoAvailableIds = new Set(
    plans.filter((row) => row.targetTwo !== null).map((row) => row.id),
  );
  const triggeredWithTargetTwo = [...triggered].filter((id) =>
    targetTwoAvailableIds.has(id));
  return {
    planCount: plans.length,
    triggeredPlanCount: triggered.size,
    targetOneReachedPlanCount: targetOne.size,
    targetOneReachedAfterTriggerRatePercent: ratePercent(
      [...targetOne].filter((id) => triggered.has(id)).length,
      triggered.size,
    ),
    targetTwoAvailablePlanCount: targetTwoAvailableIds.size,
    targetTwoReachedPlanCount: targetTwo.size,
    targetTwoReachedAfterTriggerRatePercent: ratePercent(
      [...targetTwo].filter((id) => triggered.has(id)).length,
      triggeredWithTargetTwo.length,
    ),
    invalidatedPlanCount: invalidated.size,
    expiredPlanCount: expired.size,
    ambiguousPlanCount: ambiguous.size,
    unresolvedPlanCount: plans.filter((row) => !terminal.has(row.id)).length,
  };
}

export function summarizeAgentTargetCalibration(
  plans: AgentTargetPlanRow[],
  events: AgentTargetEventRow[],
) {
  const lanes = [...new Set(plans.map((row) => row.canonicalLane))];
  return {
    version: "agent-x-target-calibration-v1" as const,
    authority: "paper_only_research" as const,
    outcomePolicy: {
      targetOne: "immutable_target_reached_lifecycle_event",
      targetTwo: "target_two_reached_flag_on_the_target_event",
      ambiguous: "excluded_from_target_success",
      missing: "unresolved_not_failure",
    },
    allPlans: summarize(plans, events),
    byCanonicalLane: lanes.sort().map((lane) => ({
      lane,
      ...summarize(plans.filter((row) => row.canonicalLane === lane), events),
    })),
    note: "This describes deterministic visual-plan lifecycle evidence. It does not change targets, risk gates, Paper behavior, or execution authority.",
  };
}
