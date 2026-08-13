export const PROX_MARKET_DISCOVERY_VERSION =
  "prox-market-discovery-v1-direct-polygon";
export const PROX_MARKET_DISCOVERY_MODE = "shadow_research" as const;

export type ProxMarketSession =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "closed";

export type ProxMarketDiscoveryFlag =
  | "quiet_participation"
  | "session_reclaim"
  | "volume_breakout"
  | "price_expansion"
  | "near_session_high"
  | "liquidity_surge"
  | "corporate_action_dislocation"
  | "downside_volume_breakdown"
  | "post_peak_deterioration";

export type ProxKnownCorporateAction = {
  sourceId: string;
  executionDate: string;
  splitFrom: number;
  splitTo: number;
  adjustmentType: string | null;
};

export type ProxMarketDiscoveryInput = {
  ticker: string;
  observedAt: string;
  marketSession: ProxMarketSession;
  expectedVolumeFraction: number;
  price: number;
  previousClose: number | null;
  sessionOpenPrice: number | null;
  sessionHighPrice: number | null;
  sessionLowPrice: number | null;
  currentVolume: number;
  previousVolume: number;
  reportedChangePercent: number | null;
  knownCorporateAction?: ProxKnownCorporateAction | null;
};

export type ProxMarketDiscoveryObservation = {
  ticker: string;
  observedAt: string;
  marketSession: ProxMarketSession;
  price: number;
  previousClose: number | null;
  sessionOpenPrice: number | null;
  sessionHighPrice: number | null;
  sessionLowPrice: number | null;
  rawFullDayChangePercent: number | null;
  observedChangePercent: number | null;
  sessionChangePercent: number | null;
  pullbackFromSessionHighPercent: number | null;
  currentVolume: number;
  previousVolume: number;
  expectedVolumeFraction: number;
  rawVolumeRatio: number | null;
  timeAdjustedRelativeVolume: number | null;
  dollarVolume: number;
  corporateActionSuspected: boolean;
  corporateActionFactor: number | null;
  corporateActionSourceId: string | null;
  anomalyFlags: ProxMarketDiscoveryFlag[];
  researchPriority: number;
  reasons: string[];
  eligibleForResearch: boolean;
};

const COMMON_SPLIT_FACTORS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 50, 100];

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function round(value: number, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function nearestSplitFactor(ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio < 1.5) return null;
  let nearest: number | null = null;
  let smallestDeviation = Infinity;
  for (const factor of COMMON_SPLIT_FACTORS) {
    const deviation = Math.abs(ratio - factor) / factor;
    if (deviation < smallestDeviation) {
      nearest = factor;
      smallestDeviation = deviation;
    }
  }
  return smallestDeviation <= 0.035 ? nearest : null;
}

function corporateActionEvidence(input: ProxMarketDiscoveryInput) {
  const known = input.knownCorporateAction ?? null;
  if (
    known &&
    Number.isFinite(known.splitFrom) &&
    Number.isFinite(known.splitTo) &&
    known.splitFrom > 0 &&
    known.splitTo > 0
  ) {
    return {
      suspected: true,
      factor: round(
        Math.max(
          known.splitFrom / known.splitTo,
          known.splitTo / known.splitFrom,
        ),
        4,
      ),
      sourceId: known.sourceId,
    };
  }

  const previousClose = positiveNumber(input.previousClose);
  const sessionOpen = positiveNumber(input.sessionOpenPrice);
  if (previousClose === null || sessionOpen === null) {
    return { suspected: false, factor: null, sourceId: null };
  }

  const ratio = Math.max(
    sessionOpen / previousClose,
    previousClose / sessionOpen,
  );
  const factor = nearestSplitFactor(ratio);
  const rawGapPercent = Math.abs(((sessionOpen - previousClose) / previousClose) * 100);
  const reportedChange = finiteNumber(input.reportedChangePercent);
  const providerDisagreesWithRawGap =
    reportedChange !== null && Math.abs(reportedChange) < 150;

  // A precise 3x+ discontinuity at the session open accompanied by a much
  // smaller provider-reported move is characteristic of an unadjusted
  // corporate-action reference, not organic momentum. Two-for-one moves are
  // not guessed because a genuine 100% gap is possible; an actual split feed
  // record can still establish those deterministically.
  const suspected = Boolean(
    factor !== null &&
      factor >= 3 &&
      rawGapPercent >= 180 &&
      providerDisagreesWithRawGap,
  );
  return {
    suspected,
    factor: suspected ? factor : null,
    sourceId: null,
  };
}

export function getProxEasternMarketClock(now = new Date()): {
  session: ProxMarketSession;
  expectedVolumeFraction: number;
  easternDate: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const rawHour = Number(value("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(value("minute"));
  const minutes = hour * 60 + minute;
  const easternDate = `${value("year")}-${value("month")}-${value("day")}`;

  if (weekday === "Sat" || weekday === "Sun") {
    return { session: "closed", expectedVolumeFraction: 1, easternDate };
  }
  if (minutes >= 240 && minutes < 570) {
    return {
      session: "pre_market",
      expectedVolumeFraction: 0.05,
      easternDate,
    };
  }
  if (minutes >= 570 && minutes < 960) {
    const elapsedFraction = (minutes - 570) / 390;
    return {
      session: "regular",
      expectedVolumeFraction: Math.min(1, 0.08 + elapsedFraction * 0.92),
      easternDate,
    };
  }
  if (minutes >= 960 && minutes < 1200) {
    return {
      session: "after_hours",
      expectedVolumeFraction: 1,
      easternDate,
    };
  }
  return { session: "closed", expectedVolumeFraction: 1, easternDate };
}

export function evaluateProxMarketDiscovery(
  input: ProxMarketDiscoveryInput,
): ProxMarketDiscoveryObservation {
  const ticker = input.ticker.toUpperCase().trim();
  const price = positiveNumber(input.price) ?? 0;
  const previousClose = positiveNumber(input.previousClose);
  const sessionOpen = positiveNumber(input.sessionOpenPrice);
  const sessionHigh = positiveNumber(input.sessionHighPrice);
  const sessionLow = positiveNumber(input.sessionLowPrice);
  const currentVolume = Math.max(0, finiteNumber(input.currentVolume) ?? 0);
  const previousVolume = Math.max(0, finiteNumber(input.previousVolume) ?? 0);
  const expectedVolumeFraction = clamp(
    finiteNumber(input.expectedVolumeFraction) ?? 1,
    0.01,
    1,
  );
  const rawFullDayChangePercent =
    price > 0 && previousClose !== null
      ? ((price - previousClose) / previousClose) * 100
      : finiteNumber(input.reportedChangePercent);
  const sessionChangePercent =
    price > 0 && sessionOpen !== null
      ? ((price - sessionOpen) / sessionOpen) * 100
      : null;
  const pullbackFromSessionHighPercent =
    price > 0 && sessionHigh !== null
      ? Math.max(0, ((Math.max(sessionHigh, price) - price) / Math.max(sessionHigh, price)) * 100)
      : null;
  const rawVolumeRatio =
    previousVolume > 0 ? currentVolume / previousVolume : null;
  const timeAdjustedRelativeVolume =
    rawVolumeRatio !== null
      ? Math.min(100, rawVolumeRatio / expectedVolumeFraction)
      : null;
  const dollarVolume = price * currentVolume;
  const corporateAction = corporateActionEvidence(input);
  const observedChangePercent =
    corporateAction.suspected && sessionChangePercent !== null
      ? sessionChangePercent
      : rawFullDayChangePercent;

  const flags = new Set<ProxMarketDiscoveryFlag>();
  const reasons: string[] = [];
  const rvol = timeAdjustedRelativeVolume ?? 0;
  const observedMove = observedChangePercent ?? 0;
  const sessionMove = sessionChangePercent ?? observedMove;
  const pullback = pullbackFromSessionHighPercent;

  if (
    rvol >= 2 &&
    Math.abs(observedMove) <= 5 &&
    sessionMove >= 0.5 &&
    (pullback === null || pullback <= 6)
  ) {
    flags.add("quiet_participation");
    reasons.push(
      `Cumulative participation is ${round(rvol, 2)}x pace while price remains early in the move.`,
    );
  }
  if (
    rawFullDayChangePercent !== null &&
    rawFullDayChangePercent <= 0.5 &&
    sessionMove >= 2 &&
    rvol >= 1.5 &&
    (pullback === null || pullback <= 8)
  ) {
    flags.add("session_reclaim");
    reasons.push("The active session is reclaiming despite a flat or negative headline comparison.");
  }
  if (rvol >= 3) {
    flags.add("volume_breakout");
    reasons.push(`Volume is running at ${round(rvol, 2)}x its time-adjusted pace.`);
  }
  if (observedMove >= 5 || sessionMove >= 5) {
    flags.add("price_expansion");
    reasons.push("Price expansion is confirmed by the current session tape.");
  }
  if (pullback !== null && pullback <= 3) {
    flags.add("near_session_high");
    reasons.push(`Price is holding within ${round(pullback, 2)}% of the session high.`);
  }
  if (
    currentVolume >= 100_000 &&
    dollarVolume >= 1_000_000 &&
    (previousVolume < 10_000 || (rawVolumeRatio ?? 0) >= 10)
  ) {
    flags.add("liquidity_surge");
    reasons.push("Live liquidity materially exceeds the instrument's prior-day baseline.");
  }
  if (corporateAction.suspected) {
    flags.add("corporate_action_dislocation");
    reasons.push(
      corporateAction.sourceId
        ? "A Polygon corporate-action record is attached; raw and normalized movement are stored separately."
        : `A likely ${corporateAction.factor ?? "multi"}x corporate-action discontinuity was isolated from organic momentum.`,
    );
  }
  if (rvol >= 2 && (observedMove <= -5 || sessionMove <= -5)) {
    flags.add("downside_volume_breakdown");
    reasons.push("Heavy participation is confirming downside movement rather than upside momentum.");
  }
  const highFromOpenPercent =
    sessionHigh !== null && sessionOpen !== null
      ? ((sessionHigh - sessionOpen) / sessionOpen) * 100
      : null;
  if (
    pullback !== null &&
    pullback >= 10 &&
    highFromOpenPercent !== null &&
    highFromOpenPercent >= 5
  ) {
    flags.add("post_peak_deterioration");
    reasons.push("The ticker expanded intraday but has materially deteriorated from its session high.");
  }

  const anomalyFlags = [...flags];
  const researchDrivers = anomalyFlags.filter(
    (flag) => flag !== "near_session_high",
  );
  const minimumLiquidity =
    (currentVolume >= 25_000 && dollarVolume >= 100_000) ||
    currentVolume >= 100_000;
  const eligibleForResearch =
    price > 0 && minimumLiquidity && researchDrivers.length > 0;

  let researchPriority = 0;
  researchPriority += Math.min(30, Math.log2(Math.max(1, rvol) + 1) * 8);
  researchPriority += Math.min(25, Math.abs(observedMove) * 1.25);
  researchPriority += Math.min(10, Math.max(0, sessionMove));
  if (flags.has("quiet_participation")) researchPriority += 15;
  if (flags.has("session_reclaim")) researchPriority += 12;
  if (flags.has("liquidity_surge")) researchPriority += 12;
  if (flags.has("corporate_action_dislocation")) researchPriority += 18;
  if (flags.has("post_peak_deterioration")) researchPriority += 10;
  if (flags.has("downside_volume_breakdown")) researchPriority += 8;
  if (flags.has("near_session_high")) researchPriority += 6;
  if (!eligibleForResearch) researchPriority = 0;

  return {
    ticker,
    observedAt: input.observedAt,
    marketSession: input.marketSession,
    price: round(price, 6),
    previousClose: previousClose === null ? null : round(previousClose, 6),
    sessionOpenPrice: sessionOpen === null ? null : round(sessionOpen, 6),
    sessionHighPrice: sessionHigh === null ? null : round(sessionHigh, 6),
    sessionLowPrice: sessionLow === null ? null : round(sessionLow, 6),
    rawFullDayChangePercent:
      rawFullDayChangePercent === null
        ? null
        : round(rawFullDayChangePercent),
    observedChangePercent:
      observedChangePercent === null ? null : round(observedChangePercent),
    sessionChangePercent:
      sessionChangePercent === null ? null : round(sessionChangePercent),
    pullbackFromSessionHighPercent:
      pullbackFromSessionHighPercent === null
        ? null
        : round(pullbackFromSessionHighPercent),
    currentVolume: Math.round(currentVolume),
    previousVolume: Math.round(previousVolume),
    expectedVolumeFraction: round(expectedVolumeFraction, 4),
    rawVolumeRatio: rawVolumeRatio === null ? null : round(rawVolumeRatio, 4),
    timeAdjustedRelativeVolume:
      timeAdjustedRelativeVolume === null
        ? null
        : round(timeAdjustedRelativeVolume, 4),
    dollarVolume: round(dollarVolume, 2),
    corporateActionSuspected: corporateAction.suspected,
    corporateActionFactor: corporateAction.factor,
    corporateActionSourceId: corporateAction.sourceId,
    anomalyFlags,
    researchPriority: Math.round(clamp(researchPriority)),
    reasons: reasons.slice(0, 8),
    eligibleForResearch,
  };
}
