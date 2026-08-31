import type {
  PaperOrderSide,
  PaperOrderType,
  PaperTimeInForce,
} from "./engine";

export type PaperAccountView = {
  id: string;
  name: string;
  startingCash: number;
  cashBalance: number;
  realizedPnl: number;
  shortMarginHeld: number;
  equity: number;
  buyingPower: number;
  longMarketValue: number;
  shortUnrealizedPnl: number;
  dataMode: "delayed" | "real_time";
};

export type PaperPositionView = {
  id: string;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  averageEntryPrice: number;
  shortMarginHeld: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  realizedPnl: number;
  quoteTimestamp: string | null;
};

export type PaperOrderView = {
  id: string;
  symbol: string;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  timeInForce: PaperTimeInForce;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  status: string;
  allowExtendedHours: boolean;
  submittedAt: string;
  filledAt: string | null;
  rejectReason: string | null;
  strategySource: string;
};

export type PaperFillView = {
  id: string;
  orderId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  price: number;
  notional: number;
  slippageBps: number;
  quoteSource: string;
  quoteTimestamp: string;
  filledAt: string;
};

export type PaperDashboard = {
  account: PaperAccountView;
  positions: PaperPositionView[];
  orders: PaperOrderView[];
  fills: PaperFillView[];
  disclosure: string;
  generatedAt: string;
};

export type PaperInstrumentView = {
  symbol: string;
  price: number;
  changePercent: number;
  previousClose: number;
  sessionOpen: number;
  sessionHigh: number;
  sessionLow: number;
  volume: number;
  quoteTimestamp: string;
  quoteAgeMinutes: number;
  quoteSource: string;
  dataMode: "delayed" | "real_time";
  marketSession: "regular" | "premarket" | "after_hours" | "closed";
  borrowAvailable: boolean;
  borrowRatePercent: number | null;
  borrowReason: string | null;
  position: PaperPositionView | null;
};

export type PaperApiResponse = {
  contractVersion?: string;
  ok: boolean;
  dashboard?: PaperDashboard;
  instrument?: PaperInstrumentView;
  orderId?: string;
  status?: string;
  message?: string;
  error?: string;
};
