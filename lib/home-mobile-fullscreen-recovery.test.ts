import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile navigation separates Home intelligence from Market analysis", () => {
  const navigation = source("app/components/MobileAppNavigation.tsx");
  const home = source("app/components/home/HomeReferenceSurface.tsx");

  for (const destination of ["Home", "Market", "Paper", "Agent X", "Profile"]) {
    assert.match(navigation, new RegExp(`label: "${destination}"`));
  }
  assert.doesNotMatch(navigation, /label: "Work"|label: "Trade"/);
  assert.doesNotMatch(navigation, /label: "Scanner"/);
  assert.match(home, /htlabs:open-markets/);
  assert.match(home, /Spot \{spotMomentum\.length\}/);
  assert.match(home, /Early \{beforeCrowd\.length\}/);
  assert.match(home, />Watchlist</);
});

test("mobile Home uses a pure-black chart-led composition in portrait and landscape", () => {
  const css = source("app/globals.css");
  const recovery = css.slice(css.indexOf("Mobile Home recovery"));

  assert.match(recovery, /background: #000;/);
  assert.doesNotMatch(recovery, /radial-gradient|linear-gradient/);
  assert.match(recovery, /\.ht-mobile-global-nav\[data-application-route="home"\][\s\S]*box-shadow: none/);
  assert.match(recovery, /orientation: landscape/);
  assert.match(recovery, /\.ht-home-terminal-surface \.ht-terminal-nav \{ display: none; \}/);
  assert.match(recovery, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(recovery, /height: calc\(100dvh - 52px - env\(safe-area-inset-bottom, 0px\)\)/);
});

test("Home drawing tools are functional, persistent, and do not change provider lifecycle", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const drawings = source("app/components/market/MarketChartUserDrawings.tsx");

  for (const label of ["Horizontal", "Trendline", "Price range", "Undo", "Redo", "Delete selected"]) {
    assert.match(chart, new RegExp(label));
  }
  assert.match(chart, /htlabs:user-drawings:v1:/);
  assert.match(canvas, /MarketChartUserDrawingLayer/);
  assert.match(drawings, /coordinateToTime/);
  assert.match(drawings, /coordinateToPrice/);
  assert.match(drawings, /setPointerCapture/);
  assert.match(chart, /data-chart-provider-requests-on-switch="0"/);
  assert.match(chart, /preserveEngineOnLocalControls/);
  assert.equal(chart.match(/useLiveMarketView\(/g)?.length, 1);
  assert.doesNotMatch(chart, /fetch\(|XMLHttpRequest/);
});
