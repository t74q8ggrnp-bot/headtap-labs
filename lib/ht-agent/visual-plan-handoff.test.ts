import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { validateVisualPlanHandoffIntent } from "./visual-plan-handoff.ts";

const definition = {
  paperOnly: true, executionAuthority: "none", symbol: "SPY", triggerPrice: 501,
  stopPrice: 499, targetOne: 505, positionRisk: { quantity: 10 },
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
