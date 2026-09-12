import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Home uses one persistent chart tree across responsive terminal compositions", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const frame = source("app/components/terminal/DesktopTerminalFrame.tsx");

  assert.equal(surface.match(/<HomeReferenceChart/g)?.length, 1);
  assert.equal(surface.match(/<HomeTradePlan/g)?.length, 1);
  assert.equal(chart.match(/useLiveMarketView\(/g)?.length, 1);
  assert.doesNotMatch(frame, /fetch\(|XMLHttpRequest|useLiveMarketView|MarketChartCanvas/);
  assert.doesNotMatch(surface, /fetch\(|XMLHttpRequest/);
  assert.match(chart, /preserveEngineOnLocalControls/);
  assert.match(chart, /data-chart-provider-requests-on-switch="0"/);
});

test("desktop terminal activates independently without replacing portrait or landscape composition", () => {
  const css = source("app/globals.css");

  assert.match(css, /\.ht-terminal-pane,[\s\S]*\.ht-terminal-chart \{ display: contents; \}/);
  assert.match(css, /@media \(min-width: 1180px\)[\s\S]*\.ht-terminal \{[\s\S]*display: grid;/);
  assert.match(css, /@media \(max-width: 1179px\)[\s\S]*\.ht-home-terminal-surface \.htb-opportunities \{ display: none; \}/);
  assert.match(css, /data-application-route="home"[\s\S]*\.ht-desktop-global-header \{ display: none; \}/);
  assert.doesNotMatch(css, /data-application-route="workspace"[\s\S]*\.ht-desktop-global-header \{ display: none; \}/);
});

test("Home terminal wires real Canonical lists and keeps required actions explicit", () => {
  const home = source("app/HomeClient.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const markets = source("app/components/home/HomeTerminalMarkets.tsx");

  assert.match(home, /opportunities=\{apiFullRankedList\}/);
  assert.match(home, /watchlist=\{watchlist\}/);
  assert.match(home, /recents=\{recentlyViewed\}/);
  assert.match(surface, />\{watched \? "Watching" : "Watch"\}</);
  assert.match(surface, /href=\{`\/trade\/\$\{encodeURIComponent\(opportunity\.ticker\)\}`\}/);
  assert.match(markets, /onClick=\{\(\) => onSelect\(opportunity\)\}/);
  assert.match(markets, /href=\{`\/trade\/\$\{encodeURIComponent\(symbol\)\}`\}/);
  assert.doesNotMatch(markets, /fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(markets, /mock|fixture|hardcoded/i);
});

test("desktop chart controls render below the chart without exposing a dead Draw control", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const css = source("app/globals.css");
  const canvasIndex = chart.indexOf("<MarketChartCanvas");
  const toolbarIndex = chart.indexOf('<div className="htb-chart__toolbar">');

  assert.ok(canvasIndex > -1);
  assert.ok(toolbarIndex > canvasIndex);
  assert.match(css, /\.ht-terminal-chart \.htb-chart__toolbar \{[\s\S]*order: 2;/);
  assert.match(css, /@media \(max-width: 1179px\)[\s\S]*\.ht-home-terminal-surface \.htb-chart__toolbar \{ order: 1; \}/);
  assert.doesNotMatch(chart, />\s*Draw\s*</);
  assert.match(chart, /mobileQuery\.matches \? "1h" : "2h"/);
  assert.match(chart, /terminalQuery\.matches[\s\S]*window\.innerHeight - 125/);
});

test("pane controls are persistent, keyboard usable, and clean up global listeners", () => {
  const frame = source("app/components/terminal/DesktopTerminalFrame.tsx");
  const navigation = source("app/components/terminal/DesktopTerminalNavigation.tsx");
  const hook = source("app/hooks/useDesktopTerminalLayout.ts");

  assert.match(frame, /role="separator"/);
  assert.match(frame, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
  assert.match(frame, /requestAnimationFrame/);
  assert.match(frame, /aria-label="Expand Markets pane"/);
  assert.match(frame, /aria-label="Expand HT Intelligence pane"/);
  assert.match(hook, /localStorage/);
  assert.match(navigation, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(navigation, /window\.removeEventListener\("keydown", onKeyDown\)/);
  assert.match(navigation, /APPLICATION_ROUTES/);
});
