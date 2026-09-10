import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { evaluateAgentPlanMinute, lifecycleTransitionAllowed } from "./plan-lifecycle.ts";

const cancellation = {
  policyVersion: "agent-x-cancellation-v1-provider-minute" as const,
  conditions: [
    { code: "stop_touched" as const, evidence: "completed_provider_minute" as const, field: "low" as const, operator: "lte" as const, value: 9.5, transition: "invalidated" as const },
    { code: "plan_expiration_reached" as const, evidence: "completed_provider_minute" as const, field: "closedAt" as const, operator: "gte" as const, value: "2026-09-09T13:46:00.000Z", transition: "expired" as const },
    { code: "intraminute_order_unprovable" as const, evidence: "completed_provider_minute" as const, field: "high_low_range" as const, operator: "contains_conflicting_thresholds" as const, value: null, transition: "needs_review_ambiguous" as const },
  ],
};

const snapshot = {
  symbol: "TEST",
  state: "watching" as const,
  stateVersion: 0,
  validFrom: "2026-09-09T13:30:20.000Z",
  expiresAt: "2026-09-09T13:46:00.000Z",
  lastEvaluatedCandleAt: null,
  entryCondition: "crosses_above_trigger" as const,
  triggerPrice: 10,
  stopPrice: 9.5,
  targetOne: 11,
  targetTwo: 12,
  cancellation,
};

function candle(values: Partial<{ openedAt: string; closedAt: string; open: number; high: number; low: number; close: number; volume: number }> = {}) {
  return {
    symbol: "TEST",
    openedAt: "2026-09-09T13:31:00.000Z",
    closedAt: "2026-09-09T13:32:00.000Z",
    open: 9.8,
    high: 10.1,
    low: 9.7,
    close: 10.05,
    volume: 10_000,
    source: "massive_polygon_minute_aggregate" as const,
    ...values,
  };
}

test("transitions watching to triggered on unambiguous completed provider evidence", () => {
  const result = evaluateAgentPlanMinute(snapshot, candle());
  assert.equal(result.kind, "transition");
  if (result.kind === "transition") {
    assert.equal(result.from, "watching");
    assert.equal(result.to, "triggered");
    assert.equal(result.providerTimestamp, "2026-09-09T13:32:00.000Z");
  }
});

test("records a completed provider minute without forcing a lifecycle transition", () => {
  const result = evaluateAgentPlanMinute(snapshot, candle({ high: 9.9, close: 9.85 }));
  assert.equal(result.kind, "no_change");
  if (result.kind === "no_change") {
    assert.equal(result.evaluatedAt, "2026-09-09T13:32:00.000Z");
  }
});

test("fails closed when the first trigger candle also touches stop or target", () => {
  for (const evidence of [
    candle({ low: 9.4 }),
    candle({ high: 11.2 }),
    candle({ low: 9.4, high: 11.2 }),
  ]) {
    const result = evaluateAgentPlanMinute(snapshot, evidence);
    assert.equal(result.kind, "transition");
    if (result.kind === "transition") assert.equal(result.to, "needs_review_ambiguous");
  }
});

test("resolves triggered plans without inferring ordering inside an ambiguous candle", () => {
  const triggered = { ...snapshot, state: "triggered" as const, stateVersion: 1 };
  assert.equal((evaluateAgentPlanMinute(triggered, candle({ high: 11.1 })) as { to: string }).to, "target_reached");
  assert.equal((evaluateAgentPlanMinute(triggered, candle({ high: 10.4, low: 9.4 })) as { to: string }).to, "invalidated");
  assert.equal((evaluateAgentPlanMinute(triggered, candle({ high: 11.1, low: 9.4 })) as { to: string }).to, "needs_review_ambiguous");
});

test("ignores pre-plan, duplicate, out-of-order and terminal evidence", () => {
  assert.deepEqual(evaluateAgentPlanMinute(snapshot, candle({
    openedAt: "2026-09-09T13:29:00.000Z",
    closedAt: "2026-09-09T13:30:00.000Z",
  })), { kind: "ignored", reason: "pre_plan" });
  assert.deepEqual(evaluateAgentPlanMinute({ ...snapshot, lastEvaluatedCandleAt: "2026-09-09T13:32:00.000Z" }, candle()), {
    kind: "ignored",
    reason: "duplicate_or_out_of_order",
  });
  assert.deepEqual(evaluateAgentPlanMinute({ ...snapshot, state: "expired" }, candle()), {
    kind: "ignored",
    reason: "terminal",
  });
});

test("expires on the final completed provider minute without carrying into a later session", () => {
  const result = evaluateAgentPlanMinute(snapshot, candle({
    openedAt: "2026-09-09T13:45:00.000Z",
    closedAt: "2026-09-09T13:46:00.000Z",
    high: 9.9,
    close: 9.85,
  }));
  assert.equal(result.kind, "transition");
  if (result.kind === "transition") assert.equal(result.to, "expired");
});

test("a trigger first proven at expiration is recorded but cannot keep the plan active", () => {
  const result = evaluateAgentPlanMinute(snapshot, candle({
    openedAt: "2026-09-09T13:45:00.000Z",
    closedAt: "2026-09-09T13:46:00.000Z",
  }));
  assert.equal(result.kind, "transition");
  if (result.kind === "transition") {
    assert.equal(result.to, "expired");
    assert.equal(result.detail.triggerObservedAtExpiration, true);
  }
});

test("allows only the locked monotonic transition graph", () => {
  assert.equal(lifecycleTransitionAllowed("watching", "triggered"), true);
  assert.equal(lifecycleTransitionAllowed("triggered", "watching"), false);
  assert.equal(lifecycleTransitionAllowed("target_reached", "invalidated"), false);
});

test("rejects lifecycle evidence when machine-readable cancellation conditions drift", () => {
  const drifted = {
    ...snapshot,
    cancellation: {
      ...snapshot.cancellation,
      conditions: snapshot.cancellation.conditions.map((condition, index) => index === 0
        ? { ...condition, value: 9.4 }
        : condition),
    },
  };
  assert.deepEqual(evaluateAgentPlanMinute(drifted as never, candle()), {
    kind: "rejected",
    reason: "invalid_evidence",
  });
});
