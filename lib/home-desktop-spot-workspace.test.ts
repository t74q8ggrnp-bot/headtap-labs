import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop Home reuses the Market terminal shell with a Canonical Spot Momentum rail", () => {
  const home = source("app/HomeClient.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");
  const intelligence = source("app/components/home/HomeSpotMomentumIntelligence.tsx");
  const css = source("app/globals.css");

  assert.match(home, /homeComposition === "desktop"/);
  assert.match(home, /terminalSurface\("spot-momentum"\)/);
  assert.match(surface, /experience === "spot-momentum"/);
  assert.equal(surface.match(/<HomeReferenceChart/g)?.length, 1);
  assert.match(intelligence, /HT Agent X targets/);
  assert.match(intelligence, /Pro X evidence/);
  assert.match(intelligence, /Risk and R\/R are withheld until verified support/);
  assert.match(css, /data-application-route="discovery"[^\n]*> \.ht-desktop-global-header/);
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
  const intelligence = source("app/components/home/HomeSpotMomentumIntelligence.tsx");
  const route = source("app/api/market-context/route.ts");

  assert.doesNotMatch(home, /ht-home-market-context/);
  assert.match(intelligence, /Broad market:/);
  assert.match(route, /tickers", "SPY,QQQ,IWM,VIXY"/);
  assert.match(route, /providerRequests: 1/);
  assert.match(route, /revalidate: 15/);
  assert.match(route, /s-maxage=15/);
});
