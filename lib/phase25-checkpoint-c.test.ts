import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { APPLICATION_ROUTES, resolveApplicationRoute } from "./application-navigation.ts";
// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { resolveMobileActiveTab } from "./checkpoint-a-ui-state.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const EXPECTED_ROUTES = new Map([
  ["/", "home"],
  ["/trade/SPY", "workspace"],
  ["/scanner", "scanner"],
  ["/signals", "signals"],
  ["/news-feed", "news"],
  ["/prox", "prox"],
  ["/paper", "paper"],
  ["/agent", "agent"],
  ["/qa", "qa"],
  ["/validation", "validation"],
  ["/trading-bot", "trading-bot"],
  ["/account", "account"],
  ["/privacy", "privacy"],
  ["/terms", "terms"],
  ["/support", "support"],
]);

test("the shared application registry identifies every supported route exactly", () => {
  assert.equal(APPLICATION_ROUTES.length, EXPECTED_ROUTES.size);
  for (const [pathname, routeId] of EXPECTED_ROUTES) {
    assert.equal(resolveApplicationRoute(pathname)?.id, routeId, pathname);
  }
  assert.equal(resolveApplicationRoute("/trade/NVDA?timeframe=5m")?.id, "workspace");
  assert.equal(resolveApplicationRoute("/paper/crypto"), null, "shelved crypto stays outside active application navigation");
  assert.equal(resolveApplicationRoute("/unknown"), null);
});

test("mobile navigation uses a truthful primary state and exact secondary route sheet", () => {
  assert.equal(resolveMobileActiveTab("/", "watchlist"), "watchlist");
  assert.equal(resolveMobileActiveTab("/trade/SPY", "home"), "workspace");
  assert.equal(resolveMobileActiveTab("/scanner", "home"), "scanner");
  assert.equal(resolveMobileActiveTab("/paper", "home"), "paper");
  for (const pathname of ["/signals", "/news-feed", "/prox", "/agent", "/qa", "/validation", "/trading-bot"]) {
    assert.equal(resolveMobileActiveTab(pathname, "home"), "more", pathname);
  }
  for (const pathname of ["/account", "/privacy", "/terms", "/support"]) {
    assert.equal(resolveMobileActiveTab(pathname, "home"), "profile", pathname);
  }

  const mobile = source("app/components/MobileAppNavigation.tsx");
  assert.match(mobile, /aria-haspopup="dialog"/);
  assert.match(mobile, /moreRoutes\.map/);
  assert.match(mobile, /grid grid-cols-5/);
  assert.match(mobile, /aria-current=\{active \? "page" : undefined\}/);
});

test("the root shell shares desktop route identity without adding data requests", () => {
  const layout = source("app/layout.tsx");
  const shell = source("app/components/ResponsiveApplicationShell.tsx");
  assert.match(layout, /<ResponsiveApplicationShell>/);
  assert.match(shell, /primaryRoutes\.map/);
  assert.match(shell, /aria-label="Primary application navigation"/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(shell, /Skip to page content/);
  assert.doesNotMatch(shell, /fetch\(|XMLHttpRequest|\/api\//);
  assert.doesNotMatch(mobileNavigationSource(), /fetch\(|XMLHttpRequest|\/api\//);
});

test("shell focus and safe-area rules cover desktop and required mobile edges", () => {
  const css = source("app/globals.css");
  assert.match(css, /\.ht-responsive-shell :where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible/);
  assert.match(css, /padding-left: env\(safe-area-inset-left, 0px\)/);
  assert.match(css, /padding-right: env\(safe-area-inset-right, 0px\)/);
  assert.match(css, /padding-bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /\.ht-skip-link:focus/);
});

test("authentication and failure surfaces are announced and do not expose raw backend messages", () => {
  const paper = source("app/components/paper/PaperTradingDashboard.tsx");
  const agent = source("app/components/agent/HtAgentDashboard.tsx");
  const account = source("app/components/account/AccountSettings.tsx");
  const validation = source("app/components/validation/MarketValidationCockpit.tsx");
  const home = source("app/HomeClient.tsx");

  assert.doesNotMatch(paper, /min-h-\[650px\] animate-pulse bg-white\/\[0\.015\]/);
  assert.match(paper, /Checking your paper session/);
  assert.match(paper, /secure paper session could not be verified/);
  assert.match(agent, /secure session could not be verified/);
  assert.match(account, /<StatusState/);
  assert.match(validation, /Loading validation observations/);
  assert.doesNotMatch(validation, /validation\.error \?\?/);
  assert.doesNotMatch(account, /setMessage\(error\.message\)/);
  assert.doesNotMatch(account, /setMessage\(result\.error/);
  assert.doesNotMatch(home, /setAuthMessage\(error\.message\)/);
  assert.doesNotMatch(source("app/components/trade/TradeWorkspace.tsx"), /throw new Error\(payload\.error/);
  assert.doesNotMatch(source("app/components/trade/TickerSearchCombobox.tsx"), /throw new Error\(payload\.error/);
  assert.match(source("app/trade/[ticker]/loading.tsx"), /aria-label="Loading Trading Workspace"/);
  assert.match(source("app/error.tsx"), /This page is temporarily unavailable/);
  assert.match(source("app/not-found.tsx"), /Page not found/);
});

function mobileNavigationSource() {
  return source("app/components/MobileAppNavigation.tsx");
}
