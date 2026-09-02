// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_POLICY_VERSION, type HtAgentDecisionFrame, type HtAgentRiskPolicy, type HtAgentRiskResult, type HtAgentRiskRule } from "./contracts.ts";

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

const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ageSeconds = (timestamp: string, nowMs: number) => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 1000) : Infinity;
};

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
  return { code, passed, blocking, observed, limit, message };
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
  const marketAge = ageSeconds(frame.market.providerTimestamp, nowMs);
  const alignment = alignmentSeconds([
    frame.market.providerTimestamp,
    frame.canonical.decisionTimestamp,
    frame.prox.decisionTimestamp,
    frame.catalyst.observedAt,
  ]);
  const spread = finite(frame.market.spreadPercent);
  const equity = Math.max(0, finite(frame.paper.equity) ?? 0);
  const buyingPower = Math.max(0, finite(frame.paper.buyingPower) ?? 0);
  const entry = finite(frame.canonical.proposedEntry) ?? finite(frame.market.price);
  const stop = finite(frame.canonical.proposedStop);
  const target = finite(frame.canonical.proposedTarget);
  const perShareRisk = entry !== null && stop !== null && stop < entry ? entry - stop : null;
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
    entry !== null && stop !== null && target !== null && stop < entry && target > entry
      ? (target - entry) / (entry - stop)
      : null;
  const entryQuality = finite(frame.canonical.entryQuality);
  const extensionRisk = finite(frame.canonical.extensionRisk);

  const rules: HtAgentRiskRule[] = [
    rule("global_kill_switch", !context.globalKillSwitch, context.globalKillSwitch, false, "Global kill switch must be off."),
    rule("profile_kill_switch", !context.profileKillSwitch, context.profileKillSwitch, false, "Profile kill switch must be off."),
    rule("canonical_eligible", frame.canonical.eligible, frame.canonical.eligible, true, "Canonical must authorize the candidate."),
    rule("fresh_market_data", marketAge <= policy.maxMarketAgeSeconds, Number(marketAge.toFixed(1)), policy.maxMarketAgeSeconds, "Massive provider-time data must be fresh."),
    rule("timestamp_alignment", alignment <= policy.maxSourceAlignmentSeconds, Number(alignment.toFixed(1)), policy.maxSourceAlignmentSeconds, "Decision evidence must be timestamp-aligned."),
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
