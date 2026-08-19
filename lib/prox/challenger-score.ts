// Post-decision comparison only. The independent Edge Score must already be
// complete before this helper receives the canonical score. Canonical data is
// used only to calculate a comparison delta; it can never fill, weight, or
// otherwise manufacture the ProX score.

export const PROX_SHADOW_CHALLENGER_VERSION =
  "prox-post-decision-comparison-v2";

export type ProxShadowChallenger = {
  version: typeof PROX_SHADOW_CHALLENGER_VERSION;
  mode: "post_decision_comparison_only";
  readiness: "live_only" | "emerging" | "calibrated";
  canonicalScore: number;
  challengerScore: number;
  delta: number;
  disposition: "higher" | "aligned" | "lower";
  evidenceCoverage: number;
  sampleSize: number;
  authority: {
    publicScore: false;
    ranking: false;
    display: false;
    execution: false;
  };
  reasons: string[];
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));
const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export function buildProxShadowChallenger(input: {
  canonicalScore: number;
  independentEdgeScore: number | null;
  readiness: ProxShadowChallenger["readiness"] | "insufficient";
  evidenceCoverage: number;
  sampleSize: number;
  reasons?: string[];
}): ProxShadowChallenger | null {
  if (
    input.independentEdgeScore === null ||
    !Number.isFinite(input.independentEdgeScore) ||
    input.readiness === "insufficient"
  ) {
    return null;
  }
  const canonicalScore = round(clamp(input.canonicalScore));
  const challengerScore = round(clamp(input.independentEdgeScore));
  const delta = round(challengerScore - canonicalScore);
  return {
    version: PROX_SHADOW_CHALLENGER_VERSION,
    mode: "post_decision_comparison_only",
    readiness: input.readiness,
    canonicalScore,
    challengerScore,
    delta,
    disposition: delta >= 5 ? "higher" : delta <= -5 ? "lower" : "aligned",
    evidenceCoverage: round(clamp(input.evidenceCoverage)),
    sampleSize: Math.max(0, Math.round(input.sampleSize)),
    authority: {
      publicScore: false,
      ranking: false,
      display: false,
      execution: false,
    },
    reasons: [
      "Canonical and ProX decisions were completed independently before this comparison.",
      ...(input.reasons ?? []),
    ],
  };
}
