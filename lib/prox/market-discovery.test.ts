import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source
// extension while the production bundler resolves the same module extensionless.
import { evaluateProxMarketDiscovery } from "./market-discovery.ts";

const observedAt = "2026-08-10T16:15:00.000Z";

test("captures MSGY-like quiet cumulative participation before price expansion", () => {
  const observation = evaluateProxMarketDiscovery({
    ticker: "MSGY",
    observedAt,
    marketSession: "regular",
    expectedVolumeFraction: 0.469,
    price: 0.2689,
    previousClose: 0.2615,
    sessionOpenPrice: 0.261,
    sessionHighPrice: 0.2753,
    sessionLowPrice: 0.255,
    currentVolume: 464_452,
    previousVolume: 438_000,
    reportedChangePercent: 2.83,
  });

  assert.equal(observation.eligibleForResearch, true);
  assert.ok(observation.anomalyFlags.includes("quiet_participation"));
  assert.ok(observation.anomalyFlags.includes("near_session_high"));
  assert.ok((observation.timeAdjustedRelativeVolume ?? 0) > 2);
  assert.ok(observation.researchPriority > 0);
});

test("does not queue an ordinary low-volume flat ticker", () => {
  const observation = evaluateProxMarketDiscovery({
    ticker: "CALM",
    observedAt,
    marketSession: "regular",
    expectedVolumeFraction: 0.5,
    price: 10,
    previousClose: 10,
    sessionOpenPrice: 10,
    sessionHighPrice: 10.1,
    sessionLowPrice: 9.9,
    currentVolume: 2_000,
    previousVolume: 100_000,
    reportedChangePercent: 0,
  });

  assert.equal(observation.eligibleForResearch, false);
  assert.equal(observation.researchPriority, 0);
});

test("isolates a likely split discontinuity from organic movement", () => {
  const observation = evaluateProxMarketDiscovery({
    ticker: "SPLT",
    observedAt,
    marketSession: "regular",
    expectedVolumeFraction: 0.5,
    price: 2.2,
    previousClose: 0.27,
    sessionOpenPrice: 2.16,
    sessionHighPrice: 2.22,
    sessionLowPrice: 2.1,
    currentVolume: 500_000,
    previousVolume: 2_000_000,
    reportedChangePercent: 1.85,
  });

  assert.equal(observation.corporateActionSuspected, true);
  assert.equal(observation.corporateActionFactor, 8);
  assert.ok(
    observation.anomalyFlags.includes("corporate_action_dislocation"),
  );
  assert.ok((observation.rawFullDayChangePercent ?? 0) > 700);
  assert.ok((observation.observedChangePercent ?? 100) < 3);
});

test("records deterioration and downside participation as defensive research", () => {
  const observation = evaluateProxMarketDiscovery({
    ticker: "FADE",
    observedAt,
    marketSession: "regular",
    expectedVolumeFraction: 0.5,
    price: 8.5,
    previousClose: 10,
    sessionOpenPrice: 10.5,
    sessionHighPrice: 11.2,
    sessionLowPrice: 8.25,
    currentVolume: 1_000_000,
    previousVolume: 500_000,
    reportedChangePercent: -15,
  });

  assert.equal(observation.eligibleForResearch, true);
  assert.ok(observation.anomalyFlags.includes("downside_volume_breakdown"));
  assert.ok(observation.anomalyFlags.includes("post_peak_deterioration"));
});
