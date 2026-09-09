export function visualPlanSymbolInScope(value: unknown, symbol: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const symbols = (value as { symbols?: unknown }).symbols;
  if (!Array.isArray(symbols)) return false;
  const normalized = symbol.trim().toUpperCase();
  return symbols.some((candidate) =>
    candidate === "*" ||
    (typeof candidate === "string" && candidate.trim().toUpperCase() === normalized)
  );
}
