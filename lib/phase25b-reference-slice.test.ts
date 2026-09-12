import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 2.5B exposes one restrained primary shell and separates operator routes", () => {
  const shell = source("app/components/ResponsiveApplicationShell.tsx");
  const mobile = source("app/components/MobileAppNavigation.tsx");

  assert.match(shell, /primaryRouteIds = new Set\(\["home", "scanner", "workspace", "paper"\]\)/);
  assert.match(shell, /secondaryRouteIds = new Set\(\["signals", "news", "prox", "agent", "account", "support"\]\)/);
  assert.match(shell, /operatorRouteIds = new Set\(\["qa", "validation", "trading-bot"\]\)/);
  assert.match(shell, /aria-label="Operator routes"/);
  assert.doesNotMatch(shell, /"privacy", "terms"/);
  assert.doesNotMatch(shell, /fetch\(|XMLHttpRequest|\/api\//);

  for (const item of [
    '{ tab: "home", label: "Home", href: "/" }',
    '{ tab: "scanner", label: "Scan", href: "/scanner" }',
    '{ tab: "workspace", label: "Trade", href: "/trade" }',
    '{ tab: "paper", label: "Paper", href: "/paper" }',
    '{ tab: "more", label: "More", href: "#application-routes" }',
  ]) assert.match(mobile, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(mobile, /grid grid-cols-5/);
});

test("Home reference composition is chart-led and keeps mobile information order explicit", () => {
  const home = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const positions = [
    "1-ticker-price",
    "2-decision",
    "3-chart",
    "4-intelligence",
  ].map((marker) => home.indexOf(`data-home-priority="${marker}"`));

  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.match(home, /No structured plan available\./);
  assert.match(home, /<HomeReferenceChart symbol=\{opportunity\.ticker\}/);
  assert.match(chart, /deriveMarketChartTimeframeBars/);
  assert.match(chart, /data-chart-provider-requests-on-switch="0"/);
  assert.match(chart, /preserveEngineOnLocalControls/);
  assert.equal(chart.match(/useLiveMarketView\(/g)?.length, 1);
});

test("Phase 2.5B styles retain flat surfaces and exact reference proportions", () => {
  const css = source("app/globals.css");
  const layout = source("lib/desktop-terminal-layout.ts");
  assert.match(css, /grid-template-columns: 56px var\(--ht-terminal-markets-width\) minmax\(0, 1fr\) var\(--ht-terminal-intelligence-width\)/);
  assert.match(layout, /marketsWidth: 220/);
  assert.match(layout, /intelligenceWidth: 296/);
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  assert.match(chart, /landscapeQuery\.matches[\s\S]*window\.innerHeight - 150[\s\S]*mobileQuery\.matches[\s\S]*window\.innerHeight < 720[\s\S]*terminalQuery\.matches[\s\S]*window\.innerHeight - 125[\s\S]*: 500/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-intelligence \{ border: 0; background: transparent; \}/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-symbol-header \{[\s\S]*border: 0;/);
});

test("Phase 2.5B keeps essential mobile market context keyboard reachable", () => {
  const homeSurface = source("app/components/home/HomeReferenceSurface.tsx");
  const css = source("app/globals.css");

  assert.match(homeSurface, /className="htb-tape" aria-label="Market context" tabIndex=\{0\}/);
  assert.match(homeSurface, /\[\["SPY", marketContext\.spy\.change\], \["QQQ", marketContext\.qqq\.change\]\]/);
  assert.match(homeSurface, /className="htb-tape__session"/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-tape__desktop-only \{ display: none; \}/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-tape__mobile-more \{ display: none; \}/);
});

test("visible-range controls remain local and cannot remount or refetch the Home chart", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const css = source("app/globals.css");

  for (const label of ["1H", "2H", "Session"]) assert.match(chart, new RegExp(`label: "${label}"`));
  assert.match(chart, /mobileQuery\.matches \? "1h" : "2h"/);
  assert.match(chart, /aria-label="Latest \/ reset visible chart range"/);
  assert.match(chart, /data-chart-range-provider-requests-on-switch="0"/);
  assert.match(chart, /preserveEngineOnLocalControls/);
  assert.equal(chart.match(/useLiveMarketView\(/g)?.length, 1);
  assert.doesNotMatch(chart, /fetch\(|XMLHttpRequest/);
  assert.match(canvas, /\? "persistent-local-controls"/);
  assert.doesNotMatch(canvas.match(/const chartEngineIdentity =[\s\S]*?;\n/)?.[0] ?? "", /visibleRange|latestResetToken/);
  assert.match(canvas, /marketChartIsFollowingLatest\(previousRange, previousPointCount\)/);
  assert.match(canvas, /handleScroll:\s*\{[\s\S]*mouseWheel: true,[\s\S]*pressedMouseMove: true,[\s\S]*horzTouchDrag: true/);
  assert.match(canvas, /handleScale:\s*\{[\s\S]*mouseWheel: true,[\s\S]*pinch: true/);
  assert.doesNotMatch(chart, /(?:baseBars|bars)\.slice\(/);
  assert.match(css, /\.htb-chart__toolbar-separator/);
  assert.match(css, /\.htb-chart__layers-panel \{[\s\S]*position: absolute/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-chart__toolbar \{[\s\S]*display: flex/);
});

test("visible-range semantics avoid a redundant roleless wrapper announcement", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");

  assert.match(chart, /<label className="htb-chart__range">/);
  assert.doesNotMatch(chart, /className="htb-chart__range" aria-label=/);
  assert.match(chart, /<select\s+aria-label="Visible chart range"/);
});
