import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { readWorkspaceInstrumentSeed, writeWorkspaceInstrumentSeed } from "./workspace-instrument-seed.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const instrument = {
  symbol: "SPY",
  name: "SPDR S&P 500 ETF Trust",
  market: "stocks",
  locale: "us",
  primaryExchange: "ARCX",
  securityType: "ETF",
  assetKind: "etf" as const,
  active: true,
  currency: "usd",
  cik: null,
  compositeFigi: null,
  shareClassFigi: null,
  providerUpdatedAt: "2026-09-08T12:00:00.000Z",
  workspaceSupported: true,
  provider: "massive_polygon" as const,
};

test("a fresh exact search seed can hydrate one matching workspace", () => {
  const storage = memoryStorage();
  assert.equal(writeWorkspaceInstrumentSeed(storage, instrument, 1_000), true);
  assert.equal(readWorkspaceInstrumentSeed(storage, "SPY", 2_000)?.name, instrument.name);
  assert.equal(readWorkspaceInstrumentSeed(storage, "SPY", 2_001), null);
});

test("mismatched and stale seeds are rejected", () => {
  const storage = memoryStorage();
  writeWorkspaceInstrumentSeed(storage, instrument, 1_000);
  assert.equal(readWorkspaceInstrumentSeed(storage, "QQQ", 2_000), null);
  writeWorkspaceInstrumentSeed(storage, instrument, 1_000);
  assert.equal(readWorkspaceInstrumentSeed(storage, "SPY", 400_000), null);
});
