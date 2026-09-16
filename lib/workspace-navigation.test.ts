import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { resolveMobileActiveTab } from "./checkpoint-a-ui-state.ts";

test("the consolidated desktop navigation exposes the Trading Workspace entry", () => {
  const source = readFileSync(new URL("../lib/application-navigation.ts", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../app/components/ResponsiveApplicationShell.tsx", import.meta.url), "utf8");
  assert.match(source, /shortLabel: "Workspace", href: "\/trade"/);
  assert.match(shell, /primaryRoutes\.map/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
});

test("mobile navigation converges legacy Trading Workspace routes on Market", () => {
  const source = readFileSync(
    new URL("../app/components/MobileAppNavigation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\{ tab: "market", label: "Market", href: "\/market" \}/);
  assert.equal(resolveMobileActiveTab("/trade"), "market");
  assert.equal(resolveMobileActiveTab("/trade/SPY"), "market");
  assert.match(source, /resolveMobileActiveTab\(pathname\)/);
  assert.doesNotMatch(source, /tab: "workspace"/);
  assert.match(source, /grid grid-cols-5/);
});

test("the legacy Trading Workspace entry opens the default instrument in Market", () => {
  const source = readFileSync(new URL("../app/trade/page.tsx", import.meta.url), "utf8");

  assert.match(source, /redirect\("\/market\?ticker=SPY"\)/);
});
