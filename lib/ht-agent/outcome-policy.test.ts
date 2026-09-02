import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getHtAgentMissingOutcomeReason, HT_AGENT_OUTCOME_HEALTH_GRACE_MS } from "./outcome-policy.ts";

test("keeps a missing Agent outcome pending during the verified-bar window", () => {
  const reason = getHtAgentMissingOutcomeReason({
    targetAt: "2026-09-02T14:00:00.000Z",
    observedAt: new Date("2026-09-02T14:09:59.000Z"),
  });
  assert.equal(reason, null);
});

test("terminally excludes an active-session outcome when Massive never prints a verified bar", () => {
  const reason = getHtAgentMissingOutcomeReason({
    targetAt: "2026-09-02T14:00:00.000Z",
    observedAt: new Date("2026-09-02T14:10:00.000Z"),
  });
  assert.match(reason ?? "", /excluded rather than fabricated/i);
});

test("terminally records a closed-market target without inventing a return", () => {
  const reason = getHtAgentMissingOutcomeReason({
    targetAt: "2026-09-02T02:00:00.000Z",
    observedAt: new Date("2026-09-02T02:10:00.000Z"),
  });
  assert.match(reason ?? "", /market was closed/i);
});

test("health grace covers the measurement window and two worker cycles", () => {
  assert.equal(HT_AGENT_OUTCOME_HEALTH_GRACE_MS, 12 * 60_000);
});
