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

test("landscape Home uses the chart workspace with the approved compact Intelligence rail", () => {
  const css = source("app/globals.css");

  const landscape = css.slice(css.indexOf("Final cascade for the mobile alignment pass"));
  assert.match(landscape, /@media \(orientation: landscape\) and \(max-height: 600px\) and \(max-width: 1179px\)/);
  assert.match(landscape, /grid-template-columns: minmax\(0, 1fr\) clamp\(200px, 30vw, 260px\)/);
  assert.match(landscape, /\.ht-terminal-pane--intelligence \{[\s\S]*display: grid !important/);
  assert.match(landscape, /\.ht-terminal-pane__body \{[\s\S]*overflow-y: auto/);
});

test("short landscape uses the terminal Home without relying on fragile pointer detection", () => {
  const css = source("app/globals.css");
  const home = source("app/HomeClient.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const landscape = css.slice(css.indexOf("Final cascade for the mobile alignment pass"));

  assert.match(landscape, /\(max-height: 600px\)/);
  assert.match(landscape, /\(orientation: landscape\)/);
  assert.doesNotMatch(landscape, /\(hover: none\)|\(pointer: coarse\)/);
  assert.match(home, /\(orientation: landscape\) and \(max-height: 600px\) and \(max-width: 1179px\)/);
  assert.match(surface, /compactLayout === "landscape"/);
  assert.match(landscape, /--ht-phone-landscape-rail: 48px/);
  assert.match(landscape, /grid-template-rows: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(landscape, /height: 100dvh/);
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

test("compact Market keeps market browsing, Intelligence, Watch, and Paper review available from the instrument header", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");

  assert.match(surface, /className="ht-home-compact-action ht-home-markets-launcher"/);
  assert.match(surface, /className="ht-home-compact-action ht-home-intelligence-launcher"/);
  assert.match(surface, /onToggleWatchlist/);
  assert.match(surface, /href=\{`\/paper\?symbol=\$\{encodeURIComponent\(symbol\)\}`\}/);
  assert.match(surface, /Explore Core Markets, Mega Caps, Bullish Today, Bearish Today, Watchlist, and Recently Viewed/);
  assert.match(surface, /Explore Spot Momentum, Before the Crowd, Watchlist, and Recently Viewed/);
  assert.match(surface, /aria-label="Open HT Intelligence"/);
});
