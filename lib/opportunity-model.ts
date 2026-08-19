import type { TradeFrameworkResult } from "@/lib/canonical-trade-framework";
import type { ExplosionAssessment } from "@/lib/canonical-opportunity";
import type { MarketStock, TradeFrameworkDisplay } from "@/lib/contracts/market";
import type { ProxIntelligencePacket } from "@/lib/prox/intelligence";
import type { ProxShadowChallenger } from "@/lib/prox/challenger-score";

export type OpportunityStrategy = "spot_momentum" | "before_the_crowd";
export type OpportunityTier = "scanner" | "watch" | "feature" | "hero";

// One display policy owns both the homepage list and its permanent ledger.
// Qualified contenders and no-entry radar observations have separate quotas
// so one can never silently impersonate the other.
export const MOMENTUM_RUNNER_UP_COUNT = 5;
export const MOMENTUM_RADAR_COUNT = 5;

export type Opportunity = {
  ticker: string;
  price: number;
  change: number;
  displayQuoteLive?: boolean;
  displayQuoteAsOf?: string | null;
  previousCloseChange?: number;
  sessionOpenPrice?: number | null;
  changeFromOpenPercent?: number | null;
  sessionHighPrice?: number | null;
  pullbackFromSessionHighPercent?: number | null;
  scanSession?: string;
  setupType?: "standard" | "session_reclaim";
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
  explosionAssessment?: ExplosionAssessment | null;
  proxIntelligence?: ProxIntelligencePacket | null;
  proxChallenger?: ProxShadowChallenger | null;
  strategy?: OpportunityStrategy;
  signalStrength?: number;
  strategyScore?: number;
  displayedConfidence?: number;
  tier?: OpportunityTier;
  eligibility?: { eligible: boolean; reasons: string[] };
  displayEligibility?: { eligible: boolean; reasons: string[] };
  momentumRadarEligible?: boolean;
  visibilityState?: string;
  engineVersion?: string;
  sourceRunId?: string;
  _convictionTier?: string;
  _isCatalyst?: boolean;
};

export type OpportunityStock = MarketStock;
const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function normalizeOpportunity(raw: unknown): Opportunity {
  const source = objectValue(raw);
  const rawEligibility = objectValue(source.eligibility);
  const rawDisplayEligibility = objectValue(source.displayEligibility);
  const rawTradeFramework = objectValue(source.tradeFramework);
  const ticker = String(source.ticker ?? "").toUpperCase();
  const eligible = Boolean(
    rawDisplayEligibility.eligible ??
      rawEligibility.eligible ??
      source.eligible,
  );
  const eligibilityReasons = Array.isArray(rawDisplayEligibility.reasons)
    ? rawDisplayEligibility.reasons.map(String)
    : Array.isArray(rawEligibility.reasons)
      ? rawEligibility.reasons.map(String)
      : Array.isArray(source.rejectionReasons)
        ? source.rejectionReasons.map(String)
        : [];
  const tier = source.tier as OpportunityTier | undefined;

  return {
    ticker,
    price: numberValue(source.displayPrice ?? source.price),
    change: numberValue(
      source.displayChange ?? source.change ?? source.change_percent,
    ),
    displayQuoteLive: source.displayQuoteLive === true,
    displayQuoteAsOf: source.displayQuoteAsOf
      ? String(source.displayQuoteAsOf)
      : null,
    previousCloseChange: numberValue(
      source.change ?? source.change_percent,
    ),
    sessionOpenPrice:
      source.sessionOpenPrice === null ||
      source.session_open_price === null ||
      (source.sessionOpenPrice === undefined &&
        source.session_open_price === undefined)
        ? null
        : numberValue(
            source.sessionOpenPrice ?? source.session_open_price,
          ),
    changeFromOpenPercent:
      source.changeFromOpenPercent === null ||
      source.change_from_open_percent === null ||
      (source.changeFromOpenPercent === undefined &&
        source.change_from_open_percent === undefined)
        ? null
        : numberValue(
            source.changeFromOpenPercent ??
              source.change_from_open_percent,
          ),
    sessionHighPrice:
      source.sessionHighPrice === null ||
      source.session_high_price === null ||
      (source.sessionHighPrice === undefined &&
        source.session_high_price === undefined)
        ? null
        : numberValue(source.sessionHighPrice ?? source.session_high_price),
    pullbackFromSessionHighPercent:
      source.pullbackFromSessionHighPercent === null ||
      source.pullback_from_session_high_percent === null ||
      (source.pullbackFromSessionHighPercent === undefined &&
        source.pullback_from_session_high_percent === undefined)
        ? null
        : numberValue(
            source.pullbackFromSessionHighPercent ??
              source.pullback_from_session_high_percent,
          ),
    scanSession: String(source.scanSession ?? source.scan_session ?? "unknown"),
    setupType:
      source.setupType === "session_reclaim"
        ? "session_reclaim"
        : "standard",
    opportunityType: String(
      source.opportunityType ??
        (numberValue(source.catalystScore ?? source.catalyst_score) >= 20
          ? "catalyst"
          : "momentum"),
    ),
    opportunityScore: numberValue(
      source.strategyScore ?? source.opportunityScore,
    ),
    qualityScore: numberValue(
      source.qualityScore ?? source.strategyScore ?? source.opportunityScore,
    ),
    breakoutPotentialScore: numberValue(source.breakoutPotentialScore),
    breakoutPotentialLabel: String(source.breakoutPotentialLabel ?? "Limited"),
    floatDataStatus: source.floatDataStatus === "verified" ? "verified" : "unavailable",
    momentumScore: numberValue(source.momentumScore ?? source.momentum_score),
    attentionScore: numberValue(
      source.crowdScore ?? source.attentionScore ?? source.crowd_score,
      50,
    ),
    riskScore: numberValue(
      source.trapScore ?? source.riskScore ?? source.trap_score,
      50,
    ),
    stage: String(source.stage ?? tier ?? "Watch"),
    stageEmoji:
      String(
        source.stageEmoji ??
          (tier === "hero"
            ? "🔥"
            : tier === "feature"
              ? "⚡"
              : tier === "watch"
                ? "👀"
                : "🔎"),
      ),
    confidence: numberValue(
      source.displayedConfidence ?? source.confidence ?? source.strategyScore,
    ),
    whyItMatters: String(
      source.whyItMatters ??
        (eligible
          ? `${ticker} passed the canonical opportunity gate.`
          : `${ticker} is not currently eligible for feature placement.`),
    ),
    whatChanged: String(
      source.whatChanged ??
        source.signalState ??
        source.state ??
        "Canonical backend evaluation updated.",
    ),
    riskNote: String(
      source.riskNote ??
        (Array.isArray(rawEligibility.reasons)
          ? rawEligibility.reasons[0]
          : undefined) ??
        (Array.isArray(rawTradeFramework.warnings)
          ? rawTradeFramework.warnings[0]
          : undefined) ??
        "Entry timing and risk still require discipline.",
    ),
    signals: Array.isArray(source.signals)
      ? source.signals.map(String)
      : [
          ...(numberValue(source.change) > 0
            ? [`Up ${numberValue(source.change).toFixed(1)}%`]
            : []),
          ...(numberValue(source.relativeVolume) >= 1.2
            ? [`${numberValue(source.relativeVolume).toFixed(1)}x relative volume`]
            : []),
        ],
    isBeforeCrowd: source.strategy === "before_the_crowd" && eligible,
    catalystScore: numberValue(source.catalystScore ?? source.catalyst_score),
    catalystTags: Array.isArray(source.catalystTags)
      ? source.catalystTags.map(String)
      : [],
    riskTags: Array.isArray(source.riskTags) ? source.riskTags.map(String) : [],
    relativeVolume: numberValue(source.relativeVolume ?? source.relative_volume),
    crowdStage: numberValue(source.crowdStage),
    scannedAt: (source.scannedAt ?? source.scanned_at ?? null) as string | null,
    freshnessLabel: String(source.freshnessLabel ?? "Live Scan"),
    tradeFramework: (source.tradeFramework ?? null) as TradeFrameworkResult | null,
    explosionAssessment: (source.explosionAssessment ??
      null) as ExplosionAssessment | null,
    proxIntelligence: (source.proxIntelligence ??
      null) as ProxIntelligencePacket | null,
    proxChallenger: (source.proxChallenger ??
      null) as ProxShadowChallenger | null,
    strategy: source.strategy as OpportunityStrategy | undefined,
    signalStrength: numberValue(source.signalStrength),
    strategyScore: numberValue(source.strategyScore ?? source.opportunityScore),
    displayedConfidence: numberValue(source.displayedConfidence ?? source.confidence),
    tier,
    eligibility: { eligible, reasons: eligibilityReasons },
    displayEligibility: { eligible, reasons: eligibilityReasons },
    momentumRadarEligible: Boolean(source.momentumRadarEligible),
    visibilityState: source.visibilityState
      ? String(source.visibilityState)
      : undefined,
    engineVersion: source.engineVersion as string | undefined,
    sourceRunId: source.sourceRunId as string | undefined,
  };
}

export function opportunityToStock(opportunity: Opportunity): OpportunityStock {
  return {
    symbol: opportunity.ticker,
    opportunityStrategy: opportunity.strategy,
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

export function mergeOpportunityLists(...lists: unknown[][]) {
  const merged = new Map<string, Opportunity>();
  for (const raw of lists.flat()) {
    const opportunity = normalizeOpportunity(raw);
    if (!opportunity.ticker) continue;
    // Lists are supplied in authority order. Preserve the first complete
    // canonical decision for a ticker instead of spreading two strategy
    // records together. The old merge could combine one lane's score with
    // another lane's labels/framework and create a record that never existed
    // in either API response.
    if (!merged.has(opportunity.ticker)) {
      merged.set(opportunity.ticker, opportunity);
    }
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
      opportunity.change > 0
        ? opportunity.setupType === "session_reclaim"
          ? "Reclaiming"
          : "Positive"
        : opportunity.change < 0
          ? "Negative"
          : "Flat",
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
