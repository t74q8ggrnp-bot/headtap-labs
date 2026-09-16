import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("portrait Home reserves the first screen for the compact header, chart, controls, and navigation", () => {
  const css = source("app/globals.css");

  assert.match(css, /@media \(max-width: 767px\)[\s\S]*data-application-route="home"\] \.htb-home \{[\s\S]*height: calc\(100dvh - 58px - env\(safe-area-inset-top/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-decision-line \{ display: none; \}/);
  assert.match(css, /\.ht-home-terminal-surface \.ht-terminal-pane--intelligence/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-chart__toolbar \{[\s\S]*height: 44px/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test("landscape Home uses the chart workspace without a permanent Intelligence rail", () => {
  const css = source("app/globals.css");

  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1179px\) and \(orientation: landscape\)[\s\S]*grid-template-columns: 52px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 1179px\)[\s\S]*\.ht-home-terminal-surface \.ht-terminal-pane--intelligence[\s\S]*display: none/);
  assert.match(css, /\.ht-home-intelligence-dialog\[data-presentation="sheet"\][\s\S]*width: min\(390px, 46vw\)/);
});

test("rotation resizes the existing chart without changing the selected visible range", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");

  assert.match(chart, /const rangeInitializedRef = useRef\(false\)/);
  assert.match(chart, /if \(!rangeInitializedRef\.current\)/);
  assert.doesNotMatch(chart, /rangeSelectedByUserRef/);
  assert.equal(chart.match(/<MarketChartCanvas/g)?.length, 1);
  assert.match(chart, /preserveEngineOnLocalControls/);
  assert.match(canvas, /new ResizeObserver\(resizeChart\)/);
  assert.match(canvas, /dataset\.chartInitializationCount/);
});

test("compact Home keeps Markets, Intelligence, Watch, and Workspace available from the instrument header", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");

  assert.match(surface, /className="ht-home-compact-action ht-home-market-launcher"/);
  assert.match(surface, /className="ht-home-compact-action ht-home-intelligence-launcher"/);
  assert.match(surface, /onToggleWatchlist/);
  assert.match(surface, /href=\{`\/trade\/\$\{encodeURIComponent\(opportunity\.ticker\)\}`\}/);
  assert.match(surface, /title="Explore markets"/);
  assert.match(surface, /title="HT Intelligence"/);
});
