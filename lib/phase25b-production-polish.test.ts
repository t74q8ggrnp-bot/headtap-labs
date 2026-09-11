import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("new chart users start with candles and volume while stored layer preferences remain authoritative", () => {
  const preferences = source("app/hooks/useChartLayerPreferences.ts");
  const homeChart = source("app/components/home/HomeReferenceChart.tsx");
  const workspace = source("app/components/trade/TradeWorkspace.tsx");

  assert.match(preferences, /vwap: false,[\s\S]*ema9: false,[\s\S]*ema20: false,[\s\S]*volume: true/);
  assert.match(preferences, /setPreferences\(\{ \.\.\.DEFAULTS, \.\.\.stored \}\)/);
  assert.match(homeChart, /useState<MarketChartMode>\("candles"\)/);
  assert.match(homeChart, /const chartLayers = useChartLayerPreferences\(\)/);
  assert.match(homeChart, /onClick=\{\(\) => chartLayers\.toggle\(layer\)\}/);
  assert.match(workspace, /const chartLayers = useChartLayerPreferences\(\)/);
});

test("current price keeps its axis value without a full-width guide", () => {
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const candleOptions = canvas.match(/const candleSeries =[\s\S]*?\n    \}\);/)?.[0] ?? "";
  const graphOptions = canvas.match(/const graphSeries =[\s\S]*?\n    \}\);/)?.[0] ?? "";

  for (const options of [candleOptions, graphOptions]) {
    assert.match(options, /priceLineVisible: false/);
    assert.match(options, /lastValueVisible: true/);
  }
  assert.doesNotMatch(canvas, /priceLineVisible: true/);
});

test("optional indicators are explicitly identified only when enabled", () => {
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const homeChart = source("app/components/home/HomeReferenceChart.tsx");
  const workspaceChart = source("app/components/trade/TradeWorkspaceChart.tsx");

  for (const title of ["VWAP", "EMA 9", "EMA 20"]) {
    assert.match(canvas, new RegExp(`title: "${title}"`));
  }
  assert.match(canvas, /lastValueVisible: definition\.visible/);
  assert.match(canvas, /lastValueVisible: showVwap/);
  assert.match(homeChart, /ht-chart-layer-key--\$\{layer\}/);
  assert.match(workspaceChart, /ht-chart-layer-key--\$\{indicator\}/);
});

test("chart polish remains presentation-local and preserves one provider hook and chart engine", () => {
  const homeChart = source("app/components/home/HomeReferenceChart.tsx");
  const workspaceChart = source("app/components/trade/TradeWorkspaceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");

  assert.equal(homeChart.match(/useLiveMarketView\(/g)?.length, 1);
  assert.doesNotMatch(homeChart, /fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(workspaceChart, /fetch\(|XMLHttpRequest/);
  assert.match(homeChart, /data-chart-provider-requests-on-switch="0"/);
  assert.match(workspaceChart, /data-chart-provider-requests-on-switch="0"/);
  assert.match(homeChart, /preserveEngineOnLocalControls/);
  assert.match(workspaceChart, /preserveEngineOnLocalControls/);
  assert.match(canvas, /chartInitializationCount/);
});

test("market context and premium chart controls use unclipped restrained geometry", () => {
  const css = source("app/globals.css");

  assert.match(css, /\.htb-tape \{[\s\S]*height: 34px;[\s\S]*min-height: 34px;[\s\S]*line-height: 1\.25;[\s\S]*box-sizing: border-box;/);
  assert.match(css, /\.htb-chart__controls,[\s\S]*\.htb-chart__range-desktop \{[\s\S]*border-radius: 4px;/);
  assert.match(css, /\.htb-score \{[\s\S]*font-size: 2\.25rem;/);
  assert.match(css, /\.htb-intel-section > h3 \{[\s\S]*letter-spacing: 0;[\s\S]*text-transform: none;/);
});
