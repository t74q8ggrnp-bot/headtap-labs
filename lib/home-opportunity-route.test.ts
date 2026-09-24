import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error Node strip-types resolves the TypeScript source directly.
import { homeOpportunityHref, normalizeHomeOpportunityLane } from "./market-workspace-route.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Home opportunity links retain exact ticker and Canonical lane identity", () => {
  assert.equal(homeOpportunityHref("apus", "spot_momentum"), "/?lane=spot_momentum&ticker=APUS");
  assert.equal(homeOpportunityHref("mimi", "before_the_crowd"), "/?lane=before_the_crowd&ticker=MIMI");
  assert.equal(homeOpportunityHref("bad/value", "spot_momentum"), null);
  assert.equal(homeOpportunityHref("SPY", "unknown"), null);
  assert.equal(normalizeHomeOpportunityLane("before_the_crowd"), "before_the_crowd");
  assert.equal(normalizeHomeOpportunityLane("spot_momentum"), "spot_momentum");
  assert.equal(normalizeHomeOpportunityLane("market"), null);
});

test("Home lane selection stays on Home while Market remains explicit and independent", () => {
  const home = source("app/HomeClient.tsx");
  const markets = source("app/components/home/HomeTerminalMarkets.tsx");
  const intelligence = source("app/components/home/HomeSpotMomentumIntelligence.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");

  assert.match(home, /const selectHomeOpportunity = \(opportunity: APIOpportunity, lane: HomeOpportunityLane\)/);
  assert.match(markets, /onSelect\(opportunity, lane\)/);
  assert.match(home, /router\.push\(href, \{ scroll: false \}\)/);
  assert.match(home, /requestedHomeOpportunity\?\.ticker \?\? apiMomentum\?\.ticker \?\? "SPY"/);
  assert.match(home, /requestedHomeOpportunity \?\? apiMomentum/);
  assert.match(markets, /href=\{`\/market\?ticker=/);
  assert.match(intelligence, /opportunity\.strategy === "before_the_crowd" \? "Before the Crowd" : "Spot Momentum"/);
  assert.match(surface, /key=\{`\$\{canonicalOpportunity\.strategy \?\? "spot_momentum"\}:\$\{canonicalOpportunity\.ticker\}`\}/);
  assert.doesNotMatch(home, /fetch\([^)]*home-opportunity/);
});
