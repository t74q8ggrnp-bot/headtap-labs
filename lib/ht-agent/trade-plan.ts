// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_TRADE_PLAN_VERSION, type HtAgentDecision, type HtAgentDecisionFrame, type HtAgentMode, type HtTradePlan, type HtTradePlanStatus } from "./contracts.ts";

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const finitePositive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const failedCodes = (decision: HtAgentDecision) => new Set(
  decision.risk.rules
    .filter((rule) => rule.blocking && !rule.passed)
    .map((rule) => rule.code),
);

const hasAny = (codes: Set<string>, candidates: string[]) =>
  candidates.some((candidate) => codes.has(candidate));

function statusLabel(status: HtTradePlanStatus, mode: HtAgentMode) {
  if (status === "paper_entry_eligible") {
    return mode === "observe" ? "PAPER SETUP ELIGIBLE · OBSERVE" : "PAPER ENTRY ELIGIBLE";
  }
  return {
    wait: "WAIT",
    manage: "MANAGE PAPER POSITION",
    reduce: "PROTECT PAPER PROFIT",
    exit: "PAPER EXIT TRIGGERED",
    avoid: "AVOID CURRENT SETUP",
    unavailable: "DECISION UNAVAILABLE",
  }[status];
}

function planStatus(
  frame: HtAgentDecisionFrame,
  decision: HtAgentDecision,
): HtTradePlanStatus {
  if (frame.paper.symbolPositionQuantity !== 0) {
    if (decision.action === "exit") return "exit";
    if (decision.action === "reduce") return "reduce";
    return "manage";
  }
  if (!frame.canonical.eligible || frame.prox.stance === "veto") return "avoid";
  const failed = failedCodes(decision);
  if (hasAny(failed, ["fresh_market_data", "timestamp_alignment"])) return "unavailable";
  if (hasAny(failed, ["halt", "bad_print", "trade_levels", "risk_reward", "liquidity", "spread"])) {
    return "avoid";
  }
  if (failed.size > 0) return "wait";
  return "paper_entry_eligible";
}

function chaseRisk(frame: HtAgentDecisionFrame): HtTradePlan["chaseRisk"] {
  const extension = Number(frame.canonical.extensionRisk);
  const pullback = Number(frame.market.pullbackFromSessionHighPercent);
  if (!Number.isFinite(extension)) return "unmeasured";
  if (extension >= 65 || (Number.isFinite(pullback) && pullback >= 12)) return "high";
  if (extension >= 40 || (Number.isFinite(pullback) && pullback >= 6)) return "medium";
  return "low";
}

function whyNow(frame: HtAgentDecisionFrame) {
  const parts = [frame.canonical.whatChanged.trim()].filter(Boolean);
  if (frame.market.relativeVolume > 0) {
    parts.push(`${frame.market.relativeVolume.toFixed(1)}x relative volume is present in the aligned Canonical frame.`);
  }
  if (frame.prox.stance === "support") parts.push("Independent ProX supports the current structure.");
  if (frame.prox.stance === "warn") parts.push("Independent ProX is warning on the current structure.");
  return parts.join(" ") || "The backend has not produced a measurable timing reason yet.";
}

function whyCouldLose(frame: HtAgentDecisionFrame, invalidation: number | null) {
  const warning = frame.prox.stance === "warn" || frame.prox.stance === "veto"
    ? frame.prox.reasons[0]
    : null;
  const base = warning || frame.canonical.riskNote || frame.canonical.riskTags[0];
  const invalidationText = invalidation === null
    ? "No honest invalidation level is currently measurable."
    : `A provider-time move through ${invalidation.toFixed(4)} invalidates the modeled structure.`;
  return [base, invalidationText].filter(Boolean).join(" ");
}

export function buildHtTradePlan(
  frame: HtAgentDecisionFrame,
  decision: HtAgentDecision,
  mode: HtAgentMode,
): HtTradePlan {
  const status = planStatus(frame, decision);
  const entry = finitePositive(decision.risk.proposedEntry);
  const stop = finitePositive(decision.risk.proposedStop);
  const targetOne = finitePositive(decision.risk.proposedTarget);
  const targetTwo = finitePositive(frame.canonical.proposedTargetTwo);
  const bid = finitePositive(frame.market.bid);
  const ask = finitePositive(frame.market.ask);
  const orderedQuote = bid !== null && ask !== null && ask >= bid;
  const eligibleEntryBand = status === "paper_entry_eligible" && orderedQuote
    ? { low: round(bid), high: round(ask) }
    : null;
  const sessionHigh = finitePositive(frame.market.sessionHighPrice);
  const confirmationTrigger = status === "paper_entry_eligible"
    ? sessionHigh !== null && sessionHigh >= frame.market.price
      ? sessionHigh
      : ask ?? entry
    : null;
  const riskReward = entry !== null && stop !== null && targetOne !== null && stop < entry && targetOne > entry
    ? round((targetOne - entry) / (entry - stop), 2)
    : null;
  const executionLocked =
    mode === "observe" ||
    decision.risk.rules.some((rule) =>
      ["global_kill_switch", "profile_kill_switch"].includes(rule.code) && !rule.passed,
    );

  let summary = decision.explanation;
  if (status === "paper_entry_eligible") {
    summary = executionLocked
      ? "The setup clears the measurable market gates, but paper execution remains locked or observe-only."
      : "The setup clears the current backend tradeability and deterministic paper-risk gates.";
  } else if (status === "wait") {
    summary = "Momentum may still deserve attention, but HT Agent is withholding a paper entry at the current price.";
  } else if (status === "avoid") {
    summary = "The stock may be moving, but the current setup does not provide an acceptable paper entry.";
  } else if (status === "unavailable") {
    summary = "HT Agent cannot issue a current plan because the required provider-time evidence is stale or misaligned.";
  }

  const confirmation = confirmationTrigger === null
    ? "No entry confirmation is currently measurable; wait for a fresh aligned decision frame."
    : `A fresh Canonical frame must remain eligible at or above ${confirmationTrigger.toFixed(4)}, with ProX not vetoing and spread/liquidity still inside policy.`;
  const invalidationText = stop === null
    ? "No honest invalidation is measurable, so a new paper entry is withheld."
    : `The modeled setup is invalid below ${stop.toFixed(4)}.`;

  return {
    version: HT_TRADE_PLAN_VERSION,
    symbol: frame.market.symbol,
    status,
    statusLabel: statusLabel(status, mode),
    actionable: status === "paper_entry_eligible" && !executionLocked,
    paperOnly: true,
    executionLocked,
    currentPrice: round(frame.market.price),
    entryZone: eligibleEntryBand,
    confirmationTrigger: confirmationTrigger === null ? null : round(confirmationTrigger),
    invalidation: stop === null ? null : round(stop),
    targetOne: targetOne === null ? null : round(targetOne),
    targetTwo: targetTwo === null ? null : round(targetTwo),
    riskReward,
    chaseRisk: chaseRisk(frame),
    summary,
    whyNow: whyNow(frame),
    whatConfirms: confirmation,
    whatInvalidates: invalidationText,
    whyCouldLose: whyCouldLose(frame, stop),
    evidenceAsOf: frame.market.providerTimestamp,
  };
}
