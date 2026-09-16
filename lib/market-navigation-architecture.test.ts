import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the product opens on Scanner and preserves explicit root query destinations in Market", () => {
  const root = source("app/page.tsx");
  const manifest = source("app/manifest.ts");

  assert.match(root, /redirect\("\/scanner"\)/);
  assert.match(root, /redirect\(`\/market\?\$\{preserved\.toString\(\)\}`\)/);
  assert.match(manifest, /start_url: "\/scanner"/);
});

test("the approved primary navigation is Scanner, Market, Paper, Agent X, and Profile", () => {
  const mobile = source("app/components/MobileAppNavigation.tsx");
  const labels = ["Scanner", "Market", "Paper", "Agent X", "Profile"];
  const positions = labels.map((label) => mobile.indexOf(`label: "${label}"`));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  assert.doesNotMatch(mobile, /label: "Trade"|label: "Work"/);
});

test("Scanner opens the selected ticker in Market while legacy Workspace links remain registered", () => {
  const scanner = source("app/scanner/page.tsx");
  const shell = source("app/components/ResponsiveApplicationShell.tsx");
  const routes = source("lib/application-navigation.ts");

  assert.match(scanner, /href=\{`\/market\?ticker=\$\{encodeURIComponent\(o\.ticker\)\}`\}/);
  assert.match(scanner, /Open Market →/);
  assert.doesNotMatch(scanner, /href=\{`\/trade\/\$\{encodeURIComponent\(o\.ticker\)\}`\}/);
  assert.match(shell, /router\.push\(`\/market\?ticker=\$\{encodeURIComponent\(symbol\)\}`\)/);
  assert.match(routes, /id: "workspace"[\s\S]*href: "\/trade"/);
});

test("Market retains both Canonical discovery lanes and hands execution review to Paper", () => {
  const market = source("app/market/page.tsx");
  const surface = source("app/components/home/HomeReferenceSurface.tsx");

  assert.match(market, /getRollingCanonicalDecisionFrame\("momentum"\)/);
  assert.match(market, /getRollingCanonicalDecisionFrame\("before_crowd"\)/);
  assert.match(market, /initialMomentumPayload=\{initialMomentumPayload\}/);
  assert.match(market, /initialBeforeCrowdPayload=\{initialBeforeCrowdPayload\}/);
  assert.match(surface, /href=\{`\/paper\?symbol=\$\{encodeURIComponent\(opportunity\.ticker\)\}`\}/);
});
