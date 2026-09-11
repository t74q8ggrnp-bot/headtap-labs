import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Trading Workspace adopts the accepted flat three-column terminal architecture", () => {
  const workspace = source("app/components/trade/TradeWorkspace.tsx");
  const header = source("app/components/trade/TradeWorkspaceHeader.tsx");
  const css = source("app/globals.css");

  assert.match(workspace, /min-\[1180px\]:grid-cols-\[220px_minmax\(0,1fr\)_330px\]/);
  assert.match(workspace, /window\.matchMedia\("\(min-width: 1180px\)"\)/);
  assert.doesNotMatch(header, /TickerSearchCombobox|<Image/);
  assert.match(css, /Phase 2\.5B Checkpoint 1: flat terminal reference styling/);
  assert.match(css, /\.ht-trade-workspace__frame \{[\s\S]*?border-radius: 0;[\s\S]*?box-shadow: none;/);
});

test("Trading Workspace range and timeframe controls remain separate and local", () => {
  const chart = source("app/components/trade/TradeWorkspaceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const invocationStart = chart.lastIndexOf("<MarketChartCanvas");
  const invocation = chart.slice(invocationStart, chart.indexOf("/>", invocationStart) + 2);

  assert.match(chart, /useState<MarketChartVisibleRange>\("2h"\)/);
  assert.match(chart, /query\.matches \? "1h" : "2h"/);
  assert.match(chart, /aria-label="Chart timeframe"/);
  assert.match(chart, /role="group" aria-label="Visible chart range"/);
  assert.match(chart, /<select[\s\S]*?aria-label="Visible chart range"/);
  assert.match(chart, /aria-label="Latest \/ reset visible chart range"/);
  assert.match(chart, /data-chart-range-provider-requests-on-switch="0"/);
  assert.match(invocation, /visibleRange=\{visibleRange\}/);
  assert.match(invocation, /latestResetToken=\{latestResetToken\}/);
  assert.match(invocation, /preserveEngineOnLocalControls/);
  assert.doesNotMatch(invocation, /\skey=/);
  assert.match(canvas, /dataset\.chartInitializationCount/);
});

test("Trading Workspace preserves chart layers and future drawing seams", () => {
  const chart = source("app/components/trade/TradeWorkspaceChart.tsx");

  for (const label of ["Agent X", "ProX", "Volume", "VWAP", "EMA 9", "EMA 20"]) {
    assert.match(chart, new RegExp(label.replace(" ", "\\s")));
  }
  assert.match(chart, /layerHost=\{EMPTY_CHART_LAYER_HOST\}/);
  assert.match(chart, /chartObjects=\{visibleChartObjects\}/);
});

test("market charts replace the in-chart vendor mark with a noninteractive HT Labs watermark and retain public attribution", () => {
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const terms = source("app/terms/page.tsx");

  assert.match(canvas, /attributionLogo: false/);
  assert.match(canvas, /src="\/logo\.png"[\s\S]*?alt=""[\s\S]*?aria-hidden="true"/);
  assert.match(canvas, /pointer-events-none[\s\S]*?data-chart-watermark="ht-labs"/);
  assert.match(terms, /id="chart-attribution"/);
  assert.match(terms, /TradingView Lightweight Charts™/);
  assert.match(terms, /Copyright © 2025 TradingView, Inc\./);
  assert.match(terms, /href="https:\/\/www\.tradingview\.com\/"/);
  assert.match(terms, /Apache License, Version 2\.0/);
});

test("Trading Workspace keeps explicit loading, unavailable, stale, and no-plan states", () => {
  const chart = source("app/components/trade/TradeWorkspaceChart.tsx");
  const intelligence = source("app/components/trade/TradeWorkspaceIntelligence.tsx");
  const plan = source("app/components/trade/TradeWorkspaceAgentPlan.tsx");

  assert.match(chart, /title="Loading verified chart"/);
  assert.match(chart, /title="Verified chart unavailable"/);
  assert.match(intelligence, /describeWorkspaceReadFreshness/);
  assert.match(intelligence, /freshnessTone/);
  assert.match(plan, />No current plan</);
  assert.match(plan, /Paper review locked/);
});

test("Trading Workspace mobile controls use two explicit rows without overlapping the range control", () => {
  const chart = source("app/components/trade/TradeWorkspaceChart.tsx");
  const css = source("app/globals.css");

  assert.match(chart, /ht-workspace-chart-toolbar/);
  assert.match(chart, /ht-workspace-timeframes/);
  assert.match(chart, /ht-workspace-modes/);
  assert.match(css, /\.ht-workspace-chart-toolbar \{[\s\S]*?grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 0\.85fr\)/);
  assert.match(css, /\.ht-workspace-range \{ grid-column: 1; grid-row: 2;/);
  assert.match(css, /\.ht-workspace-latest \{ grid-column: 2; grid-row: 2; width: 100%;/);
});

test("Workspace lists do not nest a complementary landmark inside the labelled region", () => {
  const lists = source("app/components/trade/TradeWorkspaceLists.tsx");

  assert.doesNotMatch(lists, /<aside/);
  assert.match(lists, /<div className="ht-workspace-lists space-y-5">/);
});

test("the desktop Workspace header cannot occlude the first ticker row", () => {
  const css = source("app/globals.css");

  assert.match(
    css,
    /\.ht-trade-workspace__frame\s*\{[^}]*overflow:\s*clip;/,
    "the frame must clip paint without becoming the sticky header's scroll container",
  );
  assert.doesNotMatch(
    css,
    /\.ht-trade-workspace__frame\s*\{[^}]*overflow:\s*hidden;/,
    "overflow hidden offsets the nested sticky header and clips the first rail item",
  );
});
