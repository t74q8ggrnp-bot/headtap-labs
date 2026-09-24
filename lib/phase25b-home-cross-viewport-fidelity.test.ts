import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Home keeps one provider-backed chart across every responsive composition", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const frame = source("app/components/terminal/DesktopTerminalFrame.tsx");

  assert.equal(surface.match(/<HomeReferenceChart/g)?.length, 1);
  assert.equal(chart.match(/<MarketChartCanvas/g)?.length, 1);
  assert.equal(chart.match(/useLiveMarketView\(/g)?.length, 1);
  assert.match(chart, /preserveEngineOnLocalControls/);
  assert.match(chart, /data-chart-range-provider-requests-on-switch="0"/);
  assert.doesNotMatch(frame, /fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(surface, /fetch\(|XMLHttpRequest/);
});

test("Home chart exposes one quiet control strip with settings inside Layers", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");

  assert.equal(chart.match(/className="htb-chart__toolbar"/g)?.length, 1);
  assert.equal(chart.match(/aria-label="Visible chart range"/g)?.length, 1);
  assert.equal(chart.match(/<summary>Layers<\/summary>/g)?.length, 1);
  assert.match(chart, /aria-label="Price display layers"/);
  assert.match(chart, /Chart layers/);
  assert.match(chart, />\s*Latest\s*</);
  assert.match(chart, /<summary aria-label=\{`Drawing tools/);
  assert.match(chart, />Draw<\/summary>/);
});

test("Home Intelligence is progressive and compact layouts open it in a sheet", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");

  assert.match(surface, /const \[compactIntelligenceOpen, setCompactIntelligenceOpen\] = useState\(false\)/);
  assert.match(surface, /title="HT Intelligence"/);
  assert.match(surface, /open=\{compactLayout === "compact" && compactIntelligenceOpen\}/);
  assert.match(surface, /intelligence=\{compactLayout === "desktop" \? intelligence : null\}/);
  assert.match(surface, /<summary>Levels and risk<\/summary>/);
  assert.match(surface, /<summary>Pro X evidence<\/summary>/);
  assert.match(surface, /<summary>Agent X<\/summary>/);
  assert.match(surface, /<summary>Full evidence<\/summary>/);
  assert.equal(surface.match(/<HomeTradePlan/g)?.length, 1);
});

test("Home CSS contains explicit desktop, portrait, and landscape compositions", () => {
  const css = source("app/globals.css");

  assert.match(css, /data-application-route="home"[\s\S]*font-family: var\(--font-ht-terminal\)/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1179px\) and \(orientation: landscape\)/);
  assert.match(css, /@media \(min-width: 1180px\)/);
  assert.match(css, /radial-gradient\(circle at 0 0, rgba\(165, 61, 9, 0\.22\)/);
  assert.match(css, /\.ht-mobile-global-nav \{[\s\S]*border-top: 0 !important/);
});

test("Home chart and terminal reading order rely on DOM order, not CSS order", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const layout = source("app/layout.tsx");
  const css = source("app/globals.css");

  assert.ok(chart.indexOf("<MarketChartCanvas") < chart.indexOf('className="htb-chart__toolbar"'));
  assert.ok(surface.indexOf("instrumentHeader={instrumentHeader}") < surface.indexOf("chart={chart}"));
  assert.ok(surface.indexOf("chart={chart}") < surface.indexOf('intelligence={compactLayout === "desktop"'));
  assert.ok(layout.indexOf("<ResponsiveApplicationShell>") < layout.indexOf("<MobileAppNavigation />"));
  assert.doesNotMatch(css, /(?:^|[;{])\s*order\s*:/m);
});

test("legacy mobile Home declarations cannot restore the old two-row toolbar", () => {
  const css = source("app/globals.css");

  assert.doesNotMatch(css, /\.htb-chart__toolbar\s*\{[^}]*grid-template-columns:\s*auto auto/);
  assert.doesNotMatch(css, /\.htb-chart__controls--mode/);
  assert.match(css, /\.ht-home-terminal-surface \.htb-chart__toolbar \{[\s\S]*display: flex;/);
  assert.match(css, /\.ht-terminal-market-table tbody td \{ font-size: 0\.7rem;/);
});

test("compact portrait and landscape keep content inside the visual viewport", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const css = source("app/globals.css");

  assert.match(chart, /const viewportHeight = window\.visualViewport\?\.height \?\? window\.innerHeight/);
  assert.match(chart, /landscapeQuery\.matches[\s\S]*viewportHeight - 164[\s\S]*mobileQuery\.matches[\s\S]*viewportHeight - 302/);
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1179px\) and \(orientation: landscape\)[\s\S]*\.ht-home-terminal-surface \{ height: 100dvh; min-height: 0; overflow: hidden; \}/);
  assert.match(css, /@media \(max-width: 1179px\)[\s\S]*\.ht-home-terminal-surface \.ht-terminal-pane--intelligence[\s\S]*display: none/);
  assert.match(css, /\.ht-home-intelligence-dialog \.ht-dialog-sheet__content \{ min-height: 0; overflow-y: auto;/);
});

test("portrait actions stay compact and accessible while collapsed Intelligence releases its gap", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const css = source("app/globals.css");

  assert.match(surface, /aria-label=\{watched \? `Remove \$\{symbol\} from watchlist` : `Add \$\{symbol\} to watchlist`\}/);
  assert.match(surface, /aria-label=\{`Review \$\{symbol\} in Paper Trading`\}/);
  assert.match(surface, /ht-home-action-label--mobile">Paper/);
  assert.match(surface, /ht-home-action-label--desktop">Review in Paper/);
  assert.match(chart, /Math\.min\(620, Math\.max\(330, viewportHeight - 302\)\)/);
  assert.match(css, /\.ht-home-terminal-surface \.ht-home-action-label--desktop \{ display: none; \}/);
  assert.match(css, /\.htb-home \{ padding-bottom: calc\(60px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
});
