export type CryptoPulseState = "expanding" | "stable" | "weakening";

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
  methodologyVersion: "crypto-momentum-v1";
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
  };
  timestamp: string;
};
