import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source
// extension while the production bundler resolves the same module extensionless.
import { findProxOutcomeBarAtTarget, resolveProxOutcomeHorizon, summarizeProxOutcomePath, type ProxOutcomeBar } from "./shadow-outcome-resolution.ts";

const at = (minute: number) => Date.parse(`2026-08-21T13:${String(minute).padStart(2, "0")}:00.000Z`);

const bars: ProxOutcomeBar[] = [
  { timeMs: at(30), open: 10, high: 10.2, low: 9.9, close: 10.1 },
  { timeMs: at(35), open: 10.1, high: 11, low: 10, close: 10.8 },
  { timeMs: at(40), open: 10.8, high: 10.9, low: 9.5, close: 9.8 },
];

test("resolves a horizon from the nearest verified historical bar", () => {
  const match = findProxOutcomeBarAtTarget(bars, "2026-08-21T13:36:00.000Z");
  assert.equal(match?.timeMs, at(35));
  const resolved = resolveProxOutcomeHorizon({
    horizon: "5m",
    targetAt: "2026-08-21T13:35:00.000Z",
    bars,
    now: new Date("2026-08-21T14:00:00.000Z"),
  });
  assert.equal(resolved.state, "measured");
  assert.equal(resolved.measuredPrice, 10.8);
});

test("keeps a missing recent horizon pending and terminally marks an old gap unavailable", () => {
  const recent = resolveProxOutcomeHorizon({
    horizon: "15m",
    targetAt: "2026-08-21T14:00:00.000Z",
    bars: [],
    now: new Date("2026-08-21T14:30:00.000Z"),
  });
  assert.equal(recent.state, "pending");

  const old = resolveProxOutcomeHorizon({
    horizon: "24h",
    targetAt: "2026-08-10T14:00:00.000Z",
    bars: [],
    now: new Date("2026-08-21T14:30:00.000Z"),
  });
  assert.equal(old.state, "unavailable");
  assert.equal(old.measuredPrice, null);
});

test("computes MFE and MAE from the full observed path instead of the latest snapshot", () => {
  const path = summarizeProxOutcomePath({
    bars,
    entryPrice: 10,
    decisionAt: "2026-08-21T13:30:00.000Z",
    through: new Date("2026-08-21T14:00:00.000Z"),
  });
  assert.ok(path);
  assert.equal(Number(path.maxGainPercent.toFixed(2)), 10);
  assert.equal(Number(path.maxDrawdownPercent.toFixed(2)), -5);
  assert.equal(path.timeToPeakMinutes, 5);
});
