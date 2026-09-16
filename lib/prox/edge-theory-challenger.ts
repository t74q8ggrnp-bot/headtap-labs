export const PROX_EDGE_THEORY_CHALLENGER_VERSION =
  "prox-edge-theory-challenger-v1";

export type ProxEdgeTheoryChallengerInput = {
  components: {
    liveImpulse: number;
    participation: number;
    vwapPosition: number;
    peakRetention: number;
    marketStructure: number;
    twoClockAlignment: number;
    comparableOutcomes: number | null;
    newsAttention: number | null;
  };
  rewardRiskAsymmetry: number;
  evidenceConfidence: number;
  currentRiskPenalty: number;
  currentExtended: boolean;
  extensionAtrMultiple: number | null;
  calibration: {
    sampleSize: number;
    continuationRate: number;
    evidenceState: "insufficient" | "emerging" | "calibrated";
  } | null;
  newsSourceCount: number;
  readiness: "insufficient" | "live_only" | "emerging" | "calibrated";
  hardFailures: string[];
};

export type ProxEdgeTheoryChallengerResult = {
  version: typeof PROX_EDGE_THEORY_CHALLENGER_VERSION;
  mode: "prospective_shadow_research_only";
  score: number;
  continuationEstimate: number;
  rewardRiskAsymmetry: number;
  evidenceConfidence: number;
  riskPenalty: number;
  researchQualified: boolean;
  readiness: ProxEdgeTheoryChallengerInput["readiness"];
  components: ProxEdgeTheoryChallengerInput["components"] & {
    calibrationReliability: number;
    newsReliability: number;
    extensionExhaustionPenalty: number;
  };
  authority: {
    canonicalDecision: false;
    canonicalRanking: false;
    publicDisplay: false;
    agentDecision: false;
    paperExecution: false;
    liveExecution: false;
  };
  reasons: string[];
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function neutralPrior(value: number | null, reliability: number) {
  if (value === null) return 50;
  const boundedReliability = clamp(reliability, 0, 1);
  return 50 + (clamp(value) - 50) * boundedReliability;
}

function fixedWeightContinuation(
  components: ProxEdgeTheoryChallengerResult["components"],
) {
  // Preserve the current component families and nominal weights, but keep a
  // fixed denominator. Missing optional evidence is a neutral 50 rather than
  // silently increasing every remaining component's influence.
  const weighted =
    components.liveImpulse * 0.2 +
    components.participation * 0.2 +
    components.vwapPosition * 0.1 +
    components.peakRetention * 0.1 +
    components.marketStructure * 0.2 +
    components.twoClockAlignment * 0.1 +
    components.comparableOutcomes! * 0.1 +
    components.newsAttention! * 0.1;
  return weighted / 1.1;
}

function nonScoreFailures(failures: string[]) {
  return failures.filter(
    (failure) =>
      !failure.includes("Edge Score is below") &&
      !failure.includes("continuation probability is below"),
  );
}

export function buildProxEdgeTheoryChallenger(
  input: ProxEdgeTheoryChallengerInput,
): ProxEdgeTheoryChallengerResult {
  const calibrationSample = Math.max(
    0,
    Math.round(finite(input.calibration?.sampleSize) ?? 0),
  );
  const calibrationReliability =
    input.calibration?.evidenceState === "insufficient"
      ? 0
      : calibrationSample / (calibrationSample + 100);
  const comparableOutcomes = neutralPrior(
    input.components.comparableOutcomes,
    calibrationReliability,
  );

  const newsReliability = Math.min(
    1,
    Math.max(0, Math.round(finite(input.newsSourceCount) ?? 0)) / 5,
  );
  const newsAttention = neutralPrior(
    input.components.newsAttention,
    newsReliability,
  );

  const extensionAtrMultiple = finite(input.extensionAtrMultiple);
  const extensionPressure =
    extensionAtrMultiple === null
      ? 0
      : Math.max(0, extensionAtrMultiple - 1.5) * 4;
  const saturatedImpulsePressure =
    extensionPressure > 0
      ? Math.max(0, input.components.liveImpulse - 85) * 0.15
      : 0;
  const extensionExhaustionPenalty = clamp(
    extensionPressure + saturatedImpulsePressure,
    0,
    18,
  );
  const currentPenaltyWithoutFixedExtension = Math.max(
    0,
    input.currentRiskPenalty - (input.currentExtended ? 8 : 0),
  );
  const riskPenalty =
    currentPenaltyWithoutFixedExtension + extensionExhaustionPenalty;

  const components: ProxEdgeTheoryChallengerResult["components"] = {
    ...input.components,
    comparableOutcomes: round(comparableOutcomes),
    newsAttention: round(newsAttention),
    calibrationReliability: round(calibrationReliability * 100),
    newsReliability: round(newsReliability * 100),
    extensionExhaustionPenalty: round(extensionExhaustionPenalty),
  };
  const continuationEstimate = clamp(fixedWeightContinuation(components));

  // Evidence confidence is deliberately a qualification gate, not a bullish
  // score component. Complete evidence can make a decision more trustworthy;
  // it cannot make an otherwise weak setup more likely to continue.
  const score = clamp(
    continuationEstimate * 0.7 + input.rewardRiskAsymmetry * 0.3 - riskPenalty,
  );
  const blockingFailures = nonScoreFailures(input.hardFailures);
  const researchQualified =
    blockingFailures.length === 0 &&
    input.readiness !== "insufficient" &&
    input.evidenceConfidence >= 55 &&
    continuationEstimate >= 50 &&
    score >= 55;

  const reasons = [
    "Evidence confidence gates research qualification but contributes no bullish score points.",
    "Comparable outcomes are shrunk toward a neutral prior according to their sample size.",
    "Missing optional evidence stays neutral so component weights remain comparable across candidates.",
    "Extension risk increases continuously when a strong impulse is already far above VWAP.",
  ];
  if (input.calibration?.evidenceState === "emerging") {
    reasons.push(
      "Emerging outcome history remains deliberately low-reliability until later samples confirm it.",
    );
  }

  return {
    version: PROX_EDGE_THEORY_CHALLENGER_VERSION,
    mode: "prospective_shadow_research_only",
    score: round(score),
    continuationEstimate: round(continuationEstimate),
    rewardRiskAsymmetry: round(clamp(input.rewardRiskAsymmetry)),
    evidenceConfidence: round(clamp(input.evidenceConfidence)),
    riskPenalty: round(riskPenalty),
    researchQualified,
    readiness: input.readiness,
    components,
    authority: {
      canonicalDecision: false,
      canonicalRanking: false,
      publicDisplay: false,
      agentDecision: false,
      paperExecution: false,
      liveExecution: false,
    },
    reasons,
  };
}
