// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_DECISION_VERSION, type HtAgentDecision, type HtAgentDecisionFrame, type HtAgentMode, type HtAgentRiskResult } from "./contracts.ts";

export function decideHtAgentAction(
  frame: HtAgentDecisionFrame,
  risk: HtAgentRiskResult,
  mode: HtAgentMode,
): HtAgentDecision {
  if (frame.paper.symbolPositionQuantity !== 0) {
    const unsafeMarketEvidence = risk.rules.filter((item) =>
      ["fresh_market_data", "market_session", "spread", "halt", "bad_print", "duplicate"].includes(item.code) && !item.passed,
    );
    if (unsafeMarketEvidence.length > 0) {
      return {
        version: HT_AGENT_DECISION_VERSION,
        action: "manage",
        explanation: `The paper position remains open, but risk-reducing execution is withheld until market evidence is safe: ${unsafeMarketEvidence.map((item) => item.message).join(" ")}`,
        risk,
        requiresApproval: false,
        executableInPaper: false,
      };
    }
    const stop = frame.canonical.proposedStop;
    const target = frame.canonical.proposedTarget;
    if (stop !== null && frame.market.price <= stop) {
      return {
        version: HT_AGENT_DECISION_VERSION,
        action: "exit",
        explanation: "The provider-time price crossed the immutable risk stop; exit is risk-reducing and paper-only.",
        risk,
        requiresApproval: mode === "approval_paper",
        executableInPaper: mode !== "observe",
      };
    }
    if (target !== null && frame.market.price >= target) {
      return {
        version: HT_AGENT_DECISION_VERSION,
        action: "reduce",
        explanation: "The provider-time price reached the modeled target; reduce simulated exposure and preserve a journaled remainder.",
        risk,
        requiresApproval: mode === "approval_paper",
        executableInPaper: mode !== "observe",
      };
    }
    return {
      version: HT_AGENT_DECISION_VERSION,
      action: "manage",
      explanation: "An open paper position exists and neither its stop nor target has triggered.",
      risk,
      requiresApproval: false,
      executableInPaper: false,
    };
  }

  if (!frame.canonical.eligible) {
    return {
      version: HT_AGENT_DECISION_VERSION,
      action: "reject",
      explanation: "Canonical did not authorize this candidate; HT Agent cannot promote it.",
      risk,
      requiresApproval: false,
      executableInPaper: false,
    };
  }
  if (frame.prox.stance === "veto") {
    return {
      version: HT_AGENT_DECISION_VERSION,
      action: "reject",
      explanation: `Independent ProX vetoed the paper entry: ${frame.prox.reasons[0] ?? "market-structure evidence failed"}.`,
      risk,
      requiresApproval: false,
      executableInPaper: false,
    };
  }
  if (!risk.allowed) {
    const failed = risk.rules.filter((item) => item.blocking && !item.passed);
    return {
      version: HT_AGENT_DECISION_VERSION,
      action: failed.some((item) => item.code.includes("fresh") || item.code.includes("timestamp"))
        ? "expire"
        : "reject",
      explanation: `Deterministic risk gate blocked the proposal: ${failed.map((item) => item.message).join(" ")}`,
      risk,
      requiresApproval: false,
      executableInPaper: false,
    };
  }
  if (mode === "observe") {
    return {
      version: HT_AGENT_DECISION_VERSION,
      action: "observe",
      explanation: "The setup cleared the paper policy but the profile is in Observe mode.",
      risk,
      requiresApproval: false,
      executableInPaper: false,
    };
  }
  if (mode === "approval_paper") {
    return {
      version: HT_AGENT_DECISION_VERSION,
      action: "prepare",
      explanation: "The setup cleared the deterministic paper policy and is waiting for explicit approval.",
      risk,
      requiresApproval: true,
      executableInPaper: false,
    };
  }
  return {
    version: HT_AGENT_DECISION_VERSION,
    action: "enter",
    explanation: "Canonical authorized the setup, ProX did not veto it, and every deterministic paper-risk rule passed.",
    risk,
    requiresApproval: false,
    executableInPaper: true,
  };
}

export function buildHtAgentCohorts(frame: HtAgentDecisionFrame, decision: HtAgentDecision) {
  const canonicalWouldEnter = frame.canonical.eligible;
  const proxWouldEnter = canonicalWouldEnter && frame.prox.stance !== "veto";
  return [
    { cohort: "canonical_only", wouldEnter: canonicalWouldEnter, reason: canonicalWouldEnter ? "Canonical eligible" : "Canonical rejected" },
    { cohort: "canonical_prox", wouldEnter: proxWouldEnter, reason: frame.prox.stance === "veto" ? "Independent ProX veto" : `ProX ${frame.prox.stance}` },
    { cohort: "ht_agent_full", wouldEnter: decision.action === "enter" || decision.action === "prepare", reason: decision.explanation },
  ] as const;
}
