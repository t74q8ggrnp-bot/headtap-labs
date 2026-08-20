import type { ProxMarketStructureAssessment } from "@/lib/prox/market-structure";

export const PROX_EDGE_SCORE_VERSION = "prox-edge-score-v1";

export const PROX_FORBIDDEN_CANONICAL_INPUT_FIELDS = [
  "htScore",
  "ht_score",
  "canonicalScore",
  "canonical_score",
  "opportunityScore",
  "opportunity_score",
  "strategyScore",
  "strategy_score",
  "canonicalRank",
  "canonical_rank",
  "canonicalTier",
  "canonical_tier",
  "canonicalRole",
  "canonical_role",
  "canonicalEligibility",
  "canonical_eligibility",
  "rank",
  "tier",
  "role",
  "eligibility",
  "eligible",
  "crowdScore",
  "crowd_score",
  "trapScore",
  "trap_score",
  "tradeFramework",
  "trade_framework",
  "framework",
  "canonicalUpside",
  "canonicalDownside",
  "canonicalRiskReward",
  "upside",
  "downside",
  "riskReward",
  "risk_reward",
] as const;

const FORBIDDEN_FIELDS = new Set<string>(
  PROX_FORBIDDEN_CANONICAL_INPUT_FIELDS,
);

export type ProxEdgeEventEvidence = {
  verificationState: "verified" | "unverified" | "contradicted";
  catalystCategory: string;
  sourceCredibility: number;
  matchConfidence: number;
  contradictionCount: number;
  ageMinutes: number;
};

export type ProxEdgeCalibrationEvidence = {
  sampleSize: number;
  continuationRate: number;
  evidenceState: "insufficient" | "emerging" | "calibrated";
};

export type ProxEdgeScoreInput = {
  ticker: string;
  price: number;
  snapshotPrice: number;
  sourceObservedAt: string;
  decisionAt: string;
  securityType: "CS" | "ADRC";
  previousCloseChangePercent: number | null;
  sessionChangePercent: number | null;
  timeAdjustedRelativeVolume: number | null;
  dollarVolume: number;
  velocity1m: number | null;
  acceleration5m: number | null;
  volumeAcceleration: number | null;
  priceVsVwap: number | null;
  pulsePrice: number | null;
  pulseAgeMinutes: number | null;
  observationAgeMinutes: number;
  pullbackFromWindowHighPercent: number | null;
  corporateActionSuspected: boolean;
  anomalyFlags: string[];
  dailyBarCount: number;
  intradayBarCount: number;
  structure: ProxMarketStructureAssessment;
  event: ProxEdgeEventEvidence | null;
  calibration: ProxEdgeCalibrationEvidence | null;
};

export type ProxEdgeScoreResult = {
  version: typeof PROX_EDGE_SCORE_VERSION;
  edgeScore: number;
  continuationProbability: number;
  rewardRiskAsymmetry: number;
  evidenceConfidence: number;
  riskPenalty: number;
  entryQualified: boolean;
  readiness: "insufficient" | "live_only" | "emerging" | "calibrated";
  components: {
    liveImpulse: number;
    participation: number;
    vwapPosition: number;
    peakRetention: number;
    marketStructure: number;
    twoClockAlignment: number;
    comparableOutcomes: number | null;
  };
  hardFailures: string[];
  reasons: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function assertNoForbiddenProxInputs(value: unknown) {
  const visit = (current: unknown, path: string) => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, entry] of Object.entries(current)) {
      if (FORBIDDEN_FIELDS.has(key)) {
        throw new Error(`Forbidden canonical input entered ProX scoring at ${path}.${key}.`);
      }
      visit(entry, `${path}.${key}`);
    }
  };
  visit(value, "input");
}

function asymmetryScore(riskReward: number | null) {
  if (riskReward === null || riskReward <= 0) return 0;
  if (riskReward < 1) return clamp(riskReward * 45);
  if (riskReward < 2) return 50 + (riskReward - 1) * 25;
  if (riskReward < 3) return 75 + (riskReward - 2) * 15;
  return clamp(90 + (riskReward - 3) * 5);
}

function twoClockAlignmentScore(
  previousCloseChangePercent: number | null,
  sessionChangePercent: number | null,
) {
  const fullDay = finite(previousCloseChangePercent);
  const session = finite(sessionChangePercent);
  if (fullDay === null && session === null) return 45;
  if (session === null) return fullDay !== null && fullDay > 0 ? 52 : 38;
  if (fullDay === null) return clamp(50 + session * 2.5, 25, 78);
  if (session >= 2 && fullDay >= 0) {
    return clamp(68 + Math.min(15, session * 1.2));
  }
  if (session > 0 && fullDay < 0) {
    return clamp(58 + Math.min(20, session * 1.5));
  }
  if (session >= -2 && fullDay > 0) {
    return clamp(48 + session * 3, 35, 55);
  }
  if (session < -2 && fullDay > 0) {
    return clamp(38 + session * 1.5, 15, 38);
  }
  return clamp(35 + session * 2, 10, 48);
}

function weightedAverage(
  components: Array<{ value: number | null; weight: number }>,
) {
  const available = components.filter(
    (component): component is { value: number; weight: number } =>
      component.value !== null && Number.isFinite(component.value),
  );
  const weight = available.reduce((sum, component) => sum + component.weight, 0);
  if (weight <= 0) return 0;
  return available.reduce(
    (sum, component) => sum + component.value * component.weight,
    0,
  ) / weight;
}

export function scoreProxEdge(input: ProxEdgeScoreInput): ProxEdgeScoreResult {
  assertNoForbiddenProxInputs(input);
  const observationTimestamp = Date.parse(input.sourceObservedAt);
  const decisionTimestamp = Date.parse(input.decisionAt);
  const observationAgeMinutes =
    Number.isFinite(input.observationAgeMinutes) &&
    input.observationAgeMinutes >= 0
      ? input.observationAgeMinutes
      : 999;
  const velocity = finite(input.velocity1m) ?? 0;
  const acceleration = finite(input.acceleration5m) ?? 0;
  const liveImpulse = clamp(50 + velocity * 12 + acceleration * 6);
  const relativeVolume = Math.max(0, finite(input.timeAdjustedRelativeVolume) ?? 0);
  const volumeAcceleration = Math.max(0, finite(input.volumeAcceleration) ?? 0);
  const participation = clamp(
    35 + Math.log2(relativeVolume + 1) * 18 + Math.log2(volumeAcceleration + 1) * 8,
  );
  const priceVsVwap = finite(input.priceVsVwap);
  const vwapPosition =
    priceVsVwap === null ? 45 : clamp(50 + priceVsVwap * 7);
  const pullback = Math.max(
    0,
    finite(input.pullbackFromWindowHighPercent) ?? 0,
  );
  const peakRetention = clamp(
    pullback <= 3 ? 85 - pullback * 3 : 76 - (pullback - 3) * 7,
  );
  const twoClockAlignment = twoClockAlignmentScore(
    input.previousCloseChangePercent,
    input.sessionChangePercent,
  );
  const structureCapacity = finite(
    input.structure.continuationCapacityPercent,
  );
  const atrPercent = finite(input.structure.atrPercent);
  const marketStructure = clamp(
    45 +
      (input.structure.priceDiscovery ? 12 : 0) +
      Math.max(0, input.structure.dailyTrendPercent ?? 0) * 0.8 +
      (structureCapacity !== null && atrPercent !== null && atrPercent > 0
        ? Math.min(25, (structureCapacity / atrPercent) * 12)
        : 0) -
      (input.structure.extended ? 10 : 0),
  );
  const calibrationAvailable =
    input.calibration !== null &&
    input.calibration.sampleSize >= 30 &&
    input.calibration.evidenceState !== "insufficient";
  const comparableOutcomes = calibrationAvailable
    ? clamp(input.calibration!.continuationRate * 100)
    : null;
  const continuationProbability = clamp(
    weightedAverage([
      { value: liveImpulse, weight: 0.2 },
      { value: participation, weight: 0.2 },
      { value: vwapPosition, weight: 0.1 },
      { value: peakRetention, weight: 0.1 },
      { value: marketStructure, weight: 0.2 },
      { value: twoClockAlignment, weight: 0.1 },
      { value: comparableOutcomes, weight: 0.1 },
    ]),
  );
  const rewardRiskAsymmetry = asymmetryScore(
    finite(input.structure.scenarioRiskReward),
  );

  const freshnessScore = clamp(
    100 - observationAgeMinutes * 5 - (input.pulseAgeMinutes ?? 15) * 5,
  );
  const structureCoverage = clamp(
    (Math.min(60, input.dailyBarCount) / 60) * 60 +
      (Math.min(30, input.intradayBarCount) / 30) * 40,
  );
  const marketCompleteness =
    [
      input.velocity1m,
      input.acceleration5m,
      input.volumeAcceleration,
      input.priceVsVwap,
      input.timeAdjustedRelativeVolume,
      input.structure.structuralRiskPercent,
      input.structure.continuationCapacityPercent,
    ].filter((value) => finite(value) !== null).length / 7;
  const eventConfidence =
    input.event?.verificationState === "verified"
      ? clamp(
          input.event.sourceCredibility * 0.55 +
            input.event.matchConfidence * 0.45,
        )
      : null;
  const calibrationConfidence = calibrationAvailable
    ? input.calibration!.evidenceState === "calibrated"
      ? 100
      : 70
    : null;
  const evidenceConfidence = clamp(
    weightedAverage([
      { value: freshnessScore, weight: 0.35 },
      { value: structureCoverage, weight: 0.3 },
      { value: marketCompleteness * 100, weight: 0.2 },
      { value: eventConfidence, weight: 0.1 },
      { value: calibrationConfidence, weight: 0.05 },
    ]),
  );

  const hardFailures: string[] = [];
  const priceDifferencePercent =
    input.pulsePrice !== null && input.pulsePrice > 0 && input.snapshotPrice > 0
      ? (Math.abs(input.snapshotPrice - input.pulsePrice) /
          input.snapshotPrice) *
        100
      : 0;
  const priceConsistencyThresholdPercent = Math.max(
    5,
    Math.min(25, (finite(input.structure.atrPercent) ?? 0) * 0.75),
  );
  const defensiveCatalyst = new Set([
    "offering_dilution",
    "reverse_split",
    "delisting_compliance",
  ]);
  if (input.securityType !== "CS" && input.securityType !== "ADRC") {
    hardFailures.push("Security type is not eligible for the common-equity opportunity lane.");
  }
  if (input.corporateActionSuspected) {
    hardFailures.push("A corporate-action discontinuity prevents organic momentum qualification.");
  }
  if (
    !Number.isFinite(observationTimestamp) ||
    !Number.isFinite(decisionTimestamp) ||
    observationTimestamp > decisionTimestamp + 30_000
  ) {
    hardFailures.push("The independent decision timestamps are invalid or out of order.");
  }
  if (observationAgeMinutes > 12) {
    hardFailures.push("The independent market observation is stale.");
  }
  if (input.pulseAgeMinutes === null || input.pulseAgeMinutes > 10) {
    hardFailures.push("The live ProX minute-bar pulse is missing or stale.");
  }
  if (priceDifferencePercent > priceConsistencyThresholdPercent) {
    hardFailures.push("Snapshot and minute-bar prices are internally inconsistent.");
  }
  if (!Number.isFinite(input.dollarVolume) || input.dollarVolume < 100_000) {
    hardFailures.push("Observed liquidity is severely deficient.");
  }
  if (!input.structure.measurable) {
    hardFailures.push("Structural risk or continuation capacity is not honestly measurable.");
  }
  if (input.structure.postPeakFailure) {
    hardFailures.push("Fresh structure confirms post-peak failure below VWAP.");
  }
  if (input.structure.severePeakFailure && !input.structure.postPeakFailure) {
    hardFailures.push(
      "Realized pullback from the recent high is severe regardless of the current tick.",
    );
  }
  if (
    input.structure.scenarioRiskReward !== null &&
    input.structure.scenarioRiskReward < 1
  ) {
    hardFailures.push("Independent scenario reward/risk is below 1.0.");
  }
  if (
    input.event?.verificationState === "verified" &&
    input.event.ageMinutes <= 72 * 60 &&
    defensiveCatalyst.has(input.event.catalystCategory)
  ) {
    hardFailures.push("A recent verified defensive corporate event blocks entry qualification.");
  }
  if (input.event?.verificationState === "contradicted") {
    hardFailures.push("The attached catalyst evidence is contradicted.");
  }

  let riskPenalty = 0;
  const reasons: string[] = [];
  if (input.structure.extended) {
    riskPenalty += 8;
    reasons.push("ATR-to-VWAP extension reduces the independent Edge Score.");
  }
  if ((input.event?.contradictionCount ?? 0) > 0) {
    riskPenalty += Math.min(12, input.event!.contradictionCount * 4);
    reasons.push("Documented event contradictions reduce evidence quality.");
  }
  if (input.anomalyFlags.includes("post_peak_deterioration")) {
    riskPenalty += 5;
    reasons.push("The direct observer recorded earlier post-peak deterioration.");
  }
  if (input.event?.verificationState === "verified") {
    reasons.push("A recent primary-source event contributes to evidence confidence.");
  }
  if (!calibrationAvailable) {
    reasons.push("Comparable ProX outcome evidence is insufficient and contributes no probability points.");
  }
  reasons.push(...input.structure.reasons);

  const edgeScore = clamp(
    continuationProbability * 0.6 +
      rewardRiskAsymmetry * 0.3 +
      evidenceConfidence * 0.1 -
      riskPenalty,
  );
  if (edgeScore < 55) {
    hardFailures.push("Independent ProX Edge Score is below the 55 entry-quality floor.");
  }
  if (continuationProbability < 50) {
    hardFailures.push("Independent continuation probability is below the entry-quality floor.");
  }
  const readiness: ProxEdgeScoreResult["readiness"] =
    input.calibration?.evidenceState === "calibrated" && evidenceConfidence >= 75
      ? "calibrated"
      : input.calibration?.evidenceState === "emerging"
        ? "emerging"
        : evidenceConfidence >= 55
          ? "live_only"
          : "insufficient";

  return {
    version: PROX_EDGE_SCORE_VERSION,
    edgeScore: round(edgeScore),
    continuationProbability: round(continuationProbability),
    rewardRiskAsymmetry: round(rewardRiskAsymmetry),
    evidenceConfidence: round(evidenceConfidence),
    riskPenalty: round(riskPenalty),
    entryQualified: hardFailures.length === 0,
    readiness,
    components: {
      liveImpulse: round(liveImpulse),
      participation: round(participation),
      vwapPosition: round(vwapPosition),
      peakRetention: round(peakRetention),
      marketStructure: round(marketStructure),
      twoClockAlignment: round(twoClockAlignment),
      comparableOutcomes:
        comparableOutcomes === null ? null : round(comparableOutcomes),
    },
    hardFailures,
    reasons: reasons.slice(0, 12),
  };
}
