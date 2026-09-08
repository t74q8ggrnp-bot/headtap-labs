import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
// @ts-expect-error Node's strip-types runner resolves source extensions.
import { HT_AGENT_FRAME_VERSION, type HtAgentDecisionFrame } from "./contracts.ts";
// @ts-expect-error Node's strip-types runner resolves source extensions.
import { DEFAULT_HT_AGENT_RISK_POLICY, evaluateHtAgentRisk } from "./risk.ts";
// @ts-expect-error Node's strip-types runner resolves source extensions.
import { decideHtAgentAction } from "./decision.ts";

// Exercise the actual server builders and approval branch with provider/DB doubles.
// No network, credentials, accounts, writes or provider credits are used.
const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const names = ["buildFrame", "buildManagedPositionFrame", "resolveHtAgentProposal"];
const extracted = names.map(name => {
  const node = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Server contract changed: missing ${name}`);
  return node.getText(parsed);
}).join("\n");
const compiled = ts.transpileModule(`${extracted}\nObject.assign(exports, { buildFrame, buildManagedPositionFrame });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness(quoteTimestamp: string | null, action = "prepare") {
  const now = new Date("2026-09-03T14:00:30Z");
  const priceTimestamp = "2026-09-03T14:00:25Z";
  const canonical = {
    sourceRunId: "run", decisionTimestamp: priceTimestamp, eligible: true,
    proposedEntry: 10, proposedStop: 9, proposedTarget: 13,
    proposedTargetTwo: 14, entryQuality: 80, extensionRisk: 20,
  };
  const candidate = {
    opportunity: { ticker: "TEST", relativeVolume: 5, catalystScore: 0,
      displayEligibility: { eligible: true }, opportunityScore: 90,
      tradeFramework: { entryQuality: 80, extensionRisk: 20 },
    },
    lane: "before_crowd", sourceRunId: "run", decisionTimestamp: priceTimestamp,
  };
  const prior = { symbol: "TEST", market_facts: {}, canonical_evidence: canonical, catalyst_evidence: { observedAt: null } };
  const profile = { id: "profile", paper_account_id: "paper", kill_switch: false, status: "active", mode: "approval_paper" };
  const calls = { price: 0, nbbo: 0, writes: 0 };
  const context = { user: { id: "user" }, service: { from: (table: string) => {
    const chain = {
      select: () => chain, eq: () => chain,
      single: async () => ({ error: null, data: table === "ht_agent_decisions"
        ? { id: "decision", frame_id: "old-frame", symbol: "TEST", action, state: "pending_approval" } : prior }),
      insert: () => { calls.writes++; throw new Error("Unexpected database write"); },
      update: () => { calls.writes++; throw new Error("Unexpected database write"); },
    };
    return chain;
  } } };
  const exports = {} as {
    buildFrame: (...args: unknown[]) => Promise<HtAgentDecisionFrame>;
    buildManagedPositionFrame: (...args: unknown[]) => Promise<HtAgentDecisionFrame>;
    resolveHtAgentProposal: (...args: unknown[]) => Promise<unknown>;
  };
  vm.runInNewContext(compiled, {
    exports, Date, crypto: { randomUUID: () => "new-frame" }, HT_AGENT_FRAME_VERSION,
    HT_AGENT_STOCK_UNIVERSE_VERSION: "dual-lane-test", requireCanonicalSourceRunId: (id: string) => id,
    getPaperTradingQuote: async () => { calls.price++; return { price: 8.9, timestamp: priceTimestamp, volume: 2_000_000, source: "massive" }; },
    fetchMassiveLastQuote: async () => { calls.nbbo++; return quoteTimestamp === null ? null : { bid: 8.88, ask: 8.92, timestamp: quoteTimestamp }; },
    loadPaperDashboard: async () => ({ account: { equity: 100_000, buyingPower: 100_000, cashBalance: 100_000 },
      positions: action === "exit" ? [{ symbol: "TEST", side: "long", quantity: 100, marketValue: 890 }] : [], orders: [] }),
    paperDailyPnl: async () => 0,
    canonicalLevels: () => ({ entry: 10, stop: 9, target: 13, targetTwo: 14 }),
    proxEvidence: () => ({ decisionTimestamp: priceTimestamp, stance: "support", reasons: [] }),
    getEasternMarketSession: () => "regular", hasExplicitHaltEvidence: () => false,
    number: (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    getOrCreateHtAgentProfile: async () => profile, globalControl: async () => ({ kill_switch: false }),
    loadProxEvidence: async () => ({ run: null, members: new Map() }),
    htAgentProposalLane: () => "before_crowd", getRollingCanonicalDecisionFrame: async () => ({}),
    findHtAgentProposalCandidate: () => candidate,
    evaluateHtAgentRisk: (frame: HtAgentDecisionFrame, riskContext: Parameters<typeof evaluateHtAgentRisk>[1]) =>
      evaluateHtAgentRisk(frame, { ...riskContext, now }),
    policyFromProfile: () => DEFAULT_HT_AGENT_RISK_POLICY, decideHtAgentAction,
  });
  return { exports, calls, context, profile, candidate, prior, priceTimestamp };
}

test("actual entry and managed-position frame builders preserve NBBO time without a price-clock fallback", async () => {
  for (const timestamp of [null, "2026-09-03T13:00:00Z", "2026-09-03T15:00:00Z", "2026-09-03T14:00:20Z"]) {
    const h = harness(timestamp, "exit");
    const entry = await h.exports.buildFrame(h.context, h.profile, h.candidate, null, undefined);
    const managed = await h.exports.buildManagedPositionFrame(h.context, h.profile, h.prior, null, undefined);
    for (const frame of [entry, managed]) {
      assert.equal(frame.market.providerTimestamp, h.priceTimestamp);
      assert.equal(frame.market.quoteProviderTimestamp, timestamp);
      assert.equal(JSON.parse(JSON.stringify(frame)).market.quoteProviderTimestamp, timestamp);
    }
    assert.equal(h.calls.price, 2);
    assert.equal(h.calls.nbbo, 2);
    assert.equal(h.calls.writes, 0);
  }
});

test("actual approval revalidation cannot submit entries or exits using stale/missing/future NBBO", async () => {
  for (const action of ["prepare", "exit"]) {
    for (const timestamp of [null, "2026-09-03T13:00:00Z", "2026-09-03T15:00:00Z"]) {
      const h = harness(timestamp, action);
      await assert.rejects(() => h.exports.resolveHtAgentProposal(h.context, "decision", true), /Approval revalidation failed/);
      assert.equal(h.calls.price, 1);
      assert.equal(h.calls.nbbo, 1);
      assert.equal(h.calls.writes, 0);
    }
  }
});
