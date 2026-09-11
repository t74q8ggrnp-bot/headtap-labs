import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { resolveMobileActiveTab } from "./checkpoint-a-ui-state.ts";

test("the consolidated desktop navigation exposes the Trading Workspace entry", () => {
  const source = readFileSync(new URL("../lib/application-navigation.ts", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../app/components/ResponsiveApplicationShell.tsx", import.meta.url), "utf8");
  assert.match(source, /shortLabel: "Workspace", href: "\/trade"/);
  assert.match(shell, /APPLICATION_ROUTES\.map/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
});

test("mobile navigation exposes and activates the Trading Workspace", () => {
  const source = readFileSync(
    new URL("../app/components/MobileAppNavigation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\{ tab: "workspace", label: "Trade", href: "\/trade" \}/);
  assert.equal(resolveMobileActiveTab("/trade", "home"), "workspace");
  assert.equal(resolveMobileActiveTab("/trade/SPY", "home"), "workspace");
  assert.match(source, /resolveMobileActiveTab\(pathname, homeTab\)/);
  assert.match(source, /if \(tab === "workspace"\)/);
  assert.match(source, /tab === "more"/);
  assert.match(source, /type MobileHomeTab/);
});

test("the Trading Workspace entry opens a useful default instrument", () => {
  const source = readFileSync(new URL("../app/trade/page.tsx", import.meta.url), "utf8");

  assert.match(source, /redirect\("\/trade\/SPY"\)/);
});
