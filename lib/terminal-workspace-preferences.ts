import type { MarketChartTimeframe } from "./market-chart-timeframes";
import type { MarketChartVisibleRange } from "./market-chart-visible-range";

export const TERMINAL_WORKSPACE_PREFERENCES_KEY = "htlabs:terminal-workspace:v1";

export type TerminalWorkspacePreferences = {
  symbol: string | null;
  timeframe: MarketChartTimeframe;
  visibleRange: MarketChartVisibleRange;
  priceLayers: { candles: boolean; line: boolean };
};

export const DEFAULT_TERMINAL_WORKSPACE_PREFERENCES: TerminalWorkspacePreferences = {
  symbol: null,
  timeframe: "1m",
  visibleRange: "2h",
  priceLayers: { candles: true, line: false },
};

const TIMEFRAMES = new Set<MarketChartTimeframe>(["1m", "5m", "15m"]);
const RANGES = new Set<MarketChartVisibleRange>(["1h", "90m", "2h", "session"]);
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;
const normalizeSymbol = (value: unknown) => {
  if (typeof value !== "string") return null;
  const symbol = value.trim().replace(/^\$/, "").toUpperCase();
  return SYMBOL.test(symbol) ? symbol : null;
};

export function parseTerminalWorkspacePreferences(
  value: unknown,
  fallback: TerminalWorkspacePreferences = DEFAULT_TERMINAL_WORKSPACE_PREFERENCES,
): TerminalWorkspacePreferences {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<TerminalWorkspacePreferences>;
  const priceLayers = candidate.priceLayers && typeof candidate.priceLayers === "object"
    ? candidate.priceLayers
    : fallback.priceLayers;
  const candles = typeof priceLayers.candles === "boolean"
    ? priceLayers.candles
    : fallback.priceLayers.candles;
  const line = typeof priceLayers.line === "boolean"
    ? priceLayers.line
    : fallback.priceLayers.line;

  return {
    symbol: normalizeSymbol(candidate.symbol) ?? fallback.symbol,
    timeframe: TIMEFRAMES.has(candidate.timeframe as MarketChartTimeframe)
      ? candidate.timeframe as MarketChartTimeframe
      : fallback.timeframe,
    visibleRange: RANGES.has(candidate.visibleRange as MarketChartVisibleRange)
      ? candidate.visibleRange as MarketChartVisibleRange
      : fallback.visibleRange,
    // A chart with neither price layer is not useful. Recover to candles while
    // preserving the user's valid choice when either layer is enabled.
    priceLayers: candles || line ? { candles, line } : { candles: true, line: false },
  };
}

export function mergeTerminalWorkspacePreferences(
  current: TerminalWorkspacePreferences,
  patch: Partial<TerminalWorkspacePreferences>,
) {
  return parseTerminalWorkspacePreferences({ ...current, ...patch }, current);
}
