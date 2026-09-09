import type { AgentPlanLifecycleState } from "./visual-plan";

export const HT_AGENT_PLAN_LIFECYCLE_VERSION = "agent-x-plan-lifecycle-v1-provider-minute" as const;

export type AgentPlanMinuteEvidence = {
  symbol: string;
  openedAt: string;
  closedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "massive_polygon_minute_aggregate";
};

export type AgentPlanLifecycleSnapshot = {
  state: AgentPlanLifecycleState;
  stateVersion: number;
  validFrom: string;
  expiresAt: string;
  lastEvaluatedCandleAt: string | null;
  entryCondition: "crosses_above_trigger";
  triggerPrice: number;
  stopPrice: number;
  targetOne: number;
  targetTwo: number | null;
};

export type AgentPlanLifecycleEvaluation =
  | {
      kind: "transition";
      from: AgentPlanLifecycleState;
      to: AgentPlanLifecycleState;
      event:
        | "entry_triggered"
        | "target_reached"
        | "plan_invalidated"
        | "plan_expired"
        | "price_order_ambiguous";
      providerTimestamp: string;
      price: number | null;
      detail: Record<string, unknown>;
    }
  | { kind: "no_change"; evaluatedAt: string; detail: Record<string, unknown> }
  | { kind: "ignored"; reason: "terminal" | "pre_plan" | "duplicate_or_out_of_order" }
  | { kind: "rejected"; reason: "invalid_evidence" | "symbol_mismatch" };

const TERMINAL_STATES = new Set<AgentPlanLifecycleState>([
  "target_reached",
  "invalidated",
  "expired",
  "needs_review_ambiguous",
]);

function validEvidence(evidence: AgentPlanMinuteEvidence) {
  const openedAt = Date.parse(evidence.openedAt);
  const closedAt = Date.parse(evidence.closedAt);
  return Number.isFinite(openedAt) && Number.isFinite(closedAt) &&
    closedAt - openedAt === 60_000 &&
    [evidence.open, evidence.high, evidence.low, evidence.close].every(
      (value) => Number.isFinite(value) && value > 0,
    ) && evidence.high >= Math.max(evidence.open, evidence.close, evidence.low) &&
    evidence.low <= Math.min(evidence.open, evidence.close, evidence.high) &&
    Number.isFinite(evidence.volume) && evidence.volume >= 0;
}

function transition(
  snapshot: AgentPlanLifecycleSnapshot,
  evidence: AgentPlanMinuteEvidence,
  to: AgentPlanLifecycleState,
  event: Extract<AgentPlanLifecycleEvaluation, { kind: "transition" }>["event"],
  price: number | null,
  detail: Record<string, unknown> = {},
): AgentPlanLifecycleEvaluation {
  return {
    kind: "transition",
    from: snapshot.state,
    to,
    event,
    providerTimestamp: evidence.closedAt,
    price,
    detail: {
      lifecycleVersion: HT_AGENT_PLAN_LIFECYCLE_VERSION,
      candleOpenedAt: evidence.openedAt,
      candleClosedAt: evidence.closedAt,
      ...detail,
    },
  };
}

export function evaluateAgentPlanMinute(
  snapshot: AgentPlanLifecycleSnapshot & { symbol: string },
  evidence: AgentPlanMinuteEvidence,
): AgentPlanLifecycleEvaluation {
  if (snapshot.symbol !== evidence.symbol) return { kind: "rejected", reason: "symbol_mismatch" };
  if (!validEvidence(evidence)) return { kind: "rejected", reason: "invalid_evidence" };
  if (TERMINAL_STATES.has(snapshot.state)) return { kind: "ignored", reason: "terminal" };
  const candleOpenedAt = Date.parse(evidence.openedAt);
  const candleClosedAt = Date.parse(evidence.closedAt);
  const validFrom = Date.parse(snapshot.validFrom);
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt)) {
    return { kind: "rejected", reason: "invalid_evidence" };
  }
  if (candleClosedAt <= validFrom) return { kind: "ignored", reason: "pre_plan" };
  const lastEvaluated = snapshot.lastEvaluatedCandleAt
    ? Date.parse(snapshot.lastEvaluatedCandleAt)
    : Number.NEGATIVE_INFINITY;
  if (candleClosedAt <= lastEvaluated) {
    return { kind: "ignored", reason: "duplicate_or_out_of_order" };
  }

  // Expiration is minute-aligned. A candle that starts after the boundary
  // proves immediate expiry; the final candle ending at the boundary is still
  // evaluated before it closes the plan.
  if (candleOpenedAt >= expiresAt) {
    return transition(snapshot, evidence, "expired", "plan_expired", null);
  }

  const touchesStop = evidence.low <= snapshot.stopPrice;
  const touchesTrigger = evidence.high >= snapshot.triggerPrice;
  const touchesTarget = evidence.high >= snapshot.targetOne;
  const completesExpirationWindow = candleClosedAt >= expiresAt;

  if (snapshot.state === "watching") {
    if (touchesTrigger && (touchesStop || touchesTarget)) {
      return transition(
        snapshot,
        evidence,
        "needs_review_ambiguous",
        "price_order_ambiguous",
        null,
        { touchesTrigger, touchesStop, touchesTarget },
      );
    }
    if (touchesStop) {
      return transition(snapshot, evidence, "invalidated", "plan_invalidated", snapshot.stopPrice);
    }
    // A trigger first proven by the final completed minute cannot leave an
    // actionable plan alive beyond its provider-time expiry. Preserve that
    // evidence in the terminal event without carrying the plan overnight.
    if (touchesTrigger && completesExpirationWindow) {
      return transition(snapshot, evidence, "expired", "plan_expired", null, {
        triggerObservedAtExpiration: true,
      });
    }
    if (touchesTrigger) {
      return transition(snapshot, evidence, "triggered", "entry_triggered", snapshot.triggerPrice);
    }
    if (completesExpirationWindow) {
      return transition(snapshot, evidence, "expired", "plan_expired", null);
    }
  }

  if (snapshot.state === "triggered") {
    if (touchesStop && touchesTarget) {
      return transition(
        snapshot,
        evidence,
        "needs_review_ambiguous",
        "price_order_ambiguous",
        null,
        { touchesStop, touchesTarget },
      );
    }
    if (touchesStop) {
      return transition(snapshot, evidence, "invalidated", "plan_invalidated", snapshot.stopPrice);
    }
    if (touchesTarget) {
      return transition(snapshot, evidence, "target_reached", "target_reached", snapshot.targetOne, {
        targetOneReached: true,
        targetTwoReached: snapshot.targetTwo !== null && evidence.high >= snapshot.targetTwo,
      });
    }
    if (completesExpirationWindow) {
      return transition(snapshot, evidence, "expired", "plan_expired", null);
    }
  }

  return {
    kind: "no_change",
    evaluatedAt: evidence.closedAt,
    detail: { lifecycleVersion: HT_AGENT_PLAN_LIFECYCLE_VERSION },
  };
}

export function lifecycleTransitionAllowed(
  from: AgentPlanLifecycleState,
  to: AgentPlanLifecycleState,
) {
  if (from === "watching") {
    return ["triggered", "invalidated", "expired", "needs_review_ambiguous"].includes(to);
  }
  if (from === "triggered") {
    return ["target_reached", "invalidated", "expired", "needs_review_ambiguous"].includes(to);
  }
  return false;
}
