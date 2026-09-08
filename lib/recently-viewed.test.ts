import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { addRecentlyViewedSymbol, clearStoredRecentlyViewed, normalizeRecentlyViewed, parseStoredRecentlyViewed, readStoredRecentlyViewed, RECENTLY_VIEWED_LIMIT, RECENTLY_VIEWED_STORAGE_KEY, removeRecentlyViewedSymbol, writeStoredRecentlyViewed } from "./recently-viewed.ts";

test("recently viewed is normalized, deduplicated, and capped at twelve", () => {
  const input = Array.from({ length: 15 }, (_, index) => `s${index}`);
  assert.equal(normalizeRecentlyViewed(input).length, RECENTLY_VIEWED_LIMIT);
  assert.deepEqual(normalizeRecentlyViewed(["spy", " SPY ", "qqq"]), ["SPY", "QQQ"]);
});

test("recording a ticker moves it to the front and retains the cap", () => {
  const full = Array.from({ length: 12 }, (_, index) => `S${index}`);
  assert.deepEqual(addRecentlyViewedSymbol(full, "s5").slice(0, 3), ["S5", "S0", "S1"]);

  const withNew = addRecentlyViewedSymbol(full, "QQQ");
  assert.equal(withNew.length, 12);
  assert.equal(withNew[0], "QQQ");
  assert.equal(withNew.includes("S11"), false);
});

test("recently viewed parsing never substitutes malformed values", () => {
  assert.deepEqual(parseStoredRecentlyViewed("broken"), []);
  assert.deepEqual(parseStoredRecentlyViewed(JSON.stringify({ ticker: "SPY" })), []);
  assert.deepEqual(removeRecentlyViewedSymbol(["SPY", "QQQ"], "spy"), ["QQQ"]);
});

test("recent storage remains device-local and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  assert.deepEqual(writeStoredRecentlyViewed(storage, ["spy", "qqq"]), ["SPY", "QQQ"]);
  assert.equal(values.get(RECENTLY_VIEWED_STORAGE_KEY), '["SPY","QQQ"]');
  assert.deepEqual(readStoredRecentlyViewed(storage), ["SPY", "QQQ"]);
  clearStoredRecentlyViewed(storage);
  assert.equal(values.has(RECENTLY_VIEWED_STORAGE_KEY), false);

  const unavailable = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readStoredRecentlyViewed(unavailable), []);
  assert.deepEqual(writeStoredRecentlyViewed(unavailable, ["spy"]), ["SPY"]);
  assert.doesNotThrow(() => clearStoredRecentlyViewed(unavailable));
});
