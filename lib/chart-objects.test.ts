import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_CHART_OBJECT_VERSION, isHtChartObject, projectProviderTimestampToDisplayBucket } from "./chart-objects.ts";

const base = {
  id: "plan-entry-1",
  schemaVersion: HT_CHART_OBJECT_VERSION,
  authority: "agent",
  symbol: "SPY",
  status: "active",
  label: "Entry",
  source: { kind: "agent_x_visual_plan", id: "plan-1", version: "v1" },
  timing: {
    marketEvidenceAt: "2026-09-09T13:30:00.000Z",
    sourceComputedAt: "2026-09-09T13:30:02.000Z",
    session: "regular",
    evidenceInterval: "1m",
    freshness: "fresh",
  },
  confidence: { value: null, authority: null },
} as const;

test("validates semantic price lines and rejects invented zero levels", () => {
  assert.equal(isHtChartObject({ ...base, type: "price_line", role: "entry_trigger", price: 100 }), true);
  assert.equal(isHtChartObject({ ...base, type: "price_line", role: "entry_trigger", price: 0 }), false);
  assert.equal(isHtChartObject({ ...base, type: "price_line", role: "invented", price: 100 }), false);
});

test("validates ordered time-bounded zones", () => {
  assert.equal(isHtChartObject({
    ...base,
    type: "price_zone",
    role: "entry_zone",
    low: 99.9,
    high: 100.1,
    validFrom: "2026-09-09T13:30:00.000Z",
    validUntil: "2026-09-09T13:45:00.000Z",
  }), true);
  assert.equal(isHtChartObject({
    ...base,
    type: "price_zone",
    role: "entry_zone",
    low: 100.1,
    high: 99.9,
    validFrom: "2026-09-09T13:30:00.000Z",
    validUntil: "2026-09-09T13:45:00.000Z",
  }), false);
});

test("projects exact one-minute evidence into display buckets without changing its source timestamp", () => {
  assert.equal(projectProviderTimestampToDisplayBucket("2026-09-09T13:37:42.000Z", 60), 1788961020);
  assert.equal(projectProviderTimestampToDisplayBucket("2026-09-09T13:37:42.000Z", 300), 1788960900);
  assert.equal(projectProviderTimestampToDisplayBucket("2026-09-09T13:37:42.000Z", 900), 1788960600);
  assert.equal(projectProviderTimestampToDisplayBucket("2026-09-09T13:32:00.000Z", 60, "interval_close"), 1788960660);
});
