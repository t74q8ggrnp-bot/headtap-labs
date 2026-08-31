export type CryptoPulseState = "expanding" | "stable" | "weakening";

export type CryptoDiscoveryVenue = "coinbase" | "kraken" | "crypto_com";

export type CryptoDiscoveryWindow = "rolling_24h" | "utc_session";

export type CryptoDiscoveryCandidate = {
  assetId: string;
  symbol: string;
  rank: number;
  entryPriceUsd: number;
  observedMovePercent: number;
  dollarVolume: number;
  venueCount: number;
  venues: CryptoDiscoveryVenue[];
  quoteCurrencies: string[];
  confirmingVenues: number;
  crossVenueDispersionPercent: number;
  proposedOpportunityScore: number;
  attention: {
    source: "coingecko_trending";
    rank: number;
    coinId: string;
  } | null;
  supportFlags: string[];
  riskFlags: string[];
  scoreBreakdown: {
    momentum: number;
    liquidity: number;
    crossVenue: number;
    venueBreadth: number;
    attention: number;
  };
  markets: Array<{
    venue: CryptoDiscoveryVenue;
    productId: string;
    quoteCurrency: string;
    sourceWindow: CryptoDiscoveryWindow;
    priceUsd: number;
    observedMovePercent: number;
    dollarVolume: number;
    spreadPercent: number | null;
    tradeCount: number | null;
  }>;
};

export type CryptoShadowDiscovery = {
  version: "crypto-multivenue-discovery-v2";
  mode: "confirmation";
  authority: "bounded_confirmation";
  generatedAt: string;
  candidates: CryptoDiscoveryCandidate[];
  diagnostics: {
    configuredVenues: number;
    healthyVenues: number;
    venueMarkets: Record<CryptoDiscoveryVenue, number>;
    quoteMarkets: Record<string, number>;
    supportedPairs: number;
    observedAssets: number;
    candidateAssets: number;
    attentionSourceHealthy: boolean;
    attentionItems: number;
    providerFailures: number;
    providerStatus: Array<{
      venue: CryptoDiscoveryVenue;
      ok: boolean;
      marketCount: number;
      message: string;
    }>;
  };
};

export type CryptoDiscoveryPrice = {
  assetId: string;
  symbol: string;
  priceUsd: number;
};

export type CryptoProxState =
  | "expanding"
  | "stable"
  | "weakening"
  | "stale";

export type CryptoProxPacket = {
  packetVersion: "crypto-prox-v2";
  mode: "bounded_authority";
  productId: string;
  symbol: string;
  computedAt: string;
  fresh: boolean;
  barCount: number;
  state: CryptoProxState;
  marketConfirmation: number;
  proposedScoreAdjustment: number;
  shadowOpportunityScore: number;
  features: {
    velocity1mPercent: number | null;
    velocity5mPercent: number | null;
    velocity15mPercent: number | null;
    volumeAcceleration: number | null;
    priceVsVwapPercent: number | null;
    spreadPercent: number | null;
    windowHighPrice: number | null;
    pullbackFromWindowHighPercent: number | null;
    minutesSinceWindowHigh: number | null;
    averageBarRangePercent: number | null;
    realizedVolatilityPercent: number | null;
    activeBarRatioPercent: number | null;
    btcRelativeStrength15mPercent: number | null;
    peakFailureThresholdPercent: number;
    peakFailureConfirmed: boolean;
  };
  supportFlags: string[];
  riskFlags: string[];
  trace: Array<{
    factor: string;
    value: number | string | boolean | null;
    impact: "supportive" | "neutral" | "defensive";
    reason: string;
  }>;
};

export type CryptoOpportunity = {
  productId: string;
  symbol: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  pullbackFromHighPercent: number;
  rangePositionPercent: number;
  volume24h: number;
  dollarVolume24h: number;
  relativeVolume: number;
  baseOpportunityScore: number;
  opportunityScore: number;
  proxIntelligence: CryptoProxPacket | null;
  riskScore: number;
  pulseState: CryptoPulseState;
  eligible: boolean;
  radarEligible: boolean;
  decisionState: "qualified" | "radar" | "withheld";
  decisionReason: string;
  authorityFlags: string[];
  sourceVenues: CryptoDiscoveryVenue[];
  quoteCurrencies: string[];
  venueConfirmationScore: number;
  liveDataFresh: boolean;
  stage: string;
  summary: string;
  riskTags: string[];
  scoreBreakdown: {
    momentum: number;
    volume: number;
    peakRetention: number;
    liquidity: number;
    rangePosition: number;
  };
};

export type CryptoOpportunityFeed = {
  success: true;
  lane: "crypto_momentum";
  status: "observation_only";
  provider: "centralized_exchange_public";
  methodologyVersion: "crypto-momentum-v3-prox-authority";
  decisionFrame: {
    version: "crypto-decision-frame-v1";
    decisionAt: string;
    freshUntil: string;
    fresh: boolean;
    source: "computed" | "materialized" | "stale_fallback";
    authority: "backend_atomic";
  };
  hero: CryptoOpportunity | null;
  developingLeader: CryptoOpportunity | null;
  contenders: CryptoOpportunity[];
  radar: CryptoOpportunity[];
  shadowDiscovery: CryptoShadowDiscovery;
  diagnostics: {
    availableUsdProducts: number;
    shortlistedProducts: number;
    evaluatedProducts: number;
    eligibleProducts: number;
    radarProducts: number;
    providerFailures: number;
    discoverySeedProducts: number;
    authorityEligibleProducts: number;
    withheldProducts: number;
    staleProxProducts: number;
    proxEvaluatedProducts: number;
    proxAvailableProducts: number;
    proxProviderFailures: number;
    shadowDiscoveryAssets: number;
    shadowDiscoveryCandidates: number;
    shadowDiscoveryHealthyVenues: number;
    shadowDiscoveryProviderFailures: number;
  };
  timestamp: string;
};
