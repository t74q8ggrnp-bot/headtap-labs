import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves source extensions.
import { assessHtAgentRunHealth } from "./run-health.ts";

const now = Date.parse("2026-09-03T17:00:00Z");
const profile = { id: "profile" };
const run = (overrides: Record<string, unknown> = {}) => ({
  id: "success",
  profile_id: profile.id,
  status: "success",
  started_at: "2026-09-03T16:58:50Z",
  completed_at: "2026-09-03T16:59:00Z",
  ...overrides,
});

test("a current in-progress cycle does not hide a fresh completed success", () => {
  const result = assessHtAgentRunHealth([profile], [
    run({ id: "running", status: "running", started_at: "2026-09-03T16:59:50Z", completed_at: null }),
    run(),
  ], { now, maximumSuccessAgeMs: 10 * 60_000 });
  assert.equal(result.ok, true);
  assert.equal(result.profileStates[0].runningCurrent, true);
  assert.equal(result.profileStates[0].latestSuccess?.id, "success");
});

test("an overdue or future-dated running cycle remains a hard failure", () => {
  for (const started_at of ["2026-09-03T16:54:59Z", "2026-09-03T17:00:03Z", "not-a-time"]) {
    const result = assessHtAgentRunHealth([profile], [
      run({ id: "running", status: "running", started_at, completed_at: null }),
      run(),
    ], { now, maximumSuccessAgeMs: 10 * 60_000 });
    assert.equal(result.ok, false, started_at);
    assert.equal(result.overdueRunningCount, 1, started_at);
  }
});

test("a running cycle cannot substitute for a missing or stale successful cycle", () => {
  const onlyRunning = assessHtAgentRunHealth([profile], [
    run({ id: "running", status: "running", started_at: "2026-09-03T16:59:50Z", completed_at: null }),
  ], { now, maximumSuccessAgeMs: 10 * 60_000 });
  assert.equal(onlyRunning.ok, false);
  assert.equal(onlyRunning.missingFreshSuccessCount, 1);

  const stale = assessHtAgentRunHealth([profile], [run({ completed_at: "2026-09-03T16:40:00Z" })], {
    now,
    maximumSuccessAgeMs: 10 * 60_000,
  });
  assert.equal(stale.ok, false);
});
