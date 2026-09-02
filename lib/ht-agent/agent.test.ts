import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { decideHtAgentAction } from "./decision.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { chronologicalWalkForward } from "./evaluation.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { evaluateHtAgentRisk } from "./risk.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_AGENT_FRAME_VERSION } from "./contracts.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildHtTradePlan } from "./trade-plan.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getEasternDayStart, getHtAgentSessionCloseTarget } from "./time.ts";

function frame(overrides: Record<string, unknown> = {}) {
  const base = {
    version: HT_AGENT_FRAME_VERSION,
    frameId: "00000000-0000-4000-8000-000000000001",
    capturedAt: "2026-09-01T13:10:30.000Z",
    market: {
      symbol: "TEST", price: 0.5, bid: 0.495, ask: 0.505, spreadPercent: 2,
      volume: 4_000_000, dollarVolume: 2_000_000, relativeVolume: 6,
      providerTimestamp: "2026-09-01T13:10:20.000Z", source: "massive_polygon_realtime",
      marketSession: "regular", sessionHighPrice: 0.55,
      pullbackFromSessionHighPercent: 9.091, halted: false, badPrint: false,
    },
    canonical: {
      sourceRunId: "00000000-0000-4000-8000-000000000002", engineVersion: "canonical-test",
      decisionTimestamp: "2026-09-01T13:10:25.000Z", eligible: true, rank: 1,
      tier: "hero", score: 90, strategy: "spot_momentum", reasons: [],
      proposedEntry: 0.5, proposedStop: 0.45, proposedTarget: 0.65,
      proposedTargetTwo: 0.75, support: 0.45, resistance: 0.65,
      riskReward: 3, entryQuality: 80, extensionRisk: 25,
      whatChanged: "Price and participation accelerated on the aligned provider-time frame.",
      riskNote: "Momentum can fail if the breakout loses support.",
      riskTags: ["High Volatility"],
    },
    prox: {
      runId: "00000000-0000-4000-8000-000000000003",
      decisionTimestamp: "2026-09-01T13:10:00.000Z", stance: "support",
      disposition: "selected", edgeScore: 82, evidenceConfidence: 75, reasons: [],
      structure: {
        measurable: true, structuralSupport: 0.45, invalidationPrice: 0.45,
        resistancePrice: 0.65, scenarioRiskReward: 3, extensionAtrMultiple: 1.5,
        extended: false, postPeakFailure: false, severePeakFailure: false,
      },
    },
    catalyst: { state: "verified", score: 40, tags: ["filing"], observedAt: "2026-09-01T13:10:00.000Z" },
    paper: {
      accountId: "00000000-0000-4000-8000-000000000004", equity: 100_000,
      buyingPower: 100_000, cash: 100_000, dailyPnl: 0, grossExposure: 0,
      openPositionCount: 0, symbolPositionQuantity: 0, symbolPositionValue: 0,
      pendingOrderForSymbol: false,
    },
  };
  return { ...base, ...overrides };
}

const context = {
  now: new Date("2026-09-01T13:10:30.000Z"),
  globalKillSwitch: false,
  profileKillSwitch: false,
  duplicateDecision: false,
};

test("allows a sub-dollar Canonical candidate when every real risk rule passes", () => {
  const result = evaluateHtAgentRisk(frame() as never, context);
  assert.equal(result.allowed, true);
  assert.ok(result.quantity > 0);
  assert.equal(result.rules.some((item) => item.code.includes("price_floor")), false);
});

test("fails closed for stale, misaligned, wide-spread, halted, bad-print, and duplicate inputs", () => {
  const stale = frame({
    market: { ...(frame().market), providerTimestamp: "2026-09-01T13:00:00.000Z", spreadPercent: 7, halted: true, badPrint: true },
    paper: { ...(frame().paper), pendingOrderForSymbol: true },
  });
  const result = evaluateHtAgentRisk(stale as never, { ...context, duplicateDecision: true });
  assert.equal(result.allowed, false);
  for (const code of ["fresh_market_data", "timestamp_alignment", "spread", "halt", "bad_print", "duplicate"]) {
    assert.equal(result.rules.find((item) => item.code === code)?.passed, false, code);
  }
});

test("kill switch, daily drawdown, exposure, and buying power are non-overridable", () => {
  const constrained = frame({
    paper: { ...(frame().paper), equity: 10_000, buyingPower: 1, dailyPnl: -500, grossExposure: 7_000, openPositionCount: 6 },
  });
  const result = evaluateHtAgentRisk(constrained as never, { ...context, globalKillSwitch: true });
  assert.equal(result.allowed, false);
  for (const code of ["global_kill_switch", "position_count", "daily_drawdown", "gross_exposure", "buying_power"]) {
    assert.equal(result.rules.find((item) => item.code === code)?.passed, false, code);
  }
});

test("modes produce observe, approval proposal, and paper-autopilot entry without changing upstream scores", () => {
  const input = frame() as never;
  const risk = evaluateHtAgentRisk(input, context);
  assert.equal(decideHtAgentAction(input, risk, "observe").action, "observe");
  assert.equal(decideHtAgentAction(input, risk, "approval_paper").action, "prepare");
  const auto = decideHtAgentAction(input, risk, "paper_autopilot");
  assert.equal(auto.action, "enter");
  assert.equal(auto.executableInPaper, true);
});

test("backend trade plan exposes one honest paper setup without changing the public score", () => {
  const input = frame();
  const risk = evaluateHtAgentRisk(input as never, context);
  const decision = decideHtAgentAction(input as never, risk, "observe");
  const plan = buildHtTradePlan(input as never, decision, "observe");
  assert.equal(plan.status, "paper_entry_eligible");
  assert.equal(plan.executionLocked, true);
  assert.equal(plan.actionable, false);
  assert.deepEqual(plan.entryZone, { low: 0.495, high: 0.505 });
  assert.equal(plan.confirmationTrigger, 0.55);
  assert.equal(plan.invalidation, 0.45);
  assert.equal(plan.targetOne, 0.65);
  assert.equal(plan.targetTwo, 0.75);
  assert.equal(plan.riskReward, 3);
  assert.equal(input.canonical.score, 90);
});

test("trade plan withholds entry instead of inventing levels when structure is not measurable", () => {
  const input = frame({
    canonical: {
      ...(frame().canonical),
      proposedStop: null,
      proposedTarget: null,
      proposedTargetTwo: null,
      riskReward: null,
    },
  }) as never;
  const decision = decideHtAgentAction(input, evaluateHtAgentRisk(input, context), "approval_paper");
  const plan = buildHtTradePlan(input, decision, "approval_paper");
  assert.equal(plan.status, "avoid");
  assert.equal(plan.entryZone, null);
  assert.equal(plan.invalidation, null);
  assert.equal(plan.targetOne, null);
  assert.match(plan.whatInvalidates, /No honest invalidation/);
});

test("weak reward and excessive extension remain visible momentum but are not paper entries", () => {
  const weakReward = frame({
    canonical: {
      ...(frame().canonical),
      proposedStop: 0.45,
      proposedTarget: 0.54,
      riskReward: 0.8,
    },
  }) as never;
  const weakDecision = decideHtAgentAction(
    weakReward,
    evaluateHtAgentRisk(weakReward, context),
    "paper_autopilot",
  );
  assert.equal(buildHtTradePlan(weakReward, weakDecision, "paper_autopilot").status, "avoid");

  const extended = frame({
    canonical: { ...(frame().canonical), extensionRisk: 90 },
  }) as never;
  const extendedDecision = decideHtAgentAction(
    extended,
    evaluateHtAgentRisk(extended, context),
    "paper_autopilot",
  );
  const extendedPlan = buildHtTradePlan(extended, extendedDecision, "paper_autopilot");
  assert.equal(extendedPlan.status, "wait");
  assert.equal(extendedPlan.chaseRisk, "high");
  assert.equal(extendedPlan.entryZone, null);
});

test("stale evidence produces unavailable status and no actionable paper levels", () => {
  const input = frame({
    market: { ...(frame().market), providerTimestamp: "2026-09-01T13:00:00.000Z" },
  }) as never;
  const decision = decideHtAgentAction(input, evaluateHtAgentRisk(input, context), "paper_autopilot");
  const plan = buildHtTradePlan(input, decision, "paper_autopilot");
  assert.equal(plan.status, "unavailable");
  assert.equal(plan.actionable, false);
  assert.equal(plan.entryZone, null);
});

test("independent ProX may veto but may not manufacture Canonical eligibility", () => {
  const vetoFrame = frame({ prox: { ...(frame().prox), stance: "veto", reasons: ["halt-like tape discontinuity"] } }) as never;
  const risk = evaluateHtAgentRisk(vetoFrame, context);
  assert.equal(decideHtAgentAction(vetoFrame, risk, "paper_autopilot").action, "reject");
  const canonicalReject = frame({ canonical: { ...(frame().canonical), eligible: false }, prox: { ...(frame().prox), stance: "support" } }) as never;
  const rejectedRisk = evaluateHtAgentRisk(canonicalReject, context);
  assert.equal(decideHtAgentAction(canonicalReject, rejectedRisk, "paper_autopilot").action, "reject");
});

test("paper lifecycle moves deterministically from entry to manage to exit", () => {
  const initial = frame() as never;
  const initialRisk = evaluateHtAgentRisk(initial, context);
  assert.equal(decideHtAgentAction(initial, initialRisk, "paper_autopilot").action, "enter");
  const open = frame({ paper: { ...(frame().paper), symbolPositionQuantity: 100, symbolPositionValue: 50, openPositionCount: 1 } }) as never;
  assert.equal(decideHtAgentAction(open, evaluateHtAgentRisk(open, context), "paper_autopilot").action, "manage");
  const stopped = frame({
    market: { ...(frame().market), price: 0.44 },
    paper: { ...(frame().paper), symbolPositionQuantity: 100, symbolPositionValue: 44, openPositionCount: 1 },
  }) as never;
  assert.equal(decideHtAgentAction(stopped, evaluateHtAgentRisk(stopped, context), "paper_autopilot").action, "exit");
});

test("Approval Paper creates explicit exit proposals while kill switches never create new exposure", () => {
  const stopped = frame({
    market: { ...(frame().market), price: 0.44 },
    paper: { ...(frame().paper), symbolPositionQuantity: 100, symbolPositionValue: 44, openPositionCount: 1 },
  }) as never;
  const stoppedRisk = evaluateHtAgentRisk(stopped, { ...context, globalKillSwitch: true });
  const exit = decideHtAgentAction(stopped, stoppedRisk, "approval_paper");
  assert.equal(exit.action, "exit");
  assert.equal(exit.requiresApproval, true);
  assert.equal(exit.executableInPaper, true);

  const blockedEntry = frame() as never;
  const blockedRisk = evaluateHtAgentRisk(blockedEntry, { ...context, globalKillSwitch: true });
  assert.equal(decideHtAgentAction(blockedEntry, blockedRisk, "paper_autopilot").action, "reject");
});

test("closed sessions and unsafe provider evidence fail closed", () => {
  const closed = frame({ market: { ...(frame().market), marketSession: "closed" } }) as never;
  assert.equal(evaluateHtAgentRisk(closed, context).allowed, false);
  const unsafePosition = frame({
    market: { ...(frame().market), providerTimestamp: "2026-09-01T12:00:00.000Z" },
    paper: { ...(frame().paper), symbolPositionQuantity: 100, symbolPositionValue: 50, openPositionCount: 1 },
  }) as never;
  const decision = decideHtAgentAction(unsafePosition, evaluateHtAgentRisk(unsafePosition, context), "paper_autopilot");
  assert.equal(decision.action, "manage");
  assert.equal(decision.executableInPaper, false);
});

test("walk-forward evaluation never overlaps training and evaluation time", () => {
  const samples = Array.from({ length: 9 }, (_, index) => ({
    observedAt: new Date(Date.UTC(2026, 8, 1, 13, index)).toISOString(), value: index,
  }));
  const folds = chronologicalWalkForward(samples, 4, 2);
  assert.equal(folds.length, 3);
  for (const fold of folds) {
    assert.ok(Date.parse(fold.train.at(-1)!.observedAt) < Date.parse(fold.evaluate[0].observedAt));
  }
});

test("Eastern day boundaries and session-close horizons remain DST and weekend aware", () => {
  assert.equal(getEasternDayStart("2026-09-01T13:10:00.000Z"), "2026-09-01T04:00:00.000Z");
  assert.equal(getEasternDayStart("2026-12-01T15:00:00.000Z"), "2026-12-01T05:00:00.000Z");
  assert.equal(getHtAgentSessionCloseTarget("2026-09-01T13:10:00.000Z"), "2026-09-01T20:00:00.000Z");
  assert.equal(getHtAgentSessionCloseTarget("2026-08-28T21:00:00.000Z"), "2026-08-31T20:00:00.000Z");
});
