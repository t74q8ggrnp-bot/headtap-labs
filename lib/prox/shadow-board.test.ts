import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { buildProxShadowBoard } from "./shadow-board.ts";

function candidate(index: number, qualified = true) {
  return {
    ticker: `T${index}`,
    price: 10,
    discoveredAt: "2026-08-14T14:00:00.000Z",
    sourceObservationId: `observation-${index}`,
    sourceObservedAt: "2026-08-14T14:00:00.000Z",
    marketSession: "regular" as const,
    discoveryPattern: "price_expansion",
    dollarVolume: 1_000_000,
    edge: {
      version: "prox-edge-score-v2" as const,
      edgeScore: 90 - index,
      continuationProbability: 80 - index,
      rewardRiskAsymmetry: 75,
      evidenceConfidence: 70,
      riskPenalty: 0,
      entryQualified: qualified,
      readiness: "live_only" as const,
      components: {
        liveImpulse: 80,
        participation: 80,
        vwapPosition: 80,
        peakRetention: 80,
        marketStructure: 80,
        twoClockAlignment: 80,
        comparableOutcomes: null,
        newsAttention: null,
      },
      hardFailures: qualified ? [] : ["Entry withheld."],
      reasons: [],
    },
  };
}

test("creates one hero, five contenders, radar blocks, and explicit rejections", () => {
  const board = buildProxShadowBoard([
    ...Array.from({ length: 8 }, (_, index) => candidate(index)),
    candidate(20, false),
  ]);
  assert.equal(board.filter((member) => member.role === "hero").length, 1);
  assert.equal(board.filter((member) => member.role === "contender").length, 5);
  assert.equal(board.filter((member) => member.disposition === "rejected").length, 2);
  assert.equal(board.filter((member) => member.disposition === "blocked").length, 1);
  assert.equal(board.length, 9);
});

test("returns an honest radar-only board when no candidate qualifies", () => {
  const board = buildProxShadowBoard([
    candidate(1, false),
    candidate(2, false),
  ]);
  assert.equal(board.some((member) => member.role === "hero"), false);
  assert.equal(board.every((member) => member.disposition === "blocked"), true);
});
