import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires source extensions.
import { describeProxMicrostructureCoverage } from "./microstructure-coverage.ts";

const now = Date.parse("2026-09-03T11:15:56.782Z");
const current = new Date(now - 1_000).toISOString();
const row = { ticker: "TEST", market_as_of: current, quote_as_of: current, trade_as_of: current };

test("complete coverage requires separate quote and trade clocks, not just the latest clock", () => {
  const result = describeProxMicrostructureCoverage([row], now);
  assert.equal(result.coverageState, "complete");
  assert.equal(result.freshQuoteAndTradeCount, 1);
  assert.deepEqual(result.sourceIssues, []);
});

test("the confirmed VIDA case preserves its old quote and absent recent tape", () => {
  const result = describeProxMicrostructureCoverage([{ ticker: "VIDA",
    market_as_of: "2026-09-03T10:05:46.312Z", quote_as_of: "2026-09-03T10:05:46.312Z", trade_as_of: null }], now);
  assert.equal(result.coverageState, "partial");
  assert.equal(result.sourceIssues[0].quote.state, "stale");
  assert.equal(result.sourceIssues[0].quote.ageSeconds, 4210.5);
  assert.equal(result.sourceIssues[0].trade.state, "unavailable");
  assert.equal(result.sourceIssues[0].trade.providerAsOf, null);
  assert.equal(result.providerRequests, 0);
});

test("a fresh trade cannot hide an old quote in coverage diagnostics", () => {
  const old = "2026-09-03T10:00:00.000Z";
  for (const source of [{ ...row, quote_as_of: old }, { ...row, trade_as_of: old }]) {
    const result = describeProxMicrostructureCoverage([source], now);
    assert.equal(result.coverageState, "partial");
    assert.equal(result.freshQuoteAndTradeCount, 0);
    assert.equal(result.sourceIssues[0].combined.usable, true);
  }
});

test("diagnostics preserve the existing five-minute source boundary and do not mutate evidence", () => {
  const input = [{ ...row, quote_as_of: new Date(now - 300_000).toISOString() }];
  const before = structuredClone(input);
  assert.equal(describeProxMicrostructureCoverage(input, now).coverageState, "complete");
  assert.equal(describeProxMicrostructureCoverage(input, now + 1).coverageState, "partial");
  assert.deepEqual(input, before);
});

test("empty and malformed observations cannot imply complete coverage", () => {
  assert.equal(describeProxMicrostructureCoverage([], now).coverageState, "unavailable");
  assert.equal(describeProxMicrostructureCoverage([{ ...row, quote_as_of: "bad" }], now).coverageState, "partial");
});
