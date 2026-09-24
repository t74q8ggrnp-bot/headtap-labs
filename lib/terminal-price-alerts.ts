export const TERMINAL_PRICE_ALERTS_KEY = "htlabs:terminal-price-alerts:v1";
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const normalizeSymbol = (value: unknown) => {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return SYMBOL.test(symbol) ? symbol : null;
};

export type TerminalPriceAlertSource = "drawing" | "agent_target";

export type TerminalPriceAlert = {
  id: string;
  symbol: string;
  price: number;
  direction: "at_or_above" | "at_or_below";
  source: TerminalPriceAlertSource;
  label: string;
  createdAt: string;
  triggeredAt: string | null;
};

export function parseTerminalPriceAlerts(value: unknown): TerminalPriceAlert[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<TerminalPriceAlert>;
    const symbol = normalizeSymbol(candidate.symbol);
    const price = Number(candidate.price);
    if (
      !symbol || !Number.isFinite(price) || price <= 0 ||
      (candidate.direction !== "at_or_above" && candidate.direction !== "at_or_below") ||
      (candidate.source !== "drawing" && candidate.source !== "agent_target") ||
      typeof candidate.id !== "string" || typeof candidate.label !== "string" ||
      typeof candidate.createdAt !== "string"
    ) return [];
    return [{
      id: candidate.id,
      symbol,
      price,
      direction: candidate.direction,
      source: candidate.source,
      label: candidate.label,
      createdAt: candidate.createdAt,
      triggeredAt: typeof candidate.triggeredAt === "string" ? candidate.triggeredAt : null,
    }];
  }).slice(-100);
}

export function priceAlertTriggered(alert: TerminalPriceAlert, currentPrice: number) {
  return alert.direction === "at_or_above"
    ? currentPrice >= alert.price
    : currentPrice <= alert.price;
}
