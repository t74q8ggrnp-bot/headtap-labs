export const MARKET_WORKSPACE_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function normalizeMarketWorkspaceSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return MARKET_WORKSPACE_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function marketWorkspaceHref(value: unknown) {
  const symbol = normalizeMarketWorkspaceSymbol(value);
  return symbol ? `/market?ticker=${encodeURIComponent(symbol)}` : null;
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
