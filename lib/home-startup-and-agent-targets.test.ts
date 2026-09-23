import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("Home and Market render their application shells without blocking on canonical frame construction", () => {
  const home = source("app/page.tsx");
  const market = source("app/market/page.tsx");

  assert.doesNotMatch(home, /getRollingCanonicalDecisionFrame/);
  assert.doesNotMatch(home, /Promise\.allSettled/);
  assert.match(home, /initialMomentumPayload=\{null\}/);
  assert.match(home, /initialBeforeCrowdPayload=\{null\}/);

  assert.doesNotMatch(market, /getRollingCanonicalDecisionFrame/);
  assert.doesNotMatch(market, /Promise\.allSettled/);
  assert.match(market, /initialMomentumPayload=\{null\}/);
  assert.match(market, /initialBeforeCrowdPayload=\{null\}/);
});

test("the authenticated Agent target feed performs a bounded exact-symbol query", () => {
  const route = source("app/api/ht-agent/route.ts");
  const server = source("lib/ht-agent/server.ts");
  const component = source("app/components/agent/HomeTradePlan.tsx");

  assert.match(route, /loadHtAgentTradePlans\(context, symbol\)/);
  assert.match(route, /A valid symbol is required/);
  assert.match(server, /requestedSymbol: string \| null = null/);
  assert.match(server, /decisionQuery = decisionQuery\.eq\("symbol", requestedSymbol\)\.limit\(1\)/);
  assert.match(server, /decisionQuery = decisionQuery\.limit\(100\)/);
  assert.match(component, /view=trade_plans&symbol=\$\{encodeURIComponent\(symbol\)\}/);
});
