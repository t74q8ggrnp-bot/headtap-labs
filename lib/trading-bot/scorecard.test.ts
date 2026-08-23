import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner resolves this source module directly.
import { buildBotPerformanceScorecard } from "./scorecard.ts";

const trade = (
  overrides: Partial<{
    id: string;
    ticker: string;
    status: string;
    entry_price: number | null;
    entry_at: string | null;
    exit_price: number | null;
    exit_at: string | null;
    exit_reason: string | null;
    pnl: number | null;
    pnl_percent: number | null;
    bot_score: number | null;
    bot_logic_version: string | null;
    entry_snapshot: Record<string, unknown> | null;
  }> = {},
) => ({
  id: "trade",
  ticker: "TEST",
  status: "closed",
  entry_price: 10,
  entry_at: "2026-08-20T14:00:00.000Z",
  exit_price: 11,
  exit_at: "2026-08-20T15:00:00.000Z",
  exit_reason: "trailing_stop",
  pnl: 100,
  pnl_percent: 10,
  bot_score: 80,
  bot_logic_version: "bot-v3-unified-observed-quality",
  entry_snapshot: { botEntryPath: "continuation" },
  ...overrides,
});

test("does not count missing-P&L operational closures as flat trades", () => {
  const result = buildBotPerformanceScorecard([
    trade(),
    trade({
      id: "missing",
      ticker: "MISSING",
      exit_price: null,
      pnl: null,
      pnl_percent: null,
      exit_reason: "no_position_found",
    }),
  ]);

  assert.equal(result.entryLogicSummary.count, 1);
  assert.equal(result.entryLogicSummary.wins, 1);
  assert.equal(result.entryLogicSummary.flat, 0);
  assert.equal(result.operationalClosures.length, 1);
});

test("keeps orphan reconciliation P&L visible but out of entry logic", () => {
  const result = buildBotPerformanceScorecard([
    trade(),
    trade({
      id: "orphan",
      ticker: "MSGY",
      pnl: 80_000,
      pnl_percent: 1_100,
      bot_logic_version: "orphan-reconciliation-2026-08-11",
      entry_snapshot: { backfilled: true },
    }),
  ]);

  assert.equal(result.allRealizedSummary.totalPnl, 80_100);
  assert.equal(result.entryLogicSummary.totalPnl, 100);
  assert.equal(result.entryLogicSummary.count, 1);
  assert.equal(result.byEntryPath.orphan_reconciliation.count, 1);
});

test("shows whether one outlier carries total P&L", () => {
  const result = buildBotPerformanceScorecard([
    trade({ ticker: "MSGY", pnl: 80_000 }),
    trade({ id: "loss", ticker: "LOSS", pnl: -13_000, pnl_percent: -13 }),
  ]);

  assert.equal(result.entryLogicSummary.totalPnl, 67_000);
  assert.equal(result.entryLogicSummary.pnlWithoutLargestWinner, -13_000);
});

test("quarantines legacy scores above the v3 0-100 contract", () => {
  const result = buildBotPerformanceScorecard([
    trade({ bot_score: 126.26, bot_logic_version: "bot-v2-continuation-parity" }),
  ]);
  assert.equal(result.byScoreBucket.invalid_over_100_legacy.count, 1);
});
