export type MarketStock = {
  symbol: string;
  price: number;
  change: number;
  volume?: number;
  prevVolume?: number;
  relativeVolume?: number;
  catalystScore?: number;
  htSignalScore?: number;
  momentumScore?: number;
  crowdScore?: number;
  trapScore?: number;
  signalState?: string;
  signalPattern?: string;
  hasFDAEvent?: boolean;
  hasInsiderBuy?: boolean;
  changePercent?: number;
};

export type TradeFrameworkDisplay = {
  uptideMin: number;
  uptideMax: number;
  riskZone: number;
  rr: number;
  confidence: "High" | "Moderate" | "Early" | "Speculative";
  horizon: string;
  sentence: string;
  isLive: boolean;
};

export type DecisionTraceDisplay = {
  opportunityScore: number;
  confidence: "High" | "Moderate" | "Early" | "Speculative";
  primaryDrivers: string[];
  rejectedAlternatives: { symbol: string; reason: string }[];
  candidatesEvaluated: number;
};

export type BullBearAnalysis = {
  ticker: string;
  onRadar: string;
  bullCase: string[];
  bearCase: string[];
  crowdFocus: string;
  htRead: string;
  newsCount: number;
  timestamp: string;
};
