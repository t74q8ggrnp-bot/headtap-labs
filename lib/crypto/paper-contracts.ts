import type { presentCoinApiPublication } from "./coinapi-publication";

export const CRYPTO_PAPER_CONTRACT = "crypto-manual-paper-v1";
export type CryptoPaperSide = "buy" | "sell";
export type CryptoPaperIntent = { marketId: string; side: CryptoPaperSide; quantity: string; limitPrice: string };
export type CryptoPaperPreview = CryptoPaperIntent & {
  cycleId: string; notional: number; estimatedFee: number; total: number;
  buyingPowerBefore: number; buyingPowerAfter: number; availableQuantity: string;
  feeBps: number; slippageBps: number; policyVersion: string; expiresAt: string;
  book: { bid: number; ask: number; asOf: string };
};
export type CryptoPaperPosition = {
  market_id: string; quantity: string; available_quantity: string; cost_basis: number; updated_at: string;
  currentPrice: number | null; priceAsOf: string | null; current: boolean;
  marketValue: number | null; unrealizedPnl: number | null;
};
export type CryptoPaperOrder = {
  id: string; client_id: string; market_id: string; side: CryptoPaperSide; quantity: string;
  filled_quantity: string; limit_price: string; status: "open" | "partially_filled" | "filled" | "cancelled" | "expired";
  submitted_at: string; expires_at: string;
};
export type CryptoPaperFill = {
  id: string; order_id: string; market_id: string; side: CryptoPaperSide; quantity: string;
  price: number; fee: number; cash_delta: number; realized_pnl: number; provider_at: string; filled_at: string;
};
export type CryptoPaperDashboard = {
  contractVersion: string; enabled: boolean; account: {
    starting_cash: number; cash: number; realized_pnl: number;
  } | null;
  reservedCash: number; buyingPower: number; equity: number | null; marksCurrent: boolean;
  positions: CryptoPaperPosition[]; orders: CryptoPaperOrder[]; fills: CryptoPaperFill[];
  feed: { status: string; reason: string | null; publicationId: string | null;
    publication: ReturnType<typeof presentCoinApiPublication> | null };
  realExecution: false; agentAutopilot: false;
};

const marketPattern = /^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD$/;
export const validCryptoPaperMarket = (value: unknown): value is string => typeof value === "string" && marketPattern.test(value);
export const validCryptoPaperUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Preserve decimal strings. The DB alone calculates/reserves money and fills. */
export function parseCryptoPaperIntent(input: unknown): CryptoPaperIntent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!["string","number"].includes(typeof value.quantity) || !["string","number"].includes(typeof value.limitPrice)) return null;
  const quantity = typeof value.quantity === "string" ? value.quantity.trim() : String(value.quantity ?? "");
  const limitPrice = typeof value.limitPrice === "string" ? value.limitPrice.trim() : String(value.limitPrice ?? "");
  const decimal = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,12})?$/;
  if (!validCryptoPaperMarket(value.marketId) || (value.side !== "buy" && value.side !== "sell") ||
      !decimal.test(quantity) || !decimal.test(limitPrice) || Number(quantity) <= 0 || Number(quantity) > 1e12 ||
      Number(limitPrice) <= 0 || Number(limitPrice) >= 1e9) return null;
  return { marketId:value.marketId, side:value.side, quantity, limitPrice };
}
