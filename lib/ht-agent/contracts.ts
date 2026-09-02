export const HT_AGENT_FRAME_VERSION = "ht-agent-frame-v1" as const;
export const HT_AGENT_POLICY_VERSION = "ht-agent-risk-v2-tradeability" as const;
export const HT_AGENT_DECISION_VERSION = "ht-agent-decision-v2-trade-plan" as const;
export const HT_AGENT_COHORT_VERSION = "ht-agent-cohorts-v1" as const;
export const HT_TRADE_PLAN_VERSION = "ht-trade-plan-v1" as const;

export type HtAgentMode = "observe" | "approval_paper" | "paper_autopilot";
export type HtAgentAction =
  | "observe"
  | "prepare"
  | "enter"
  | "manage"
  | "reduce"
  | "exit"
  | "reject"
  | "expire";
export type ProxAgentStance = "support" | "warn" | "veto" | "abstain";
export type HtTradePlanStatus =
  | "wait"
  | "paper_entry_eligible"
  | "manage"
  | "reduce"
  | "exit"
  | "avoid"
  | "unavailable";

export type HtAgentMarketFacts = {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spreadPercent: number | null;
  volume: number;
  dollarVolume: number;
  relativeVolume: number;
  providerTimestamp: string;
  source: string;
  marketSession: "regular" | "premarket" | "after_hours" | "closed";
  sessionHighPrice: number | null;
  pullbackFromSessionHighPercent: number | null;
  halted: boolean;
  badPrint: boolean;
};

export type HtAgentCanonicalEvidence = {
  sourceRunId: string;
  engineVersion: string;
  decisionTimestamp: string;
  eligible: boolean;
  rank: number | null;
  tier: string;
  score: number;
  strategy: string;
  reasons: string[];
  proposedEntry: number | null;
  proposedStop: number | null;
  proposedTarget: number | null;
  proposedTargetTwo: number | null;
  support: number | null;
  resistance: number | null;
  riskReward: number | null;
  entryQuality: number | null;
  extensionRisk: number | null;
  whatChanged: string;
  riskNote: string;
  riskTags: string[];
};

export type HtAgentProxEvidence = {
  runId: string | null;
  decisionTimestamp: string | null;
  stance: ProxAgentStance;
  disposition: string | null;
  edgeScore: number | null;
  evidenceConfidence: number | null;
  structure: {
    measurable: boolean;
    structuralSupport: number | null;
    invalidationPrice: number | null;
    resistancePrice: number | null;
    scenarioRiskReward: number | null;
    extensionAtrMultiple: number | null;
    extended: boolean;
    postPeakFailure: boolean;
    severePeakFailure: boolean;
  } | null;
  reasons: string[];
};

export type HtAgentCatalystEvidence = {
  state: "verified" | "unverified" | "contradicted" | "unavailable";
  score: number;
  tags: string[];
  observedAt: string | null;
};

export type HtAgentPaperState = {
  accountId: string;
  equity: number;
  buyingPower: number;
  cash: number;
  dailyPnl: number;
  grossExposure: number;
  openPositionCount: number;
  symbolPositionQuantity: number;
  symbolPositionValue: number;
  pendingOrderForSymbol: boolean;
};

export type HtAgentDecisionFrame = {
  version: typeof HT_AGENT_FRAME_VERSION;
  frameId: string;
  capturedAt: string;
  market: HtAgentMarketFacts;
  canonical: HtAgentCanonicalEvidence;
  prox: HtAgentProxEvidence;
  catalyst: HtAgentCatalystEvidence;
  paper: HtAgentPaperState;
};

export type HtAgentRiskPolicy = {
  version: typeof HT_AGENT_POLICY_VERSION;
  maxMarketAgeSeconds: number;
  maxSourceAlignmentSeconds: number;
  maxSpreadPercent: number;
  minDollarVolume: number;
  maxPositionRiskPercent: number;
  maxPositionValuePercent: number;
  maxGrossExposurePercent: number;
  maxDailyDrawdownPercent: number;
  maxOpenPositions: number;
  riskBudgetPercent: number;
  conservativeSlippageBps: number;
  minimumRiskReward: number;
  minimumEntryQuality: number;
  maximumExtensionRisk: number;
};

export type HtAgentRiskRule = {
  code: string;
  passed: boolean;
  blocking: boolean;
  observed: number | string | boolean | null;
  limit: number | string | boolean | null;
  message: string;
};

export type HtAgentRiskResult = {
  policyVersion: string;
  allowed: boolean;
  rules: HtAgentRiskRule[];
  quantity: number;
  proposedEntry: number | null;
  proposedStop: number | null;
  proposedTarget: number | null;
  maximumRisk: number;
  estimatedNotional: number;
};

export type HtAgentDecision = {
  version: typeof HT_AGENT_DECISION_VERSION;
  action: HtAgentAction;
  explanation: string;
  risk: HtAgentRiskResult;
  requiresApproval: boolean;
  executableInPaper: boolean;
};

export type HtTradePlan = {
  version: typeof HT_TRADE_PLAN_VERSION;
  symbol: string;
  status: HtTradePlanStatus;
  statusLabel: string;
  actionable: boolean;
  paperOnly: true;
  executionLocked: boolean;
  currentPrice: number;
  entryZone: { low: number; high: number } | null;
  confirmationTrigger: number | null;
  invalidation: number | null;
  targetOne: number | null;
  targetTwo: number | null;
  riskReward: number | null;
  chaseRisk: "low" | "medium" | "high" | "unmeasured";
  summary: string;
  whyNow: string;
  whatConfirms: string;
  whatInvalidates: string;
  whyCouldLose: string;
  evidenceAsOf: string;
};
