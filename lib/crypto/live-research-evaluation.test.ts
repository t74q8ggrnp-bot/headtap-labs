import assert from "node:assert/strict";
import test from "node:test";
import type { CryptoLiveResearchInput } from "./live-research";
import type { CryptoEvaluationEpisode, CryptoHistoricalBook } from "./live-research-evaluation";
// @ts-expect-error Node's built-in TypeScript runner needs source extensions.
import { measureCryptoResearchOutcome, splitCryptoWalkForward } from "./live-research-evaluation.ts";

const now = Date.parse("2026-09-02T12:00:00Z");
const at = (seconds: number) => new Date(now + seconds * 1_000).toISOString();
const identity = { provider: "coinapi", marketId: "COINBASE_SPOT_TEST_USD", base: "TEST", quote: "USD" as const };
const input: CryptoLiveResearchInput = {
  identity, decisionAt: at(0), trade: { price: 10, asOf: at(-1) },
  book: { bid: 9.99, ask: 10.01, asOf: at(-1) }, candles: [], marketState: "normal",
};
const costs = { version: "fixture-v1", feeBpsPerSide: 10, slippageBpsPerSide: 5 };
const book = (seconds: number, bid = 11): CryptoHistoricalBook => ({
  identity, bid, ask: bid + 0.01, asOf: at(seconds), receivedAt: at(seconds + 1),
});
const measure = (books: CryptoHistoricalBook[], measuredAt = at(3_700)) =>
  measureCryptoResearchOutcome({ input, books, costs, measuredAt, horizonSeconds: 900 });

test("late processing uses each horizon's own book, never the current price", () => {
  const books = [book(900, 11), book(3_600, 20)];
  const first = measure(books);
  const second = measureCryptoResearchOutcome({ input, books, costs, measuredAt: at(3_700), horizonSeconds: 3_600 });
  assert.equal(first.exitAsOf, at(900)); assert.equal(second.exitAsOf, at(3_600));
  assert.ok(second.netReturnPercent! > first.netReturnPercent!);
  const expected = (11 * 0.9995 * 0.999 / (10.01 * 1.0005 * 1.001) - 1) * 100;
  assert.equal(first.netReturnPercent, expected);
});

test("missing horizon data stays unavailable, not a zero or a later quote", () => {
  for (const books of [[], [book(3_600)], [book(901)], [book(894)]]) {
    const result = measure(books);
    assert.equal(result.status, "unavailable"); assert.equal(result.netReturnPercent, null);
  }
  assert.equal(measure([book(895)]).status, "measured");
});

test("future availability, another venue and crossed quotes cannot measure an outcome", () => {
  assert.equal(measure([{ ...book(900), receivedAt: at(5_000) }]).status, "unavailable");
  assert.equal(measure([{ ...book(900), identity: { ...identity, marketId: "KRAKEN_SPOT_TEST_USD" } }]).status, "unavailable");
  assert.equal(measure([{ ...book(900), ask: 0 }]).status, "unavailable");
  assert.equal(measure([book(900), book(900, 99)]).status, "unavailable");
});

test("not due is pending, not a loss", () => {
  const result = measure([], at(500));
  assert.equal(result.status, "pending"); assert.equal(result.netReturnPercent, null);
});

test("stale entry prices cannot manufacture a profitable entry", () => {
  const result = measureCryptoResearchOutcome({ input: { ...input, book: { ...input.book!, asOf: at(-30) } },
    books: [book(900)], costs, measuredAt: at(1_000), horizonSeconds: 900 });
  assert.equal(result.status, "unavailable"); assert.equal(result.reason, "invalid_entry_book");
});

test("a flat market loses spread, fees and slippage in the simulation", () => {
  assert.ok(measure([book(900, 9.99)]).netReturnPercent! < 0);
});

const boundary = { modelVersion: "frozen-v1", trainingUntil: at(0), evaluationFrom: at(3_600),
  evaluationUntil: at(7_200), embargoMs: 300_000, reportAt: at(8_000) };
const episode = (id: string, start: number, end: number, available = end): CryptoEvaluationEpisode => ({
  episodeId: id, marketId: identity.marketId, modelVersion: "frozen-v1", decisionAt: at(start),
  outcomeAt: at(end), outcomeAvailableAt: at(available), netReturnPercent: 1,
});

test("walk-forward split purges overlapping outcomes and labels not yet available at training time", () => {
  const result = splitCryptoWalkForward([
    episode("train", -7_200, -3_600), episode("late-label", -7_200, -3_600, 100),
    episode("crosses-cutoff", -100, 100), episode("embargo", 100, 200),
    episode("test", 3_600, 4_500), episode("future", 7_100, 8_000),
  ], boundary);
  assert.deepEqual(result.training.map(row => row.episodeId), ["train"]);
  assert.deepEqual(result.evaluation.map(row => row.episodeId), ["test"]);
  assert.equal(result.excluded.length, 4);
  assert.equal(result.evaluationSummary.profitableEdgeEstablished, false);
});

test("model mixing, duplicates and missing labels cannot inflate evaluation", () => {
  const result = splitCryptoWalkForward([
    { ...episode("other-version", 3_600, 4_000), modelVersion: "refitted-v2" },
    { ...episode("missing", 3_600, 4_000), netReturnPercent: NaN },
  ], boundary);
  assert.equal(result.evaluationSummary.measuredEpisodes, 0);
  assert.equal(result.evaluationSummary.averageNetReturnPercent, null);
  assert.equal(result.evaluationSummary.positiveReturnRate, null);
  const row = episode("duplicate", 3_600, 4_000);
  assert.throws(() => splitCryptoWalkForward([row, row], boundary), /Duplicate/);
});

test("evaluation cannot overlap the training interval or embargo", () => {
  assert.throws(() => splitCryptoWalkForward([], { ...boundary, evaluationFrom: at(1) }), /boundaries/);
  assert.throws(() => splitCryptoWalkForward([], { ...boundary, reportAt: at(6_000) }), /boundaries/);
});
