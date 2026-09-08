import assert from "node:assert/strict";
import test from "node:test";
import type { MatchedCryptoEpisode, CryptoSimulationPolicy, SizedResearchBook } from "./research-comparison";
// @ts-expect-error Node source imports.
import { compareFrozenCryptoModels, simulateCryptoResearchChoice } from "./research-comparison.ts";

const origin = Date.parse("2026-09-02T12:00:00Z");
const at = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
const identity = { provider:"coinapi",marketId:"COINBASE_SPOT_TEST_USD",base:"TEST",quote:"USD" as const };
const evidenceHash = "a".repeat(64);
const costs: CryptoSimulationPolicy = { version:"fixture-costs-not-live",feeBpsPerSide:20,slippageBpsPerSide:10,executionDelayMs:2000,maxBookParticipation:.1 };
const book = (seconds: number,bid: number): SizedResearchBook => ({ identity,bid,ask:bid + .02,bidSize:1000,askSize:1000,asOf:at(seconds),receivedAt:at(seconds + .1) });
const episode = (): MatchedCryptoEpisode => ({ episodeId:"one",sourceVersion:"coinapi-provider-book-ledger-v1",identity,evidenceHash,
  decisionAt:at(0),horizonSeconds:300,marketIntegrity:"verified_normal",allocatedDollars:200,
  baseline:{ version:"baseline-v1",frozenAt:at(-7200),evidenceHash,action:"paper_entry",quantity:10 },
  candidate:{ version:"candidate-v1",frozenAt:at(-7200),evidenceHash,action:"no_trade",quantity:null },
  books:[book(0,8),book(2,10),book(120,9),book(302,9.5)] });
const window = { baselineVersion:"baseline-v1",candidateVersion:"candidate-v1",trainingUntil:at(-3600),evaluationFrom:at(0),
  evaluationUntil:at(1800),reportAt:at(2000),embargoMs:300_000,startingCapitalDollars:1000 };
const simulate = (e = episode()) => simulateCryptoResearchChoice(e,e.baseline,costs,at(2000));

test("simulation waits for the execution delay and subtracts spread, fees and slippage", () => {
  const result = simulate();
  assert.equal(result.entryAsOf,at(2)); assert.equal(result.exitAsOf,at(302));
  const expected = 10 * (9.5 * .999 * .998 - 10.02 * 1.001 * 1.002);
  assert.ok(Math.abs(result.pnlDollars! - expected) < 1e-10); assert.ok(result.pnlDollars! < 0);
});

test("missing, late, conflicting or another exchange's books never fabricate fills", () => {
  for (const books of [[],[book(0,10),book(300,11)],
    [book(2,10),{ ...book(302,11),receivedAt:at(500) }],
    [book(2,10),{ ...book(302,11),identity:{ ...identity,marketId:"KRAKEN_SPOT_TEST_USD" } }],
    [book(2,10),book(302,11),book(302,99)]]) {
    assert.equal(simulate({ ...episode(),books }).pnlDollars,null);
  }
});

test("size, allocation, halt and missing-integrity restrictions are deterministic", () => {
  assert.equal(simulate({ ...episode(),allocatedDollars:1 }).status,"unfilled");
  const large = episode(); large.baseline.quantity = 101;
  assert.equal(simulate(large).reason,"insufficient_observed_liquidity");
  for (const marketIntegrity of ["halted","suspect","unavailable"] as const) {
    assert.equal(simulate({ ...episode(),marketIntegrity }).status,"unavailable");
  }
  const missing = episode(); missing.books[1].askSize = null;
  assert.equal(simulate(missing).reason,"missing_book_liquidity");
});

test("fair comparison counts losers and no-trades with sampled drawdown", () => {
  const report = compareFrozenCryptoModels([episode()],costs,window);
  assert.equal(report.baseline.filledTrades,1); assert.equal(report.baseline.winRate,0);
  assert.equal(report.candidate.noTrades,1); assert.equal(report.candidate.winRate,null);
  assert.ok(report.baseline.observedQuoteDrawdownPercent! > 0);
  assert.equal(report.candidate.netPnlDollars,0);
  assert.ok(report.incrementalNetPnlDollars! > 0);
  assert.equal(report.profitabilityEstablished,false); assert.equal(report.executionAuthorized,false);
});

test("missing evidence remains an excluded pair, not a win or a zero loss", () => {
  const one = episode(); one.candidate.action = "unavailable";
  const report = compareFrozenCryptoModels([one],costs,window);
  assert.equal(report.paired.length,0); assert.equal(report.excluded.length,1);
  assert.equal(report.candidate.netPnlDollars,null); assert.equal(report.incrementalNetPnlDollars,null);
});

test("quarantined legacy, mismatched evidence, refitted models and training overlap are rejected", () => {
  const legacy = { ...episode(),sourceVersion:"ht_crypto_prox_observations" };
  const mismatch = episode(); mismatch.candidate.evidenceHash = "b".repeat(64);
  const refit = episode(); refit.candidate.frozenAt = at(10);
  for (const one of [legacy,mismatch,refit]) {
    assert.equal(compareFrozenCryptoModels([one],costs,window).paired.length,0);
  }
  assert.throws(()=>compareFrozenCryptoModels([],costs,{ ...window,trainingUntil:at(0) }),/window/);
});

test("duplicate aliases and overlapping portfolios cannot inflate sample size", () => {
  assert.throws(()=>compareFrozenCryptoModels([episode(),{ ...episode(),episodeId:"other" }],costs,window),/Duplicate/);
  const overlap = { ...episode(),episodeId:"overlap",decisionAt:at(60) };
  const report = compareFrozenCryptoModels([episode(),overlap],costs,window);
  assert.equal(report.paired.length,1); assert.equal(report.excluded[0].reason,"overlapping_portfolio_episode");
});

test("no-trades cannot disguise invalid identities, clocks or allocations", () => {
  for (const e of [{ ...episode(),identity:{ ...identity,provider:"other" } },
    { ...episode(),identity:{ ...identity,base:"OTHER" } },{ ...episode(),decisionAt:"bad" },
    { ...episode(),allocatedDollars:NaN }]) {
    assert.equal(simulateCryptoResearchChoice(e,e.candidate,costs,at(2000)).pnlDollars,null);
  }
  assert.throws(()=>compareFrozenCryptoModels([],{ ...costs,maxBookParticipation:2 },window),/bounded/);
});

test("later episodes cannot reuse capital lost earlier in the evaluation", () => {
  const first = { ...episode(),allocatedDollars:1000 };
  const second = { ...episode(),episodeId:"later",allocatedDollars:1000,decisionAt:at(600),
    books:[book(602,10),book(902,11)] };
  const report = compareFrozenCryptoModels([first,second],costs,window);
  assert.equal(report.paired.length,1);
  assert.equal(report.excluded[0].reason,"allocation_exceeds_remaining_study_capital");
  const conflict = { ...episode(),books:[book(2,10),book(120,9),book(120,99),book(302,11)] };
  assert.equal(simulate(conflict).reason,"conflicting_path_books");
});
