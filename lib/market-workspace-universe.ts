export const MARKET_CORE_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;

export const MARKET_MEGA_CAP_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AVGO",
] as const;

export const MARKET_WORKSPACE_SYMBOLS = [
  ...MARKET_CORE_SYMBOLS,
  ...MARKET_MEGA_CAP_SYMBOLS,
] as const;

export const MARKET_CONTEXT_PROVIDER_SYMBOLS = [
  ...MARKET_WORKSPACE_SYMBOLS,
  "VIXY",
] as const;

export function marketWorkspaceAssetLabel(symbol: string) {
  return (MARKET_CORE_SYMBOLS as readonly string[]).includes(symbol) ? "ETF" : "Stock";
}
