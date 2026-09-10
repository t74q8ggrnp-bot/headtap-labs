import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION, visualPlanIdempotencyKey } from "./visual-plan-idempotency.ts";

const input = {
  profileId: "00000000-0000-4000-8000-000000000001",
  frameHash: "a".repeat(64),
  decisionId: "00000000-0000-4000-8000-000000000002",
};

test("the same immutable decision frame produces one deterministic idempotency key", () => {
  assert.equal(HT_AGENT_VISUAL_PLAN_GENERATOR_VERSION, "agent-x-visual-plan-generator-v2-risk-reward-cancellation");
  assert.equal(visualPlanIdempotencyKey(input), visualPlanIdempotencyKey({ ...input }));
  assert.match(visualPlanIdempotencyKey(input), /^[0-9a-f]{64}$/);
});

test("a changed frame or decision cannot silently reuse the prior plan key", () => {
  const original = visualPlanIdempotencyKey(input);
  assert.notEqual(original, visualPlanIdempotencyKey({ ...input, frameHash: "b".repeat(64) }));
  assert.notEqual(original, visualPlanIdempotencyKey({ ...input, decisionId: "00000000-0000-4000-8000-000000000003" }));
});
