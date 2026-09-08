// Execute the actual health-route section with read-only database doubles.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { describeProxMicrostructureCoverage } from "../lib/prox/microstructure-coverage.ts";
import { isActiveMarketTimestampUsable } from "../lib/market-data-time.ts";

const source = readFileSync(new URL("../app/api/system-health/route.ts", import.meta.url), "utf8");
const start = source.indexOf("  // Massive Advanced NBBO");
const end = source.indexOf("  // Pro X now has an independent", start);
const footer = source.indexOf("  const hardFailures =");
assert.ok(start > 0 && end > start && footer > end);
const compiled = ts.transpileModule(`export async function run(){ const checks = [];
${source.slice(start, end)}
${source.slice(footer)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

async function check({ missingQuotes = 0, staleRows = 0, active = true, providerErrors = 0 } = {}) {
  const now = new Date().toISOString();
  const observations = Array.from({ length: 20 }, (_, i) => ({ ticker: `TEST${i}`, market_as_of: now,
    quote_as_of: i < missingQuotes ? "2026-01-01T00:00:00Z" : now, trade_as_of: now }));
  for (const row of observations.slice(0, staleRows)) Object.assign(row, { market_as_of: "2026-01-01T00:00:00Z", quote_as_of: null, trade_as_of: null });
  const run = { id: "run", engine_version: "test", complete: true, authority: "shadow", source_data_mode: "real_time",
    market_session: "pre_market", expected_observation_count: 20, persisted_observation_count: 20,
    quote_observation_count: 20, trade_observation_count: 20, provider_error_count: providerErrors,
    truncated_tape_count: 0, completed_at: now, latest_market_as_of: now };
  const supabase = { from: table => {
    const result = { error: null, data: table === "prox_realtime_microstructure_runs" ? run : observations };
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => result,
      then: (yes, no) => Promise.resolve(result).then(yes, no) };
    return q;
  } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, supabase, Date, Map, Response, NextResponse: { json: Response.json },
    activeMarketSession: active, PROX_MICROSTRUCTURE_VERSION: "test", PROX_MICROSTRUCTURE_AUTHORITY: "shadow",
    ACTIVE_MAX_MICROSTRUCTURE_AGE_HOURS: 5 / 60, hoursSince: time => (Date.now() - Date.parse(time)) / 3_600_000,
    isActiveMarketTimestampUsable, describeProxMicrostructureCoverage,
    latestSignal: null, displayableCount: 0, cryptoEvidence: { warnings: [] } });
  return (await exports.run()).json();
}

test("healthy combined clocks cannot conceal stale NBBO in per-source diagnostics", async () => {
  const result = await check({ missingQuotes: 1 });
  assert.equal(result.ok, true); // Preserve the existing collector criterion, disclose the limitation.
  assert.equal(result.checks[0].detail.sourceCoverage.freshQuoteAndTradeCount, 19);
  assert.match(result.checks[0].message, /partial source coverage/);
  assert.equal(result.warnings[0].name, "prox_microstructure_partial_source_coverage");
  assert.equal(result.warnings[0].sources[0].quote.state, "stale");
});

test("provider errors and the existing 80-percent combined freshness floor still fail health", async () => {
  assert.equal((await check({ staleRows: 4 })).ok, true);
  assert.equal((await check({ staleRows: 5 })).ok, false);
  assert.equal((await check({ providerErrors: 1 })).ok, false);
});

test("closed-session retained evidence is labeled retained without an active-session warning", async () => {
  const result = await check({ staleRows: 20, active: false });
  assert.equal(result.ok, true);
  assert.match(result.checks[0].message, /retained outside the active session/);
  assert.equal(result.warnings.length, 0);
});

test("complete independent quote and trade coverage has no partial-coverage warning", async () => {
  const result = await check();
  assert.equal(result.ok, true);
  assert.equal(result.checks[0].detail.sourceCoverage.coverageState, "complete");
  assert.equal(result.warnings.length, 0);
});
