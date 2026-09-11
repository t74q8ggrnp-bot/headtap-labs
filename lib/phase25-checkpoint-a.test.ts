import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { matureReadOnlyFailure, resolveMobileActiveTab, resolvePaperAccountStatus, resolveQaHealth } from "./checkpoint-a-ui-state.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("News controls wrap without forcing horizontal mobile overflow", () => {
  const news = source("app/news-feed/page.tsx");
  assert.match(news, /flex flex-col gap-4 sm:flex-row/);
  assert.match(news, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(news, /className="min-w-0 w-full rounded-xl/);
  assert.doesNotMatch(news, /placeholder:text-zinc-600 focus:border-orange-500\/50 w-40/);
});

test("mobile navigation does not mark Home active on unrelated routes", () => {
  assert.equal(resolveMobileActiveTab("/", "convictions"), "convictions");
  assert.equal(resolveMobileActiveTab("/paper", "home"), "paper");
  assert.equal(resolveMobileActiveTab("/scanner", "home"), "scanner");
  assert.equal(resolveMobileActiveTab("/trade/SPY", "home"), "workspace");
  assert.equal(resolveMobileActiveTab("/account", "home"), "profile");
  assert.equal(resolveMobileActiveTab("/news-feed", "home"), "more");
  assert.equal(resolveMobileActiveTab("/qa", "home"), "more");
  assert.equal(resolveMobileActiveTab("/agent", "home"), "more");
});

test("Agent announces authentication resolution instead of returning a blank screen", () => {
  const agent = source("app/components/agent/HtAgentDashboard.tsx");
  assert.match(agent, /role="status"/);
  assert.match(agent, /aria-live="polite"/);
  assert.match(agent, /aria-busy="true"/);
  assert.match(agent, /Checking your paper-only session/);
  assert.doesNotMatch(agent, /if \(!authReady\) return <div/);
});

test("Paper account status cannot be active until auth and account data resolve", () => {
  assert.deepEqual(
    resolvePaperAccountStatus({ authReady: false, signedIn: false, loading: true, dashboardReady: false }),
    { label: "Checking paper session", tone: "pending" },
  );
  assert.deepEqual(
    resolvePaperAccountStatus({ authReady: true, signedIn: false, loading: false, dashboardReady: false }),
    { label: "Sign in required", tone: "neutral" },
  );
  assert.deepEqual(
    resolvePaperAccountStatus({ authReady: true, signedIn: true, loading: false, dashboardReady: false }),
    { label: "Paper account unavailable", tone: "unavailable" },
  );
  assert.deepEqual(
    resolvePaperAccountStatus({ authReady: true, signedIn: true, loading: false, dashboardReady: true }),
    { label: "Paper account active", tone: "active" },
  );
  assert.doesNotMatch(source("app/components/paper/PaperTradingDashboard.tsx"), /Apply migration 0024/);
});

test("QA publishes no score or all-clear label before a complete run", () => {
  assert.deepEqual(resolveQaHealth({
    totalSystems: 10,
    resolvedSystems: 0,
    operational: 0,
    degraded: 0,
    running: false,
    hasCompletedRun: false,
  }), { score: null, label: "Checking systems..." });
  assert.deepEqual(resolveQaHealth({
    totalSystems: 10,
    resolvedSystems: 9,
    operational: 9,
    degraded: 0,
    running: false,
    hasCompletedRun: true,
  }), { score: null, label: "Checking systems..." });
  assert.deepEqual(resolveQaHealth({
    totalSystems: 10,
    resolvedSystems: 10,
    operational: 10,
    degraded: 0,
    running: false,
    hasCompletedRun: true,
  }), { score: 100, label: "All Systems Go" });
});

test("read-only operator routes map raw backend failures to mature states", () => {
  assert.match(matureReadOnlyFailure("trading-bot", 401), /authorized operator session/);
  assert.match(matureReadOnlyFailure("trading-bot", 500), /temporarily unavailable/);
  assert.match(matureReadOnlyFailure("prox", 403), /authorized HT Labs operators/);
  assert.match(matureReadOnlyFailure("prox"), /Canonical rankings are unaffected/);

  const tradingBot = source("app/trading-bot/page.tsx");
  const prox = source("app/prox/page.tsx");
  const agentPlan = source("app/components/agent/HomeTradePlan.tsx");
  const visualPlan = source("app/hooks/useAgentVisualPlan.ts");
  const qa = source("app/qa/page.tsx");
  assert.doesNotMatch(tradingBot, /setError\(data\?\.error/);
  assert.doesNotMatch(prox, /setError\(data\?\.error/);
  assert.doesNotMatch(agentPlan, /throw new Error\(body\.error/);
  assert.doesNotMatch(visualPlan, /throw new Error\(body\.error/);
  assert.doesNotMatch(qa, /data\.error \|\| "No analysis returned"/);
  assert.match(tradingBot, /role="alert"/);
  assert.match(prox, /role="alert"/);
  assert.match(prox, /error \? "Unavailable" : "Live"/);
});
