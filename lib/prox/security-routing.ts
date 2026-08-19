export const PROX_SECURITY_ROUTING_VERSION =
  "prox-security-routing-v1";

export type ProxInstrumentLane =
  | "opportunity_equity"
  | "market_context"
  | "linked_instrument_context"
  | "excluded_asset"
  | "pending_verification";

export type ProxSecurityMetadataState = "verified" | "pending";

export type ProxSecurityRoute = {
  securityType: string | null;
  instrumentLane: ProxInstrumentLane;
  metadataState: ProxSecurityMetadataState;
  opportunityEligible: boolean;
  reason: string;
};

export type ProxRoutedResearchCandidate = {
  ticker: string;
  researchPriority: number;
  dollarVolume: number;
  instrumentLane: ProxInstrumentLane;
};

export const PROX_SECURITY_LANE_LIMITS = {
  total: 300,
  market_context: 25,
  linked_instrument_context: 20,
  pending_verification: 15,
} as const;

const OPPORTUNITY_EQUITY_TYPES = new Set(["CS", "ADRC"]);
const MARKET_CONTEXT_TYPES = new Set(["ETF", "ETN", "ETV", "FUND", "INDEX"]);
const LINKED_INSTRUMENT_TYPES = new Set([
  "WARRANT",
  "RIGHT",
  "UNIT",
  "ADRW",
  "ADRR",
]);
const EXCLUDED_ASSET_TYPES = new Set([
  "PFD",
  "ADRP",
  "BOND",
  "SP",
  "BASKET",
  "OTHER",
]);

function normalizedType(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

export function routeProxSecurityType(
  rawSecurityType: string | null | undefined,
): ProxSecurityRoute {
  const securityType = normalizedType(rawSecurityType);
  if (!securityType) {
    return {
      securityType: null,
      instrumentLane: "pending_verification",
      metadataState: "pending",
      opportunityEligible: false,
      reason: "Security metadata is missing and must be verified before opportunity ranking.",
    };
  }
  if (OPPORTUNITY_EQUITY_TYPES.has(securityType)) {
    return {
      securityType,
      instrumentLane: "opportunity_equity",
      metadataState: "verified",
      opportunityEligible: true,
      reason: "Common-equity instrument eligible for independent ProX opportunity research.",
    };
  }
  if (MARKET_CONTEXT_TYPES.has(securityType)) {
    return {
      securityType,
      instrumentLane: "market_context",
      metadataState: "verified",
      opportunityEligible: false,
      reason: "Basket or benchmark instrument retained as market context, never as an opportunity hero.",
    };
  }
  if (LINKED_INSTRUMENT_TYPES.has(securityType)) {
    return {
      securityType,
      instrumentLane: "linked_instrument_context",
      metadataState: "verified",
      opportunityEligible: false,
      reason: "Linked derivative instrument retained as contextual evidence, never as an opportunity hero.",
    };
  }
  if (EXCLUDED_ASSET_TYPES.has(securityType)) {
    return {
      securityType,
      instrumentLane: "excluded_asset",
      metadataState: "verified",
      opportunityEligible: false,
      reason: "Instrument structure is outside ProX common-equity opportunity research.",
    };
  }
  return {
    securityType,
    instrumentLane: "pending_verification",
    metadataState: "pending",
    opportunityEligible: false,
    reason: "Provider security type is new or deferred and requires explicit classification.",
  };
}

function compareCandidates(
  left: ProxRoutedResearchCandidate,
  right: ProxRoutedResearchCandidate,
) {
  return (
    right.researchPriority - left.researchPriority ||
    right.dollarVolume - left.dollarVolume ||
    left.ticker.localeCompare(right.ticker)
  );
}

export function selectProxRoutedResearchCandidates<
  T extends ProxRoutedResearchCandidate,
>(
  candidates: T[],
  limits: typeof PROX_SECURITY_LANE_LIMITS = PROX_SECURITY_LANE_LIMITS,
): T[] {
  const sorted = [...candidates].sort(compareCandidates);
  const context = sorted
    .filter((candidate) => candidate.instrumentLane === "market_context")
    .slice(0, limits.market_context);
  const linked = sorted
    .filter(
      (candidate) =>
        candidate.instrumentLane === "linked_instrument_context",
    )
    .slice(0, limits.linked_instrument_context);
  const pending = sorted
    .filter(
      (candidate) => candidate.instrumentLane === "pending_verification",
    )
    .slice(0, limits.pending_verification);
  const auxiliary = [...context, ...linked, ...pending];
  const equityCapacity = Math.max(0, limits.total - auxiliary.length);
  const equities = sorted
    .filter((candidate) => candidate.instrumentLane === "opportunity_equity")
    .slice(0, equityCapacity);

  return [...equities, ...auxiliary].sort(compareCandidates);
}
