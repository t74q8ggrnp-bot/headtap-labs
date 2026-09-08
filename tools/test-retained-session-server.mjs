/** Exercise the real rolling-frame wrapper offline, including cached payloads.
 * No network, credentials, provider calls, or database writes are available. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../lib/canonical-decision-frame-policy.ts";
import * as sessions from "../lib/stock-market-session.ts";

const source = await readFile(new URL("../lib/canonical-decision-frame.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const CLOSED = "2026-09-03T00:22:00Z";
function frame() {
  const record = { ticker: "TEST", sourceRunId: "run", scanSession: "after_hours", price: 0.72,
    opportunityScore: 91, decisionQuoteAsOf: "2026-09-02T23:58:00Z", freshnessLabel: "Live Scan", displayQuoteLive: true,
    proxIntelligence: { pulse: { marketAsOf: "2026-09-02T23:58:00Z" } }, scoreContext: { proxMarketDataAligned: true } };
  return { timestamp: "2026-09-03T00:21:50Z", sourceRun: { id: "run", completedAt: "2026-09-02T23:58:18Z" },
    opportunities: [record], momentumContenders: [], momentumRadar: [], engineVersion: "unchanged-canonical" };
}
function harness(cached, rebuilt = cached, at = CLOSED) {
  const now = new Date(at);
  const trace = { builds: 0 };
  const exports = {};
  class FrozenDate extends Date { constructor(value = at) { super(value); } static now() { return now.getTime(); } }
  const bindings = {
    "server-only": {}, "next/cache": { unstable_cache: () => async () => cached },
    "@/lib/canonical-opportunity-feed": { buildCanonicalOpportunityFeed: async () => { trace.builds++; return rebuilt; } },
    "@/lib/canonical-decision-frame-policy": { ...policy,
      getDecisionFrameFreshness: (value, clock = now) => policy.getDecisionFrameFreshness(value, clock),
      getDecisionFrameMarketTimingFreshness: (value, clock = now) => policy.getDecisionFrameMarketTimingFreshness(value, clock),
      getRetainedSessionIntegrity: (value, clock = now) => policy.getRetainedSessionIntegrity(value, clock),
    },
    "@/lib/stock-market-session": sessions,
  };
  vm.runInNewContext(compiled, { exports, Date: FrozenDate,
    require: name => { if (!(name in bindings)) throw Error(`Unexpected dependency: ${name}`); return bindings[name]; },
  }, { timeout: 1000 });
  return { api: exports, trace };
}

test("both stock routes retain cached prices/scores, downgrade labels and expose no live expiry", async () => {
  const cached = frame();
  const original = JSON.stringify(cached);
  const { api, trace } = harness(cached);
  for (const lane of ["momentum", "before_crowd"]) {
    const result = await api.getRollingCanonicalDecisionFrame(lane);
    assert.equal(result.decisionFrame.status, "last_session");
    assert.equal(result.decisionFrame.fresh, false);
    assert.equal(result.decisionFrame.freshUntil, null);
    assert.equal(result.decisionFrame.retainedSession.valid, true);
    assert.equal(result.opportunities[0].displayQuoteLive, false);
    assert.equal(result.opportunities[0].freshnessLabel, "Last session · 2026-09-02");
    assert.equal(result.opportunities[0].price, 0.72);
    assert.equal(result.opportunities[0].opportunityScore, 91);
  }
  assert.equal(trace.builds, 0);
  assert.equal(JSON.stringify(cached), original);
});

test("reopening cannot use a retained frame as a fresh decision", async () => {
  const cached = frame();
  const { api, trace } = harness(cached, cached, "2026-09-03T08:00:00Z");
  const result = await api.getRollingCanonicalDecisionFrame("momentum");
  assert.equal(result.decisionFrame.status, "stale");
  assert.equal(result.decisionFrame.fresh, false);
  assert.equal(result.decisionFrame.staleCacheBypassed, true);
  assert.equal(trace.builds, 1);
});

test("new processing timestamps never rehabilitate expired active-session provider data", async () => {
  const value = frame(); value.timestamp = "2026-09-03T08:10:00Z";
  const { api } = harness(value, value, value.timestamp);
  const result = await api.getRollingCanonicalDecisionFrame("momentum");
  assert.equal(result.decisionFrame.ageSeconds, 0);
  assert.equal(result.decisionFrame.fresh, false);
  assert.equal(result.decisionFrame.freshUntil, null);
});

test("a genuinely fresh premarket rebuild restores the unchanged active expiry", async () => {
  const rebuilt = frame();
  rebuilt.timestamp = "2026-09-03T08:03:00Z";
  rebuilt.opportunities[0].scanSession = "pre_market";
  rebuilt.opportunities[0].decisionQuoteAsOf = "2026-09-03T08:02:00Z";
  rebuilt.opportunities[0].proxIntelligence.pulse.marketAsOf = "2026-09-03T08:02:00Z";
  const { api, trace } = harness(frame(), rebuilt, rebuilt.timestamp);
  const result = await api.getRollingCanonicalDecisionFrame("momentum");
  assert.equal(result.decisionFrame.status, "live");
  assert.equal(result.decisionFrame.fresh, true);
  assert.equal(result.decisionFrame.freshUntil, "2026-09-03T08:04:30.000Z");
  assert.equal(result.opportunities[0], rebuilt.opportunities[0]);
  assert.equal(trace.builds, 1);
});

test("missing source and decision timestamps remain unavailable, not generated", async () => {
  const { api } = harness({ opportunities: [], engineVersion: "unchanged-canonical" });
  const result = await api.getRollingCanonicalDecisionFrame("before_crowd");
  assert.equal(result.decisionFrame.decisionAsOf, null);
  assert.equal(result.decisionFrame.ageSeconds, null);
  assert.equal(result.decisionFrame.status, "unavailable");
  assert.equal(result.decisionFrame.fresh, false);
  assert.equal(result.decisionFrame.retainedSession.valid, false);
});
