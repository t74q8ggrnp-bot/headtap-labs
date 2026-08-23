import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source
// extension while the production bundler resolves the same module extensionless.
import { buildProxPatternCalibrations, getProxEpisodeHorizonTargets, labelProxOutcome } from "./outcome-memory.ts";

test("labels a quiet-participation episode only after durable follow-through", () => {
  const result = labelProxOutcome({
    anomalyFlags: ["quiet_participation", "near_session_high"],
    maxGainPercent: 11,
    maxDrawdownPercent: -2.5,
    returnByHorizon: { "1h": 6.5, "4h": 8.2 },
  });

  assert.equal(result.ready, true);
  assert.equal(result.calibratable, true);
  assert.equal(result.label, "quiet_accumulation_breakout");
});

test("quarantines corporate-action episodes from calibration", () => {
  const result = labelProxOutcome({
    anomalyFlags: ["corporate_action_dislocation", "price_expansion"],
    maxGainPercent: 900,
    maxDrawdownPercent: 0,
    returnByHorizon: { "4h": 800 },
  });

  assert.equal(result.label, "corporate_action_distortion");
  assert.equal(result.calibratable, false);
});

test("labels surrendered expansion as a late chase", () => {
  const result = labelProxOutcome({
    anomalyFlags: ["price_expansion", "near_session_high"],
    maxGainPercent: 12,
    maxDrawdownPercent: -10,
    returnByHorizon: { "1h": 3, "4h": -2 },
  });

  assert.equal(result.label, "late_chase");
});

test("keeps calibration insufficient until a real sample exists", () => {
  const episodes = Array.from({ length: 29 }, (_, index) => ({
    patternSignature: "quiet_participation",
    marketSession: "regular" as const,
    label:
      index < 18
        ? ("quiet_accumulation_breakout" as const)
        : ("late_chase" as const),
    maxGainPercent: index < 18 ? 9 : 2,
    maxDrawdownPercent: index < 18 ? -3 : -10,
    timeToPeakMinutes: 42,
  }));

  const [calibration] = buildProxPatternCalibrations(episodes);
  assert.equal(calibration.sampleSize, 29);
  assert.equal(calibration.evidenceState, "insufficient");
  assert.equal(calibration.continuationCount, 18);
});

test("uses the next weekday close for an after-hours episode", () => {
  const targets = getProxEpisodeHorizonTargets({
    startedAt: "2026-08-14T21:00:00.000Z",
    tradingDate: "2026-08-14",
    marketSession: "after_hours",
  });
  const sessionClose = targets.find(
    (target) => target.horizon === "session_close",
  );
  const nextSession = targets.find(
    (target) => target.horizon === "next_session",
  );

  assert.equal(sessionClose?.targetAt, "2026-08-17T20:00:00.000Z");
  assert.equal(nextSession?.targetAt, "2026-08-17T13:35:00.000Z");
});

test("moves a Friday 24-hour stock horizon to the next tradable weekday", () => {
  const targets = getProxEpisodeHorizonTargets({
    startedAt: "2026-08-21T13:30:00.000Z",
    tradingDate: "2026-08-21",
    marketSession: "regular",
  });
  assert.equal(
    targets.find((target) => target.horizon === "24h")?.targetAt,
    "2026-08-24T13:30:00.000Z",
  );
});
