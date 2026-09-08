import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves source extensions.
import { assessProxOutcomeMemoryRunHealth } from "./outcome-memory-run-health.ts";

const now = Date.parse("2026-09-04T13:30:00Z");
const run = (overrides: Record<string, unknown> = {}) => ({
  id: "success",
  observed_at: "2026-09-04T13:27:00Z",
  completed_at: "2026-09-04T13:27:30Z",
  status: "success",
  complete: true,
  ...overrides,
});

test("a current running cycle does not hide the last completed success", () => {
  const result = assessProxOutcomeMemoryRunHealth(
    [
      run({
        id: "running",
        observed_at: "2026-09-04T13:29:50Z",
        completed_at: null,
        status: "running",
        complete: false,
      }),
      run(),
    ],
    { now, maximumSuccessAgeMs: 8 * 60_000 },
  );

  assert.equal(result.ok, true);
  assert.equal(result.runningCurrent, true);
  assert.equal(result.latestAttempt?.id, "running");
  assert.equal(result.latestSuccess?.id, "success");
});

test("an overdue or future-dated running cycle remains a hard failure", () => {
  for (const observed_at of [
    "2026-09-04T13:24:59Z",
    "2026-09-04T13:30:03Z",
    "not-a-time",
  ]) {
    const result = assessProxOutcomeMemoryRunHealth(
      [
        run({
          id: "running",
          observed_at,
          completed_at: null,
          status: "running",
          complete: false,
        }),
        run(),
      ],
      { now, maximumSuccessAgeMs: 8 * 60_000 },
    );

    assert.equal(result.ok, false, observed_at);
    assert.equal(result.runningOverdue, true, observed_at);
  }
});

test("a latest failed cycle stays red until a newer successful cycle completes", () => {
  const failed = assessProxOutcomeMemoryRunHealth(
    [
      run({
        id: "failed",
        observed_at: "2026-09-04T13:29:00Z",
        completed_at: "2026-09-04T13:29:10Z",
        status: "failed",
        complete: false,
      }),
      run(),
    ],
    { now, maximumSuccessAgeMs: 8 * 60_000 },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.latestTerminalFailed, true);

  const recovered = assessProxOutcomeMemoryRunHealth(
    [
      run({
        id: "recovered",
        observed_at: "2026-09-04T13:29:20Z",
        completed_at: "2026-09-04T13:29:30Z",
      }),
      failed.latestTerminal!,
    ],
    { now, maximumSuccessAgeMs: 8 * 60_000 },
  );
  assert.equal(recovered.ok, true);
  assert.equal(recovered.latestTerminalFailed, false);
});

test("a running cycle cannot substitute for a missing or stale success", () => {
  const runningOnly = assessProxOutcomeMemoryRunHealth(
    [
      run({
        id: "running",
        observed_at: "2026-09-04T13:29:50Z",
        completed_at: null,
        status: "running",
        complete: false,
      }),
    ],
    { now, maximumSuccessAgeMs: 8 * 60_000 },
  );
  assert.equal(runningOnly.ok, false);
  assert.equal(runningOnly.successFresh, false);

  const stale = assessProxOutcomeMemoryRunHealth(
    [
      run({
        observed_at: "2026-09-04T13:10:00Z",
        completed_at: "2026-09-04T13:10:30Z",
      }),
    ],
    { now, maximumSuccessAgeMs: 8 * 60_000 },
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.successFresh, false);
});
