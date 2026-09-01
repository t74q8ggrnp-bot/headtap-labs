export const HT_AGENT_FRAME_VERSION = "ht-agent-frame-v1" as const;
export const HT_AGENT_POLICY_VERSION = "ht-agent-risk-v1" as const;
export const HT_AGENT_DECISION_VERSION = "ht-agent-decision-v1" as const;
export const HT_AGENT_COHORT_VERSION = "ht-agent-cohorts-v1" as const;

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
};

export type HtAgentProxEvidence = {
  runId: string | null;
  decisionTimestamp: string | null;
  stance: ProxAgentStance;
  disposition: string | null;
  edgeScore: number | null;
  evidenceConfidence: number | null;
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
