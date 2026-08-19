import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { buildProxShadowChallenger } from "./challenger-score.ts";

test("refuses to manufacture a ProX score from the canonical answer", () => {
  const result = buildProxShadowChallenger({
    canonicalScore: 92,
    independentEdgeScore: null,
    readiness: "insufficient",
    evidenceCoverage: 0,
    sampleSize: 0,
  });
  assert.equal(result, null);
});

test("uses canonical score only after the independent score is complete", () => {
  const result = buildProxShadowChallenger({
    canonicalScore: 70,
    independentEdgeScore: 82,
    readiness: "calibrated",
    evidenceCoverage: 95,
    sampleSize: 120,
  });
  assert.equal(result?.challengerScore, 82);
  assert.equal(result?.canonicalScore, 70);
  assert.equal(result?.delta, 12);
  assert.equal(result?.disposition, "higher");
  assert.equal(result?.authority.ranking, false);
});
