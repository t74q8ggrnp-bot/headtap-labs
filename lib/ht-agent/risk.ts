// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_POLICY_VERSION, type HtAgentDecisionFrame, type HtAgentRiskPolicy, type HtAgentRiskResult, type HtAgentRiskRule } from "./contracts.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { nullableAgentNumber as finite } from "./evidence.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { evaluateHtAgentMarketTiming } from "./market-timing.ts";

export const DEFAULT_HT_AGENT_RISK_POLICY: HtAgentRiskPolicy = {
  version: HT_AGENT_POLICY_VERSION,
  maxMarketAgeSeconds: 90,
  maxSourceAlignmentSeconds: 120,
  maxSpreadPercent: 3,
  minDollarVolume: 250_000,
  maxPositionRiskPercent: 1,
  maxPositionValuePercent: 12,
  maxGrossExposurePercent: 60,
  maxDailyDrawdownPercent: 3,
  maxOpenPositions: 6,
  riskBudgetPercent: 0.5,
  conservativeSlippageBps: 25,
  minimumRiskReward: 1.5,
  minimumEntryQuality: 55,
  maximumExtensionRisk: 65,
};

export function resolveHtAgentRiskPolicy(overrides: Record<string, unknown> | null): HtAgentRiskPolicy {
  const policy = { ...DEFAULT_HT_AGENT_RISK_POLICY };
  for (const key of Object.keys(DEFAULT_HT_AGENT_RISK_POLICY)) {
    if (key === "version") continue;
    const value = finite(overrides?.[key]);
    if (value !== null) policy[key as Exclude<keyof HtAgentRiskPolicy, "version">] = value;
  }
  return policy;
}

export function htAgentRootFailures(rules: HtAgentRiskRule[]): HtAgentRiskRule[] {
  return rules.filter((item) => item.blocking && !item.passed && item.status !== "not_evaluated");
}

const alignmentSeconds = (timestamps: Array<string | null>) => {
  const times = timestamps.flatMap((value) => {
    if (!value) return [];
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? [parsed] : [];
  });
  return times.length < 2 ? Infinity : (Math.max(...times) - Math.min(...times)) / 1000;
};

function rule(
  code: string,
  passed: boolean,
  observed: HtAgentRiskRule["observed"],
  limit: HtAgentRiskRule["limit"],
  message: string,
  blocking = true,
): HtAgentRiskRule {
  return { code, passed, blocking, observed, limit, message, status: passed ? "passed" : "failed" };
}

export type HtAgentRiskContext = {
  now?: Date;
  globalKillSwitch: boolean;
  profileKillSwitch: boolean;
  duplicateDecision: boolean;
};

export function evaluateHtAgentRisk(
  frame: HtAgentDecisionFrame,
  context: HtAgentRiskContext,
  policy: HtAgentRiskPolicy = DEFAULT_HT_AGENT_RISK_POLICY,
): HtAgentRiskResult {
  const nowMs = (context.now ?? new Date()).getTime();
  const marketTiming = evaluateHtAgentMarketTiming(
    frame.market.providerTimestamp, frame.market.quoteProviderTimestamp,
    nowMs, policy.maxMarketAgeSeconds,
  );
  const alignment = alignmentSeconds([
    frame.market.providerTimestamp,
    frame.market.quoteProviderTimestamp ?? null,
    frame.canonical.decisionTimestamp,
    frame.prox.decisionTimestamp,
    frame.catalyst.observedAt,
  ]);
  const spread = finite(frame.market.spreadPercent);
  const equity = Math.max(0, finite(frame.paper.equity) ?? 0);
  const buyingPower = Math.max(0, finite(frame.paper.buyingPower) ?? 0);
  const canonicalEntry = finite(frame.canonical.proposedEntry);
  const marketPrice = finite(frame.market.price);
  const entry = canonicalEntry !== null && canonicalEntry > 0
    ? canonicalEntry
    : marketPrice !== null && marketPrice > 0
      ? marketPrice
      : null;
  const stop = finite(frame.canonical.proposedStop);
  const target = finite(frame.canonical.proposedTarget);
  const perShareRisk = entry !== null && stop !== null && stop > 0 && stop < entry
    ? entry - stop
    : null;
  const riskBudget = equity * (policy.riskBudgetPercent / 100);
  const quantityByRisk = perShareRisk && perShareRisk > 0
    ? Math.floor(riskBudget / perShareRisk)
    : 0;
  const quantityByValue = entry && entry > 0
    ? Math.floor((equity * policy.maxPositionValuePercent / 100) / entry)
    : 0;
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByValue));
  const estimatedNotional = entry ? quantity * entry : 0;
  const maximumRisk = perShareRisk ? quantity * perShareRisk : 0;
  const dailyDrawdownPercent = equity > 0
    ? Math.max(0, -frame.paper.dailyPnl / equity * 100)
    : Infinity;
  const grossExposurePercent = equity > 0
    ? frame.paper.grossExposure / equity * 100
    : Infinity;
  const projectedExposurePercent = equity > 0
    ? (frame.paper.grossExposure + estimatedNotional) / equity * 100
    : Infinity;
  const projectedRiskPercent = equity > 0 ? maximumRisk / equity * 100 : Infinity;
  const modeledRiskReward =
    entry !== null && stop !== null && target !== null && stop > 0 && stop < entry && target > entry
      ? (target - entry) / (entry - stop)
      : null;
  const entryQuality = finite(frame.canonical.entryQuality);
  const extensionRisk = finite(frame.canonical.extensionRisk);

  const rules: HtAgentRiskRule[] = [
    rule("global_kill_switch", !context.globalKillSwitch, context.globalKillSwitch, false, "Global kill switch must be off."),
    rule("profile_kill_switch", !context.profileKillSwitch, context.profileKillSwitch, false, "Profile kill switch must be off."),
    rule("canonical_eligible", frame.canonical.eligible, frame.canonical.eligible, true, "Canonical must authorize the candidate."),
    { ...rule("fresh_market_data", marketTiming.fresh, marketTiming.observedAgeSeconds, policy.maxMarketAgeSeconds, "Massive price and NBBO must each have a fresh, non-future provider timestamp."), marketTiming: marketTiming.evidence },
    rule("timestamp_alignment", marketTiming.available && alignment <= policy.maxSourceAlignmentSeconds, Number.isFinite(alignment) ? Number(alignment.toFixed(1)) : null, policy.maxSourceAlignmentSeconds, "Price, NBBO and decision evidence must be timestamp-aligned."),
    rule("market_session", frame.market.marketSession === "regular", frame.market.marketSession, "regular", "Phase 1 paper execution is limited to the regular session; other sessions remain observable."),
    rule("spread", spread !== null && spread >= 0 && spread <= policy.maxSpreadPercent, spread, policy.maxSpreadPercent, "NBBO spread must be measurable and within policy."),
    rule("liquidity", frame.market.dollarVolume >= policy.minDollarVolume, frame.market.dollarVolume, policy.minDollarVolume, "Dollar volume must meet the liquidity floor."),
    rule("halt", !frame.market.halted, frame.market.halted, false, "Halted symbols cannot enter."),
    rule("bad_print", !frame.market.badPrint, frame.market.badPrint, false, "Bad-print conditions cannot enter."),
    rule(
      "trade_levels",
      modeledRiskReward !== null,
      modeledRiskReward === null ? "unmeasurable" : Number(modeledRiskReward.toFixed(2)),
      "measurable stop and target",
      "Entry, invalidation, and continuation target must be measurable and correctly ordered.",
    ),
    rule(
      "risk_reward",
      modeledRiskReward !== null && modeledRiskReward >= policy.minimumRiskReward,
      modeledRiskReward === null ? null : Number(modeledRiskReward.toFixed(2)),
      policy.minimumRiskReward,
      "Modeled reward/risk must clear the HT Agent paper floor.",
    ),
    rule(
      "entry_quality",
      entryQuality !== null && entryQuality >= policy.minimumEntryQuality,
      entryQuality,
      policy.minimumEntryQuality,
      "Canonical entry quality must be measurable and clear the Agent floor.",
    ),
    rule(
      "extension",
      extensionRisk !== null && extensionRisk <= policy.maximumExtensionRisk,
      extensionRisk,
      policy.maximumExtensionRisk,
      "Current extension risk is too high for a new paper entry.",
    ),
    rule("duplicate", !context.duplicateDecision && !frame.paper.pendingOrderForSymbol, context.duplicateDecision || frame.paper.pendingOrderForSymbol, false, "Duplicate decisions and pending symbol orders are blocked."),
    rule("position_count", frame.paper.openPositionCount < policy.maxOpenPositions || frame.paper.symbolPositionQuantity !== 0, frame.paper.openPositionCount, policy.maxOpenPositions, "Open-position limit must be available."),
    rule("position_absent", frame.paper.symbolPositionQuantity === 0, frame.paper.symbolPositionQuantity, 0, "A new entry cannot duplicate an existing position."),
    rule("daily_drawdown", dailyDrawdownPercent <= policy.maxDailyDrawdownPercent, Number(dailyDrawdownPercent.toFixed(2)), policy.maxDailyDrawdownPercent, "Daily drawdown limit cannot be exceeded."),
    rule("gross_exposure", projectedExposurePercent <= policy.maxGrossExposurePercent, Number(projectedExposurePercent.toFixed(2)), policy.maxGrossExposurePercent, "Projected gross exposure must remain within policy."),
    rule("position_risk", quantity > 0 && projectedRiskPercent <= policy.maxPositionRiskPercent, Number(projectedRiskPercent.toFixed(3)), policy.maxPositionRiskPercent, "Position risk must be measurable and within policy."),
    rule("buying_power", estimatedNotional > 0 && estimatedNotional <= buyingPower, Number(estimatedNotional.toFixed(2)), Number(buyingPower.toFixed(2)), "Buying power must cover the simulated order."),
    rule("existing_exposure_observed", grossExposurePercent <= policy.maxGrossExposurePercent, Number(grossExposurePercent.toFixed(2)), policy.maxGrossExposurePercent, "Existing gross exposure is already above policy.", false),
  ];
  // Distinguish absent evidence from an actual measured threshold violation.
  const unavailable = (code: string, message: string) => {
    const item = rules.find((candidate) => candidate.code === code)!;
    Object.assign(item, { passed: false, status: "unavailable", observed: null, message });
  };
  if (!marketTiming.available) {
    unavailable("fresh_market_data", "Price or NBBO provider time is missing or invalid; no replacement timestamp was assumed.");
    unavailable("timestamp_alignment", "Alignment cannot be verified without both price and NBBO provider timestamps.");
  }
  if (spread === null) unavailable("spread", "NBBO spread is unavailable; a measured spread is required.");
  if (entryQuality === null) unavailable("entry_quality", "Canonical entry quality is unavailable; no quality score was assumed.");
  if (extensionRisk === null) unavailable("extension", "Extension risk is unavailable; it was not treated as low risk.");
  if (entry === null || stop === null || target === null) {
    unavailable("trade_levels", "Entry, invalidation, or continuation target is missing; a complete measurable setup is required.");
  }

  const defer = (code: string, dependsOn: string[], message: string) => {
    const item = rules.find((candidate) => candidate.code === code)!;
    // Unevaluable still blocks execution; it is not a pass or a waived gate.
    Object.assign(item, { passed: false, status: "not_evaluated", observed: null, dependsOn, message });
  };
  if (modeledRiskReward === null) {
    defer("risk_reward", ["trade_levels"], "Reward/risk cannot be evaluated until the trade levels are measurable and correctly ordered.");
  }
  if (perShareRisk === null) {
    defer("position_risk", ["trade_levels"], "Position risk cannot be sized without a valid entry and positive invalidation below it.");
  }
  if (quantity === 0) {
    const dependency = perShareRisk === null ? "trade_levels" : "position_risk";
    defer("buying_power", [dependency], "Buying-power sufficiency was not evaluated because no order could be sized; this is not an insufficient-funds finding.");
    defer("gross_exposure", [dependency], "Projected exposure cannot be evaluated until the order can be sized.");
  }
  return {
    policyVersion: policy.version,
    allowed: rules.every((item) => !item.blocking || item.passed),
    rules,
    quantity,
    proposedEntry: entry,
    proposedStop: stop,
    proposedTarget: target,
    maximumRisk: Number(maximumRisk.toFixed(2)),
    estimatedNotional: Number(estimatedNotional.toFixed(2)),
  };
}
