export const PROX_TRANSITION_CALIBRATION_VERSION =
  "prox-transition-calibration-v1";
export const PROX_TRANSITION_LEARNING_CASE_VERSION =
  "prox-transition-learning-case-v1";
export const PROX_TRANSITION_EMERGING_SAMPLE = 30;
export const PROX_TRANSITION_CALIBRATED_SAMPLE = 100;

export type ProxTransitionEvidenceState =
  | "insufficient"
  | "emerging"
  | "calibrated";

export type ProxTransitionCohortLevel =
  | "full_profile"
  | "behavior_profile"
  | "session_momentum"
  | "market_session";

export type ProxTransitionProfile = {
  marketSession: string;
  priceBucket: string;
  relativeVolumeBucket: string;
  momentumBucket: string;
  crowdBucket: string;
  trapBucket: string;
  scoreBucket: string;
};

export type ProxTransitionLearningCase = {
  profile: ProxTransitionProfile;
  graduatedToSpot: boolean;
  transitionMinutes: number | null;
  maxGainPercent: number;
  maxDrawdownPercent: number;
  timeToPeakMinutes: number;
};

export type ProxTransitionLearningOutcome =
  | "explosion"
  | "continuation"
  | "failure"
  | "ordinary";

export type ProxTransitionCalibration = {
  cohortKey: string;
  cohortLevel: ProxTransitionCohortLevel;
  dimensions: Record<string, string>;
  sampleSize: number;
  graduatedCount: number;
  graduationRate: number;
  explosionCount: number;
  explosionRate: number;
  continuationCount: number;
  continuationRate: number;
  failureCount: number;
  failureRate: number;
  missedExplosionCount: number;
  missedExplosionRate: number;
  medianMaxGainPercent: number;
  medianMaxDrawdownPercent: number;
  medianTimeToPeakMinutes: number;
  medianTransitionMinutes: number | null;
  evidenceState: ProxTransitionEvidenceState;
};

export type ProxTransitionComparisonEvidence = {
  calibrationVersion: typeof PROX_TRANSITION_CALIBRATION_VERSION;
  authority: "shadow_research_only";
  cohortKey: string;
  cohortLevel: ProxTransitionCohortLevel;
  evidenceState: ProxTransitionEvidenceState;
  sampleSize: number;
  graduatedCount: number;
  graduationRate: number;
  explosionRate: number;
  continuationRate: number;
  failureRate: number;
  missedExplosionRate: number;
  medianMaxGainPercent: number;
  medianMaxDrawdownPercent: number;
  medianTimeToPeakMinutes: number;
  medianTransitionMinutes: number | null;
  summary: string;
  publicScoreAuthority: false;
  executionAuthority: false;
};

const COHORT_LEVELS: ProxTransitionCohortLevel[] = [
  "full_profile",
  "behavior_profile",
  "session_momentum",
  "market_session",
];

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function bucket(
  value: unknown,
  boundaries: Array<{ maximum: number; name: string }>,
  overflow: string,
) {
  const number = finiteNumber(value);
  if (number === null) return "unknown";
  return (
    boundaries.find((boundary) => number < boundary.maximum)?.name ??
    overflow
  );
}

function normalizeSession(value: unknown) {
  return value === "pre_market" ||
    value === "regular" ||
    value === "after_hours"
    ? value
    : "unknown";
}

export function buildProxTransitionProfile(input: {
  marketSession?: unknown;
  price?: unknown;
  relativeVolume?: unknown;
  momentumScore?: unknown;
  crowdScore?: unknown;
  trapScore?: unknown;
  opportunityScore?: unknown;
}): ProxTransitionProfile {
  return {
    marketSession: normalizeSession(input.marketSession),
    priceBucket: bucket(
      input.price,
      [
        { maximum: 1, name: "under_1" },
        { maximum: 5, name: "1_to_5" },
        { maximum: 20, name: "5_to_20" },
      ],
      "20_plus",
    ),
    relativeVolumeBucket: bucket(
      input.relativeVolume,
      [
        { maximum: 1, name: "under_1x" },
        { maximum: 2, name: "1_to_2x" },
        { maximum: 5, name: "2_to_5x" },
        { maximum: 10, name: "5_to_10x" },
        { maximum: 20, name: "10_to_20x" },
      ],
      "20x_plus",
    ),
    momentumBucket: bucket(
      input.momentumScore,
      [
        { maximum: 40, name: "under_40" },
        { maximum: 60, name: "40_to_59" },
        { maximum: 80, name: "60_to_79" },
      ],
      "80_plus",
    ),
    crowdBucket: bucket(
      input.crowdScore,
      [
        { maximum: 35, name: "under_35" },
        { maximum: 60, name: "35_to_59" },
      ],
      "60_plus",
    ),
    trapBucket: bucket(
      input.trapScore,
      [
        { maximum: 35, name: "under_35" },
        { maximum: 60, name: "35_to_59" },
      ],
      "60_plus",
    ),
    scoreBucket: bucket(
      input.opportunityScore,
      [
        { maximum: 50, name: "under_50" },
        { maximum: 65, name: "50_to_64" },
        { maximum: 80, name: "65_to_79" },
      ],
      "80_plus",
    ),
  };
}

export function getProxTransitionCohortDimensions(
  profile: ProxTransitionProfile,
  level: ProxTransitionCohortLevel,
): Record<string, string> {
  if (level === "market_session") {
    return { marketSession: profile.marketSession };
  }
  if (level === "session_momentum") {
    return {
      marketSession: profile.marketSession,
      relativeVolumeBucket: profile.relativeVolumeBucket,
      momentumBucket: profile.momentumBucket,
    };
  }
  if (level === "behavior_profile") {
    return {
      marketSession: profile.marketSession,
      relativeVolumeBucket: profile.relativeVolumeBucket,
      momentumBucket: profile.momentumBucket,
      crowdBucket: profile.crowdBucket,
      trapBucket: profile.trapBucket,
    };
  }
  return { ...profile };
}

export function getProxTransitionCohortKey(
  profile: ProxTransitionProfile,
  level: ProxTransitionCohortLevel,
) {
  const dimensions = getProxTransitionCohortDimensions(profile, level);
  const signature = Object.entries(dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
  return `${PROX_TRANSITION_CALIBRATION_VERSION}|${level}|${signature}`;
}

export function getProxTransitionCohortKeys(
  profile: ProxTransitionProfile,
) {
  return COHORT_LEVELS.map((level) =>
    getProxTransitionCohortKey(profile, level),
  );
}

export function proxTransitionProfileFromStorage(
  row: Record<string, unknown>,
): ProxTransitionProfile {
  return {
    marketSession: String(row.market_session ?? "unknown"),
    priceBucket: String(row.price_bucket ?? "unknown"),
    relativeVolumeBucket: String(
      row.relative_volume_bucket ?? "unknown",
    ),
    momentumBucket: String(row.momentum_bucket ?? "unknown"),
    crowdBucket: String(row.crowd_bucket ?? "unknown"),
    trapBucket: String(row.trap_bucket ?? "unknown"),
    scoreBucket: String(row.score_bucket ?? "unknown"),
  };
}

export function proxTransitionCalibrationFromStorage(
  row: Record<string, unknown>,
): ProxTransitionCalibration {
  const number = (value: unknown) => finiteNumber(value) ?? 0;
  return {
    cohortKey: String(row.cohort_key),
    cohortLevel: row.cohort_level as ProxTransitionCohortLevel,
    dimensions: (row.dimensions ?? {}) as Record<string, string>,
    sampleSize: number(row.sample_size),
    graduatedCount: number(row.graduated_count),
    graduationRate: number(row.graduation_rate),
    explosionCount: number(row.explosion_count),
    explosionRate: number(row.explosion_rate),
    continuationCount: number(row.continuation_count),
    continuationRate: number(row.continuation_rate),
    failureCount: number(row.failure_count),
    failureRate: number(row.failure_rate),
    missedExplosionCount: number(row.missed_explosion_count),
    missedExplosionRate: number(row.missed_explosion_rate),
    medianMaxGainPercent: number(row.median_max_gain_percent),
    medianMaxDrawdownPercent: number(row.median_max_drawdown_percent),
    medianTimeToPeakMinutes: number(row.median_time_to_peak_minutes),
    medianTransitionMinutes:
      row.median_transition_minutes === null
        ? null
        : number(row.median_transition_minutes),
    evidenceState: row.evidence_state as ProxTransitionEvidenceState,
  };
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? round((sorted[middle - 1] + sorted[middle]) / 2)
    : round(sorted[middle]);
}

function evidenceState(sampleSize: number): ProxTransitionEvidenceState {
  if (sampleSize >= PROX_TRANSITION_CALIBRATED_SAMPLE) return "calibrated";
  if (sampleSize >= PROX_TRANSITION_EMERGING_SAMPLE) return "emerging";
  return "insufficient";
}

export function classifyProxTransitionLearningOutcome(input: {
  maxGainPercent: number;
  maxDrawdownPercent: number;
}): ProxTransitionLearningOutcome {
  if (input.maxGainPercent >= 100) return "explosion";
  if (input.maxGainPercent >= 20) return "continuation";
  if (input.maxGainPercent < 10 && input.maxDrawdownPercent <= -10) {
    return "failure";
  }
  return "ordinary";
}

export function buildProxTransitionCalibrations(
  cases: ProxTransitionLearningCase[],
) {
  const groups = new Map<
    string,
    {
      level: ProxTransitionCohortLevel;
      dimensions: Record<string, string>;
      cases: ProxTransitionLearningCase[];
    }
  >();
  for (const item of cases) {
    for (const level of COHORT_LEVELS) {
      const key = getProxTransitionCohortKey(item.profile, level);
      const group: {
        level: ProxTransitionCohortLevel;
        dimensions: Record<string, string>;
        cases: ProxTransitionLearningCase[];
      } = groups.get(key) ?? {
        level,
        dimensions: getProxTransitionCohortDimensions(item.profile, level),
        cases: [],
      };
      group.cases.push(item);
      groups.set(key, group);
    }
  }

  return [...groups.entries()].map(([cohortKey, group]) => {
    const sampleSize = group.cases.length;
    const graduated = group.cases.filter((item) => item.graduatedToSpot);
    const explosion = group.cases.filter(
      (item) =>
        classifyProxTransitionLearningOutcome(item) === "explosion",
    );
    const continuation = group.cases.filter((item) => {
      const outcome = classifyProxTransitionLearningOutcome(item);
      return outcome === "explosion" || outcome === "continuation";
    });
    const failure = group.cases.filter(
      (item) =>
        classifyProxTransitionLearningOutcome(item) === "failure",
    );
    const missedExplosion = explosion.filter(
      (item) => !item.graduatedToSpot,
    );
    const ratio = (count: number) => round(count / sampleSize);
    return {
      cohortKey,
      cohortLevel: group.level,
      dimensions: group.dimensions,
      sampleSize,
      graduatedCount: graduated.length,
      graduationRate: ratio(graduated.length),
      explosionCount: explosion.length,
      explosionRate: ratio(explosion.length),
      continuationCount: continuation.length,
      continuationRate: ratio(continuation.length),
      failureCount: failure.length,
      failureRate: ratio(failure.length),
      missedExplosionCount: missedExplosion.length,
      missedExplosionRate: ratio(missedExplosion.length),
      medianMaxGainPercent:
        median(group.cases.map((item) => item.maxGainPercent)) ?? 0,
      medianMaxDrawdownPercent:
        median(group.cases.map((item) => item.maxDrawdownPercent)) ?? 0,
      medianTimeToPeakMinutes:
        median(group.cases.map((item) => item.timeToPeakMinutes)) ?? 0,
      medianTransitionMinutes: median(
        graduated
          .map((item) => item.transitionMinutes)
          .filter((value): value is number => value !== null),
      ),
      evidenceState: evidenceState(sampleSize),
    } satisfies ProxTransitionCalibration;
  });
}

export function selectProxTransitionComparisonEvidence(
  profile: ProxTransitionProfile,
  calibrations: ProxTransitionCalibration[],
): ProxTransitionComparisonEvidence | null {
  const byKey = new Map(
    calibrations.map((calibration) => [calibration.cohortKey, calibration]),
  );
  const ordered = COHORT_LEVELS.map((level) =>
    byKey.get(getProxTransitionCohortKey(profile, level)),
  ).filter((value): value is ProxTransitionCalibration => Boolean(value));
  if (ordered.length === 0) return null;
  const selected =
    ordered.find((calibration) => calibration.evidenceState !== "insufficient") ??
    [...ordered].sort((left, right) => {
      if (right.sampleSize !== left.sampleSize) {
        return right.sampleSize - left.sampleSize;
      }
      return (
        COHORT_LEVELS.indexOf(left.cohortLevel) -
        COHORT_LEVELS.indexOf(right.cohortLevel)
      );
    })[0];
  const percent = (value: number) => `${round(value * 100, 1)}%`;
  const summary =
    selected.evidenceState === "insufficient"
      ? `${selected.sampleSize} comparable finalized cases exist; evidence remains insufficient and cannot influence the HT score.`
      : `${selected.sampleSize} comparable finalized cases: ${percent(selected.graduationRate)} graduated to Spot Momentum, ${percent(selected.continuationRate)} reached 20% continuation, and ${percent(selected.failureRate)} failed defensively.`;
  return {
    calibrationVersion: PROX_TRANSITION_CALIBRATION_VERSION,
    authority: "shadow_research_only",
    cohortKey: selected.cohortKey,
    cohortLevel: selected.cohortLevel,
    evidenceState: selected.evidenceState,
    sampleSize: selected.sampleSize,
    graduatedCount: selected.graduatedCount,
    graduationRate: selected.graduationRate,
    explosionRate: selected.explosionRate,
    continuationRate: selected.continuationRate,
    failureRate: selected.failureRate,
    missedExplosionRate: selected.missedExplosionRate,
    medianMaxGainPercent: selected.medianMaxGainPercent,
    medianMaxDrawdownPercent: selected.medianMaxDrawdownPercent,
    medianTimeToPeakMinutes: selected.medianTimeToPeakMinutes,
    medianTransitionMinutes: selected.medianTransitionMinutes,
    summary,
    publicScoreAuthority: false,
    executionAuthority: false,
  };
}
