import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Checkpoint F keeps the accepted request and polling contracts intact", () => {
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");
  const agent = source("app/components/agent/HtAgentDashboard.tsx");
  const qa = source("app/qa/page.tsx");
  const validation = source("app/components/validation/MarketValidationCockpit.tsx");
  const bot = source("app/trading-bot/page.tsx");

  assert.match(paper, /fetch\(path/);
  assert.match(paper, /setInterval\(\(\) => void refresh\(true\), 20_000\)/);
  assert.equal(agent.match(/fetch\("\/api\/ht-agent"/g)?.length, 1);
  assert.match(agent, /setInterval\(\(\) => void request\(\).*20_000\)/);
  assert.equal(qa.match(/fetch\("\/api\//g)?.length, 9);
  assert.match(qa, /setInterval\(runChecks, 30000\)/);
  assert.equal(validation.match(/fetch\("\/api\//g)?.length, 2);
  assert.match(validation, /5 \* 60_000/);
  assert.equal(bot.match(/fetch\("\/api\/bot-trades\?limit=100"/g)?.length, 1);
  assert.match(bot, /setInterval\(load, 30000\)/);
});

test("remaining surfaces declare customer, account, and operator presentation roles", () => {
  for (const path of [
    "app/components/agent/HtAgentDashboard.tsx",
    "app/qa/page.tsx",
    "app/components/validation/MarketValidationCockpit.tsx",
    "app/trading-bot/page.tsx",
  ]) {
    assert.match(source(path), /ht-operator-route/);
    assert.match(source(path), /data-route-audience="operator"/);
  }

  assert.match(source("app/components/paper/PaperTradingDashboard.tsx"), /ht-customer-route/);
  assert.match(source("app/components/account/AccountSettings.tsx"), /ht-account-route/);
  assert.match(source("app/components/legal/LegalDocument.tsx"), /ht-legal-route/);
  assert.match(source("app/components/ResponsiveApplicationShell.tsx"), /data-route-audience=/);
});

test("operator records and supporting documents expose mature semantics and states", () => {
  const qa = source("app/qa/page.tsx");
  const validation = source("app/components/validation/MarketValidationCockpit.tsx");
  const bot = source("app/trading-bot/page.tsx");
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");

  assert.match(qa, /<PanelHeader/);
  assert.match(qa, /aria-pressed=\{autoRefresh\}/);
  assert.match(qa, /role="listitem"/);
  assert.match(qa, /<dl className="space-y-2">/);
  assert.match(validation, /<caption className="sr-only">/);
  assert.match(validation, /role="region" aria-label="Market validation observations"/);
  assert.match(bot, /<StatusState title="Loading paper-bot records"/);
  assert.match(bot, /role="list" aria-label="Paper-bot trades"/);
  assert.match(paper, /aria-label="Paper order ticket"/);
  assert.match(paper, /role=\{instrumentError \? "alert" : "status"\}/);
});

test("native dialog behavior covers modal semantics, Escape, focus restoration, and scroll locking", () => {
  const primitive = source("app/components/ui/ApplicationPrimitives.tsx");
  const css = source("app/globals.css");

  assert.match(primitive, /dialog\.showModal\(\)/);
  assert.match(primitive, /aria-modal="true"/);
  assert.match(primitive, /onCancel=\{\(event\) =>/);
  assert.match(primitive, /onOpenChange\(false\)/);
  assert.match(primitive, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(css, /html:has\(\.ht-dialog-sheet\[open\]\)/);
  assert.match(css, /body:has\(\.ht-dialog-sheet\[open\]\)/);
  assert.match(css, /overflow: hidden/);
});

test("qualification tooling includes all active routes and required acceptance viewports", () => {
  const capture = source("tools/capture-phase25-visual-baselines.mjs");
  assert.match(capture, /name: "mobile-375-short", width: 375, height: 667/);
  assert.match(capture, /name: "desktop-1440", width: 1440, height: 900/);
  for (const route of [
    "/", "/trade/SPY", "/scanner", "/signals", "/news-feed", "/prox", "/paper", "/agent",
    "/qa", "/validation", "/trading-bot", "/account", "/privacy", "/terms", "/support",
  ]) assert.match(capture, new RegExp(`"${route.replaceAll("/", "\\/")}"`));
  assert.doesNotMatch(capture, /paper\/crypto|crypto\/research/);
});
