import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop Home prioritizes a single large chart and moves contenders below Pro X", () => {
  const home = source("app/HomeClient.tsx");
  const workspace = source("app/components/opportunity/DesktopSpotMomentumWorkspace.tsx");
  const css = source("app/globals.css");

  assert.equal(home.match(/<DesktopSpotMomentumWorkspace/g)?.length, 1);
  assert.equal(workspace.match(/<HeroPriceChart/g)?.length, 1);
  assert.match(workspace, /fillAvailableHeight/);
  assert.equal(workspace.match(/\n\s*<HomeTradePlan/g)?.length, 1);
  assert.ok(workspace.indexOf("ht-desktop-spot-workspace__hero") < workspace.indexOf("ht-desktop-spot-workspace__evidence"));
  assert.ok(workspace.indexOf("ht-desktop-spot-workspace__evidence") < workspace.indexOf("ht-desktop-spot-workspace__contenders"));
  assert.match(css, /grid-template-columns: minmax\(250px, 30%\) minmax\(0, 70%\)/);
  assert.match(css, /height: calc\(100dvh - 58px\)/);
  assert.match(workspace, /Risk and R\/R are withheld until verified support/);
});

test("desktop Home relies on the global shell without a duplicate dashboard header", () => {
  const home = source("app/HomeClient.tsx");

  assert.doesNotMatch(home, />\s*Dashboard\s*</);
  assert.doesNotMatch(home, />\s*Top Convictions\s*</);
  assert.doesNotMatch(home, /className="ht-home-conviction mx-auto max-w/);
});

test("desktop first paint reserves the final workspace geometry", () => {
  const home = source("app/HomeClient.tsx");
  const stateCard = source("app/components/OpportunityStateCard.tsx");
  const css = source("app/globals.css");

  assert.match(home, /<OpportunityStateCard loading workspace \/>/);
  assert.match(stateCard, /ht-home-workspace-loading/);
  assert.match(stateCard, /aria-busy="true"/);
  assert.match(stateCard, /src="\/app-icon\.png"/);
  assert.match(stateCard, /Syncing verified market intelligence/);
  assert.match(css, /\.ht-home-workspace-loading__card/);
  assert.match(css, /height: calc\(100dvh - 58px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("market context is compact, provider-timestamped, and shares one 15-second snapshot", () => {
  const home = source("app/HomeClient.tsx");
  const workspace = source("app/components/opportunity/DesktopSpotMomentumWorkspace.tsx");
  const route = source("app/api/market-context/route.ts");

  assert.doesNotMatch(home, /ht-home-market-context/);
  assert.match(workspace, /Broad market:/);
  assert.match(workspace, /Provider snapshot/);
  assert.match(route, /tickers", "SPY,QQQ,IWM,VIXY"/);
  assert.match(route, /providerRequests: 1/);
  assert.match(route, /revalidate: 15/);
  assert.match(route, /s-maxage=15/);
});
