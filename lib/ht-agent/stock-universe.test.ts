import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildHtAgentStockUniverse, findHtAgentProposalCandidate, htAgentProposalLane, HT_AGENT_CANDIDATES_PER_LANE, HT_AGENT_STOCK_UNIVERSE_VERSION, loadHtAgentStockUniverse } from "./stock-universe.ts";

const MOMENTUM_RUN = "00000000-0000-4000-8000-000000000001";
const BTC_RUN = "00000000-0000-4000-8000-000000000002";
const MOMENTUM_TIME = "2026-09-02T14:00:20.000Z";
const BTC_TIME = "2026-09-02T14:00:30.000Z";
const PROVIDER_TIME = "2026-09-02T14:00:10.000Z";

function lane(beforeCrowd: boolean, symbols: string[]) {
  return {
    sourceRun: { id: beforeCrowd ? BTC_RUN : MOMENTUM_RUN },
    engineVersion: "canonical-test",
    decisionFrame: { decisionAsOf: beforeCrowd ? BTC_TIME : MOMENTUM_TIME, fresh: true },
    opportunities: symbols.map((ticker, index) => ({
      ticker,
      strategy: beforeCrowd ? "before_the_crowd" : "spot_momentum",
      sourceRunId: beforeCrowd ? BTC_RUN : MOMENTUM_RUN,
      decisionQuoteAsOf: PROVIDER_TIME,
      price: 10 + index,
      strategyScore: 90 - index,
      displayEligibility: { eligible: true, reasons: [] as string[] },
      tradeFramework: { upsideMin: 5, downsideRisk: 2 },
    })),
  };
}

test("evaluates up to six published candidates from each stock lane", () => {
  const momentum = lane(false, Array.from({ length: 9 }, (_, index) => `M${index}`));
  const before_crowd = lane(true, Array.from({ length: 9 }, (_, index) => `B${index}`));
  const result = buildHtAgentStockUniverse({ momentum, before_crowd });
  assert.equal(result.coverage.version, HT_AGENT_STOCK_UNIVERSE_VERSION);
  assert.equal(result.coverage.limitPerLane, HT_AGENT_CANDIDATES_PER_LANE);
  assert.equal(result.candidates.length, 12);
  assert.deepEqual(result.candidates.map((item) => item.opportunity.ticker), ["M0", "M1", "M2", "M3", "M4", "M5", "B0", "B1", "B2", "B3", "B4", "B5"]);
  assert.deepEqual(result.coverage.lanes.map((item) => [item.publishedCount, item.consideredCount]), [[9, 6], [9, 6]]);
});

test("both retained stock lanes remain visible history, never new Agent entry candidates", () => {
  const momentum = lane(false, ["RETAINED-M"]);
  const before_crowd = lane(true, ["RETAINED-B"]);
  momentum.decisionFrame = { ...momentum.decisionFrame, fresh: false };
  before_crowd.decisionFrame = { ...before_crowd.decisionFrame, fresh: false };
  const result = buildHtAgentStockUniverse({ momentum, before_crowd });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.coverage.lanes.map(item => item.state), ["stale", "stale"]);
  assert.deepEqual(result.coverage.lanes.map(item => item.publishedCount), [1, 1]);
});

test("each lane retains its own source run, rank, processing time and provider time", () => {
  const result = buildHtAgentStockUniverse({ momentum: lane(false, ["M"]), before_crowd: lane(true, ["B", "C"]) });
  assert.equal(result.candidates[0].sourceRunId, MOMENTUM_RUN);
  const candidate = result.candidates[2];
  assert.equal(candidate.sourceRunId, BTC_RUN);
  assert.equal(candidate.rank, 2);
  assert.equal(candidate.decisionTimestamp, BTC_TIME);
  assert.equal(candidate.providerTimestamp, PROVIDER_TIME);
  assert.equal(candidate.opportunity.strategy, "before_the_crowd");
  assert.equal(candidate.engineVersion, "canonical-test");
});

test("shared symbols keep one complete primary-lane decision, not the most attractive fields", () => {
  const momentum = lane(false, ["SAME"]);
  const before_crowd = lane(true, ["SAME", "OTHER"]);
  momentum.opportunities[0].displayEligibility = { eligible: false, reasons: ["Not entry eligible"] };
  before_crowd.opportunities[0].strategyScore = 99;
  before_crowd.opportunities[0].price = 25;
  before_crowd.opportunities[0].tradeFramework.upsideMin = 90;
  const snapshot = JSON.stringify({ momentum, before_crowd });
  const result = buildHtAgentStockUniverse({ momentum, before_crowd });
  assert.equal(result.candidates.length, 2);
  const retained = result.candidates[0];
  assert.equal(retained.lane, "momentum");
  assert.equal(retained.opportunity.price, 10);
  assert.equal(retained.opportunity.strategyScore, 90);
  assert.equal(retained.opportunity.tradeFramework?.upsideMin, 5);
  assert.equal(retained.opportunity.displayEligibility?.eligible, false);
  assert.deepEqual(result.coverage.duplicates, [{ symbol: "SAME", retainedLane: "momentum", omittedLane: "before_crowd", omittedRank: 1 }]);
  assert.equal(JSON.stringify({ momentum, before_crowd }), snapshot);
});

test("duplicates within a lane never become two paper candidates", () => {
  const result = buildHtAgentStockUniverse({ momentum: lane(false, ["ONE", "one", "TWO"]), before_crowd: lane(true, []) });
  assert.deepEqual(result.candidates.map((item) => [item.opportunity.ticker, item.rank]), [["ONE", 1], ["TWO", 3]]);
});

test("does not invent a cross-lane ranking based on score or target size", () => {
  const momentum = lane(false, ["FIRST", "SECOND"]);
  momentum.opportunities[1].strategyScore = 100;
  const before_crowd = lane(true, ["THIRD"]);
  before_crowd.opportunities[0].strategyScore = 100;
  const result = buildHtAgentStockUniverse({ momentum, before_crowd });
  assert.deepEqual(result.candidates.map((item) => item.opportunity.ticker), ["FIRST", "SECOND", "THIRD"]);
});

test("a stale lane supplies no new entry candidates; the other lane remains explicit", () => {
  const momentum = lane(false, ["STALE"]);
  momentum.decisionFrame.fresh = false;
  const result = buildHtAgentStockUniverse({ momentum, before_crowd: lane(true, ["FRESH"]) });
  assert.deepEqual(result.candidates.map((item) => item.opportunity.ticker), ["FRESH"]);
  assert.equal(result.coverage.lanes[0].state, "stale");
  assert.equal(result.coverage.lanes[0].consideredCount, 0);
});

test("missing or malformed frame provenance never becomes a current entry candidate", () => {
  for (const patch of [{ decisionFrame: undefined }, { decisionFrame: { fresh: true, decisionAsOf: "invalid" } }, { engineVersion: "" }]) {
    const result = buildHtAgentStockUniverse({ momentum: { ...lane(false, ["BAD"]), ...patch }, before_crowd: null });
    assert.equal(result.candidates.length, 0);
  }
});

test("source-run mismatch is recorded, not silently relabeled", () => {
  const momentum = lane(false, ["BAD", "GOOD"]);
  momentum.opportunities[0].sourceRunId = BTC_RUN;
  const result = buildHtAgentStockUniverse({ momentum, before_crowd: null });
  assert.deepEqual(result.candidates.map((item) => item.opportunity.ticker), ["GOOD"]);
  assert.equal(result.candidates[0].rank, 2);
  assert.match(result.coverage.lanes[0].omitted[0].reason, /disagree/);
});

test("a missing frame run may use the candidate's real run but never generate one", () => {
  const momentum = lane(false, ["GOOD", "BAD"]);
  momentum.sourceRun.id = "";
  momentum.opportunities[1].sourceRunId = "";
  const result = buildHtAgentStockUniverse({ momentum, before_crowd: null });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].sourceRunId, MOMENTUM_RUN);
  assert.match(result.coverage.lanes[0].omitted[0].reason, /unavailable/);
});

test("a foreign-lane record cannot inherit another strategy", () => {
  const before_crowd = lane(true, ["WRONG"]);
  before_crowd.opportunities[0].strategy = "spot_momentum";
  const result = buildHtAgentStockUniverse({ momentum: null, before_crowd });
  assert.equal(result.candidates.length, 0);
  assert.match(result.coverage.lanes[1].omitted[0].reason, /Strategy/);
});

test("invalid records do not silently expand the bounded shortlist", () => {
  const momentum = lane(false, ["", "B", "C", "D", "E", "F", "G"]);
  const result = buildHtAgentStockUniverse({ momentum, before_crowd: null });
  assert.deepEqual(result.candidates.map((item) => item.opportunity.ticker), ["B", "C", "D", "E", "F"]);
  assert.equal(result.coverage.lanes[0].omitted[0].rank, 1);
});

test("does not substitute display or processing time for missing provider evidence", () => {
  const momentum = lane(false, ["MISSING"]);
  momentum.opportunities[0].decisionQuoteAsOf = "";
  Object.assign(momentum.opportunities[0], { displayQuoteAsOf: BTC_TIME, scannedAt: BTC_TIME });
  const result = buildHtAgentStockUniverse({ momentum, before_crowd: null });
  assert.equal(result.candidates[0].providerTimestamp, null);
  assert.equal(result.candidates[0].decisionTimestamp, MOMENTUM_TIME);
});

test("loader requests both lanes independently and records one source failure", async () => {
  const calls: string[] = [];
  const result = await loadHtAgentStockUniverse(async (requested) => {
    calls.push(requested);
    if (requested === "momentum") throw new Error("source unavailable");
    return lane(true, ["BTC"]);
  });
  assert.deepEqual(calls, ["momentum", "before_crowd"]);
  assert.deepEqual(result.candidates.map((item) => item.opportunity.ticker), ["BTC"]);
  assert.equal(result.coverage.lanes[0].state, "unavailable");
  assert.equal(result.coverage.lanes[1].state, "ready");
});

test("two source outages return explicit empty coverage without throwing away position management", async () => {
  const result = await loadHtAgentStockUniverse(async () => { throw new Error("outage"); });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.coverage.lanes.map((item) => item.state), ["unavailable", "unavailable"]);
});

test("proposal revalidation identifies the original strategy, including legacy frames", () => {
  assert.equal(htAgentProposalLane({ strategy: "before_the_crowd" }), "before_crowd");
  assert.equal(htAgentProposalLane({ strategy: "spot_momentum" }), "momentum");
  for (const missing of [null, {}, { strategy: "crypto" }, { sourceLane: "momentum" }]) {
    assert.equal(htAgentProposalLane(missing), null);
  }
});

test("Before the Crowd proposals revalidate against that lane without borrowing Momentum", () => {
  const frame = lane(true, ["BTC"]);
  const candidate = findHtAgentProposalCandidate("before_crowd", frame, "btc");
  assert.equal(candidate?.sourceRunId, BTC_RUN);
  assert.equal(candidate?.decisionTimestamp, BTC_TIME);
  assert.equal(candidate?.opportunity.strategy, "before_the_crowd");
  assert.equal(findHtAgentProposalCandidate("momentum", frame, "BTC"), null);
});

test("pending proposals below the new-cycle quota still receive full same-lane revalidation", () => {
  const frame = lane(true, ["A", "B", "C", "D", "E", "F", "G"]);
  assert.equal(findHtAgentProposalCandidate("before_crowd", frame, "G")?.rank, 7);
});

test("withdrawn, stale or misattributed proposals cannot be approved via a fallback", () => {
  const frame = lane(true, ["BTC"]);
  assert.equal(findHtAgentProposalCandidate("before_crowd", frame, "REMOVED"), null);
  frame.decisionFrame.fresh = false;
  assert.equal(findHtAgentProposalCandidate("before_crowd", frame, "BTC"), null);
  frame.decisionFrame.fresh = true;
  frame.opportunities[0].sourceRunId = MOMENTUM_RUN;
  assert.equal(findHtAgentProposalCandidate("before_crowd", frame, "BTC"), null);
});
