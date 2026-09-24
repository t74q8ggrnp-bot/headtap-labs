import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node's strip-types test runner requires the source extension.
import { DEFAULT_TERMINAL_WORKSPACE_PREFERENCES, parseTerminalWorkspacePreferences } from "./terminal-workspace-preferences.ts";
// @ts-expect-error Node's strip-types test runner requires the source extension.
import { parseTerminalPriceAlerts, priceAlertTriggered } from "./terminal-price-alerts.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("terminal continuity accepts only valid ticker and local chart controls", () => {
  assert.deepEqual(parseTerminalWorkspacePreferences({
    symbol: "aapl",
    timeframe: "5m",
    visibleRange: "90m",
    priceLayers: { candles: true, line: true },
  }), {
    symbol: "AAPL",
    timeframe: "5m",
    visibleRange: "90m",
    priceLayers: { candles: true, line: true },
  });
  assert.deepEqual(parseTerminalWorkspacePreferences({
    symbol: "bad/value",
    timeframe: "30s",
    visibleRange: "forever",
    priceLayers: { candles: false, line: false },
  }), DEFAULT_TERMINAL_WORKSPACE_PREFERENCES);
});

test("guided price alerts are validated and evaluate deterministically", () => {
  const [alert] = parseTerminalPriceAlerts([{
    id: "alert-1",
    symbol: "spy",
    price: 500,
    direction: "at_or_above",
    source: "drawing",
    label: "Chart level",
    createdAt: "2026-09-24T12:00:00.000Z",
    triggeredAt: null,
  }]);
  assert.equal(alert.symbol, "SPY");
  assert.equal(priceAlertTriggered(alert, 499.99), false);
  assert.equal(priceAlertTriggered(alert, 500), true);
  assert.equal(parseTerminalPriceAlerts([{ symbol: "BAD/", price: -1 }]).length, 0);
});

test("Home, Market, and Paper share the chart, drawings, viewport, and zero-request controls", () => {
  const chart = source("app/components/home/HomeReferenceChart.tsx");
  const canvas = source("app/components/market/MarketChartCanvas.tsx");
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");
  const validation = source("app/api/market-validation/route.ts");

  assert.match(chart, /useTerminalWorkspacePreferences/);
  assert.match(chart, /workspacePreferences\.hydrated/);
  assert.match(chart, /new ResizeObserver\(apply\)/);
  assert.match(chart, /terminalChartHeight/);
  assert.match(chart, /useTerminalPriceAlerts/);
  assert.match(chart, /viewportKey={`ht-terminal:/);
  assert.match(chart, /data-chart-provider-requests-on-switch="0"/);
  assert.match(canvas, /retainedTerminalViewports/);
  assert.match(paper, /<HomeReferenceChart symbol=\{loadedInstrument\.symbol\} embedded \/>/);
  assert.doesNotMatch(paper, /<HeroPriceChart/);
  assert.match(validation, /providerRequestsAdded: 0/);
});

test("Agent calibration remains optional, read-only, and non-authoritative", () => {
  const server = source("lib/ht-agent/server.ts");
  const card = source("app/components/agent/HtTradePlanCard.tsx");

  assert.match(server, /authority: "research_only"/);
  assert.match(server, /It does not change live targets, scoring, risk, or Paper authority/);
  assert.match(card, /Same-lane 60m T1 reach/);
  assert.match(card, /Evidence \{evidenceTime\}/);
  assert.match(card, /Invalidation \{money\(plan\.invalidation\)\}/);
});
