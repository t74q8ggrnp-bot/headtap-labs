export const MARKET_WORKSPACE_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
export type HomeOpportunityLane = "spot_momentum" | "before_the_crowd";

export function normalizeMarketWorkspaceSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return MARKET_WORKSPACE_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function marketWorkspaceHref(value: unknown) {
  const symbol = normalizeMarketWorkspaceSymbol(value);
  return symbol ? `/market?ticker=${encodeURIComponent(symbol)}` : null;
}

export function normalizeHomeOpportunityLane(value: unknown): HomeOpportunityLane | null {
  return value === "spot_momentum" || value === "before_the_crowd" ? value : null;
}

export function homeOpportunityHref(symbolValue: unknown, laneValue: unknown) {
  const symbol = normalizeMarketWorkspaceSymbol(symbolValue);
  const lane = normalizeHomeOpportunityLane(laneValue);
  if (!symbol || !lane) return null;

  const params = new URLSearchParams({ lane, ticker: symbol });
  return `/?${params.toString()}`;
}

export function resolveMarketWorkspaceSymbol(input: {
  requested: unknown;
  selected: unknown;
  canonicalHero: unknown;
}) {
  return normalizeMarketWorkspaceSymbol(input.requested) ??
    normalizeMarketWorkspaceSymbol(input.selected) ??
    normalizeMarketWorkspaceSymbol(input.canonicalHero);
}
