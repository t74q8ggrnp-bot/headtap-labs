import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop Home reuses the Market terminal shell with a Canonical Spot Momentum rail", () => {
  const home = source("app/HomeClient.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const intelligence = source("app/components/home/HomeSpotMomentumIntelligence.tsx");
  const css = source("app/globals.css");

  assert.match(home, /homeComposition === "desktop"/);
  assert.match(home, /terminalSurface\("spot-momentum"\)/);
  assert.match(surface, /experience === "spot-momentum"/);
  assert.equal(surface.match(/<HomeReferenceChart/g)?.length, 1);
  assert.match(intelligence, /HT Agent X targets/);
  assert.match(intelligence, /Pro X evidence/);
  assert.match(intelligence, /Risk and R\/R are withheld until verified support/);
  assert.match(css, /data-application-route="discovery"[^\n]*> \.ht-desktop-global-header/);
});

test("desktop Home relies on the global shell without a duplicate dashboard header", () => {
  const home = source("app/HomeClient.tsx");

  assert.doesNotMatch(home, />\s*Dashboard\s*</);
  assert.doesNotMatch(home, />\s*Top Convictions\s*</);
  assert.doesNotMatch(home, /className="ht-home-conviction mx-auto max-w/);
});

test("desktop first paint reserves the final workspace geometry", () => {
  const home = source("app/HomeClient.tsx");
  const stateCard = source("app/components/OpportunityStateCard.tsx");
  const css = source("app/globals.css");

  assert.match(home, /<OpportunityStateCard loading workspace \/>/);
  assert.match(stateCard, /ht-home-workspace-loading/);
  assert.match(stateCard, /aria-busy="true"/);
  assert.match(stateCard, /src="\/app-icon\.png"/);
  assert.match(stateCard, /Syncing verified market intelligence/);
  assert.match(css, /\.ht-home-workspace-loading__card/);
  assert.match(css, /height: calc\(100dvh - 58px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("Home replaces broad-market context with bounded Pro X support while the shared snapshot remains cached", () => {
  const home = source("app/HomeClient.tsx");
  const intelligence = source("app/components/home/HomeSpotMomentumIntelligence.tsx");
  const route = source("app/api/market-context/route.ts");

  assert.doesNotMatch(home, /ht-home-market-context/);
  assert.doesNotMatch(intelligence, /Broad market:/);
  assert.match(intelligence, /Pro X pulse/);
  assert.match(intelligence, /Bounded live-tape evidence supports the current Canonical read/);
  assert.match(route, /tickers", "SPY,QQQ,IWM,VIXY"/);
  assert.match(route, /providerRequests: 1/);
  assert.match(route, /revalidate: 15/);
  assert.match(route, /s-maxage=15/);
});

test("Spot Momentum uses an honest 90-minute default and refined candles without changing Market defaults", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");

  assert.match(surface, /presentation=\{experience\}/);
  assert.match(chart, /presentation === "spot-momentum" \? "90m" : "2h"/);
  assert.match(chart, /\{ id: "90m", label: "90M" \}/);
  assert.match(chart, /candlePresentation=\{presentation === "spot-momentum" \? "refined" : "standard"\}/);
  assert.match(canvas, /MARKET_CHART_CANDLE_PALETTES\[candlePresentation\]/);
  assert.match(canvas, /preserveEngineOnLocalControls/);
});
