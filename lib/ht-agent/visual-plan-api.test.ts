import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { visualPlanObjectFreshness, visualPlanPaperUrl } from "./visual-plan-api.ts";

test("visual plan handoff remains an explicit paper-only review link", () => {
  assert.equal(
    visualPlanPaperUrl({ symbol: "SPY", planVersionId: "00000000-0000-4000-8000-000000000001" }),
    "/paper?symbol=SPY&source=ht_agent&agentPlanVersion=00000000-0000-4000-8000-000000000001",
  );
});

test("visual plan freshness rejects future provider clocks and ages stored evidence honestly", () => {
  const now = Date.parse("2026-09-09T13:35:00.000Z");
  assert.equal(visualPlanObjectFreshness("2026-09-09T13:34:30.000Z", now), "fresh");
  assert.equal(visualPlanObjectFreshness("2026-09-09T13:32:30.000Z", now), "aging");
  assert.equal(visualPlanObjectFreshness("2026-09-09T13:20:00.000Z", now), "stale");
  assert.equal(visualPlanObjectFreshness("2026-09-09T13:36:00.000Z", now), "stale");
});
