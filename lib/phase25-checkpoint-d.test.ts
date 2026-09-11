import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("QA retains ten diagnostics, including all nine same-origin API requests, and awaits every check", () => {
  const qa = source("app/qa/page.tsx");
  const checksBody = qa.slice(qa.indexOf("const checks = ["), qa.indexOf("await Promise.all(checks.map"));

  assert.deepEqual(
    [...checksBody.matchAll(/\/\/ (\d+)\./g)].map((match) => Number(match[1])),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.match(checksBody, /fetch\("\/api\/system-health", \{ cache: "no-store" \}\)/);
  assert.match(qa, /await Promise\.all\(checks\.map\(c => c\(\)\)\)/);
});

test("trade chart controls update one mounted chart engine locally", () => {
  const chart = source("app/components/market/MarketChartCanvas.tsx");
  const workspaceChart = source("app/components/trade/TradeWorkspaceChart.tsx");
  const chartInvocationStart = workspaceChart.lastIndexOf("<MarketChartCanvas");
  const chartInvocation = workspaceChart.slice(
    chartInvocationStart,
    workspaceChart.indexOf("/>", chartInvocationStart) + 2,
  );

  assert.match(chart, /persistent identity/);
  assert.match(chart, /dataset\.chartInitializationCount/);
  assert.match(chart, /const candleSeries = chart\.addSeries\(CandlestickSeries/);
  assert.match(chart, /const graphSeries = chart\.addSeries\(AreaSeries/);
  assert.match(chart, /visible: mode === "graph"/);
  assert.match(chart, /visible: mode === "candles"/);
  assert.match(chart, /applyOptions\(\{ visible: showVwap \}\)/);
  assert.match(chart, /applyOptions\(\{ visible: showVolume \}\)/);
  assert.match(workspaceChart, /data-chart-provider-requests-on-switch="0"/);
  assert.match(workspaceChart, /layerHost=\{EMPTY_CHART_LAYER_HOST\}/);
  assert.match(workspaceChart, /preserveEngineOnLocalControls/);
  assert.doesNotMatch(chartInvocation, /\skey=/);
  assert.doesNotMatch(workspaceChart, /onTimeframeChange[\s\S]*?fetch\(/);
});

test("the reference workspace uses shared visual and accessible state primitives", () => {
  const workspace = source("app/components/trade/TradeWorkspace.tsx");
  const chart = source("app/components/trade/TradeWorkspaceChart.tsx");
  const plan = source("app/components/trade/TradeWorkspaceAgentPlan.tsx");
  const primitives = source("app/components/ui/ApplicationPrimitives.tsx");
  const css = source("app/globals.css");

  assert.match(workspace, /ht-application-shell ht-trade-workspace/);
  assert.match(workspace, /ht-trade-workspace__frame/);
  assert.match(chart, /ht-workspace-panel/);
  assert.match(chart, /<StatusState/);
  assert.match(plan, /<AccessibleDialogSheet/);
  assert.match(plan, /presentation="sheet"/);
  assert.match(plan, /className="ht-agent-plan-sheet md:hidden"/);
  assert.match(primitives, /className=\{classes\("ht-dialog-sheet", className\)\}/);
  assert.match(css, /Phase 2\.5B Checkpoint 1: flat terminal reference styling/);
  assert.match(css, /\.ht-workspace-segment\[aria-pressed="true"\]/);
  assert.match(css, /\.ht-agent-plan-sheet\[data-presentation="sheet"\]/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("ChartLayerHost and semantic drawing seams remain present", () => {
  const chart = source("app/components/market/MarketChartCanvas.tsx");

  assert.match(chart, /export function ChartLayerHost/);
  assert.match(chart, /data-chart-native-object-layer="true"/);
  assert.match(chart, /data-chart-layer-authority=\{authority\}/);
  assert.match(chart, /createChartObjectWriter/);
  assert.match(chart, /data-chart-object-zone/);
  assert.match(chart, /createSeriesMarkers/);
});
