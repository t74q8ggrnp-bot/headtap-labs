import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { scoreCryptoOpportunity } from "./opportunity-engine.ts";

const strongSnapshot = {
  productId: "TEST-USD",
  symbol: "TEST",
  open: 10,
  high: 12,
  low: 9,
  last: 11.5,
  volume24h: 1_000_000,
  volume30d: 15_000_000,
};

test("qualifies liquid momentum that is retaining its 24-hour high", () => {
  const opportunity = scoreCryptoOpportunity(strongSnapshot);
  assert.ok(opportunity);
  assert.equal(opportunity.eligible, true);
  assert.equal(opportunity.decisionState, "qualified");
  assert.ok(opportunity.opportunityScore >= 45);
  assert.ok(opportunity.pullbackFromHighPercent < 5);
});

test("rejects internally inconsistent market ranges instead of scoring them", () => {
  assert.equal(
    scoreCryptoOpportunity({ ...strongSnapshot, high: 10, last: 11.5 }),
    null,
  );
  assert.equal(
    scoreCryptoOpportunity({ ...strongSnapshot, low: 11.75 }),
    null,
  );
});

test("does not qualify a move that has surrendered too much of its high", () => {
  const opportunity = scoreCryptoOpportunity({
    ...strongSnapshot,
    high: 20,
    low: 9,
    last: 12,
  });
  assert.ok(opportunity);
  assert.equal(opportunity.eligible, false);
  assert.ok(opportunity.riskTags.includes("Peak Retention Risk"));
});
