import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildHtAgentOutcomeUpdate, htAgentOutcomeEvidenceKey, planHtAgentOutcomeBatch, type HtAgentDueOutcome } from "./outcome-batch.ts";

const row = (overrides: Partial<HtAgentDueOutcome> = {}): HtAgentDueOutcome => ({
  id: "outcome-1",
  targetAt: "2026-09-03T15:00:00.000Z",
  symbol: "CHPT",
  proposedEntry: 7.5,
  cohort: "ht_agent_full",
  wouldEnter: true,
  conservativeSlippageBps: 25,
  ...overrides,
});

test("three cohorts reuse one exact provider-evidence key", () => {
  const rows = [
    row({ id: "1", cohort: "canonical_only" }),
    row({ id: "2", cohort: "canonical_prox" }),
    row({ id: "3", cohort: "ht_agent_full" }),
  ];
  const bar = { timeMs: Date.parse(rows[0].targetAt), open: 7.5, high: 7.7, low: 7.4, close: 7.6 };
  const plans = planHtAgentOutcomeBatch({
    rows,
    barsBySymbol: new Map([["CHPT", [bar]]]),
    failedSymbols: new Set(),
    observedAt: new Date("2026-09-03T15:20:00.000Z"),
  });
  assert.equal(new Set(plans.filter((plan) => plan.state === "measured").map((plan) => plan.evidenceKey)).size, 1);
  assert.equal(htAgentOutcomeEvidenceKey("CHPT", bar.timeMs), `CHPT|${bar.timeMs}`);
});

test("provider failure remains pending instead of fabricating an unavailable outcome", () => {
  const [plan] = planHtAgentOutcomeBatch({
    rows: [row()],
    barsBySymbol: new Map(),
    failedSymbols: new Set(["CHPT"]),
    observedAt: new Date("2026-09-03T16:00:00.000Z"),
  });
  assert.deepEqual(plan, { row: row(), state: "pending", reason: "provider_failed" });
});

test("verified missing bars become unavailable only after the existing policy window", () => {
  const [plan] = planHtAgentOutcomeBatch({
    rows: [row()],
    barsBySymbol: new Map([["CHPT", []]]),
    failedSymbols: new Set(),
    observedAt: new Date("2026-09-03T15:20:00.000Z"),
  });
  assert.equal(plan.state, "unavailable");
});

test("measured return applies conservative slippage only to would-enter cohorts", () => {
  const bar = { timeMs: Date.parse(row().targetAt), open: 7.5, high: 7.7, low: 7.4, close: 7.65 };
  const [plan] = planHtAgentOutcomeBatch({
    rows: [row()], barsBySymbol: new Map([["CHPT", [bar]]]), failedSymbols: new Set(),
    observedAt: new Date("2026-09-03T15:20:00.000Z"),
  });
  assert.equal(plan.state, "measured");
  if (plan.state !== "measured") return;
  const update = buildHtAgentOutcomeUpdate(plan, new Date("2026-09-03T15:20:00.000Z"), {
    bid: 7.64, ask: 7.66, timestamp: "2026-09-03T15:00:00.100Z",
  });
  assert.ok(Math.abs((update.returnPercent ?? 0) - 1.75) < 1e-9);
  assert.equal(update.resolutionState, "measured");
  assert.equal(update.price, 7.65);
  assert.ok((update.spreadPercent ?? 0) > 0);
});
