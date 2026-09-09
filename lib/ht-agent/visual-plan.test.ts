import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_DECISION_VERSION, HT_AGENT_FRAME_VERSION } from "./contracts.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { buildAgentXVisualPlan, resolveAgentXVisualPlanExpiration } from "./visual-plan.ts";

function input() {
  return {
    decisionId: "00000000-0000-4000-8000-000000000010",
    mode: "observe" as const,
    sessionBoundary: "2026-09-09T20:00:00.000Z",
    frame: {
      version: HT_AGENT_FRAME_VERSION,
      frameId: "00000000-0000-4000-8000-000000000011",
      capturedAt: "2026-09-09T13:30:22.000Z",
      market: {
        symbol: "TEST", price: 10, bid: 9.99, ask: 10.01, spreadPercent: 0.2,
        volume: 2_000_000, dollarVolume: 20_000_000, relativeVolume: 3,
        providerTimestamp: "2026-09-09T13:30:20.000Z",
        quoteProviderTimestamp: "2026-09-09T13:30:19.000Z",
        source: "massive_polygon_realtime", marketSession: "regular" as const,
        sessionHighPrice: 10.1, pullbackFromSessionHighPercent: 0.99,
        halted: false, badPrint: false,
      },
      canonical: {
        sourceRunId: "00000000-0000-4000-8000-000000000012",
        sourceLane: "momentum" as const,
        sourceProviderTimestamp: "2026-09-09T13:30:20.000Z",
        engineVersion: "canonical-v1", decisionTimestamp: "2026-09-09T13:30:21.000Z",
        eligible: true, rank: 1, tier: "hero", score: 90, strategy: "spot_momentum",
        reasons: [], proposedEntry: 10, proposedStop: 9.5, proposedTarget: 11,
        proposedTargetTwo: 12, support: 9.5, resistance: 11, riskReward: 2,
        entryQuality: 80, extensionRisk: 20, whatChanged: "Participation accelerated.",
        riskNote: "Momentum can fail.", riskTags: [],
      },
      prox: {
        runId: "00000000-0000-4000-8000-000000000013",
        decisionTimestamp: "2026-09-09T13:30:00.000Z", stance: "support" as const,
        disposition: "selected", edgeScore: 80, evidenceConfidence: 70,
        structure: {
          measurable: true, structuralSupport: 9.6, invalidationPrice: 9.5,
          resistancePrice: 11, scenarioRiskReward: 2, extensionAtrMultiple: 1,
          extended: false, postPeakFailure: false, severePeakFailure: false,
        }, reasons: [],
      },
      catalyst: { state: "verified" as const, score: 20, tags: [], observedAt: "2026-09-09T13:29:00.000Z" },
      paper: {
        accountId: "00000000-0000-4000-8000-000000000014", equity: 100_000,
        buyingPower: 100_000, cash: 100_000, dailyPnl: 0, grossExposure: 0,
        openPositionCount: 0, symbolPositionQuantity: 0, symbolPositionValue: 0,
        pendingOrderForSymbol: false,
      },
    },
    decision: {
      version: HT_AGENT_DECISION_VERSION,
      action: "observe" as const,
      explanation: "Observe the paper setup.", requiresApproval: false,
      executableInPaper: false,
      risk: {
        policyVersion: "ht-agent-risk-v3-evidence", allowed: true, rules: [],
        quantity: 100, proposedEntry: 10, proposedStop: 9.5, proposedTarget: 11,
        maximumRisk: 50, estimatedNotional: 1_000,
      },
    },
  };
}

test("builds one honest long paper plan from the existing decision and risk evidence", () => {
  const result = buildAgentXVisualPlan(input() as never);
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.plan.executionAuthority, "none");
  assert.equal(result.plan.paperOnly, true);
  assert.equal(result.plan.direction, "long");
  assert.equal(result.plan.expiresAt, "2026-09-09T13:46:00.000Z");
  assert.deepEqual(result.plan.chartObjects.filter((item) => item.authority === "agent").map((item) => item.type), [
    "price_zone", "price_line", "price_line", "price_line", "price_line",
  ]);
  assert.equal(result.plan.chartObjects.some((item) => item.authority === "prox"), true);
});

test("never manufactures a plan when levels or deterministic risk are unavailable", () => {
  const missingStop = input();
  missingStop.decision.risk.proposedStop = null as never;
  missingStop.frame.canonical.proposedStop = null as never;
  assert.deepEqual(buildAgentXVisualPlan(missingStop as never), {
    available: false,
    code: "levels_unavailable",
    reason: "Entry, invalidation and target levels are not completely measurable and correctly ordered.",
  });
  const blocked = input();
  blocked.decision.risk.allowed = false;
  assert.equal(buildAgentXVisualPlan(blocked as never).available, false);
  const targetBelowTrigger = input();
  targetBelowTrigger.frame.market.sessionHighPrice = 11.5;
  assert.equal(buildAgentXVisualPlan(targetBelowTrigger as never).available, false);
});

test("does not generate independent ProX objects from unmeasurable evidence", () => {
  const value = input();
  value.frame.prox.structure.measurable = false;
  const result = buildAgentXVisualPlan(value as never);
  assert.equal(result.available, true);
  if (result.available) assert.equal(result.plan.chartObjects.some((item) => item.authority === "prox"), false);
});

test("does not render a duplicate second target when legacy evidence adds no new level", () => {
  const value = input();
  value.frame.canonical.proposedTargetTwo = value.frame.canonical.proposedTarget;
  const result = buildAgentXVisualPlan(value as never);
  assert.equal(result.available, true);
  if (!result.available) return;
  assert.equal(result.plan.targetTwo, null);
  assert.equal(result.plan.chartObjects.some(
    (item) => item.type === "price_line" && item.role === "target_2",
  ), false);
});

test("bounds expiration by the applicable session boundary", () => {
  assert.equal(resolveAgentXVisualPlanExpiration({
    providerTimestamp: "2026-09-09T19:52:20.000Z",
    sessionBoundary: "2026-09-09T20:00:00.000Z",
  }), "2026-09-09T20:00:00.000Z");
});
