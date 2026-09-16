import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Home exposes each existing discovery source without adding a request", () => {
  const home = source("app/HomeClient.tsx");
  const feed = source("app/hooks/useOpportunityFeed.ts");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const markets = source("app/components/home/HomeTerminalMarkets.tsx");

  assert.match(home, /spotMomentum=\{apiFullRankedList\}/);
  assert.match(home, /beforeCrowd=\{apiBeforeCrowdList\}/);
  assert.match(home, /watchlist=\{watchlist\}/);
  assert.match(home, /recents=\{recentlyViewed\}/);
  assert.match(feed, /\/api\/opportunities\?type=momentum&limit=100/);
  assert.match(feed, /\/api\/opportunities\?type=before_crowd&limit=100/);
  assert.equal(feed.match(/fetch\(/g)?.length, 2);
  assert.doesNotMatch(surface, /fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(markets, /fetch\(|XMLHttpRequest/);
});

test("market browser names Spot Momentum, Before the Crowd, Watchlist, and Recently Viewed", () => {
  const markets = source("app/components/home/HomeTerminalMarkets.tsx");

  for (const label of ["Spot Momentum", "Before the Crowd", "Watchlist", "Recently Viewed"]) {
    assert.match(markets, new RegExp(label));
  }
  assert.match(markets, /role="tablist" aria-label="Market lists"/);
  assert.match(markets, /role="tabpanel"/);
  assert.match(markets, /event\.key === "ArrowRight"/);
  assert.match(markets, /event\.key === "ArrowLeft"/);
  assert.match(markets, /Open full scanner/);
});

test("compact Home opens Markets and Intelligence in accessible focus-contained sheets", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const dialog = source("app/components/ui/ApplicationPrimitives.tsx");
  const css = source("app/globals.css");

  assert.match(surface, /aria-haspopup="dialog"/);
  assert.match(surface, /title="Explore markets"/);
  assert.match(surface, /title="HT Intelligence"/);
  assert.match(surface, /presentation="sheet"/);
  assert.match(surface, /className="ht-home-market-browser"/);
  assert.match(surface, /className="ht-home-intelligence-dialog"/);
  assert.match(dialog, /resolveDialogFocusLoopTarget/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /onCancel=/);
  assert.match(css, /\.ht-home-compact-action/);
  assert.match(css, /\.ht-home-intelligence-dialog/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test("Home keeps one chart and removes inline mobile discovery and intelligence blocks", () => {
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const chart = source("app/components/home/HomeReferenceChart.tsx");

  assert.equal(surface.match(/<HomeReferenceChart/g)?.length, 1);
  assert.equal(chart.match(/<MarketChartCanvas/g)?.length, 1);
  assert.doesNotMatch(surface, /ht-home-market-launcher--flow/);
  assert.match(surface, /intelligence=\{compactLayout === "desktop" \? intelligence : null\}/);
});

test("Home discloses sparse one-minute tape from the existing chart frame", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");

  assert.match(chart, /Sparse tape · \{visibleCoverage\.renderedProviderBarCount\}\/\{visibleCoverage\.expectedIntervalCount\} traded/);
  assert.match(chart, /Blank intervals represent missing verified provider aggregates\./);
  assert.match(chart, /aria-label="Visible chart coverage"/);
  assert.match(chart, /coveragePercentage\}% coverage/);
  assert.match(chart, />View 5m</);
  assert.match(chart, />View session</);
  assert.match(chart, /timeframe === "1m"/);
  assert.doesNotMatch(chart, /fetch\(|XMLHttpRequest/);
  assert.equal(chart.match(/<MarketChartCanvas/g)?.length, 1);
  assert.match(canvas, /resolveMarketChartVisibleCoverage/);
});

test("mobile navigation exposes Home intelligence and Market without a duplicate Trade destination", () => {
  const navigation = source("app/components/MobileAppNavigation.tsx");
  assert.match(navigation, /tab: "home", label: "Home", href: "\/"/);
  assert.match(navigation, /tab: "market", label: "Market", href: "\/market"/);
  assert.doesNotMatch(navigation, /label: "Scanner"/);
  assert.doesNotMatch(navigation, /tab: "workspace"/);
});

test("desktop gives every discovery and personal lane the full Markets width", () => {
  const css = source("app/globals.css");
  assert.match(css, /data-application-route="home"\] \.ht-terminal-market-tabs \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});
