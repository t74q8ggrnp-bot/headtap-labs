import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const DESKTOP_NAV_FILES = [
  "app/HomeClient.tsx",
  "app/scanner/page.tsx",
  "app/signals/page.tsx",
  "app/components/paper/PaperTradingDashboard.tsx",
  "app/components/agent/HtAgentDashboard.tsx",
];

test("desktop navigation exposes the Trading Workspace entry", () => {
  for (const file of DESKTOP_NAV_FILES) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /href="\/trade"/);
    assert.match(source, />\s*Workspace\s*</);
  }
});

test("mobile navigation exposes and activates the Trading Workspace", () => {
  const source = readFileSync(
    new URL("../app/components/MobileAppNavigation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\{ tab: "workspace", label: "Trade", href: "\/trade" \}/);
  assert.match(source, /pathname === "\/trade" \|\| pathname\.startsWith\("\/trade\/"\)/);
  assert.match(source, /isTradeWorkspace \? "workspace"/);
  assert.match(source, /if \(tab === "workspace"\)/);
  assert.match(source, /tab !== "workspace"/);
});

test("the Trading Workspace entry opens a useful default instrument", () => {
  const source = readFileSync(new URL("../app/trade/page.tsx", import.meta.url), "utf8");

  assert.match(source, /redirect\("\/trade\/SPY"\)/);
});
