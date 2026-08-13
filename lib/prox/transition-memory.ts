export const PROX_TRANSITION_MEMORY_VERSION =
  "prox-canonical-transition-v1";

export type ProxTransitionCaseLabel =
  | "before_crowd_to_spot_explosion"
  | "before_crowd_to_spot_continuation"
  | "before_crowd_to_spot_failure"
  | "before_crowd_to_spot_transition";

export type ProxTransitionObservation = {
  observedAt: string;
  price: number;
  role: string;
  rank: number;
  score: number;
  decisionSnapshot?: Record<string, unknown> | null;
};

export type ProxTransitionOutcome = {
  highestPrice: number;
  highestAt?: string | null;
  lowestPrice: number;
  lowestAt?: string | null;
};

export type ProxCanonicalTransitionCase = {
  transitionMinutes: number;
  transitionReturnPercent: number;
  maxGainFromEarlyPercent: number;
  maxDrawdownFromEarlyPercent: number;
  maxGainFromSpotPercent: number;
  caseLabel: ProxTransitionCaseLabel;
  caseFingerprint: Record<string, unknown>;
};

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function returnPercent(entryPrice: number, price: number) {
  return round(((price - entryPrice) / entryPrice) * 100);
}

function snapshotNumber(
  snapshot: Record<string, unknown> | null | undefined,
  key: string,
) {
  return finiteNumber(snapshot?.[key]);
}

export function classifyProxTransitionCase(input: {
  maxGainFromEarlyPercent: number;
  maxDrawdownFromEarlyPercent: number;
}): ProxTransitionCaseLabel {
  if (input.maxGainFromEarlyPercent >= 100) {
    return "before_crowd_to_spot_explosion";
  }
  if (input.maxGainFromEarlyPercent >= 20) {
    return "before_crowd_to_spot_continuation";
  }
  if (
    input.maxGainFromEarlyPercent < 10 &&
    input.maxDrawdownFromEarlyPercent <= -10
  ) {
    return "before_crowd_to_spot_failure";
  }
  return "before_crowd_to_spot_transition";
}

export function buildProxCanonicalTransitionCase(input: {
  ticker: string;
  tradingDate: string;
  beforeCrowd: ProxTransitionObservation;
  spotMomentum: ProxTransitionObservation;
  outcome: ProxTransitionOutcome;
}): ProxCanonicalTransitionCase | null {
  const earlyPrice = finitePositive(input.beforeCrowd.price);
  const spotPrice = finitePositive(input.spotMomentum.price);
  const highestPrice = finitePositive(input.outcome.highestPrice);
  const lowestPrice = finitePositive(input.outcome.lowestPrice);
  const earlyAt = new Date(input.beforeCrowd.observedAt).getTime();
  const spotAt = new Date(input.spotMomentum.observedAt).getTime();
  if (
    earlyPrice === null ||
    spotPrice === null ||
    highestPrice === null ||
    lowestPrice === null ||
    !Number.isFinite(earlyAt) ||
    !Number.isFinite(spotAt) ||
    spotAt <= earlyAt ||
    highestPrice < Math.max(earlyPrice, spotPrice) ||
    lowestPrice > earlyPrice
  ) {
    return null;
  }

  const transitionMinutes = round((spotAt - earlyAt) / 60_000, 1);
  const transitionReturnPercent = returnPercent(earlyPrice, spotPrice);
  const maxGainFromEarlyPercent = returnPercent(earlyPrice, highestPrice);
  const maxDrawdownFromEarlyPercent = returnPercent(earlyPrice, lowestPrice);
  const maxGainFromSpotPercent = returnPercent(spotPrice, highestPrice);
  const caseLabel = classifyProxTransitionCase({
    maxGainFromEarlyPercent,
    maxDrawdownFromEarlyPercent,
  });

  return {
    transitionMinutes,
    transitionReturnPercent,
    maxGainFromEarlyPercent,
    maxDrawdownFromEarlyPercent,
    maxGainFromSpotPercent,
    caseLabel,
    caseFingerprint: {
      sourceKind: "canonical_transition_case",
      ticker: input.ticker.toUpperCase(),
      tradingDate: input.tradingDate,
      beforeCrowd: {
        observedAt: input.beforeCrowd.observedAt,
        price: earlyPrice,
        role: input.beforeCrowd.role,
        rank: input.beforeCrowd.rank,
        score: input.beforeCrowd.score,
        scanSession: input.beforeCrowd.decisionSnapshot?.scanSession ?? null,
        relativeVolume: snapshotNumber(
          input.beforeCrowd.decisionSnapshot,
          "relativeVolume",
        ),
        momentumScore: snapshotNumber(
          input.beforeCrowd.decisionSnapshot,
          "momentumScore",
        ),
        crowdScore: snapshotNumber(
          input.beforeCrowd.decisionSnapshot,
          "crowdScore",
        ),
        trapScore: snapshotNumber(
          input.beforeCrowd.decisionSnapshot,
          "trapScore",
        ),
      },
      spotMomentum: {
        observedAt: input.spotMomentum.observedAt,
        price: spotPrice,
        role: input.spotMomentum.role,
        rank: input.spotMomentum.rank,
        score: input.spotMomentum.score,
        scanSession: input.spotMomentum.decisionSnapshot?.scanSession ?? null,
        relativeVolume: snapshotNumber(
          input.spotMomentum.decisionSnapshot,
          "relativeVolume",
        ),
        momentumScore: snapshotNumber(
          input.spotMomentum.decisionSnapshot,
          "momentumScore",
        ),
        crowdScore: snapshotNumber(
          input.spotMomentum.decisionSnapshot,
          "crowdScore",
        ),
        trapScore: snapshotNumber(
          input.spotMomentum.decisionSnapshot,
          "trapScore",
        ),
      },
      transition: {
        minutes: transitionMinutes,
        returnPercent: transitionReturnPercent,
      },
      observedOutcome: {
        highestPrice,
        highestAt: input.outcome.highestAt ?? null,
        lowestPrice,
        lowestAt: input.outcome.lowestAt ?? null,
        maxGainFromEarlyPercent,
        maxDrawdownFromEarlyPercent,
        maxGainFromSpotPercent,
      },
      caseLabel,
      predictionAuthority: false,
      publicScoreAuthority: false,
      executionAuthority: false,
    },
  };
}
