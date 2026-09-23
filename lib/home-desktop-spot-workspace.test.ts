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
  assert.equal(workspace.match(/\n\s*<HomeTradePlan/g)?.length, 1);
  assert.ok(workspace.indexOf("ht-desktop-spot-workspace__hero") < workspace.indexOf("ht-desktop-spot-workspace__evidence"));
  assert.ok(workspace.indexOf("ht-desktop-spot-workspace__evidence") < workspace.indexOf("ht-desktop-spot-workspace__contenders"));
  assert.match(css, /grid-template-columns: minmax\(250px, 30%\) minmax\(0, 70%\)/);
  assert.match(workspace, /Risk and R\/R are withheld until verified support/);
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
