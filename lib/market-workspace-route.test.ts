import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types resolves the TypeScript source directly.
import { marketWorkspaceHref, normalizeMarketWorkspaceSymbol, resolveMarketWorkspaceSymbol } from "./market-workspace-route.ts";

test("normalizes valid universal stock and ETF symbols without guessing repairs", () => {
  assert.equal(normalizeMarketWorkspaceSymbol(" $spy "), "SPY");
  assert.equal(normalizeMarketWorkspaceSymbol("BRK.B"), "BRK.B");
  assert.equal(normalizeMarketWorkspaceSymbol("QQQ"), "QQQ");
  for (const invalid of ["", "SPY/QQQ", "SPY?x=1", "TOO-LONG-SYMBOL", null]) {
    assert.equal(normalizeMarketWorkspaceSymbol(invalid), null);
  }
});

test("the requested URL symbol outranks selected and Canonical hero state", () => {
  assert.equal(resolveMarketWorkspaceSymbol({
    requested: "SPY",
    selected: "AAPL",
    canonicalHero: "REFR",
  }), "SPY");
  assert.equal(resolveMarketWorkspaceSymbol({
    requested: null,
    selected: "QQQ",
    canonicalHero: "REFR",
  }), "QQQ");
});

test("builds one canonical Market workspace URL", () => {
  assert.equal(marketWorkspaceHref("aapl"), "/market?ticker=AAPL");
  assert.equal(marketWorkspaceHref("bad/value"), null);
});
