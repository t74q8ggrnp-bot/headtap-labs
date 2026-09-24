import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Spot Momentum receives the HT chart treatment without restoring a current-price guide", () => {
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const css = source("app/globals.css");

  assert.match(canvas, /CrosshairMode\.Normal/);
  assert.match(canvas, /rgba\(249,115,22,0\.42\)/);
  assert.match(canvas, /data-chart-presentation=\{candlePresentation\}/);
  assert.match(canvas, /priceLineVisible: false/);
  assert.match(canvas, /candlePresentation === "refined" \? 5 : 2/);
  assert.match(css, /data-chart-presentation="refined"/);
  assert.match(css, /drop-shadow\(0 0 7px rgba\(249, 115, 22, 0\.18\)\)/);
});

test("drawing workspace supports touch, keyboard, whole-object movement, and non-destructive visibility", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const drawings = source("app/components/market/MarketChartUserDrawings.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");

  assert.match(chart, /role="toolbar" aria-label="Chart drawing tools"/);
  assert.match(chart, /Hide saved drawings/);
  assert.match(chart, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(chart, /event\.key === "Escape"/);
  assert.match(chart, /onDeleteUserDrawing=\{deleteDrawing\}/);
  assert.match(drawings, /pointIndex: number \| null/);
  assert.match(drawings, /timeDelta = point\.time - drag\.anchor\.time/);
  assert.match(drawings, /priceDelta = point\.price - drag\.anchor\.price/);
  assert.match(drawings, /measurementLabel\(drawing\)/);
  assert.match(drawings, /setPointerCapture/);
  assert.match(canvas, /preserveEngineOnLocalControls/);
  assert.match(chart, /data-chart-provider-requests-on-switch="0"/);
  assert.equal(chart.match(/useLiveMarketView\(/g)?.length, 1);
  assert.doesNotMatch(chart, /fetch\(|XMLHttpRequest/);
});
