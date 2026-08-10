export type CryptoPulseState = "expanding" | "stable" | "weakening";

export type CryptoProxState =
  | "expanding"
  | "stable"
  | "weakening"
  | "stale";

export type CryptoProxPacket = {
  packetVersion: "crypto-prox-v1";
  mode: "shadow";
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
  opportunityScore: number;
  proxIntelligence: CryptoProxPacket | null;
  riskScore: number;
  pulseState: CryptoPulseState;
  eligible: boolean;
  radarEligible: boolean;
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
  provider: "coinbase_exchange_public";
  methodologyVersion: "crypto-momentum-v2-prox-shadow";
  hero: CryptoOpportunity | null;
  contenders: CryptoOpportunity[];
  radar: CryptoOpportunity[];
  diagnostics: {
    availableUsdProducts: number;
    shortlistedProducts: number;
    evaluatedProducts: number;
    eligibleProducts: number;
    radarProducts: number;
    providerFailures: number;
    proxEvaluatedProducts: number;
    proxAvailableProducts: number;
    proxProviderFailures: number;
  };
  timestamp: string;
};
