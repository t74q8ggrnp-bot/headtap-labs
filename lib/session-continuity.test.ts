import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { derivePreviousClose, evaluateSessionContinuity, SESSION_CONTINUITY_VERSION } from "./session-continuity.ts";

const base = {
  price: 112,
  previousCloseChangePercent: 12,
  sessionOpenPrice: 105,
  changeFromOpenPercent: 6.67,
  sessionHighPrice: 115,
  pullbackFromSessionHighPercent: 2.61,
  relativeVolume: 3,
  momentumScore: 75,
  scanSession: "pre_market",
  providerAsOf: "2026-09-24T12:20:00.000Z",
  proxState: "expanding",
};

test("derives the previous close from aligned price and full-day change", () => {
  assert.equal(derivePreviousClose(112, 12), 100);
  assert.equal(derivePreviousClose(0, 12), null);
  assert.equal(derivePreviousClose(10, -100), null);
});

test("classifies strong, fading, and new-today continuity deterministically", () => {
  const strong = evaluateSessionContinuity(base);
  assert.equal(strong.version, SESSION_CONTINUITY_VERSION);
  assert.equal(strong.state, "strong");
  assert.equal(strong.gapPercent, 5);
  assert.equal(strong.gapRetentionPercent, 80);

  const fading = evaluateSessionContinuity({
    ...base,
    price: 105,
    previousCloseChangePercent: 5,
    sessionHighPrice: 120,
    changeFromOpenPercent: -4,
    pullbackFromSessionHighPercent: 12.5,
  });
  assert.equal(fading.state, "fading");

  const newToday = evaluateSessionContinuity({
    ...base,
    price: 104,
    previousCloseChangePercent: 4,
    sessionOpenPrice: 100,
    sessionHighPrice: 105,
    changeFromOpenPercent: 4,
    pullbackFromSessionHighPercent: 0.95,
  });
  assert.equal(newToday.state, "new_today");
});

test("remains explicitly zero-authority and honest when evidence is unavailable", () => {
  const result = evaluateSessionContinuity({ ...base, providerAsOf: null });
  assert.equal(result.state, "unavailable");
  assert.deepEqual(result.authority, {
    canonical: false,
    prox: false,
    agentRisk: false,
    paper: false,
    execution: false,
  });
});
