import type {
  CryptoDiscoveryCandidate,
  CryptoOpportunity,
  CryptoShadowDiscovery,
} from "@/lib/crypto/contracts";

const MIN_LIVE_CONFIRMATION = 45;
const MIN_ACTIVE_BAR_RATIO = 50;
const MAX_PUBLIC_SPREAD_PERCENT = 1.5;
const HIGH_RISK_THRESHOLD = 90;
const HIGH_RISK_CONFIRMATION_FLOOR = 70;

const clamp = (value: number) => Math.max(0, Math.min(100, value));

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / values.length;
  return Math.sqrt(variance);
}

function anchoredDiscoveryCandidate(
  opportunity: CryptoOpportunity,
  candidates: CryptoDiscoveryCandidate[],
) {
  return candidates.find((candidate) =>
    candidate.symbol === opportunity.symbol &&
    candidate.markets.some(
      (market) =>
        market.venue === "coinbase" &&
        market.productId === opportunity.productId,
    )
  ) ?? null;
}

function venueContext(candidate: CryptoDiscoveryCandidate | null) {
  if (!candidate) {
    return {
      adjustment: 0,
      score: 0,
      flags: ["single_source_observation"],
      venues: ["coinbase"] as CryptoOpportunity["sourceVenues"],
      quoteCurrencies: ["USD"],
    };
  }

  // Only like-for-like rolling 24-hour windows receive score authority.
  // Kraken's UTC-session ticker remains useful discovery evidence, but it
  // cannot inflate or depress the final score until we normalize it ourselves.
  const comparable = candidate.markets.filter(
    (market) => market.sourceWindow === "rolling_24h",
  );
  const positiveComparable = comparable.filter(
    (market) => market.observedMovePercent > 0,
  );
  const dispersion = standardDeviation(
    comparable.map((market) => market.observedMovePercent),
  );
  const meanSpreadValues = comparable.flatMap((market) =>
    market.spreadPercent === null ? [] : [market.spreadPercent]
  );
  const meanSpread = meanSpreadValues.length > 0
    ? meanSpreadValues.reduce((sum, value) => sum + value, 0) /
      meanSpreadValues.length
    : null;
  const confirmationRatio = comparable.length > 0
    ? positiveComparable.length / comparable.length
    : 0;
  const score = Math.round(clamp(
    comparable.length * 20 + confirmationRatio * 45 - dispersion * 2,
  ));
  let adjustment = 0;
  const flags: string[] = [];
  if (
    comparable.length >= 2 &&
    positiveComparable.length >= 2 &&
    dispersion <= 6
  ) {
    adjustment += comparable.length >= 3 ? 4 : 3;
    flags.push("multi_venue_24h_confirmation");
  }
  if (dispersion >= 10) {
    adjustment -= 4;
    flags.push("cross_venue_disagreement");
  }
  if (meanSpread !== null && meanSpread > MAX_PUBLIC_SPREAD_PERCENT) {
    adjustment -= 3;
    flags.push("multi_venue_spread_risk");
  }
  if (candidate.markets.some((market) => market.sourceWindow === "utc_session")) {
    flags.push("utc_session_discovery_only");
  }

  return {
    adjustment,
    score,
    flags,
    venues: [...new Set(candidate.venues)],
    quoteCurrencies: [...new Set(candidate.quoteCurrencies)],
  };
}

export function applyCryptoDecisionAuthority({
  opportunities,
  discovery,
}: {
  opportunities: CryptoOpportunity[];
  discovery: CryptoShadowDiscovery;
}) {
  return opportunities.map((opportunity) => {
    const packet = opportunity.proxIntelligence;
    const candidate = anchoredDiscoveryCandidate(
      opportunity,
      discovery.candidates,
    );
    const venue = venueContext(candidate);
    const blockers: string[] = [];

    if (!opportunity.eligible) blockers.push("base_discovery_gates_incomplete");
    if (!packet) {
      blockers.push("live_tape_unavailable");
    } else {
      if (!packet.fresh || packet.state === "stale") {
        blockers.push("live_tape_stale");
      }
      if (packet.barCount < 16) blockers.push("limited_candle_history");
      if (packet.state === "weakening") blockers.push("live_momentum_weakening");
      if (packet.marketConfirmation < MIN_LIVE_CONFIRMATION) {
        blockers.push("live_confirmation_below_floor");
      }
      const spread = packet.features.spreadPercent;
      if (spread === null) blockers.push("spread_unavailable");
      else if (spread > MAX_PUBLIC_SPREAD_PERCENT) blockers.push("wide_spread");
      const activeBarRatio = packet.features.activeBarRatioPercent;
      if (activeBarRatio === null || activeBarRatio < MIN_ACTIVE_BAR_RATIO) {
        blockers.push("sparse_trading");
      }
      if (packet.features.peakFailureConfirmed) {
        blockers.push("post_peak_breakdown");
      }
      if (
        opportunity.riskScore >= HIGH_RISK_THRESHOLD &&
        !(
          packet.state === "expanding" &&
          packet.marketConfirmation >= HIGH_RISK_CONFIRMATION_FLOOR
        )
      ) {
        blockers.push("extreme_risk_unconfirmed");
      }
    }

    const liveAdjustment = !packet
      ? -15
      : !packet.fresh
        ? -15
        : packet.proposedScoreAdjustment;
    const opportunityScore = Math.round(clamp(
      opportunity.baseOpportunityScore + liveAdjustment + venue.adjustment,
    ));
    const qualified = blockers.length === 0 && opportunityScore >= 45;
    const radarEligible = !qualified && Boolean(
      (opportunity.eligible || opportunity.radarEligible) &&
      opportunity.dollarVolume24h >= 250_000 &&
      opportunityScore >= 30,
    );
    const decisionState = qualified
      ? "qualified"
      : radarEligible
        ? "radar"
        : "withheld";

    return {
      ...opportunity,
      opportunityScore,
      eligible: qualified,
      radarEligible,
      decisionState,
      decisionReason: qualified
        ? "24-hour discovery and fresh ProX live-tape evidence confirm the same opportunity."
        : radarEligible
          ? `Momentum remains observable, but entry authority is withheld: ${blockers.join(", ")}.`
          : `The setup is withheld: ${blockers.join(", ") || "final score below the publication floor"}.`,
      authorityFlags: [...new Set([...venue.flags, ...blockers])],
      sourceVenues: venue.venues,
      quoteCurrencies: venue.quoteCurrencies,
      venueConfirmationScore: venue.score,
      liveDataFresh: packet?.fresh === true,
      summary: qualified
        ? `${opportunity.symbol} has aligned 24-hour momentum, liquidity, and fresh ProX live-tape confirmation.`
        : `${opportunity.symbol} is still being monitored, but it does not currently have full live-entry confirmation.`,
      riskTags: [
        ...opportunity.riskTags,
        ...(!packet?.fresh ? ["Stale Live Tape"] : []),
        ...(packet?.state === "weakening" ? ["Live Momentum Weakening"] : []),
      ].filter((tag, index, tags) => tags.indexOf(tag) === index),
    } satisfies CryptoOpportunity;
  });
}

export function rankCryptoDecisionFrame(opportunities: CryptoOpportunity[]) {
  const ranked = [...opportunities].sort(
    (left, right) =>
      Number(right.eligible) - Number(left.eligible) ||
      right.opportunityScore - left.opportunityScore ||
      right.change24hPercent - left.change24hPercent ||
      right.dollarVolume24h - left.dollarVolume24h,
  );
  const qualified = ranked.filter((opportunity) => opportunity.eligible);
  const rankedRadar = ranked
    .filter((opportunity) => opportunity.radarEligible)
    .slice(0, 6);
  const developingLeader = qualified.length === 0
    ? rankedRadar[0] ?? null
    : null;
  const radar = developingLeader ? rankedRadar.slice(1) : rankedRadar;
  return {
    evaluated: ranked,
    hero: qualified[0] ?? null,
    developingLeader,
    contenders: qualified.slice(1, 6),
    radar,
    radarProducts: rankedRadar.length,
    authorityEligibleProducts: qualified.length,
    withheldProducts: ranked.filter(
      (opportunity) => opportunity.decisionState !== "qualified",
    ).length,
    staleProxProducts: ranked.filter(
      (opportunity) => opportunity.proxIntelligence?.fresh === false,
    ).length,
  };
}
