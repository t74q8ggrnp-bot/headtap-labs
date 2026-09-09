import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildHtAgentCohorts, decideHtAgentAction } from "./decision.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { chronologicalWalkForward } from "./evaluation.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { DEFAULT_HT_AGENT_RISK_POLICY, evaluateHtAgentRisk, htAgentRootFailures, resolveHtAgentRiskPolicy } from "./risk.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { HT_AGENT_FRAME_VERSION } from "./contracts.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { buildHtTradePlan } from "./trade-plan.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { getEasternDayStart, getHtAgentSessionCloseTarget, getHtAgentVisualPlanSessionBoundary } from "./time.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { nullableAgentNumber } from "./evidence.ts";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { isHtAgentRiskAuditComplete } from "./risk-audit.ts";

function frame(overrides: Record<string, unknown> = {}) {
  const base = {
    version: HT_AGENT_FRAME_VERSION,
    frameId: "00000000-0000-4000-8000-000000000001",
    capturedAt: "2026-09-01T13:10:30.000Z",
    market: {
      symbol: "TEST", price: 0.5, bid: 0.495, ask: 0.505, spreadPercent: 2,
      volume: 4_000_000, dollarVolume: 2_000_000, relativeVolume: 6,
      providerTimestamp: "2026-09-01T13:10:20.000Z", source: "massive_polygon_realtime",
      quoteProviderTimestamp: "2026-09-01T13:10:19.000Z",
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

test("price and NBBO require their own valid non-future clocks in every Agent mode", () => {
  const invalidTimes = [undefined, null, "", "invalid", "2026-09-01T12:10:00Z", "2026-09-01T13:10:30.001Z"];
  for (const field of ["providerTimestamp", "quoteProviderTimestamp"]) {
    for (const timestamp of invalidTimes) {
      const input = frame({ market: { ...frame().market, [field]: timestamp } }) as never;
      const risk = evaluateHtAgentRisk(input, context);
      assert.equal(risk.allowed, false, `${field}: ${timestamp}`);
      const freshness = risk.rules.find(item => item.code === "fresh_market_data")!;
      assert.equal(freshness.passed, false);
      assert.equal(isHtAgentRiskAuditComplete(JSON.parse(JSON.stringify(risk.rules)), risk.allowed, { requireMarketTiming: true }), true);
      for (const mode of ["observe", "approval_paper", "paper_autopilot"] as const) {
        const decision = decideHtAgentAction(input, risk, mode);
        assert.equal(decision.executableInPaper, false);
        assert.equal(decision.requiresApproval, false);
        const cohorts = buildHtAgentCohorts(input, decision);
        assert.equal(cohorts.find(item => item.cohort === "ht_agent_full")?.wouldEnter, false);
      }
    }
  }
});

test("freshness includes exact NBBO age boundaries without rounding a stale source into a pass", () => {
  for (const [timestamp, passes] of [
    ["2026-09-01T13:09:00.000Z", true],
    ["2026-09-01T13:08:59.999Z", false],
    ["2026-09-01T13:10:30.000Z", true],
  ] as const) {
    const input = frame({ market: { ...frame().market, quoteProviderTimestamp: timestamp } }) as never;
    const risk = evaluateHtAgentRisk(input, context);
    assert.equal(risk.allowed, passes);
    assert.equal(isHtAgentRiskAuditComplete(risk.rules, risk.allowed, { requireMarketTiming: true }), true);
  }
});

test("NBBO participates in alignment even when a profile permits older market evidence", () => {
  const input = frame({ market: { ...frame().market, quoteProviderTimestamp: "2026-09-01T13:07:00Z" } }) as never;
  const risk = evaluateHtAgentRisk(input, context, { ...DEFAULT_HT_AGENT_RISK_POLICY, maxMarketAgeSeconds: 300 });
  assert.equal(risk.rules.find(item => item.code === "fresh_market_data")?.passed, true);
  assert.equal(risk.rules.find(item => item.code === "timestamp_alignment")?.passed, false);
  assert.equal(risk.allowed, false);
});

test("position exits cannot use an old or unavailable NBBO refreshed by a new price", () => {
  for (const timestamp of [null, "2026-09-01T12:00:00Z", "2026-09-01T14:00:00Z"]) {
    const input = frame({
      market: { ...frame().market, price: 0.44, quoteProviderTimestamp: timestamp },
      paper: { ...frame().paper, symbolPositionQuantity: 100, symbolPositionValue: 44, openPositionCount: 1 },
    }) as never;
    const decision = decideHtAgentAction(input, evaluateHtAgentRisk(input, context), "paper_autopilot");
    assert.equal(decision.action, "manage");
    assert.equal(decision.executableInPaper, false);
  }
});

test("current timestamp audits reject missing or contradictory receipts without rewriting legacy decisions", () => {
  const risk = evaluateHtAgentRisk(frame() as never, context);
  const historical = structuredClone(risk.rules);
  delete historical.find(item => item.code === "fresh_market_data")!.marketTiming;
  assert.equal(isHtAgentRiskAuditComplete(historical, true), true);
  assert.equal(isHtAgentRiskAuditComplete(historical, true, { requireMarketTiming: true }), false);
  const tampered = structuredClone(risk.rules);
  tampered.find(item => item.code === "fresh_market_data")!.marketTiming!.nbbo.providerTimestamp = "2026-09-01T12:00:00Z";
  assert.equal(isHtAgentRiskAuditComplete(tampered, true, { requireMarketTiming: true }), false);
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

test("non-positive stops can never become a sized paper proposal", () => {
  for (const proposedStop of [0, -0.01]) {
    const invalid = frame({
      canonical: {
        ...(frame().canonical),
        proposedStop,
        proposedTarget: 0.75,
      },
    }) as never;
    const result = evaluateHtAgentRisk(invalid, context);
    assert.equal(result.allowed, false);
    assert.equal(result.quantity, 0);
    assert.equal(result.maximumRisk, 0);
    assert.equal(result.rules.find((item) => item.code === "trade_levels")?.passed, false);
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

test("shadow qualification is mode-independent without enabling Observe execution", () => {
  const input = frame() as never;
  const before = structuredClone(input);
  const risk = evaluateHtAgentRisk(input, context);
  const decisions = (["observe", "approval_paper", "paper_autopilot"] as const)
    .map((mode) => decideHtAgentAction(input, risk, mode));
  const cohorts = decisions.map((decision) => buildHtAgentCohorts(input, decision));
  assert.deepEqual(cohorts[0], cohorts[1]);
  assert.deepEqual(cohorts[1], cohorts[2]);
  assert.equal(cohorts[0].find((row) => row.cohort === "ht_agent_full")?.wouldEnter, true);
  assert.equal(decisions[0].requiresApproval, false);
  assert.equal(decisions[0].executableInPaper, false);
  assert.equal(decisions[1].requiresApproval, true);
  assert.equal(decisions[1].executableInPaper, false);
  assert.deepEqual(input, before);
});

test("full-Agent cohort still excludes vetoes, kill switches, existing positions and every failed gate", () => {
  const cases = [
    frame({ prox: { ...frame().prox, stance: "veto" } }),
    frame({ canonical: { ...frame().canonical, eligible: false } }),
    frame({ paper: { ...frame().paper, symbolPositionQuantity: 10 } }),
    frame({ market: { ...frame().market, spreadPercent: null } }),
    frame({ paper: { ...frame().paper, pendingOrderForSymbol: true } }),
  ];
  for (const mode of ["observe", "approval_paper", "paper_autopilot"] as const) {
    for (const input of cases) {
      const risk = evaluateHtAgentRisk(input as never, context);
      const decision = decideHtAgentAction(input as never, risk, mode);
      assert.equal(buildHtAgentCohorts(input as never, decision)[2].wouldEnter, false);
    }
    for (const switchName of ["globalKillSwitch", "profileKillSwitch"] as const) {
      const input = frame() as never;
      const risk = evaluateHtAgentRisk(input, { ...context, [switchName]: true });
      assert.equal(buildHtAgentCohorts(input, decideHtAgentAction(input, risk, mode))[2].wouldEnter, false);
    }
  }
});

test("numeric evidence keeps missing, malformed, and measured zero distinct", () => {
  for (const value of [null, undefined, "", "  ", false, true, [], [0], {}, NaN, Infinity, -Infinity, "NaN", "Infinity"]) {
    assert.equal(nullableAgentNumber(value), null, String(value));
  }
  for (const value of [0, "0", " 0 "]) assert.equal(nullableAgentNumber(value), 0);
  assert.equal(nullableAgentNumber("0.1282"), 0.1282);
});

test("unknown spreads and extension fail closed but actual zero measurements remain valid", () => {
  for (const missing of [null, undefined, "", " ", false, true, [], {}, NaN, Infinity]) {
    const input = frame({
      market: { ...frame().market, spreadPercent: missing },
      canonical: { ...frame().canonical, extensionRisk: missing, entryQuality: missing },
    }) as never;
    const result = evaluateHtAgentRisk(input, context);
    assert.equal(result.allowed, false);
    for (const code of ["spread", "extension", "entry_quality"]) {
      const rule = result.rules.find((item) => item.code === code)!;
      assert.equal(rule.status, "unavailable");
      assert.equal(rule.observed, null);
      assert.equal(rule.passed, false);
    }
    const decision = decideHtAgentAction(input, result, "paper_autopilot");
    assert.equal(decision.executableInPaper, false);
    assert.equal(buildHtTradePlan(input, decision, "paper_autopilot").chaseRisk, "unmeasured");
    assert.equal(isHtAgentRiskAuditComplete(result.rules, result.allowed), true);
  }
  const zero = frame({
    market: { ...frame().market, spreadPercent: 0 },
    canonical: { ...frame().canonical, extensionRisk: 0 },
  }) as never;
  assert.equal(evaluateHtAgentRisk(zero, context).allowed, true);
});

test("a missing stop blocks on its root cause, not fictitious insufficient buying power", () => {
  for (const proposedStop of [null, undefined, "", false]) {
    const input = frame({ canonical: { ...frame().canonical, proposedStop } }) as never;
    const risk = evaluateHtAgentRisk(input, context);
    assert.equal(risk.allowed, false);
    assert.equal(risk.proposedStop, null);
    assert.equal(risk.quantity, 0);
    assert.deepEqual(htAgentRootFailures(risk.rules).map((rule) => rule.code), ["trade_levels"]);
    for (const code of ["risk_reward", "position_risk", "buying_power", "gross_exposure"]) {
      const rule = risk.rules.find((item) => item.code === code)!;
      assert.equal(rule.status, "not_evaluated");
      assert.equal(rule.passed, false);
      assert.equal(rule.blocking, true);
      assert.equal(rule.observed, null);
      assert.deepEqual(rule.dependsOn, ["trade_levels"]);
    }
    const decision = decideHtAgentAction(input, risk, "paper_autopilot");
    assert.equal(decision.action, "reject");
    assert.equal(decision.executableInPaper, false);
    assert.doesNotMatch(decision.explanation, /Buying power|Position risk|reward\/risk must/i);
    assert.equal(isHtAgentRiskAuditComplete(JSON.parse(JSON.stringify(risk.rules)), false), true);
  }
});

test("measurable threshold failures remain real failures with unchanged thresholds", () => {
  const input = frame({
    canonical: { ...frame().canonical, proposedTarget: 0.54 },
    paper: { ...frame().paper, buyingPower: 1 },
  }) as never;
  const risk = evaluateHtAgentRisk(input, context);
  for (const code of ["risk_reward", "buying_power"]) {
    const rule = risk.rules.find((item) => item.code === code)!;
    assert.equal(rule.status, "failed");
    assert.equal(rule.passed, false);
    assert.equal(typeof rule.observed, "number");
  }
  assert.equal(risk.allowed, false);
  const { version, ...thresholds } = DEFAULT_HT_AGENT_RISK_POLICY;
  assert.equal(version, "ht-agent-risk-v3-evidence");
  assert.deepEqual(thresholds, {
    maxMarketAgeSeconds: 90, maxSourceAlignmentSeconds: 120, maxSpreadPercent: 3,
    minDollarVolume: 250_000, maxPositionRiskPercent: 1, maxPositionValuePercent: 12,
    maxGrossExposurePercent: 60, maxDailyDrawdownPercent: 3, maxOpenPositions: 6,
    riskBudgetPercent: 0.5, conservativeSlippageBps: 25, minimumRiskReward: 1.5,
    minimumEntryQuality: 55, maximumExtensionRisk: 65,
  });
});

test("profile overrides do not turn null or blank into a zero threshold", () => {
  for (const value of [null, undefined, "", " ", false, true, [], {}, NaN]) {
    assert.deepEqual(resolveHtAgentRiskPolicy({ minimumRiskReward: value }), DEFAULT_HT_AGENT_RISK_POLICY);
  }
  assert.equal(resolveHtAgentRiskPolicy({ maximumExtensionRisk: "55" }).maximumExtensionRisk, 55);
  assert.equal(resolveHtAgentRiskPolicy({ maxOpenPositions: 0 }).maxOpenPositions, 0);
  assert.deepEqual(resolveHtAgentRiskPolicy({ unsupportedRule: 1, version: "bad" }), DEFAULT_HT_AGENT_RISK_POLICY);
});

test("persisted risk audit rejects absent, contradicted, waived and disconnected rules", () => {
  const risk = evaluateHtAgentRisk(frame() as never, context);
  assert.equal(isHtAgentRiskAuditComplete(risk.rules, true), true);
  assert.equal(isHtAgentRiskAuditComplete([], true), false);
  assert.equal(isHtAgentRiskAuditComplete(risk.rules.slice(1), true), false);
  assert.equal(isHtAgentRiskAuditComplete(risk.rules, false), false);
  for (const change of [
    { status: undefined }, { passed: false }, { blocking: false },
    { status: "not_evaluated", passed: false, observed: null, dependsOn: ["nonexistent"] },
  ]) {
    const modified = risk.rules.map((rule) => rule.code === "spread" ? { ...rule, ...change } : rule);
    assert.equal(isHtAgentRiskAuditComplete(modified, true), false);
  }
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
  assert.equal(plan.status, "wait");
  assert.doesNotMatch(plan.statusLabel, /avoid/i);
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
  assert.equal(buildHtTradePlan(weakReward, weakDecision, "paper_autopilot").status, "wait");

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

test("visual plans use the active provider-time session boundary", () => {
  assert.equal(getHtAgentVisualPlanSessionBoundary("2026-09-09T12:15:00.000Z", "premarket"), "2026-09-09T13:30:00.000Z");
  assert.equal(getHtAgentVisualPlanSessionBoundary("2026-09-09T15:15:00.000Z", "regular"), "2026-09-09T20:00:00.000Z");
  assert.equal(getHtAgentVisualPlanSessionBoundary("2026-09-09T21:15:00.000Z", "after_hours"), "2026-09-10T00:00:00.000Z");
  assert.equal(getHtAgentVisualPlanSessionBoundary("bad", "regular"), null);
  assert.equal(getHtAgentVisualPlanSessionBoundary("2026-09-09T15:15:00.000Z", "closed"), null);
});
