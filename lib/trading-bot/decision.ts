// One versioned, paper-only entry contract for the single HT Labs trading bot.
// This module does not place orders and does not consume the independent ProX
// Edge board. It turns an already-canonical Spot Momentum opportunity into one
// comparable 0-100 bot entry decision, regardless of whether the opportunity
// arrived through the standard or continuation feed.

export const BOT_DECISION_VERSION = "bot-entry-v3-unified-observed-quality";

export const MIN_BOT_ENTRY_SCORE = 70;
export const FAST_ENTRY_SCORE = 85;
export const MIN_CANONICAL_OPPORTUNITY_SCORE = 55;
export const MIN_RELATIVE_VOLUME = 2;
export const MIN_EFFECTIVE_RR = 1.5;
export const MIN_ENTRY_QUALITY = 20;
export const MIN_STOP_LOSS_PERCENT = 5;
export const MAX_CONTINUATION_DOWNSIDE_PERCENT = 30;

export type BotEntryPath =
  | "standard"
  | "continuation"
  | "price_discovery";

export type BotDecisionCandidate = {
  ticker: string;
  price: number;
  change: number;
  changeFromOpenPercent: number | null;
  relativeVolume: number;
  signalState: string;
  opportunityScore: number;
  riskTags: string[];
  eligibility: { eligible: boolean; reasons: string[] };
  visibilityState: string;
  tradeFramework: {
    upsideMax: number | null;
    downsideRisk: number | null;
    entryQuality: number | null;
    atr14: number | null;
  } | null;
  explosionAssessment: {
    score: number;
    continuationConfirmed: boolean;
    scenarioBands: {
      expansion: { min: number; max: number };
      structuralRisk: number | null;
    } | null;
  } | null;
};

export type BotEntryDecision = {
  version: typeof BOT_DECISION_VERSION;
  ticker: string;
  path: BotEntryPath;
  qualified: boolean;
  fastEntryEligible: boolean;
  score: number | null;
  hardFailures: string[];
  effectiveDownsidePercent: number | null;
  continuationCapacityPercent: number | null;
  effectiveRr: number | null;
  components: {
    observedOpportunity: number | null;
    continuationEvidence: number | null;
    entryQuality: number | null;
    rewardRiskQuality: number | null;
    riskPenalty: number;
  };
};

export type BotEntryControlState = {
  entriesEnabled: boolean;
  entryWindowOpen: boolean;
  decisionAuditAvailable: boolean;
  orphanedAlpacaPositionCount: number;
  openPositionCount: number;
  maxConcurrentPositions: number;
  recentEntryCount: number;
  maxRecentEntries: number;
  minutesSinceLatestEntry: number;
  minimumMinutesBetweenEntries: number;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const rounded = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function getBotEntryControlSkipReason(
  state: BotEntryControlState,
): string | null {
  if (!state.entryWindowOpen) return "outside_session";
  if (!state.decisionAuditAvailable) return "decision_audit_unavailable";
  if (!state.entriesEnabled) return "new_entries_disabled";
  if (state.orphanedAlpacaPositionCount > 0) {
    return "alpaca_position_reconciliation_required";
  }
  if (state.openPositionCount >= state.maxConcurrentPositions) {
    return "max_positions";
  }
  if (state.recentEntryCount >= state.maxRecentEntries) {
    return "rolling_24h_entry_limit";
  }
  if (state.minutesSinceLatestEntry < state.minimumMinutesBetweenEntries) {
    return "entry_cooldown";
  }
  return null;
}

export function isBotCandidateReady(
  decision: BotEntryDecision,
  wasRecentlyQualified: boolean,
) {
  return (
    decision.qualified &&
    (decision.fastEntryEligible || wasRecentlyQualified)
  );
}

function getRiskPenalty(riskTags: string[]) {
  // Extension is already reflected in the canonical entryQuality component;
  // do not double-count it. These remaining execution risks are distinct.
  return riskTags.reduce((penalty, tag) => {
    if (tag === "Parabolic Move") return penalty + 5;
    if (tag === "High Volatility") return penalty + 3;
    if (tag === "New Listing") return penalty + 5;
    return penalty;
  }, 0);
}

function getEffectiveDownsidePercent(
  candidate: BotDecisionCandidate,
  path: BotEntryPath,
) {
  const framework = candidate.tradeFramework;
  if (!framework) return null;
  if (finite(framework.downsideRisk) && framework.downsideRisk > 0) {
    return Math.max(framework.downsideRisk, MIN_STOP_LOSS_PERCENT);
  }
  if (
    path !== "price_discovery" ||
    candidate.explosionAssessment?.continuationConfirmed !== true ||
    !finite(framework.atr14) ||
    framework.atr14 <= 0 ||
    !finite(candidate.price) ||
    candidate.price <= 0
  ) {
    return null;
  }
  const atrPercent = (framework.atr14 / candidate.price) * 100;
  const downside = Math.max(atrPercent, MIN_STOP_LOSS_PERCENT);
  return downside <= MAX_CONTINUATION_DOWNSIDE_PERCENT ? downside : null;
}

function getContinuationCapacityPercent(
  candidate: BotDecisionCandidate,
  path: BotEntryPath,
) {
  const modeledUpside = candidate.tradeFramework?.upsideMax;
  if (finite(modeledUpside) && modeledUpside > 0) return modeledUpside;
  if (path !== "price_discovery") return null;
  const expansion = candidate.explosionAssessment?.scenarioBands?.expansion;
  if (
    !expansion ||
    !finite(expansion.min) ||
    !finite(expansion.max) ||
    expansion.min <= 0 ||
    expansion.max < expansion.min
  ) {
    return null;
  }
  // This is a conditional observed scenario midpoint, never stored or shown
  // as a promised target. It exists only to reject unmeasurable asymmetry.
  return (expansion.min + expansion.max) / 2;
}

export function evaluateBotEntry(
  candidate: BotDecisionCandidate,
  path: BotEntryPath,
): BotEntryDecision {
  const hardFailures: string[] = [];
  const framework = candidate.tradeFramework;
  const assessment = candidate.explosionAssessment;
  const canonicalEntryAllowed =
    candidate.eligibility.eligible ||
    (path === "price_discovery" &&
      candidate.visibilityState === "verified_price_discovery");

  if (!canonicalEntryAllowed) {
    hardFailures.push("Canonical entry eligibility did not clear.");
  }
  if (!finite(candidate.price) || candidate.price <= 0) {
    hardFailures.push("Current price is unavailable or invalid.");
  }
  if (!finite(candidate.change) || candidate.change <= 0) {
    hardFailures.push("The full-session move is not positive.");
  }
  if (!finite(candidate.changeFromOpenPercent)) {
    hardFailures.push("Current-session movement from the open is unavailable.");
  } else if (candidate.changeFromOpenPercent < 0) {
    hardFailures.push("Current-session price is below its session open.");
  }
  if (!finite(candidate.relativeVolume) || candidate.relativeVolume < MIN_RELATIVE_VOLUME) {
    hardFailures.push(`Relative volume is below ${MIN_RELATIVE_VOLUME.toFixed(1)}x.`);
  }
  if (
    !finite(candidate.opportunityScore) ||
    candidate.opportunityScore < MIN_CANONICAL_OPPORTUNITY_SCORE
  ) {
    hardFailures.push(
      `Canonical opportunity score is below ${MIN_CANONICAL_OPPORTUNITY_SCORE}.`,
    );
  }
  if (
    candidate.signalState !== "Strong Momentum" &&
    assessment?.continuationConfirmed !== true
  ) {
    hardFailures.push("Observed momentum is not strongly confirmed.");
  }
  if (!framework) {
    hardFailures.push("Canonical trade framework is unavailable.");
  }

  const entryQuality = framework?.entryQuality ?? null;
  if (!finite(entryQuality) || entryQuality < MIN_ENTRY_QUALITY) {
    hardFailures.push(`Entry quality is below ${MIN_ENTRY_QUALITY}.`);
  }

  const effectiveDownsidePercent = getEffectiveDownsidePercent(candidate, path);
  const continuationCapacityPercent = getContinuationCapacityPercent(
    candidate,
    path,
  );
  const effectiveRr =
    effectiveDownsidePercent !== null &&
    effectiveDownsidePercent > 0 &&
    continuationCapacityPercent !== null
      ? continuationCapacityPercent / effectiveDownsidePercent
      : null;
  if (effectiveDownsidePercent === null) {
    hardFailures.push("Structural downside cannot be measured honestly.");
  }
  if (continuationCapacityPercent === null) {
    hardFailures.push("Continuation capacity cannot be measured honestly.");
  }
  if (effectiveRr === null || effectiveRr < MIN_EFFECTIVE_RR) {
    hardFailures.push(`Effective reward/risk is below ${MIN_EFFECTIVE_RR.toFixed(1)}:1.`);
  }

  const observedOpportunity = finite(candidate.opportunityScore)
    ? clamp(candidate.opportunityScore)
    : null;
  const continuationEvidence = finite(assessment?.score)
    ? clamp(assessment.score)
    : null;
  const entryQualityComponent = finite(entryQuality) ? clamp(entryQuality) : null;
  const rewardRiskQuality =
    effectiveRr === null ? null : clamp((effectiveRr / 3) * 100);
  const riskPenalty = getRiskPenalty(candidate.riskTags);
  const componentsAvailable =
    observedOpportunity !== null &&
    continuationEvidence !== null &&
    entryQualityComponent !== null &&
    rewardRiskQuality !== null;
  const score = componentsAvailable
    ? rounded(
        clamp(
          observedOpportunity * 0.4 +
            continuationEvidence * 0.2 +
            entryQualityComponent * 0.2 +
            rewardRiskQuality * 0.2 -
            riskPenalty,
        ),
      )
    : null;
  if (score === null || score < MIN_BOT_ENTRY_SCORE) {
    hardFailures.push(`Unified bot entry score is below ${MIN_BOT_ENTRY_SCORE}.`);
  }

  const qualified = hardFailures.length === 0;
  return {
    version: BOT_DECISION_VERSION,
    ticker: candidate.ticker,
    path,
    qualified,
    fastEntryEligible: qualified && score !== null && score >= FAST_ENTRY_SCORE,
    score,
    hardFailures,
    effectiveDownsidePercent:
      effectiveDownsidePercent === null
        ? null
        : rounded(effectiveDownsidePercent),
    continuationCapacityPercent:
      continuationCapacityPercent === null
        ? null
        : rounded(continuationCapacityPercent),
    effectiveRr: effectiveRr === null ? null : rounded(effectiveRr),
    components: {
      observedOpportunity,
      continuationEvidence,
      entryQuality: entryQualityComponent,
      rewardRiskQuality:
        rewardRiskQuality === null ? null : rounded(rewardRiskQuality),
      riskPenalty,
    },
  };
}
