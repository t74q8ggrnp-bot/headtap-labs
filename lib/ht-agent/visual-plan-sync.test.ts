import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { visualPlanSyncFingerprint } from "./visual-plan-sync.ts";

const snapshot = {
  planId: "00000000-0000-4000-8000-000000000001",
  planVersionId: "00000000-0000-4000-8000-000000000002",
  versionNumber: 2,
  lifecycleState: "triggered" as const,
  stateVersion: 3,
  stateProviderTimestamp: "2026-09-10T13:35:00.000Z",
  definition: { schemaVersion: "agent-x-visual-paper-plan-v2" },
  chartObjects: [{ id: "entry", price: 500 }],
};

test("desktop and iPhone reads of the same server snapshot receive the same fingerprint", () => {
  const desktop = visualPlanSyncFingerprint(snapshot as never);
  const iphone = visualPlanSyncFingerprint(structuredClone(snapshot) as never);
  assert.equal(desktop, iphone);
  assert.match(desktop, /^[0-9a-f]{64}$/);
});

test("a lifecycle or price change produces a new cross-client snapshot fingerprint", () => {
  const original = visualPlanSyncFingerprint(snapshot as never);
  assert.notEqual(original, visualPlanSyncFingerprint({ ...snapshot, stateVersion: 4 } as never));
  assert.notEqual(original, visualPlanSyncFingerprint({
    ...snapshot,
    chartObjects: [{ id: "entry", price: 500.01 }],
  } as never));
});
