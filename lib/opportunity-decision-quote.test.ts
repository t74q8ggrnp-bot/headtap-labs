import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { applyOpportunityDecisionQuote } from "./opportunity-decision-quote.ts";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { enforceSpotMomentumAuthority, POSITIVE_FULL_DAY_MOMENTUM_REQUIRED } from "./spot-momentum-authority.ts";

const candidate = {
  ticker: "FLIP",
  price: 10.5,
  change: 5,
  sessionOpenPrice: 10,
  changeFromOpenPercent: 5,
  sessionHighPrice: 11,
  pullbackFromSessionHighPercent: 4.545,
  scanSession: "regular",
  relativeVolume: 4,
  avgVolume: 100_000,
  htScore: 80,
  momentumScore: 80,
  crowdScore: 50,
  trapScore: 40,
  catalystScore: 0,
  pattern: "Momentum",
  state: "active",
  signalState: "verified",
  scannedAt: "2026-08-13T14:00:00.000Z",
  retrievedForSm: true,
  retrievedForBtc: false,
  retrievedForCatalyst: false,
  retrievedForReclaim: false,
  securityType: "CS",
};

test("a quote flip is applied before authority evaluation", () => {
  const updated = applyOpportunityDecisionQuote(
    candidate,
    { price: 9.8, change: -2, asOf: "2026-08-13T14:04:00.000Z" },
    new Date("2026-08-13T14:05:00.000Z"),
  );
  assert.equal(updated.price, 9.8);
  assert.equal(updated.change, -2);
  assert.ok(Math.abs((updated.changeFromOpenPercent ?? 0) - -2) < 0.0001);
  assert.equal(Number(updated.pullbackFromSessionHighPercent?.toFixed(3)), 10.909);
  assert.equal(updated.decisionQuoteLive, true);

  assert.deepEqual(
    enforceSpotMomentumAuthority({
      rejectionReasons: [],
      fullDayChangePercent: updated.change,
      peakFailureConfirmed: false,
    }),
    [POSITIVE_FULL_DAY_MOMENTUM_REQUIRED],
  );
});

test("a stale active-session quote cannot replace the promoted candidate", () => {
  const updated = applyOpportunityDecisionQuote(
    candidate,
    { price: 9.8, change: -2, asOf: "2026-08-13T13:00:00.000Z" },
    new Date("2026-08-13T14:05:00.000Z"),
  );
  assert.equal(updated.price, candidate.price);
  assert.equal(updated.change, candidate.change);
  assert.equal(updated.decisionQuoteLive, false);
  assert.equal(updated.decisionQuoteAsOf, null);
});
