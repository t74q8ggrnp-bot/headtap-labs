export const PROX_CANONICAL_PAIRED_SCORECARD_VERSION =
  "prox-canonical-paired-scorecard-v1" as const;

export const PROX_CANONICAL_PROVIDER_ALIGNMENT_SECONDS = 120;
export const PROX_CANONICAL_DECISION_ALIGNMENT_SECONDS = 180;

export type CanonicalPairCandidate = {
  id: string;
  ticker: string;
  strategy: "spot_momentum" | "before_the_crowd";
  decisionAt: string;
  providerAt: string | null;
  price: number;
  score: number;
  role: "hero" | "contender" | "radar";
  rank: number;
  sourceRunId: string | null;
  engineVersion: string | null;
};

export type ProxPairCandidate = {
  episodeId: string;
  memberId: string;
  ticker: string;
  tradingDate: string;
  marketSession: "pre_market" | "regular" | "after_hours" | "closed";
  decisionAt: string;
  providerAt: string | null;
  price: number;
  edgeScore: number;
  continuationProbability: number;
  evidenceConfidence: number;
  readiness: "insufficient" | "live_only" | "emerging" | "calibrated";
  disposition: "selected" | "blocked" | "rejected";
  role: "hero" | "contender" | "radar" | "none";
  rank: number | null;
  engineVersion: string | null;
  edgeScoreVersion: string | null;
  maxGainPercent: number;
  maxDrawdownPercent: number;
  sampledHighAt: string;
  sampledLowAt: string;
  horizons: Record<string, number>;
};

export type PairedDecision = {
  pairId: string;
  ticker: string;
  tradingDate: string;
  marketSession: ProxPairCandidate["marketSession"];
  canonical: CanonicalPairCandidate;
  prox: ProxPairCandidate;
  alignment: {
    providerSkewSeconds: number;
    decisionSkewSeconds: number;
    priceSkewPercent: number;
  };
  selection: {
    canonicalSelected: boolean;
    proxSelected: boolean;
    agreement: "both_selected" | "canonical_only" | "prox_only" | "both_withheld";
  };
  outcomes: {
    horizons: Record<string, number>;
    maxGainPercent: number;
    maxDrawdownPercent: number;
    plusFiveBeforeMinusFive: boolean;
    plusTenBeforeMinusFive: boolean;
  };
};

export type PairExclusionReason =
  | "missing_prox_provider_time"
  | "no_canonical_ticker"
  | "missing_canonical_provider_time"
  | "provider_time_misaligned"
  | "decision_time_misaligned"
  | "canonical_observation_already_paired"
  | "invalid_pair_evidence";

type Exclusion = {
  episodeId: string;
  ticker: string;
  reason: PairExclusionReason;
};

function timeMs(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value: number) {
  return Number.isFinite(value);
}

function rounded(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function selectedCanonical(candidate: CanonicalPairCandidate) {
  return candidate.role === "hero" || candidate.role === "contender";
}

function reachedGainBeforeDrawdown(
  candidate: ProxPairCandidate,
  gainThreshold: number,
  drawdownThreshold = -5,
) {
  if (candidate.maxGainPercent < gainThreshold) return false;
  if (candidate.maxDrawdownPercent > drawdownThreshold) return true;
  const highAt = timeMs(candidate.sampledHighAt);
  const lowAt = timeMs(candidate.sampledLowAt);
  return highAt !== null && lowAt !== null && highAt <= lowAt;
}

function exclusionSummary(exclusions: Exclusion[]) {
  const counts = new Map<PairExclusionReason, number>();
  for (const exclusion of exclusions) {
    counts.set(exclusion.reason, (counts.get(exclusion.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return rounded(sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]);
}

function rate(hitCount: number, total: number) {
  return total === 0 ? null : rounded(hitCount / total * 100, 2);
}

function summarizePairs(pairs: PairedDecision[]) {
  const horizons = new Set(
    pairs.flatMap((pair) => Object.keys(pair.outcomes.horizons)),
  );
  const byHorizon = [...horizons].sort().map((horizon) => {
    const measured = pairs
      .map((pair) => pair.outcomes.horizons[horizon])
      .filter((value): value is number => Number.isFinite(value));
    return {
      horizon,
      measuredCount: measured.length,
      medianReturnPercent: median(measured),
      positiveReturnRatePercent: rate(
        measured.filter((value) => value > 0).length,
        measured.length,
      ),
    };
  });
  return {
    pairCount: pairs.length,
    medianMaxGainPercent: median(pairs.map((pair) => pair.outcomes.maxGainPercent)),
    medianMaxDrawdownPercent: median(pairs.map((pair) => pair.outcomes.maxDrawdownPercent)),
    plusFiveBeforeMinusFiveHitRatePercent: rate(
      pairs.filter((pair) => pair.outcomes.plusFiveBeforeMinusFive).length,
      pairs.length,
    ),
    plusTenBeforeMinusFiveHitRatePercent: rate(
      pairs.filter((pair) => pair.outcomes.plusTenBeforeMinusFive).length,
      pairs.length,
    ),
    byHorizon,
  };
}

function scoreBand(value: number) {
  if (value >= 90) return "90-100";
  if (value >= 80) return "80-89";
  if (value >= 70) return "70-79";
  if (value >= 60) return "60-69";
  return "below-60";
}

function sampleLabel(measuredCount: number) {
  if (measuredCount >= 100) return "stronger_sample" as const;
  if (measuredCount >= 30) return "reviewable_sample" as const;
  return "exploratory_only" as const;
}

function summarizePatternGroup(label: string, pairs: PairedDecision[]) {
  const measuredOneHour = pairs.flatMap((pair) => {
    const value = pair.outcomes.horizons["1h"];
    return Number.isFinite(value) ? [value] : [];
  });
  const oneHourMisses = measuredOneHour.filter((value) => value <= 0);
  return {
    label,
    pairCount: pairs.length,
    measuredOneHourCount: measuredOneHour.length,
    sampleLabel: sampleLabel(measuredOneHour.length),
    positiveOneHourRatePercent: rate(
      measuredOneHour.filter((value) => value > 0).length,
      measuredOneHour.length,
    ),
    nonPositiveOneHourRatePercent: rate(oneHourMisses.length, measuredOneHour.length),
    medianOneHourReturnPercent: median(measuredOneHour),
    plusFiveBeforeMinusFiveHitRatePercent: rate(
      pairs.filter((pair) => pair.outcomes.plusFiveBeforeMinusFive).length,
      pairs.length,
    ),
    medianMaxGainPercent: median(pairs.map((pair) => pair.outcomes.maxGainPercent)),
    medianMaxDrawdownPercent: median(pairs.map((pair) => pair.outcomes.maxDrawdownPercent)),
    fivePercentDrawdownRatePercent: rate(
      pairs.filter((pair) => pair.outcomes.maxDrawdownPercent <= -5).length,
      pairs.length,
    ),
  };
}

function groupPatterns(
  pairs: PairedDecision[],
  selector: (pair: PairedDecision) => string,
) {
  const groups = new Map<string, PairedDecision[]>();
  for (const pair of pairs) {
    const label = selector(pair);
    const group = groups.get(label) ?? [];
    group.push(pair);
    groups.set(label, group);
  }
  return [...groups.entries()]
    .map(([label, rows]) => summarizePatternGroup(label, rows))
    .sort((left, right) =>
      right.measuredOneHourCount - left.measuredOneHourCount ||
      left.label.localeCompare(right.label));
}

function buildMissPatternAnalysis(pairs: PairedDecision[]) {
  const measuredOneHourPairs = pairs.filter((pair) =>
    Number.isFinite(pair.outcomes.horizons["1h"]));
  const missedPairs = measuredOneHourPairs.filter((pair) =>
    pair.outcomes.horizons["1h"] <= 0);
  return {
    version: "prox-canonical-miss-patterns-v1" as const,
    authority: "read_only_research" as const,
    missDefinition: {
      primary: "measured_one_hour_return_less_than_or_equal_to_zero" as const,
      secondary: [
        "failed_plus_five_before_minus_five",
        "maximum_drawdown_at_or_below_minus_five_percent",
      ] as const,
      missingOutcomePolicy: "exclude_not_zero" as const,
    },
    measuredOneHourPairCount: measuredOneHourPairs.length,
    missPairCount: missedPairs.length,
    missRatePercent: rate(missedPairs.length, measuredOneHourPairs.length),
    missSeverity: {
      medianOneHourReturnPercent: median(
        missedPairs.map((pair) => pair.outcomes.horizons["1h"]),
      ),
      medianMaxGainPercent: median(
        missedPairs.map((pair) => pair.outcomes.maxGainPercent),
      ),
      medianMaxDrawdownPercent: median(
        missedPairs.map((pair) => pair.outcomes.maxDrawdownPercent),
      ),
      fivePercentDrawdownMissCount: missedPairs.filter(
        (pair) => pair.outcomes.maxDrawdownPercent <= -5,
      ).length,
    },
    allPairPatternComparisons: {
      canonicalStrategy: groupPatterns(pairs, (pair) => pair.canonical.strategy),
      canonicalRole: groupPatterns(pairs, (pair) => pair.canonical.role),
      canonicalScoreBand: groupPatterns(pairs, (pair) => scoreBand(pair.canonical.score)),
      proxDisposition: groupPatterns(pairs, (pair) => pair.prox.disposition),
      proxReadiness: groupPatterns(pairs, (pair) => pair.prox.readiness),
      proxEdgeScoreBand: groupPatterns(pairs, (pair) => scoreBand(pair.prox.edgeScore)),
      proxEvidenceConfidenceBand: groupPatterns(
        pairs,
        (pair) => scoreBand(pair.prox.evidenceConfidence),
      ),
      marketSession: groupPatterns(pairs, (pair) => pair.marketSession),
      selectionAgreement: groupPatterns(pairs, (pair) => pair.selection.agreement),
    },
    missesByPattern: {
      canonicalStrategy: groupPatterns(missedPairs, (pair) => pair.canonical.strategy),
      canonicalRole: groupPatterns(missedPairs, (pair) => pair.canonical.role),
      canonicalScoreBand: groupPatterns(missedPairs, (pair) => scoreBand(pair.canonical.score)),
      proxDisposition: groupPatterns(missedPairs, (pair) => pair.prox.disposition),
      proxReadiness: groupPatterns(missedPairs, (pair) => pair.prox.readiness),
      proxEdgeScoreBand: groupPatterns(missedPairs, (pair) => scoreBand(pair.prox.edgeScore)),
      proxEvidenceConfidenceBand: groupPatterns(
        missedPairs,
        (pair) => scoreBand(pair.prox.evidenceConfidence),
      ),
      marketSession: groupPatterns(missedPairs, (pair) => pair.marketSession),
      selectionAgreement: groupPatterns(missedPairs, (pair) => pair.selection.agreement),
    },
    interpretationPolicy: {
      minimumReviewableMeasuredGroup: 30,
      strongerMeasuredGroup: 100,
      note: "Pattern groups are diagnostic candidates, not automatic score weights or filters. Validate them on later unseen sessions before any separately approved versioned change.",
    },
  };
}

export function buildProxCanonicalPairedScorecard(
  canonicalCandidates: CanonicalPairCandidate[],
  proxCandidates: ProxPairCandidate[],
) {
  const canonicalByTicker = new Map<string, CanonicalPairCandidate[]>();
  for (const candidate of canonicalCandidates) {
    const ticker = candidate.ticker.trim().toUpperCase();
    const group = canonicalByTicker.get(ticker) ?? [];
    group.push({ ...candidate, ticker });
    canonicalByTicker.set(ticker, group);
  }

  for (const group of canonicalByTicker.values()) {
    group.sort((left, right) =>
      (timeMs(left.providerAt) ?? Number.POSITIVE_INFINITY) -
      (timeMs(right.providerAt) ?? Number.POSITIVE_INFINITY) ||
      left.id.localeCompare(right.id));
  }

  const usedCanonicalIds = new Set<string>();
  const pairs: PairedDecision[] = [];
  const exclusions: Exclusion[] = [];

  for (const prox of [...proxCandidates].sort((left, right) =>
    left.decisionAt.localeCompare(right.decisionAt) ||
    left.episodeId.localeCompare(right.episodeId))) {
    const ticker = prox.ticker.trim().toUpperCase();
    const proxProviderMs = timeMs(prox.providerAt);
    const proxDecisionMs = timeMs(prox.decisionAt);
    if (proxProviderMs === null) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "missing_prox_provider_time" });
      continue;
    }
    const tickerCandidates = canonicalByTicker.get(ticker);
    if (!tickerCandidates || tickerCandidates.length === 0) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "no_canonical_ticker" });
      continue;
    }
    const withProviderTime = tickerCandidates.filter(
      (candidate) => timeMs(candidate.providerAt) !== null,
    );
    if (withProviderTime.length === 0) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "missing_canonical_provider_time" });
      continue;
    }
    const providerAligned = withProviderTime.filter((candidate) =>
      Math.abs((timeMs(candidate.providerAt) as number) - proxProviderMs) <=
      PROX_CANONICAL_PROVIDER_ALIGNMENT_SECONDS * 1000);
    if (providerAligned.length === 0) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "provider_time_misaligned" });
      continue;
    }
    const decisionAligned = providerAligned.filter((candidate) => {
      const candidateDecisionMs = timeMs(candidate.decisionAt);
      return candidateDecisionMs !== null && proxDecisionMs !== null &&
        Math.abs(candidateDecisionMs - proxDecisionMs) <=
          PROX_CANONICAL_DECISION_ALIGNMENT_SECONDS * 1000;
    });
    if (decisionAligned.length === 0) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "decision_time_misaligned" });
      continue;
    }
    const available = decisionAligned.filter(
      (candidate) => !usedCanonicalIds.has(candidate.id),
    );
    if (available.length === 0) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "canonical_observation_already_paired" });
      continue;
    }
    const canonical = [...available].sort((left, right) => {
      const providerDifference = Math.abs(
        (timeMs(left.providerAt) as number) - proxProviderMs,
      ) - Math.abs((timeMs(right.providerAt) as number) - proxProviderMs);
      if (providerDifference !== 0) return providerDifference;
      const decisionDifference = Math.abs(
        (timeMs(left.decisionAt) as number) - (proxDecisionMs as number),
      ) - Math.abs((timeMs(right.decisionAt) as number) - (proxDecisionMs as number));
      if (decisionDifference !== 0) return decisionDifference;
      return left.id.localeCompare(right.id);
    })[0];
    if (
      !finite(canonical.price) || canonical.price <= 0 ||
      !finite(canonical.score) || !finite(prox.price) || prox.price <= 0 ||
      !finite(prox.edgeScore) || !finite(prox.maxGainPercent) ||
      !finite(prox.maxDrawdownPercent)
    ) {
      exclusions.push({ episodeId: prox.episodeId, ticker, reason: "invalid_pair_evidence" });
      continue;
    }
    usedCanonicalIds.add(canonical.id);
    const canonicalSelected = selectedCanonical(canonical);
    const proxSelected = prox.disposition === "selected";
    const agreement = canonicalSelected
      ? proxSelected ? "both_selected" : "canonical_only"
      : proxSelected ? "prox_only" : "both_withheld";
    pairs.push({
      pairId: `${canonical.id}:${prox.memberId}`,
      ticker,
      tradingDate: prox.tradingDate,
      marketSession: prox.marketSession,
      canonical,
      prox: { ...prox, ticker },
      alignment: {
        providerSkewSeconds: rounded(Math.abs(
          (timeMs(canonical.providerAt) as number) - proxProviderMs,
        ) / 1000, 1),
        decisionSkewSeconds: rounded(Math.abs(
          (timeMs(canonical.decisionAt) as number) - (proxDecisionMs as number),
        ) / 1000, 1),
        priceSkewPercent: rounded(
          Math.abs(canonical.price - prox.price) / prox.price * 100,
        ),
      },
      selection: { canonicalSelected, proxSelected, agreement },
      outcomes: {
        horizons: prox.horizons,
        maxGainPercent: prox.maxGainPercent,
        maxDrawdownPercent: prox.maxDrawdownPercent,
        plusFiveBeforeMinusFive: reachedGainBeforeDrawdown(prox, 5),
        plusTenBeforeMinusFive: reachedGainBeforeDrawdown(prox, 10),
      },
    });
  }

  const byAgreement = {
    bothSelected: summarizePairs(pairs.filter((pair) => pair.selection.agreement === "both_selected")),
    canonicalOnly: summarizePairs(pairs.filter((pair) => pair.selection.agreement === "canonical_only")),
    proxOnly: summarizePairs(pairs.filter((pair) => pair.selection.agreement === "prox_only")),
    bothWithheld: summarizePairs(pairs.filter((pair) => pair.selection.agreement === "both_withheld")),
  };
  const sessions = new Set(pairs.map((pair) => pair.tradingDate));
  const oneHourMeasured = pairs.filter((pair) => Number.isFinite(pair.outcomes.horizons["1h"]));
  const providerAlignedCandidateCount = pairs.length + exclusions.filter(
    (item) => item.reason === "canonical_observation_already_paired",
  ).length;
  const pairingCoveragePercent = rate(pairs.length, providerAlignedCandidateCount);
  const readinessReasons: string[] = [];
  if (sessions.size < 30) readinessReasons.push("Fewer than 30 distinct trading sessions are paired.");
  if (pairs.length < 500) readinessReasons.push("Fewer than 500 independent paired episodes are available.");
  if (oneHourMeasured.length < 500) readinessReasons.push("Fewer than 500 pairs have a measured one-hour outcome.");

  return {
    version: PROX_CANONICAL_PAIRED_SCORECARD_VERSION,
    authority: "read_only_research" as const,
    automaticAuthorityChange: false,
    alignmentPolicy: {
      tickerMustMatch: true,
      providerAlignmentSeconds: PROX_CANONICAL_PROVIDER_ALIGNMENT_SECONDS,
      decisionAlignmentSeconds: PROX_CANONICAL_DECISION_ALIGNMENT_SECONDS,
      canonicalObservationReuseAllowed: false,
      missingEvidencePolicy: "exclude_not_zero" as const,
    },
    coverage: {
      canonicalObservationCount: canonicalCandidates.length,
      proxEpisodeCount: proxCandidates.length,
      pairedEpisodeCount: pairs.length,
      pairedTradingSessionCount: sessions.size,
      oneHourMeasuredPairCount: oneHourMeasured.length,
      providerAlignedCandidateCount,
      pairingCoveragePercent,
      exclusionCount: exclusions.length,
      exclusionsByReason: exclusionSummary(exclusions),
    },
    promotionReview: {
      evidenceFloorMet: readinessReasons.length === 0,
      status: readinessReasons.length === 0
        ? "eligible_for_owner_review" as const
        : "insufficient_evidence" as const,
      thresholds: {
        tradingSessions: 30,
        pairedEpisodes: 500,
        measuredOneHourOutcomes: 500,
      },
      reasons: readinessReasons,
      note: "Meeting these research floors never changes ranking, scoring, Agent authority, or execution without a separately approved promotion.",
    },
    comparisons: {
      allPairs: summarizePairs(pairs),
      byAgreement,
    },
    missAnalysis: buildMissPatternAnalysis(pairs),
    pairs,
    exclusions,
  };
}
