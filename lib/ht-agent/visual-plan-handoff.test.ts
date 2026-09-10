import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { validateVisualPlanHandoffIntent } from "./visual-plan-handoff.ts";

const definition = {
  schemaVersion: "agent-x-visual-paper-plan-v2", policyVersion: "agent-x-visual-plan-expiry-v1-15-provider-minutes",
  paperOnly: true, executionAuthority: "none", symbol: "SPY", triggerPrice: 501,
  entryZone: { low: 500, high: 501 }, stopPrice: 499, targetOne: 505, targetTwo: null,
  riskReward: { policyVersion: "agent-x-risk-reward-v1-least-favorable-entry", entryBasis: "least_favorable_permitted_entry", entryPrice: 501, riskPerShare: 2, targetOne: 2, targetTwo: null },
  estimatedRiskReward: 2,
  validFrom: "2026-09-09T13:31:00.000Z", expiresAt: "2026-09-09T13:46:00.000Z",
  cancellation: { policyVersion: "agent-x-cancellation-v1-provider-minute", conditions: [
    { code: "stop_touched", evidence: "completed_provider_minute", field: "low", operator: "lte", value: 499, transition: "invalidated" },
    { code: "plan_expiration_reached", evidence: "completed_provider_minute", field: "closedAt", operator: "gte", value: "2026-09-09T13:46:00.000Z", transition: "expired" },
    { code: "intraminute_order_unprovable", evidence: "completed_provider_minute", field: "high_low_range", operator: "contains_conflicting_thresholds", value: null, transition: "needs_review_ambiguous" },
  ] },
  positionRisk: { quantity: 10 },
  chartObjects: [{ authority: "agent", timing: { session: "regular" } }],
};
const intent = {
  symbol: "SPY", side: "buy", orderType: "stop", timeInForce: "day", quantity: 10,
  limitPrice: null, stopPrice: 501, allowExtendedHours: false, takeProfitPrice: 505,
  stopLossPrice: 499, strategySource: "ht_agent",
};

test("watching plan handoff preserves trigger, bracket and maximum size", () => {
  assert.equal(validateVisualPlanHandoffIntent({ intent, definition, lifecycleState: "watching" } as never).ok, true);
  assert.equal(validateVisualPlanHandoffIntent({ intent: { ...intent, quantity: 11 }, definition, lifecycleState: "watching" } as never).ok, false);
  assert.equal(validateVisualPlanHandoffIntent({ intent: { ...intent, stopLossPrice: 498 }, definition, lifecycleState: "watching" } as never).ok, false);
  assert.equal(validateVisualPlanHandoffIntent({ intent: { ...intent, allowExtendedHours: true }, definition, lifecycleState: "watching" } as never).ok, false);
});

test("triggered plan handoff is market-paper-only and terminal states fail closed", () => {
  const market = { ...intent, orderType: "market", stopPrice: null };
  assert.equal(validateVisualPlanHandoffIntent({ intent: market, definition, lifecycleState: "triggered" } as never).ok, true);
  assert.equal(validateVisualPlanHandoffIntent({ intent: market, definition, lifecycleState: "needs_review_ambiguous" } as never).ok, false);
});
