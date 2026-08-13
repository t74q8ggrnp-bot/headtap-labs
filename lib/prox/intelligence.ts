import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProxCatalystCategory, ProxVerificationState } from "@/lib/prox/types";
import {
  PROX_TRANSITION_LEARNING_CASE_VERSION,
  getProxTransitionCohortKeys,
  proxTransitionCalibrationFromStorage,
  proxTransitionProfileFromStorage,
  selectProxTransitionComparisonEvidence,
  type ProxTransitionComparisonEvidence,
} from "@/lib/prox/transition-calibration";
import { PROX_PUBLIC_AUTHORITY_CONTRACT } from "@/lib/prox/public-authority";

export const PROX_INTELLIGENCE_VERSION =
  "prox-intelligence-v5-session-recovery-contract";
export const PROX_PACKET_MODE = "bounded_public_market" as const;

const EVENT_LOOKBACK_HOURS = 72;
const PULSE_FRESH_MINUTES = 6;
const PULSE_STALE_MINUTES = 15;

const CATALYST_STRENGTH: Record<ProxCatalystCategory, number> = {
  merger_acquisition: 90,
  fda_decision: 90,
  clinical_results: 78,
  offering_dilution: 85,
  major_contract: 78,
  insider_transaction: 60,
  earnings_guidance: 82,
  reverse_split: 72,
  delisting_compliance: 88,
  patent_litigation: 68,
  government_award: 82,
  unclassified: 35,
};

const DEFENSIVE_CATALYSTS = new Set<ProxCatalystCategory>([
  "offering_dilution",
  "reverse_split",
  "delisting_compliance",
]);

export type ProxPacketStatus =
  | "active"
  | "evidence_only"
  | "stale_pulse"
  | "market_only"
  | "no_recent_event"
  | "unavailable";

export type ProxIntelligenceTrace = {
  factor: string;
  value: number | string | boolean | null;
  impact: "supportive" | "neutral" | "defensive";
  reason: string;
};

export type ProxIntelligencePacket = {
  packetId: string | null;
  snapshotKey: string;
  packetVersion: typeof PROX_INTELLIGENCE_VERSION;
  mode: typeof PROX_PACKET_MODE;
  authority: typeof PROX_PUBLIC_AUTHORITY_CONTRACT;
  ticker: string;
  asOf: string;
  status: ProxPacketStatus;
  event: {
    id: string;
    headline: string | null;
    filedAt: string | null;
    ageMinutes: number | null;
    catalystCategory: ProxCatalystCategory;
    verificationState: ProxVerificationState;
    sourceKey: string | null;
    sourceTier: string | null;
    sourceCredibility: number;
    matchConfidence: number;
    matchMethod: string;
    evidenceCount: number;
    contradictionCount: number;
  } | null;
  pulse: {
    computedAt: string;
    ageSeconds: number;
    fresh: boolean;
    price: number | null;
    velocity1m: number | null;
    acceleration5m: number | null;
    volumeAcceleration: number | null;
    priceVsVwap: number | null;
    dollarVolume: number | null;
    windowHighPrice: number | null;
    pullbackFromWindowHighPercent: number | null;
    minutesSinceWindowHigh: number | null;
    averageBarRangePercent: number | null;
    peakFailureThresholdPercent: number;
    peakFailureConfirmed: boolean;
    state: "expanding" | "stable" | "weakening" | "stale";
  } | null;
  transitionEvidence: ProxTransitionComparisonEvidence | null;
  scores: {
    evidenceConfidence: number;
    catalystStrength: number;
    marketConfirmation: number;
    freshness: number;
    contradictionRisk: number;
    composite: number;
  };
  supportFlags: string[];
  riskFlags: string[];
  botPolicy: {
    authority: "observation_only";
    wouldVeto: boolean;
    wouldReduceSize: boolean;
    rankAdjustment: number;
    reasons: string[];
  };
  trace: ProxIntelligenceTrace[];
};

type EventLinkRow = {
  ticker?: unknown;
  event_id?: unknown;
  match_confidence?: unknown;
  match_method?: unknown;
};

type EventRow = {
  id?: unknown;
  source_id?: unknown;
  headline?: unknown;
  filed_at?: unknown;
  catalyst_category?: unknown;
  verification_state?: unknown;
  confidence?: unknown;
  contradictions?: unknown;
};

type SourceRow = {
  id?: unknown;
  source_key?: unknown;
  tier?: unknown;
  base_credibility?: unknown;
};

type MarketFeatureRow = {
  ticker?: unknown;
  price?: unknown;
  velocity_1m?: unknown;
  acceleration_5m?: unknown;
  volume_acceleration?: unknown;
  price_vs_vwap?: unknown;
  dollar_volume?: unknown;
  window_high_price?: unknown;
  pullback_from_window_high_percent?: unknown;
  minutes_since_window_high?: unknown;
  average_bar_range_percent?: unknown;
  computed_at?: unknown;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeTicker(value: string) {
  return value.toUpperCase().trim();
}

function normalizeCategory(value: unknown): ProxCatalystCategory {
  const category = stringValue(value) as ProxCatalystCategory | null;
  return category && category in CATALYST_STRENGTH ? category : "unclassified";
}

function normalizeVerification(value: unknown): ProxVerificationState {
  return value === "verified" || value === "contradicted"
    ? value
    : "unverified";
}

function isoAgeMinutes(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (nowMs - timestamp) / 60_000);
}

function contradictionCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function buildUnavailablePacket(
  ticker: string,
  asOf: string,
  reason: string,
): ProxIntelligencePacket {
  return {
    packetId: null,
    snapshotKey: `${PROX_INTELLIGENCE_VERSION}:${ticker}:unavailable`,
    packetVersion: PROX_INTELLIGENCE_VERSION,
    mode: PROX_PACKET_MODE,
    authority: PROX_PUBLIC_AUTHORITY_CONTRACT,
    ticker,
    asOf,
    status: "unavailable",
    event: null,
    pulse: null,
    transitionEvidence: null,
    scores: {
      evidenceConfidence: 0,
      catalystStrength: 0,
      marketConfirmation: 0,
      freshness: 0,
      contradictionRisk: 0,
      composite: 0,
    },
    supportFlags: [],
    riskFlags: ["prox_unavailable"],
    botPolicy: {
      authority: "observation_only",
      wouldVeto: false,
      wouldReduceSize: false,
      rankAdjustment: 0,
      reasons: [reason],
    },
    trace: [
      {
        factor: "availability",
        value: false,
        impact: "neutral",
        reason,
      },
    ],
  };
}

function buildPacket(args: {
  ticker: string;
  asOf: string;
  nowMs: number;
  link: EventLinkRow | null;
  event: EventRow | null;
  source: SourceRow | null;
  evidenceCount: number;
  market: MarketFeatureRow | null;
  transitionEvidence: ProxTransitionComparisonEvidence | null;
}): ProxIntelligencePacket {
  const {
    ticker,
    asOf,
    nowMs,
    link,
    event,
    source,
    evidenceCount,
    market,
    transitionEvidence,
  } = args;
  const eventId = stringValue(event?.id);
  const filedAt = stringValue(event?.filed_at);
  const ageMinutes = isoAgeMinutes(filedAt, nowMs);
  const recentEvent =
    eventId !== null &&
    ageMinutes !== null &&
    ageMinutes <= EVENT_LOOKBACK_HOURS * 60;
  const category = normalizeCategory(event?.catalyst_category);
  const verificationState = normalizeVerification(event?.verification_state);
  const sourceCredibility =
    finiteNumber(source?.base_credibility) ?? finiteNumber(event?.confidence) ?? 50;
  const matchConfidence = finiteNumber(link?.match_confidence) ?? 0;
  const contradictions = contradictionCount(event?.contradictions);

  const pulseComputedAt = stringValue(market?.computed_at);
  const pulseAgeMinutes = isoAgeMinutes(pulseComputedAt, nowMs);
  const pulseAgeSeconds =
    pulseAgeMinutes === null ? null : Math.round(pulseAgeMinutes * 60);
  const velocity1m = finiteNumber(market?.velocity_1m);
  const acceleration5m = finiteNumber(market?.acceleration_5m);
  const volumeAcceleration = finiteNumber(market?.volume_acceleration);
  const priceVsVwap = finiteNumber(market?.price_vs_vwap);
  const windowHighPrice = finiteNumber(market?.window_high_price);
  const pullbackFromWindowHighPercent = finiteNumber(
    market?.pullback_from_window_high_percent,
  );
  const minutesSinceWindowHigh = finiteNumber(
    market?.minutes_since_window_high,
  );
  const averageBarRangePercent = finiteNumber(
    market?.average_bar_range_percent,
  );
  const pulseFresh =
    pulseAgeMinutes !== null && pulseAgeMinutes <= PULSE_FRESH_MINUTES;
  const pulseStale =
    pulseAgeMinutes !== null && pulseAgeMinutes > PULSE_STALE_MINUTES;

  const verificationScore =
    verificationState === "verified"
      ? 100
      : verificationState === "contradicted"
        ? 0
        : 55;
  const evidenceDepth = clamp(evidenceCount * 20, 0, 100);
  const evidenceConfidence = recentEvent
    ? clamp(
        sourceCredibility * 0.4 +
          matchConfidence * 0.25 +
          verificationScore * 0.25 +
          evidenceDepth * 0.1,
      )
    : 0;
  const catalystStrength = recentEvent ? CATALYST_STRENGTH[category] : 0;
  const freshness =
    recentEvent && ageMinutes !== null
      ? clamp(100 - (ageMinutes / (EVENT_LOOKBACK_HOURS * 60)) * 100)
      : recentEvent
        ? 50
        : 0;
  const contradictionRisk = recentEvent
    ? clamp(
        (verificationState === "contradicted" ? 85 : 0) +
          contradictions * 20,
      )
    : 0;
  const peakFailureEvidence = [
    (velocity1m ?? 0) <= -0.75,
    (acceleration5m ?? 0) <= -1.5,
    (priceVsVwap ?? 0) <= -0.75,
    (volumeAcceleration ?? 0) >= 1.1 && (velocity1m ?? 0) < 0,
  ].filter(Boolean).length;
  const peakFailureThresholdPercent = clamp(
    Math.max(6, (averageBarRangePercent ?? 0) * 2.5),
    6,
    15,
  );
  const peakFailureConfirmed = Boolean(
    pulseFresh &&
      (pullbackFromWindowHighPercent ?? 0) >=
        peakFailureThresholdPercent &&
      (minutesSinceWindowHigh ?? 0) >= 3 &&
      peakFailureEvidence >= 2,
  );
  const peakFailurePenalty = peakFailureConfirmed
    ? clamp(((pullbackFromWindowHighPercent ?? 0) - 4) * 4, 0, 35)
    : 0;
  const marketConfirmation =
    pulseAgeMinutes !== null && !pulseStale
      ? clamp(
          50 +
            (velocity1m ?? 0) * 8 +
            (acceleration5m ?? 0) * 4 +
            ((volumeAcceleration ?? 1) - 1) * 10 +
            (priceVsVwap ?? 0) * 3 -
            peakFailurePenalty,
        )
      : 0;
  const composite = recentEvent
    ? clamp(
        evidenceConfidence * 0.35 +
          catalystStrength * 0.15 +
          marketConfirmation * 0.3 +
          freshness * 0.2 -
          contradictionRisk * 0.5,
      )
    : 0;

  const supportFlags: string[] = [];
  const riskFlags: string[] = [];
  if (recentEvent) {
    if (verificationState === "verified") supportFlags.push("verified_event");
    if (sourceCredibility >= 90) supportFlags.push("primary_source");
    if (matchConfidence >= 95) supportFlags.push("deterministic_ticker_match");
  }
  if ((volumeAcceleration ?? 0) >= 2) supportFlags.push("volume_accelerating");
  if ((priceVsVwap ?? 0) > 0) supportFlags.push("price_above_vwap");
  if ((acceleration5m ?? 0) >= 2) supportFlags.push("positive_5m_acceleration");
  if ((pullbackFromWindowHighPercent ?? 100) <= 2) {
    supportFlags.push("holding_near_window_high");
  } else if (
    (acceleration5m ?? 0) >= 1 &&
    (priceVsVwap ?? 0) >= 0
  ) {
    supportFlags.push("pullback_recovering");
  }

  if (verificationState === "contradicted" || contradictions > 0) {
    riskFlags.push("contradictory_evidence");
  }
  if (recentEvent && DEFENSIVE_CATALYSTS.has(category)) {
    riskFlags.push(category);
  }
  if (recentEvent && matchConfidence < 90) riskFlags.push("weak_entity_match");
  if (recentEvent && !market) riskFlags.push("market_pulse_missing");
  if (pulseStale) riskFlags.push("market_pulse_stale");
  if ((velocity1m ?? 0) <= -4) riskFlags.push("rapid_1m_breakdown");
  if ((acceleration5m ?? 0) <= -6) riskFlags.push("negative_5m_acceleration");
  if ((priceVsVwap ?? 0) <= -3) riskFlags.push("price_below_vwap");
  if (peakFailureConfirmed) {
    riskFlags.push(
      (pullbackFromWindowHighPercent ?? 0) >= 10
        ? "post_peak_breakdown"
        : "post_peak_weakness",
    );
  }
  if (
    transitionEvidence &&
    transitionEvidence.evidenceState !== "insufficient"
  ) {
    if (
      transitionEvidence.continuationRate >= 0.5 &&
      transitionEvidence.failureRate < 0.25
    ) {
      supportFlags.push("historical_transition_support");
    }
    if (transitionEvidence.failureRate >= 0.4) {
      riskFlags.push("historical_transition_risk");
    }
  }

  const wouldVeto =
    recentEvent &&
    (contradictionRisk >= 70 ||
      (DEFENSIVE_CATALYSTS.has(category) && evidenceConfidence >= 75));
  const wouldReduceSize =
    recentEvent &&
    !wouldVeto &&
    (riskFlags.includes("market_pulse_stale") ||
      riskFlags.includes("market_pulse_missing") ||
      riskFlags.includes("rapid_1m_breakdown") ||
      riskFlags.includes("negative_5m_acceleration") ||
      riskFlags.includes("weak_entity_match"));
  const rankAdjustment = !recentEvent
    ? 0
    : wouldVeto
      ? -10
      : wouldReduceSize
        ? -3
        : Math.round(clamp((composite - 50) / 10, -5, 5));
  const policyReasons = [
    ...(wouldVeto ? ["Verified defensive or contradictory evidence would veto a new paper entry."] : []),
    ...(wouldReduceSize ? ["Pulse or evidence risk would reduce paper position size."] : []),
    ...(!wouldVeto && !wouldReduceSize && recentEvent
      ? ["No Pro X defensive execution opinion is indicated."]
      : []),
    ...(!recentEvent ? ["No recent Pro X event; absence of evidence does not penalize the canonical decision."] : []),
  ];

  const pulseState =
    pulseStale
      ? "stale"
      : peakFailureConfirmed
        ? "weakening"
        : marketConfirmation >= 65
        ? "expanding"
        : marketConfirmation < 40
          ? "weakening"
          : "stable";
  const status: ProxPacketStatus = !recentEvent
    ? market
      ? pulseStale
        ? "stale_pulse"
        : "market_only"
      : "no_recent_event"
    : !market
      ? "evidence_only"
      : pulseStale
        ? "stale_pulse"
        : "active";
  const snapshotKey = `${PROX_INTELLIGENCE_VERSION}:${ticker}:${eventId ?? "none"}:${pulseComputedAt ?? "none"}`;

  return {
    packetId: null,
    snapshotKey,
    packetVersion: PROX_INTELLIGENCE_VERSION,
    mode: PROX_PACKET_MODE,
    authority: PROX_PUBLIC_AUTHORITY_CONTRACT,
    ticker,
    asOf,
    status,
    event: recentEvent && eventId
      ? {
          id: eventId,
          headline: stringValue(event?.headline),
          filedAt,
          ageMinutes: ageMinutes === null ? null : Math.round(ageMinutes),
          catalystCategory: category,
          verificationState,
          sourceKey: stringValue(source?.source_key),
          sourceTier: stringValue(source?.tier),
          sourceCredibility: round(sourceCredibility),
          matchConfidence: round(matchConfidence),
          matchMethod: stringValue(link?.match_method) ?? "unknown",
          evidenceCount,
          contradictionCount: contradictions,
        }
      : null,
    pulse: market && pulseComputedAt && pulseAgeSeconds !== null
      ? {
          computedAt: pulseComputedAt,
          ageSeconds: pulseAgeSeconds,
          fresh: pulseFresh,
          price: finiteNumber(market.price),
          velocity1m,
          acceleration5m,
          volumeAcceleration,
          priceVsVwap,
          dollarVolume: finiteNumber(market.dollar_volume),
          windowHighPrice,
          pullbackFromWindowHighPercent,
          minutesSinceWindowHigh,
          averageBarRangePercent,
          peakFailureThresholdPercent: round(
            peakFailureThresholdPercent,
          ),
          peakFailureConfirmed,
          state: pulseState,
        }
      : null,
    transitionEvidence,
    scores: {
      evidenceConfidence: round(evidenceConfidence),
      catalystStrength: round(catalystStrength),
      marketConfirmation: round(marketConfirmation),
      freshness: round(freshness),
      contradictionRisk: round(contradictionRisk),
      composite: round(composite),
    },
    supportFlags,
    riskFlags,
    botPolicy: {
      authority: "observation_only",
      wouldVeto,
      wouldReduceSize,
      rankAdjustment,
      reasons: policyReasons,
    },
    trace: [
      {
        factor: "evidence_confidence",
        value: round(evidenceConfidence),
        impact: evidenceConfidence >= 70 ? "supportive" : "neutral",
        reason: "Source credibility, deterministic entity match, verification, and evidence depth.",
      },
      {
        factor: "market_confirmation",
        value: round(marketConfirmation),
        impact:
          marketConfirmation >= 65
            ? "supportive"
            : marketConfirmation < 40 && recentEvent
              ? "defensive"
              : "neutral",
        reason: "One-minute velocity, five-minute acceleration, volume behavior, VWAP, and confirmed post-peak deterioration across the active session.",
      },
      {
        factor: "contradiction_risk",
        value: round(contradictionRisk),
        impact: contradictionRisk >= 50 ? "defensive" : "neutral",
        reason: "Verified contradictions and explicit contradiction records.",
      },
      {
        factor: "canonical_transition_evidence",
        value: transitionEvidence?.evidenceState ?? "unavailable",
        impact:
          transitionEvidence &&
          transitionEvidence.evidenceState !== "insufficient" &&
          transitionEvidence.continuationRate >= 0.5 &&
          transitionEvidence.failureRate < 0.25
            ? "supportive"
            : transitionEvidence &&
                transitionEvidence.evidenceState !== "insufficient" &&
                transitionEvidence.failureRate >= 0.4
              ? "defensive"
              : "neutral",
        reason:
          transitionEvidence?.summary ??
          "No comparable finalized canonical transition cohort is available yet.",
      },
      {
        factor: "execution_authority",
        value: "none",
        impact: "neutral",
        reason: "Pro X has no order or live-trading authority.",
      },
    ],
  };
}

async function loadProxTransitionEvidence(
  supabase: SupabaseClient,
  tickers: string[],
) {
  const evidence = new Map<string, ProxTransitionComparisonEvidence>();
  if (tickers.length === 0) return evidence;
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: caseData, error: caseError } = await supabase
    .from("prox_strategy_learning_cases")
    .select(
      "ticker,first_seen_at,market_session,price_bucket,relative_volume_bucket,momentum_bucket,crowd_bucket,trap_bucket,score_bucket",
    )
    .eq("methodology_version", PROX_TRANSITION_LEARNING_CASE_VERSION)
    .in("ticker", tickers)
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(5000);
  // Migration 0016 is additive. Intelligence packets remain available without
  // historical comparison until its schema and first calibration cycle exist.
  if (caseError) return evidence;
  const latestCaseByTicker = new Map<string, Record<string, unknown>>();
  for (const row of (caseData ?? []) as Array<Record<string, unknown>>) {
    const ticker = stringValue(row.ticker)?.toUpperCase();
    if (ticker && !latestCaseByTicker.has(ticker)) {
      latestCaseByTicker.set(ticker, row);
    }
  }
  const keys = [
    ...new Set(
      [...latestCaseByTicker.values()].flatMap((row) =>
        getProxTransitionCohortKeys(
          proxTransitionProfileFromStorage(row),
        ),
      ),
    ),
  ];
  const calibrationByKey = new Map<
    string,
    ReturnType<typeof proxTransitionCalibrationFromStorage>
  >();
  for (let index = 0; index < keys.length; index += 80) {
    const { data, error } = await supabase
      .from("prox_transition_pattern_calibrations")
      .select("*")
      .in("cohort_key", keys.slice(index, index + 80));
    if (error) return new Map();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const calibration = proxTransitionCalibrationFromStorage(row);
      calibrationByKey.set(calibration.cohortKey, calibration);
    }
  }
  for (const [ticker, row] of latestCaseByTicker) {
    const profile = proxTransitionProfileFromStorage(row);
    const comparison = selectProxTransitionComparisonEvidence(
      profile,
      getProxTransitionCohortKeys(profile)
        .map((key) => calibrationByKey.get(key))
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    );
    if (comparison) evidence.set(ticker, comparison);
  }
  return evidence;
}

export async function loadProxIntelligencePackets(
  supabase: SupabaseClient,
  requestedTickers: string[],
): Promise<Map<string, ProxIntelligencePacket>> {
  const tickers = [...new Set(requestedTickers.map(normalizeTicker).filter(Boolean))];
  const now = new Date();
  const asOf = now.toISOString();
  const unavailable = (reason: string) =>
    new Map(
      tickers.map((ticker) => [
        ticker,
        buildUnavailablePacket(ticker, asOf, reason),
      ]),
    );
  if (tickers.length === 0) return new Map();

  try {
    const { data: linksData, error: linksError } = await supabase
      .from("prox_event_tickers")
      .select("ticker,event_id,match_confidence,match_method,created_at")
      .in("ticker", tickers)
      .order("created_at", { ascending: false })
      .limit(Math.max(500, tickers.length * 5));
    if (linksError) return unavailable(`Pro X event lookup unavailable: ${linksError.message}`);

    const latestLinkByTicker = new Map<string, EventLinkRow>();
    for (const raw of (linksData ?? []) as EventLinkRow[]) {
      const ticker = stringValue(raw.ticker);
      if (ticker && !latestLinkByTicker.has(ticker)) {
        latestLinkByTicker.set(ticker, raw);
      }
    }
    const eventIds = [
      ...new Set(
        [...latestLinkByTicker.values()]
          .map((row) => stringValue(row.event_id))
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const eventById = new Map<string, EventRow>();
    const sourceById = new Map<string, SourceRow>();
    const evidenceCountByEvent = new Map<string, number>();
    if (eventIds.length > 0) {
      const { data: eventData, error: eventError } = await supabase
        .from("prox_events")
        .select(
          "id,source_id,headline,filed_at,catalyst_category,verification_state,confidence,contradictions",
        )
        .in("id", eventIds);
      if (eventError) return unavailable(`Pro X evidence lookup unavailable: ${eventError.message}`);
      for (const row of (eventData ?? []) as EventRow[]) {
        const id = stringValue(row.id);
        if (id) eventById.set(id, row);
      }

      const sourceIds = [
        ...new Set(
          [...eventById.values()]
            .map((row) => stringValue(row.source_id))
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      if (sourceIds.length > 0) {
        const { data: sourceData } = await supabase
          .from("prox_sources")
          .select("id,source_key,tier,base_credibility")
          .in("id", sourceIds);
        for (const row of (sourceData ?? []) as SourceRow[]) {
          const id = stringValue(row.id);
          if (id) sourceById.set(id, row);
        }
      }

      const { data: evidenceData } = await supabase
        .from("prox_evidence")
        .select("event_id")
        .in("event_id", eventIds);
      for (const row of (evidenceData ?? []) as Array<{ event_id?: unknown }>) {
        const eventId = stringValue(row.event_id);
        if (eventId) {
          evidenceCountByEvent.set(
            eventId,
            (evidenceCountByEvent.get(eventId) ?? 0) + 1,
          );
        }
      }
    }

    const expandedMarketResult = await supabase
      .from("prox_market_features")
      .select(
        "ticker,price,velocity_1m,acceleration_5m,volume_acceleration,price_vs_vwap,dollar_volume,window_high_price,pullback_from_window_high_percent,minutes_since_window_high,average_bar_range_percent,computed_at",
      )
      .in("ticker", tickers);
    const legacyMarketResult = expandedMarketResult.error
      ? await supabase
          .from("prox_market_features")
          .select(
            "ticker,price,velocity_1m,acceleration_5m,volume_acceleration,price_vs_vwap,dollar_volume,computed_at",
          )
          .in("ticker", tickers)
      : null;
    const marketData = expandedMarketResult.error
      ? legacyMarketResult?.data
      : expandedMarketResult.data;
    const marketError = expandedMarketResult.error
      ? legacyMarketResult?.error
      : null;
    const marketByTicker = new Map<string, MarketFeatureRow>();
    if (!marketError) {
      for (const row of (marketData ?? []) as MarketFeatureRow[]) {
        const ticker = stringValue(row.ticker);
        if (ticker) marketByTicker.set(ticker, row);
      }
    }
    const transitionEvidenceByTicker = await loadProxTransitionEvidence(
      supabase,
      tickers,
    );

    return new Map(
      tickers.map((ticker) => {
        const link = latestLinkByTicker.get(ticker) ?? null;
        const eventId = stringValue(link?.event_id);
        const event = eventId ? eventById.get(eventId) ?? null : null;
        const sourceId = stringValue(event?.source_id);
        return [
          ticker,
          buildPacket({
            ticker,
            asOf,
            nowMs: now.getTime(),
            link,
            event,
            source: sourceId ? sourceById.get(sourceId) ?? null : null,
            evidenceCount: eventId
              ? evidenceCountByEvent.get(eventId) ?? 0
              : 0,
            market: marketByTicker.get(ticker) ?? null,
            transitionEvidence:
              transitionEvidenceByTicker.get(ticker) ?? null,
          }),
        ];
      }),
    );
  } catch (error: unknown) {
    return unavailable(
      `Pro X intelligence failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

export async function persistProxIntelligencePackets(
  supabase: SupabaseClient,
  packets: ProxIntelligencePacket[],
): Promise<{ persisted: number; unavailableReason: string | null }> {
  if (packets.length === 0) return { persisted: 0, unavailableReason: null };
  const rows = packets
    .filter((packet) => packet.status !== "unavailable")
    .map((packet) => ({
      snapshot_key: packet.snapshotKey,
      packet_version: packet.packetVersion,
      mode: packet.mode,
      ticker: packet.ticker,
      as_of: packet.asOf,
      status: packet.status,
      source_event_id: packet.event?.id ?? null,
      market_computed_at: packet.pulse?.computedAt ?? null,
      composite_score: packet.scores.composite,
      evidence_confidence: packet.scores.evidenceConfidence,
      market_confirmation: packet.scores.marketConfirmation,
      contradiction_risk: packet.scores.contradictionRisk,
      would_veto: packet.botPolicy.wouldVeto,
      would_reduce_size: packet.botPolicy.wouldReduceSize,
      rank_adjustment: packet.botPolicy.rankAdjustment,
      packet,
    }));
  if (rows.length === 0) return { persisted: 0, unavailableReason: null };
  const { error } = await supabase
    .from("prox_intelligence_packets")
    .upsert(rows, { onConflict: "snapshot_key", ignoreDuplicates: true });
  return error
    ? { persisted: 0, unavailableReason: error.message }
    : { persisted: rows.length, unavailableReason: null };
}
