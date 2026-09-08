// @ts-expect-error Node's strip-types test runner requires the source extension.
import { normalizeWatchlistSymbol } from "./watchlist.ts";

export const RECENTLY_VIEWED_STORAGE_KEY = "htlabs-viewed-tickers";
export const RECENTLY_VIEWED_LIMIT = 12;
export const RECENTLY_VIEWED_CHANGED_EVENT = "htlabs:recently-viewed-changed";
export const RECENTLY_VIEWED_BROADCAST_CHANNEL = "htlabs-recently-viewed-v1";

export type RecentlyViewedStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeRecentlyViewed(
  value: unknown,
  limit = RECENTLY_VIEWED_LIMIT,
): string[] {
  if (!Array.isArray(value) || limit <= 0) return [];

  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const item of value) {
    const symbol = normalizeWatchlistSymbol(item);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length === limit) break;
  }
  return symbols;
}

export function parseStoredRecentlyViewed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return normalizeRecentlyViewed(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function readStoredRecentlyViewed(storage: RecentlyViewedStorage): string[] {
  try {
    return parseStoredRecentlyViewed(storage.getItem(RECENTLY_VIEWED_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeStoredRecentlyViewed(
  storage: RecentlyViewedStorage,
  symbols: unknown,
): string[] {
  const normalized = normalizeRecentlyViewed(symbols);
  try {
    storage.setItem(RECENTLY_VIEWED_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preserve usable in-memory state if browser persistence is unavailable.
  }
  return normalized;
}

export function addRecentlyViewedSymbol(
  currentSymbols: unknown,
  value: unknown,
): string[] {
  const current = normalizeRecentlyViewed(currentSymbols);
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) return current;
  return [symbol, ...current.filter((item) => item !== symbol)].slice(
    0,
    RECENTLY_VIEWED_LIMIT,
  );
}

export function removeRecentlyViewedSymbol(
  currentSymbols: unknown,
  value: unknown,
): string[] {
  const current = normalizeRecentlyViewed(currentSymbols);
  const symbol = normalizeWatchlistSymbol(value);
  if (!symbol) return current;
  return current.filter((item) => item !== symbol);
}

export function clearStoredRecentlyViewed(storage: RecentlyViewedStorage): void {
  try {
    storage.removeItem(RECENTLY_VIEWED_STORAGE_KEY);
  } catch {
    // Clearing in-memory state is still useful when storage is unavailable.
  }
}
