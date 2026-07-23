import type { TradeFrameworkResult } from "@/lib/canonical-trade-framework";
import type { MarketStock, TradeFrameworkDisplay } from "@/lib/contracts/market";

export type OpportunityStrategy = "spot_momentum" | "before_the_crowd";
export type OpportunityTier = "scanner" | "watch" | "feature" | "hero";

export type Opportunity = {
  ticker: string;
  price: number;
  change: number;
  opportunityType: string;
  opportunityScore: number;
  qualityScore: number;
  breakoutPotentialScore: number;
  breakoutPotentialLabel: string;
  floatDataStatus: "unavailable" | "verified";
  momentumScore: number;
  attentionScore: number;
  riskScore: number;
  stage: string;
  stageEmoji: string;
  confidence: number;
  whyItMatters: string;
  whatChanged: string;
  riskNote: string;
  signals: string[];
  isBeforeCrowd: boolean;
  catalystScore: number;
  catalystTags: string[];
  riskTags: string[];
  relativeVolume: number;
  crowdStage: number;
  scannedAt: string | null;
  freshnessLabel: string;
  tradeFramework?: TradeFrameworkResult | null;
  strategy?: OpportunityStrategy;
  signalStrength?: number;
  strategyScore?: number;
  displayedConfidence?: number;
  tier?: OpportunityTier;
  eligibility?: { eligible: boolean; reasons: string[] };
  engineVersion?: string;
  sourceRunId?: string;
  _convictionTier?: string;
  _isCatalyst?: boolean;
};

export type OpportunityStock = MarketStock;

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function normalizeOpportunity(raw: any): Opportunity {
  const ticker = String(raw?.ticker ?? "").toUpperCase();
  const eligible = Boolean(raw?.eligibility?.eligible ?? raw?.eligible);
  const eligibilityReasons = Array.isArray(raw?.eligibility?.reasons)
    ? raw.eligibility.reasons.map(String)
    : Array.isArray(raw?.rejectionReasons)
      ? raw.rejectionReasons.map(String)
      : [];
  const tier = raw?.tier as OpportunityTier | undefined;

  return {
    ticker,
    price: numberValue(raw?.price),
    change: numberValue(raw?.change ?? raw?.change_percent),
    opportunityType: String(
      raw?.opportunityType ??
        (numberValue(raw?.catalystScore ?? raw?.catalyst_score) >= 20
          ? "catalyst"
          : "momentum"),
    ),
    opportunityScore: numberValue(raw?.strategyScore ?? raw?.opportunityScore),
    qualityScore: numberValue(raw?.qualityScore ?? raw?.strategyScore ?? raw?.opportunityScore),
    breakoutPotentialScore: numberValue(raw?.breakoutPotentialScore),
    breakoutPotentialLabel: String(raw?.breakoutPotentialLabel ?? "Limited"),
    floatDataStatus: raw?.floatDataStatus === "verified" ? "verified" : "unavailable",
    momentumScore: numberValue(raw?.momentumScore ?? raw?.momentum_score),
    attentionScore: numberValue(
      raw?.crowdScore ?? raw?.attentionScore ?? raw?.crowd_score,
      50,
    ),
    riskScore: numberValue(raw?.trapScore ?? raw?.riskScore ?? raw?.trap_score, 50),
    stage: String(tier ?? raw?.stage ?? "Watch"),
    stageEmoji:
      tier === "hero" ? "🔥" : tier === "feature" ? "⚡" : tier === "watch" ? "👀" : "🔎",
    confidence: numberValue(
      raw?.displayedConfidence ?? raw?.confidence ?? raw?.strategyScore,
    ),
    whyItMatters: String(
      raw?.whyItMatters ??
        (eligible
          ? `${ticker} passed the canonical opportunity gate.`
          : `${ticker} is not currently eligible for feature placement.`),
    ),
    whatChanged: String(
      raw?.whatChanged ??
        raw?.signalState ??
        raw?.state ??
        "Canonical backend evaluation updated.",
    ),
    riskNote: String(
      raw?.riskNote ??
        raw?.eligibility?.reasons?.[0] ??
        raw?.tradeFramework?.warnings?.[0] ??
        "Entry timing and risk still require discipline.",
    ),
    signals: Array.isArray(raw?.signals)
      ? raw.signals.map(String)
      : [
          ...(numberValue(raw?.change) > 0
            ? [`Up ${numberValue(raw.change).toFixed(1)}%`]
            : []),
          ...(numberValue(raw?.relativeVolume) >= 1.2
            ? [`${numberValue(raw.relativeVolume).toFixed(1)}x relative volume`]
            : []),
        ],
    isBeforeCrowd: raw?.strategy === "before_the_crowd" && eligible,
    catalystScore: numberValue(raw?.catalystScore ?? raw?.catalyst_score),
    catalystTags: Array.isArray(raw?.catalystTags) ? raw.catalystTags.map(String) : [],
    riskTags: Array.isArray(raw?.riskTags) ? raw.riskTags.map(String) : [],
    relativeVolume: numberValue(raw?.relativeVolume ?? raw?.relative_volume),
    crowdStage: numberValue(raw?.crowdStage),
    scannedAt: raw?.scannedAt ?? raw?.scanned_at ?? null,
    freshnessLabel: String(raw?.freshnessLabel ?? "Live Scan"),
    tradeFramework: raw?.tradeFramework ?? null,
    strategy: raw?.strategy,
    signalStrength: numberValue(raw?.signalStrength),
    strategyScore: numberValue(raw?.strategyScore ?? raw?.opportunityScore),
    displayedConfidence: numberValue(raw?.displayedConfidence ?? raw?.confidence),
    tier,
    eligibility: { eligible, reasons: eligibilityReasons },
    engineVersion: raw?.engineVersion,
    sourceRunId: raw?.sourceRunId,
  };
}

export function opportunityToStock(opportunity: Opportunity): OpportunityStock {
  return {
    symbol: opportunity.ticker,
    price: opportunity.price,
    change: opportunity.change,
    relativeVolume: opportunity.relativeVolume,
    catalystScore: opportunity.catalystScore,
    htSignalScore: opportunity.opportunityScore,
    momentumScore: opportunity.momentumScore,
    crowdScore: opportunity.attentionScore,
    trapScore: opportunity.riskScore,
    signalState: opportunity.stage,
    signalPattern: opportunity.signals[2] ?? opportunity.stage,
    changePercent: opportunity.change,
  };
}

export function selectDistinctBeforeCrowd(
  opportunities: Opportunity[],
  spotMomentumTicker?: string,
) {
  return (
    opportunities.find((opportunity) => opportunity.ticker !== spotMomentumTicker) ??
    opportunities[0] ??
    null
  );
}

export function mergeOpportunityLists(...lists: unknown[][]) {
  const merged = new Map<string, Opportunity>();
  for (const raw of lists.flat()) {
    const opportunity = normalizeOpportunity(raw);
    if (!opportunity.ticker) continue;
    const existing = merged.get(opportunity.ticker);
    merged.set(
      opportunity.ticker,
      existing
        ? {
            ...existing,
            ...opportunity,
            opportunityScore: Math.max(
              existing.opportunityScore,
              opportunity.opportunityScore,
            ),
            isBeforeCrowd: existing.isBeforeCrowd || opportunity.isBeforeCrowd,
          }
        : opportunity,
    );
  }
  return [...merged.values()];
}

export function getOpportunityPresentation(opportunity: Opportunity) {
  const saturation = Math.max(0, Math.min(100, opportunity.attentionScore));
  const risk = Math.max(0, Math.min(100, opportunity.riskScore));
  const confidence = Math.max(0, Math.min(100, opportunity.confidence));
  const score = Math.max(0, Math.min(100, opportunity.opportunityScore));

  return {
    score,
    saturation,
    windowOpen: 100 - saturation,
    confidenceLabel: confidence >= 80 ? "HIGH" : confidence >= 65 ? "MEDIUM" : "LOW",
    riskLabel: risk >= 70 ? "HIGH" : risk >= 45 ? "MEDIUM" : "LOW",
    positionLabel:
      opportunity.freshnessLabel === "Last Verified Signal"
        ? "VERIFIED"
        : saturation < 40
          ? "EARLY"
          : saturation < 65
            ? "BUILDING"
            : "LATE",
    crowdLabel: saturation < 35 ? "Early" : saturation < 65 ? "Building" : "Crowded",
    momentumLabel: score >= 75 ? "Strengthening" : score >= 60 ? "Stable" : "Fading",
    priceActionLabel:
      opportunity.change > 0 ? "Positive" : opportunity.change < 0 ? "Negative" : "Flat",
  };
}

export function tradeFrameworkToDisplay(
  framework: TradeFrameworkResult | null | undefined,
): TradeFrameworkDisplay | null {
  if (
    !framework ||
    framework.upsideMin === null ||
    framework.upsideMax === null ||
    framework.downsideRisk === null ||
    framework.rrRatio === null
  ) {
    return null;
  }

  const isLive = framework.sessionState === "regular";
  return {
    uptideMin: framework.upsideMin,
    uptideMax: framework.upsideMax,
    riskZone: framework.downsideRisk,
    rr: framework.rrRatio,
    confidence: framework.dataQualityState === "fresh" ? "High" : "Moderate",
    horizon: "1–3 days",
    sentence:
      framework.warnings[0] ??
      "Canonical opportunity window based on adjusted price history and current volatility.",
    isLive,
  };
}
