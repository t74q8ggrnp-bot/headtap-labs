import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Market URL state is the exact ticker authority without a Canonical hero fallback", () => {
  const home = source("app/HomeClient.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");

  assert.match(home, /requested: requestedMarketTicker/);
  assert.match(home, /router\.push\(href\)/);
  assert.doesNotMatch(home, /selectedOpportunity\s*\?\?\s*apiMomentum/);
  assert.match(surface, /opportunity\?\.ticker === symbol/);
  assert.match(surface, /<HomeReferenceChart symbol=\{symbol\}/);
  assert.match(surface, /<HomeTradePlan symbol=\{symbol\}/);
  assert.match(surface, /href=\{`\/paper\?symbol=\$\{encodeURIComponent\(symbol\)\}`\}/);
  assert.match(surface, /data-workspace-symbol=\{symbol\}/);
});

test("legacy Trade deep links retain their exact symbol in the Market workspace", () => {
  const trade = source("app/trade/[ticker]/page.tsx");
  const market = source("app/market/page.tsx");

  assert.match(trade, /normalizeMarketWorkspaceSymbol/);
  assert.match(trade, /redirect\(marketWorkspaceHref\(symbol\)!\)/);
  assert.match(market, /normalizeMarketWorkspaceSymbol\(rawTicker\)/);
  assert.match(market, /notFound\(\)/);
});

test("an unavailable chart names the exact requested ticker and never invents candles", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");

  assert.match(chart, /Data unavailable for \{symbol\}/);
  assert.match(chart, /No estimated candles are shown\./);
  assert.match(chart, /data-chart-symbol=\{symbol\}/);
});
