import type { TradeFrameworkResult } from "@/lib/canonical-trade-framework";
import { getBreakoutPotential } from "@/lib/breakout-potential";
import type { ProxIntelligencePacket } from "@/lib/prox/intelligence";
import { isSupportedType } from "@/lib/security-type-policy";
import {
  enforceSpotMomentumAuthority,
  preserveDisplayHardFailures,
} from "@/lib/spot-momentum-authority";
import {
  getCanonicalMomentumMagnitude,
  getSpotMomentumStrategyScore,
} from "@/lib/canonical-momentum";
import { evaluateProxPublicAuthority } from "@/lib/prox/public-authority";

export { getCanonicalMomentumMagnitude } from "@/lib/canonical-momentum";

export const CANONICAL_OPPORTUNITY_VERSION =
  "opportunities-v12-full-day-momentum-authority";
export const ACTIVE_SESSION_MAX_SIGNAL_AGE_MS = 20 * 60 * 1000;
export const EXTREME_MOMENTUM_MIN_CHANGE = 25;
export const EXTREME_MOMENTUM_MIN_RVOL = 3;
export const CONTINUATION_MIN_MOMENTUM_SCORE = 70;
const SEASONED_BAR_COUNT = 21;
const MAX_PAPER_CONTINUATION_DOWNSIDE_PERCENT = 30;
const MIN_PAPER_CONTINUATION_ENTRY_QUALITY = 20;
const PRICE_HISTORY_DISCONTINUITY_PREFIX =
  "Live price is inconsistent with recent adjusted history";

export type OpportunityStrategy = "spot_momentum" | "before_the_crowd";

export type SignalRow = {
  ticker: string;
  price: number | string | null;
  change_percent: number | string | null;
  relative_volume: number | string | null;
  avg_volume: number | string | null;
  ht_score: number | string | null;
  momentum_score: number | string | null;
  crowd_score: number | string | null;
  trap_score: number | string | null;
  catalyst_score: number | string | null;
  pattern: string | null;
  state: string | null;
  signal_state: string | null;
  scanned_at: string | null;
  retrieved_for_sm?: boolean | null;
  retrieved_for_btc?: boolean | null;
  retrieved_for_catalyst?: boolean | null;
  session_open_price?: number | string | null;
  change_from_open_percent?: number | string | null;
  session_high_price?: number | string | null;
  pullback_from_session_high_percent?: number | string | null;
  scan_session?: string | null;
  retrieved_for_reclaim?: boolean | null;
  security_type?: string | null;
  scan_run_id?: string | null;
};

export type OpportunityCandidate = {
  ticker: string;
  price: number;
  change: number;
  sessionOpenPrice: number | null;
  changeFromOpenPercent: number | null;
  sessionHighPrice: number | null;
  pullbackFromSessionHighPercent: number | null;
  scanSession: string;
  relativeVolume: number;
  avgVolume: number;
  htScore: number;
  momentumScore: number;
  crowdScore: number;
  trapScore: number;
  catalystScore: number;
  pattern: string;
  state: string;
  signalState: string;
  scannedAt: string;
  retrievedForSm: boolean;
  retrievedForBtc: boolean;
  retrievedForCatalyst: boolean;
  retrievedForReclaim: boolean;
  securityType: string | null;
  decisionQuoteLive?: boolean;
  decisionQuoteAsOf?: string | null;
};

export type ExplosionAssessment = {
  state:
    | "price_discovery"
    | "confirmed_expansion"
    | "expansion_setup"
    | "exhaustion_risk"
    | "developing";
  label: string;
  score: number;
  continuationConfirmed: boolean;
  upsideModel: TradeFrameworkResult["upsideModel"];
  upsideIsIndependentlyModeled: boolean;
  structuralDownsidePercent: number | null;
  entryQuality: number | null;
  summary: string;
  baseCase: string;
  expansionCase: string;
  tailCase: string;
  invalidation: string;
  scenarioBands: {
    methodologyVersion: "price-discovery-scenarios-v1";
    unit: "additional_from_current_price";
    base: { min: number; max: number };
    expansion: { min: number; max: number };
    tail: { min: number; max: number };
    structuralRisk: number;
    expansionRr: number;
    inputs: {
      atrPercent: number;
      currentMovePercent: number;
      relativeVolume: number;
      momentumScore: number;
      explosionScore: number;
    };
  } | null;
  paperEntryEligible: boolean;
  paperTradeScore: number | null;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const num = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export function mapSignalRow(row: SignalRow | Record<string, unknown>): OpportunityCandidate {
  return {
    ticker: String(row.ticker ?? "").toUpperCase(),
    price: num(row.price),
    change: num(row.change_percent),
    sessionOpenPrice:
      row.session_open_price === null || row.session_open_price === undefined
        ? null
        : num(row.session_open_price),
    changeFromOpenPercent:
      row.change_from_open_percent === null ||
      row.change_from_open_percent === undefined
        ? null
        : num(row.change_from_open_percent),
    sessionHighPrice:
      row.session_high_price === null || row.session_high_price === undefined
        ? null
        : num(row.session_high_price),
    pullbackFromSessionHighPercent:
      row.pullback_from_session_high_percent === null ||
      row.pullback_from_session_high_percent === undefined
        ? null
        : Math.max(0, num(row.pullback_from_session_high_percent)),
    scanSession: String(row.scan_session ?? "unknown"),
    relativeVolume: num(row.relative_volume, 1),
    avgVolume: num(row.avg_volume),
    htScore: num(row.ht_score),
    momentumScore: num(row.momentum_score),
    crowdScore: num(row.crowd_score, 50),
    trapScore: num(row.trap_score, 50),
    catalystScore: num(row.catalyst_score),
    pattern: String(row.pattern ?? "Standard"),
    state: String(row.state ?? ""),
    signalState: String(row.signal_state ?? ""),
    scannedAt: String(row.scanned_at ?? ""),
    retrievedForSm: Boolean(row.retrieved_for_sm),
    retrievedForBtc: Boolean(row.retrieved_for_btc),
    retrievedForCatalyst: Boolean(row.retrieved_for_catalyst),
    retrievedForReclaim: Boolean(row.retrieved_for_reclaim),
    securityType: row.security_type ? String(row.security_type) : null,
  };
}

export function isSessionReclaim(candidate: OpportunityCandidate) {
  return (
    candidate.retrievedForReclaim &&
    candidate.sessionOpenPrice !== null &&
    candidate.sessionOpenPrice > 0 &&
    candidate.changeFromOpenPercent !== null &&
    candidate.changeFromOpenPercent > 0
  );
}

export function getMomentumReferenceChange(candidate: OpportunityCandidate) {
  // Public movement, structure, and continuation eligibility always remain
  // anchored to the previous close. Movement from today's open is supporting
  // context only; it must never turn a negative full-day stock into a positive
  // Spot Momentum decision.
  return candidate.change;
}

function getActiveSessionChange(candidate: OpportunityCandidate) {
  const hasCurrentSessionReference =
    (candidate.scanSession === "pre_market" ||
      candidate.scanSession === "regular") &&
    candidate.sessionOpenPrice !== null &&
    candidate.sessionOpenPrice > 0 &&
    candidate.changeFromOpenPercent !== null;
  return hasCurrentSessionReference
    ? candidate.changeFromOpenPercent
    : null;
}

export function chooseOpportunityStrategy(
  candidate: OpportunityCandidate,
  requested: string | null,
): OpportunityStrategy {
  if (requested === "before_crowd" || requested === "before_the_crowd") {
    return "before_the_crowd";
  }
  if (requested === "momentum" || requested === "spot_momentum") {
    return "spot_momentum";
  }
  if (candidate.retrievedForSm) return "spot_momentum";
  if (candidate.retrievedForBtc) return "before_the_crowd";
  return "spot_momentum";
}

export function isActiveMarketSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    weekday === "Sat" ||
    weekday === "Sun"
  ) {
    return false;
  }
  const minutes = hour * 60 + minute;
  return minutes >= 240 && minutes < 1200;
}

export function isExtremeMomentum(
  candidate: OpportunityCandidate,
  strategy: OpportunityStrategy,
) {
  return (
    strategy === "spot_momentum" &&
    getMomentumReferenceChange(candidate) >= EXTREME_MOMENTUM_MIN_CHANGE &&
    candidate.relativeVolume >= EXTREME_MOMENTUM_MIN_RVOL
  );
}

export function isConfirmedContinuationRunner(
  candidate: OpportunityCandidate,
  strategy: OpportunityStrategy,
) {
  return (
    isExtremeMomentum(candidate, strategy) &&
    candidate.pattern !== "Exhaustion Risk" &&
    (candidate.momentumScore >= CONTINUATION_MIN_MOMENTUM_SCORE ||
      candidate.signalState === "Strong Momentum")
  );
}

function signalStrength(
  candidate: OpportunityCandidate,
  strategy: OpportunityStrategy,
) {
  if (strategy === "spot_momentum") {
    return clamp(
      Math.round(
        candidate.htScore * 0.55 +
          candidate.momentumScore * 0.25 +
          Math.min(100, candidate.relativeVolume * 12) * 0.2,
      ),
    );
  }
  const earliness = Math.max(0, 100 - candidate.crowdScore);
  return clamp(
    Math.round(
      candidate.htScore * 0.45 +
        earliness * 0.3 +
        Math.min(100, candidate.relativeVolume * 10) * 0.15 +
        candidate.catalystScore * 0.1,
    ),
  );
}

function buildExplosionAssessment(
  candidate: OpportunityCandidate,
  framework: TradeFrameworkResult,
  breakoutScore: number,
  eligible: boolean,
  strategy: OpportunityStrategy,
  forcePriceDiscovery = false,
  continuationConfirmed?: boolean,
): ExplosionAssessment {
  const momentumReferenceChange = getMomentumReferenceChange(candidate);
  const confirmed =
    continuationConfirmed ??
    isConfirmedContinuationRunner(candidate, strategy);
  const extreme = isExtremeMomentum(candidate, strategy);
  const state: ExplosionAssessment["state"] =
    confirmed &&
    (framework.upsideModel === "price_discovery_unmodeled" ||
      forcePriceDiscovery)
      ? "price_discovery"
      : confirmed
        ? "confirmed_expansion"
        : extreme
          ? "exhaustion_risk"
          : breakoutScore >= 68
            ? "expansion_setup"
            : "developing";
  const label =
    state === "price_discovery"
      ? "Price Discovery"
      : state === "confirmed_expansion"
        ? "Confirmed Expansion"
        : state === "expansion_setup"
          ? "Expansion Setup"
          : state === "exhaustion_risk"
            ? "Explosion Unconfirmed"
            : "Developing";
  const paperEntryEligible =
    eligible &&
    confirmed &&
    framework.downsideRisk !== null &&
    framework.downsideRisk > 0 &&
    framework.downsideRisk <= MAX_PAPER_CONTINUATION_DOWNSIDE_PERCENT &&
    framework.entryQuality !== null &&
    framework.entryQuality >= MIN_PAPER_CONTINUATION_ENTRY_QUALITY;
  const downsideDiscipline =
    framework.downsideRisk === null
      ? 0
      : 100 - Math.min(100, framework.downsideRisk * 3);
  const paperTradeScore = paperEntryEligible
    ? Math.round(
        clamp(
          breakoutScore * 0.7 +
            (framework.entryQuality ?? 0) * 0.2 +
            downsideDiscipline * 0.1,
        ),
      )
    : null;
  const atrPercent =
    framework.atr14 !== null && candidate.price > 0
      ? (framework.atr14 / candidate.price) * 100
      : null;
  const scenarioBands =
    state === "price_discovery" &&
    atrPercent !== null &&
    atrPercent > 0 &&
    framework.downsideRisk !== null &&
    framework.downsideRisk > 0
      ? (() => {
          // These are conditional expansion scenarios, not price targets.
          // Base is anchored to the stock's own ATR. Expansion and tail are
          // anchored to the live impulse, scaled only by observed RVOL,
          // momentum, and the already-published explosion score. Downside is
          // never used to manufacture upside.
          const volumeFuel = clamp(candidate.relativeVolume * 7.5);
          const fuelFactor = Math.max(
            0.6,
            Math.min(
              1.2,
              (volumeFuel * 0.35 +
                clamp(candidate.momentumScore) * 0.4 +
                breakoutScore * 0.25) /
                100,
            ),
          );
          const impulse = Math.max(
            0,
            Math.min(150, momentumReferenceChange),
          );
          const baseMin = atrPercent * 0.75;
          const baseMax = atrPercent * (1 + fuelFactor);
          const expansionMin = Math.max(baseMax, impulse * 0.35 * fuelFactor);
          const expansionMax = Math.max(
            expansionMin,
            impulse * 0.75 * fuelFactor,
          );
          const tailMin = Math.max(
            expansionMax,
            impulse * 0.9 * fuelFactor,
          );
          const tailMax = Math.max(
            tailMin,
            impulse * 1.5 * fuelFactor,
          );
          const expansionMidpoint = (expansionMin + expansionMax) / 2;
          const rounded = (value: number) =>
            Math.round(Math.min(200, value) * 10) / 10;
          return {
            methodologyVersion: "price-discovery-scenarios-v1" as const,
            unit: "additional_from_current_price" as const,
            base: { min: rounded(baseMin), max: rounded(baseMax) },
            expansion: {
              min: rounded(expansionMin),
              max: rounded(expansionMax),
            },
            tail: { min: rounded(tailMin), max: rounded(tailMax) },
            structuralRisk: rounded(framework.downsideRisk),
            expansionRr:
              Math.round(
                (expansionMidpoint / framework.downsideRisk) * 10,
              ) / 10,
            inputs: {
              atrPercent: rounded(atrPercent),
              currentMovePercent: rounded(momentumReferenceChange),
              relativeVolume: rounded(candidate.relativeVolume),
              momentumScore: Math.round(candidate.momentumScore),
              explosionScore: breakoutScore,
            },
          };
        })()
      : null;

  return {
    state,
    label,
    score: breakoutScore,
    continuationConfirmed: confirmed,
    upsideModel: forcePriceDiscovery
      ? "price_discovery_unmodeled"
      : framework.upsideModel,
    upsideIsIndependentlyModeled:
      framework.upsideModel === "resistance_based" &&
      framework.upsideMax !== null,
    structuralDownsidePercent: framework.downsideRisk,
    entryQuality: framework.entryQuality,
    summary:
      state === "price_discovery"
        ? "Observed price, volume, and momentum confirm a live expansion, but no reliable upside ceiling exists above the breakout."
        : state === "confirmed_expansion"
          ? "Observed price, volume, and momentum confirm expansion toward a real resistance reference."
          : state === "exhaustion_risk"
            ? "The move is large, but current momentum evidence does not confirm that the expansion is still alive."
            : "Explosion potential measures observed expansion fuel; it is not a return forecast.",
    baseCase: confirmed
      ? "Momentum remains active while volume and signal strength hold."
      : "The setup remains a watch until continuation confirms.",
    expansionCase:
      state === "price_discovery"
        ? "Further expansion is plausible while confirmation holds; no percentage target is asserted."
        : framework.upsideMax !== null
          ? `Known resistance supports a modeled upper band near ${framework.upsideMax.toFixed(1)}%.`
          : "Further expansion requires stronger confirmation.",
    tailCase:
      "A 50–100%+ total-day move is a possible tail outcome for this class of runner, not a forecast or promised target.",
    invalidation:
      framework.downsideRisk !== null
        ? `The structural downside reference is ${framework.downsideRisk.toFixed(1)}%; momentum failure can occur sooner.`
        : "Exit the thesis when momentum confirmation or data quality fails.",
    scenarioBands,
    paperEntryEligible,
    paperTradeScore,
  };
}

function isMoveExplainedPriceDiscontinuity(
  reason: string,
  candidateChange: number,
) {
  if (!reason.startsWith(PRICE_HISTORY_DISCONTINUITY_PREFIX)) return false;
  const match = reason.match(/\(([\d.]+)% deviation\)/);
  const deviation = Number(match?.[1]);
  const move = Math.abs(candidateChange);
  if (!Number.isFinite(deviation) || move <= 0) return false;
  return Math.abs(deviation - move) <= Math.max(5, move * 0.1);
}

function isEntryTimingOnlyRejection(reason: string) {
  return (
    reason.startsWith("R:R ") ||
    reason === "Reward magnitude is negligible."
  );
}

export function evaluateCanonicalOpportunity(
  candidate: OpportunityCandidate,
  framework: TradeFrameworkResult,
  strategy: OpportunityStrategy,
  sourceRunId: string | null = null,
  proxIntelligence: ProxIntelligencePacket | null = null,
) {
  const sessionReclaim = isSessionReclaim(candidate);
  const momentumReferenceChange = getMomentumReferenceChange(candidate);
  const activeSessionChange = getActiveSessionChange(candidate);
  const canonicalMomentumMagnitude =
    getCanonicalMomentumMagnitude(candidate);
  const rawConfirmedRunner = isConfirmedContinuationRunner(candidate, strategy);
  const pulse = proxIntelligence?.pulse;
  const sessionPeakPullback = candidate.pullbackFromSessionHighPercent;
  const recentPeakPullback =
    pulse?.pullbackFromWindowHighPercent ?? null;
  const proxAuthority = evaluateProxPublicAuthority({
    activeMarketSession: isActiveMarketSession(),
    marketConfirmation:
      proxIntelligence?.scores.marketConfirmation ?? null,
    sessionPeakPullbackPercent: sessionPeakPullback,
    pulse,
  });
  const peakFailureConfirmed = proxAuthority.peakFailureConfirmed;
  const proxMarketConfirmation = proxAuthority.marketConfirmation;
  const proxSupportsContinuation = proxAuthority.supportsContinuation;
  const confirmedRunner = rawConfirmedRunner && !peakFailureConfirmed;
  const extremeMomentum = isExtremeMomentum(candidate, strategy);
  // Price discovery already avoids creating an R:R hard failure when upside
  // is genuinely unmodeled. Any hard failure that does exist is therefore
  // real and must remain blocking. The prior continuation bypass removed
  // legitimate R:R failures for runners with a known resistance ceiling,
  // which allowed contradictions such as 0.37% upside / 153.84% risk / 0:1
  // R:R to receive hero status.
  const rejectionReasons = [...framework.hardFailures];

  if (
    strategy === "spot_momentum" &&
    framework.magnitudeQuality === "negligible" &&
    !confirmedRunner
  ) {
    rejectionReasons.push("Reward magnitude is negligible.");
  }
  if (!isSupportedType(candidate.securityType)) {
    rejectionReasons.push(
      candidate.securityType
        ? `Unsupported security type: ${candidate.securityType}.`
        : "Security type is unverified; production eligibility fails closed.",
    );
  }
  const scannedAtMs = new Date(candidate.scannedAt).getTime();
  const signalAgeMs = Date.now() - scannedAtMs;
  if (
    isActiveMarketSession() &&
    (!Number.isFinite(scannedAtMs) ||
      signalAgeMs < 0 ||
      signalAgeMs > ACTIVE_SESSION_MAX_SIGNAL_AGE_MS)
  ) {
    rejectionReasons.push(
      "Signal is too old to qualify during an active market session.",
    );
  }

  if (strategy === "spot_momentum") {
    rejectionReasons.splice(
      0,
      rejectionReasons.length,
      ...enforceSpotMomentumAuthority({
        rejectionReasons,
        fullDayChangePercent: candidate.change,
        peakFailureConfirmed,
      }),
    );
    if (!candidate.retrievedForSm && !candidate.retrievedForCatalyst) {
      rejectionReasons.push(
        "Ticker did not qualify for Spot Momentum retrieval.",
      );
    }
    if (sessionReclaim && (activeSessionChange ?? 0) < 5) {
      rejectionReasons.push(
        "Session Reclaim requires at least a 5% verified move from the current-day open.",
      );
    }
    if (!extremeMomentum) {
      if (candidate.crowdScore >= 65 && !proxSupportsContinuation) {
        rejectionReasons.push(
          `Crowd saturation (${Math.round(candidate.crowdScore)}) lacks fresh ProX continuation confirmation.`,
        );
      }
      if (candidate.trapScore >= 70 && !proxSupportsContinuation) {
        rejectionReasons.push(
          `Trap risk (${Math.round(candidate.trapScore)}) lacks fresh ProX continuation confirmation.`,
        );
      }
    }
  } else {
    if (!candidate.retrievedForBtc && !candidate.retrievedForCatalyst) {
      rejectionReasons.push(
        "Ticker did not qualify for Before The Crowd retrieval.",
      );
    }
    if (momentumReferenceChange <= 0) {
      rejectionReasons.push(
        "Before The Crowd requires positive active-session participation.",
      );
    }
    if (candidate.crowdScore >= 60) {
      rejectionReasons.push(
        "Crowd saturation is too high for the Before The Crowd thesis.",
      );
    }
    if (candidate.trapScore >= 55) {
      rejectionReasons.push(
        "Trap risk exceeds the Before The Crowd ceiling.",
      );
    }
  }

  const eligible = rejectionReasons.length === 0;
  // Visibility and conventional framework availability answer different
  // questions. During a genuine opening drive, Polygon's newest completed
  // daily bar is normally yesterday's close, so a real +100% move also looks
  // like a +100% historical-price discontinuity. When the live move itself
  // explains that discontinuity and momentum/volume independently confirm it,
  // keep the ticker visible as high-risk price discovery. All other hard
  // failures (staleness, unsupported type, insufficient history, etc.) remain
  // blocking, and the strict canonical eligibility above remains unchanged.
  const priceDiscoveryVisibilityOverride =
    strategy === "spot_momentum" &&
    confirmedRunner &&
    framework.hardFailures.length === 1 &&
    isMoveExplainedPriceDiscontinuity(
      framework.hardFailures[0],
      momentumReferenceChange,
    );
  const removablePriceDiscontinuity = priceDiscoveryVisibilityOverride
    ? rejectionReasons.find((reason) =>
        isMoveExplainedPriceDiscontinuity(reason, momentumReferenceChange),
      ) ?? null
    : null;
  const displayRejectionReasons = preserveDisplayHardFailures(
    rejectionReasons,
    removablePriceDiscontinuity,
  );
  const displayEligible = displayRejectionReasons.length === 0;
  const momentumRadarEligible = Boolean(
    strategy === "spot_momentum" &&
      !displayEligible &&
      candidate.retrievedForSm &&
      candidate.change >= 10 &&
      candidate.relativeVolume >= 1.5 &&
      candidate.momentumScore >= 70 &&
      pulse?.fresh === true &&
      !peakFailureConfirmed &&
      proxMarketConfirmation !== null &&
      proxMarketConfirmation >= 55 &&
      (pulse.state === "expanding" || pulse.state === "stable") &&
      displayRejectionReasons.length > 0 &&
      displayRejectionReasons.every(isEntryTimingOnlyRejection),
  );
  const strength = signalStrength(candidate, strategy);
  const breakout = getBreakoutPotential(
    {
      change: momentumReferenceChange,
      relativeVolume: candidate.relativeVolume,
      momentumScore: candidate.momentumScore,
      crowdScore: candidate.crowdScore,
      trapScore: candidate.trapScore,
      catalystScore: candidate.catalystScore,
    },
    framework,
    strategy,
  );
  const explosionAssessment = buildExplosionAssessment(
    candidate,
    framework,
    breakout.score,
    eligible,
    strategy,
    priceDiscoveryVisibilityOverride,
    confirmedRunner,
  );
  const tradeQuality =
    framework.rrRatio === null
      ? confirmedRunner
        ? explosionAssessment.score
        : 0
      : clamp(
          Math.round(
            Math.min(1, framework.rrRatio / 3) * 55 +
              (framework.magnitudeQuality === "meaningful" ? 25 : 0) +
              Math.max(0, 100 - (framework.extensionRisk ?? 100)) * 0.2,
          ),
        );
  const qualityScore = Math.round(strength * 0.65 + tradeQuality * 0.35);
  const magnitudeCore = canonicalMomentumMagnitude;
  const baseStrategyScore =
    strategy === "spot_momentum"
      ? Math.round(
          magnitudeCore * 0.5 +
            breakout.score * 0.35 +
            qualityScore * 0.15,
        )
      : Math.round(qualityScore * 0.65 + breakout.score * 0.35);
  const sessionAlignmentAdjustment =
    activeSessionChange === null
      ? 0
      : candidate.change > 0 && activeSessionChange > 0
        ? 4
        : candidate.change > 0 && activeSessionChange < 0
          ? proxSupportsContinuation
            ? -2
            : -8
          : candidate.change <= 0 && activeSessionChange > 0
            ? -3
            : 0;
  const proxMarketAdjustment = proxAuthority.rankAdjustment;
  const strategyScore =
    strategy === "spot_momentum"
      ? getSpotMomentumStrategyScore({
          change: candidate.change,
          breakoutScore: breakout.score,
          qualityScore,
          sessionAlignmentAdjustment,
          proxMarketAdjustment,
        })
      : Math.round(
          clamp(
            baseStrategyScore +
              sessionAlignmentAdjustment +
              proxMarketAdjustment,
          ),
        );
  const heroPulseConfirmed =
    !isActiveMarketSession() ||
    (proxIntelligence?.pulse?.fresh === true &&
      proxMarketConfirmation !== null &&
      proxMarketConfirmation >= 55 &&
      !peakFailureConfirmed);
  const tier = momentumRadarEligible || peakFailureConfirmed
    ? "watch"
    : displayEligible &&
    strategyScore >= 80 &&
    ((framework.entryQuality ?? 0) >= 70 || confirmedRunner) &&
    heroPulseConfirmed
      ? "hero"
      : displayEligible && strategyScore >= 68
        ? "feature"
        : displayEligible
          ? "watch"
          : "scanner";
  const riskTags: string[] = [];
  if (momentumReferenceChange >= 50) riskTags.push("Parabolic Move");
  else if (extremeMomentum) riskTags.push("Extreme Momentum");
  if (sessionReclaim) riskTags.push("Reclaiming Prior Close");
  if (peakFailureConfirmed) riskTags.push("Post-Peak Weakness");
  if ((framework.extensionRisk ?? 0) >= 75) {
    riskTags.push("Extended — Chasing Risk");
  }
  if (priceDiscoveryVisibilityOverride) {
    if (!riskTags.includes("Extended — Chasing Risk")) {
      riskTags.push("Extended — Chasing Risk");
    }
    riskTags.push("Historical Structure Unavailable");
  }
  if ((framework.volatility20d ?? 0) >= 8) riskTags.push("High Volatility");
  if (
    framework.barCount !== null &&
    framework.barCount < SEASONED_BAR_COUNT
  ) {
    riskTags.push("New Listing / Limited History");
  }
  const freshnessLabel =
    !Number.isFinite(signalAgeMs) || signalAgeMs > 8 * 60 * 60 * 1000
      ? "Last Verified Signal"
      : signalAgeMs > 60 * 60 * 1000
        ? "Recent Scan"
        : "Live Scan";
  const isBeforeCrowd =
    candidate.retrievedForBtc &&
    candidate.crowdScore < 60 &&
    candidate.trapScore < 55;
  const opportunityType =
    candidate.catalystScore >= 20
      ? "catalyst"
      : momentumReferenceChange >= 5 ||
          candidate.momentumScore >= 60 ||
          candidate.relativeVolume >= 3
        ? "breakout"
        : momentumReferenceChange > 0
          ? "momentum"
          : "watch";
  const displayedConfidence = displayEligible
    ? Math.min(99, strategyScore)
    : Math.min(49, Math.round(strength * 0.5));
  const signals = [
    `Momentum move ${momentumReferenceChange >= 0 ? "+" : ""}${momentumReferenceChange.toFixed(1)}%`,
    `${candidate.relativeVolume.toFixed(1)}x relative volume`,
    `Explosion potential ${explosionAssessment.score}/100`,
    ...(framework.rrRatio !== null
      ? [`${framework.rrRatio.toFixed(2)}:1 risk/reward`]
      : explosionAssessment.scenarioBands
        ? [
            `Expansion +${explosionAssessment.scenarioBands.expansion.min.toFixed(1)}% to +${explosionAssessment.scenarioBands.expansion.max.toFixed(1)}%; tail +${explosionAssessment.scenarioBands.tail.min.toFixed(1)}% to +${explosionAssessment.scenarioBands.tail.max.toFixed(1)}%`,
          ]
        : []),
    ...(isBeforeCrowd ? ["Before crowd saturation"] : []),
    ...(peakFailureConfirmed
      ? ["ProX detects confirmed post-peak deterioration"]
      : []),
  ];
  const whyItMatters =
    peakFailureConfirmed
      ? `${candidate.ticker} remains on the momentum radar, but ProX currently sees a failed continuation rather than a strong chase entry.`
      : momentumRadarEligible
      ? `${candidate.ticker} is a verified momentum leader with live ProX confirmation. HT is keeping it visible on the radar while withholding entry qualification at the current price.`
      : sessionReclaim && displayEligible
      ? `${candidate.ticker} has a verified session reclaim. HT combined the current-session move, full-session context, volume, risk${proxIntelligence?.pulse?.fresh ? ", and live ProX pulse" : ""} into this single Spot Momentum decision.`
      : explosionAssessment.state === "price_discovery"
      ? priceDiscoveryVisibilityOverride
        ? `${candidate.ticker} is in confirmed price discovery with ${explosionAssessment.score}/100 observed explosion potential; live price, volume, and momentum confirm the move, while conventional upside and downside levels remain unavailable.`
        : `${candidate.ticker} is in confirmed price discovery with ${explosionAssessment.score}/100 observed explosion potential; scenario capacity is anchored to ATR, live impulse, volume, and momentum.`
      : eligible
        ? `${candidate.ticker} currently qualifies for ${strategy === "spot_momentum" ? "Spot Momentum" : "Before The Crowd"} evaluation with a ${tier} tier after HT fused the full-day move, active session, volume, structure, and ProX tape.`
        : `${candidate.ticker} has an active signal, but it does not currently pass the full opportunity gate.`;
  const whatChanged =
    peakFailureConfirmed
      ? "The pullback from the recent high is now accompanied by weakening price structure, not merely distance from the high."
      : sessionReclaim
      ? `Price recovered from the current-day open with ${candidate.relativeVolume.toFixed(1)}x relative volume.`
      : candidate.catalystScore >= 20 && candidate.state
      ? `${candidate.state} is active in the signal stack.`
      : activeSessionChange !== null && activeSessionChange > 0
        ? "Full-day momentum is holding with positive live-session participation."
      : candidate.relativeVolume >= 3
        ? `Volume expanded to ${candidate.relativeVolume.toFixed(1)}x normal.`
        : momentumReferenceChange > 0
          ? `Price momentum is up ${momentumReferenceChange.toFixed(1)}% with positive participation.`
          : "No verified positive momentum change is currently available.";
  const riskNote =
    (peakFailureConfirmed
      ? "Price is below its recent peak and the live tape confirms deterioration through acceleration, VWAP, time, or selling-volume evidence. HT will wait for a real reclaim before restoring conviction."
      : momentumRadarEligible
      ? "Momentum and volume are real, but the conventional structure does not provide at least 1:1 modeled risk/reward here. This is a no-chase radar read, not an entry-ready call."
      : priceDiscoveryVisibilityOverride
      ? "Live momentum is confirmed, but the completed daily history cannot provide a reliable upside, downside, or resistance framework for this move."
      : displayRejectionReasons[0]) ||
    framework.warnings[0] ||
    "Momentum and volume must continue to hold. Entry timing still matters.";
  const stage =
    peakFailureConfirmed
      ? "Post-Peak Weakness"
      : momentumRadarEligible
      ? "Momentum Leader — No Chase"
      : sessionReclaim && displayEligible
      ? candidate.scanSession === "pre_market"
        ? "Pre-Market Reclaim"
        : "Intraday Reclaim"
      : explosionAssessment.state === "price_discovery"
      ? "Price Discovery"
      : explosionAssessment.state === "confirmed_expansion"
        ? "Confirmed Expansion"
        : tier === "hero"
          ? "High-Quality Opportunity"
          : tier === "feature"
            ? "Qualified Opportunity"
            : tier === "watch"
              ? "Watch"
              : "Scanner Only";
  const stageEmoji =
    explosionAssessment.continuationConfirmed
      ? "🔥"
      : tier === "hero"
        ? "🔥"
        : tier === "feature"
          ? "⚡"
          : tier === "watch"
            ? "👀"
            : "🔎";

  return {
    ...candidate,
    strategy,
    signalStrength: strength,
    strategyScore,
    opportunityScore: strategyScore,
    qualityScore,
    tradeQuality,
    breakoutPotentialScore: breakout.score,
    breakoutPotentialLabel: breakout.label,
    breakoutPotentialComponents: breakout.components,
    floatDataStatus: breakout.floatDataStatus,
    explosionAssessment,
    displayedConfidence,
    confidence: displayedConfidence,
    tier,
    eligible,
    rejectionReasons,
    eligibility: { eligible, reasons: rejectionReasons },
    displayEligibility: {
      eligible: displayEligible,
      reasons: displayRejectionReasons,
    },
    visibilityState: priceDiscoveryVisibilityOverride
      ? "verified_price_discovery"
      : momentumRadarEligible
        ? "momentum_radar"
      : sessionReclaim && displayEligible
        ? "session_reclaim"
      : eligible
        ? "canonical"
        : "rejected",
    tradeFramework: framework,
    engineVersion: CANONICAL_OPPORTUNITY_VERSION,
    sourceRunId,
    proxIntelligence,
    setupType: sessionReclaim ? "session_reclaim" : "standard",
    displayChange: momentumReferenceChange,
    scoreContext: {
      sessionAlignmentAdjustment,
      proxMarketAdjustment,
      proxSupportsContinuation,
      proxAuthorityVersion: proxAuthority.authorityVersion,
      momentumFusion: "previous_close_anchor_session_context_v2",
      peakFailureConfirmed,
      sessionPeakPullbackPercent:
        sessionPeakPullback,
      recentPeakPullbackPercent:
        recentPeakPullback,
    },
    continuationEligible: explosionAssessment.paperEntryEligible,
    momentumRadarEligible,
    opportunityType,
    riskTags,
    attentionScore: candidate.crowdScore,
    riskScore: candidate.trapScore,
    relativeVolume: candidate.relativeVolume,
    isBeforeCrowd,
    catalystTags:
      candidate.catalystScore >= 20
        ? [candidate.state || "Verified Catalyst"]
        : [],
    stage,
    stageEmoji,
    whyItMatters,
    whatChanged,
    riskNote,
    signals,
    freshnessLabel,
  };
}
