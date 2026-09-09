import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../../app/api/ht-agent/plans/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../app/api/ht-agent/outcomes/route.ts", import.meta.url), "utf8");
const chart = readFileSync(new URL("../../app/components/market/MarketChartCanvas.tsx", import.meta.url), "utf8");
const workspaceChart = readFileSync(new URL("../../app/components/trade/TradeWorkspaceChart.tsx", import.meta.url), "utf8");
const planServer = readFileSync(new URL("./visual-plan-server.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: Array<{ path: string; schedule: string }> };

test("native plan reads are authenticated, no-store, and do not call a market provider", () => {
  assert.match(api, /authenticatePaperRequest/);
  assert.match(api, /private, no-store/);
  assert.match(api, /no_current_plan/);
  assert.doesNotMatch(api, /massiveStocksUrl|fetchMassive|getPaperTradingQuote|ht_stock_display_frames/);
});

test("plan generation checks its rollout gate before producing audit side effects", () => {
  assert.match(planServer, /select\("visual_plan_mode,visual_plan_symbol_scope"\)/);
  assert.ok(planServer.indexOf('select("visual_plan_mode,visual_plan_symbol_scope")') < planServer.indexOf("buildAgentXVisualPlan({"));
});

test("visual lifecycle reuses the existing one-minute outcome worker and groups provider symbols", () => {
  assert.match(worker, /ht_agent_claim_visual_plan_batch/);
  assert.match(worker, /new Set\(visualClaims\.map/);
  assert.match(worker, /visualPlanProviderRequests/);
  assert.deepEqual(
    vercel.crons.filter((job) => job.path === "/api/ht-agent/outcomes"),
    [{ path: "/api/ht-agent/outcomes", schedule: "* * * * *" }],
  );
});

test("ChartLayerHost owns semantic lines, zones and lifecycle markers", () => {
  assert.match(chart, /data-chart-native-object-layer/);
  assert.match(chart, /createPriceLine/);
  assert.match(chart, /data-chart-object-zone/);
  assert.match(chart, /createSeriesMarkers/);
});

test("Agent and ProX layer controls remain hidden until the visible rollout gate", () => {
  assert.match(workspaceChart, /intelligenceLayersEnabled \? \["agent", "prox"\]/);
});
