// The actual health handler under a database outage. No network or credentials.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { probeDatabaseHealth } from "../lib/database-health-probe.ts";

const source = await readFile(new URL("../app/api/system-health/route.ts", import.meta.url), "utf8");
const compile = value => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const compiled = compile(source);
const boundary = source.indexOf("  // Home and Scanner read the latest promoted run-scoped dataset.");
assert.ok(boundary > 0);
const prefix = compile(source.slice(0, boundary) + "return Response.json({continued:true,checks});\n}");

async function run({ mode = "error", successfulPrefix = false } = {}) {
  const reads = [];
  let providers = 0;
  let signal;
  const db = { from: table => {
    const read = { table };
    reads.push(read);
    const q = {
      select: fields => { read.fields = fields; return q; },
      limit: limit => { read.limit = limit; return q; },
      abortSignal: value => { signal = value; return q; },
      then: (resolve, reject) => (mode === "stuck" ? new Promise(() => {}) : mode === "throw"
        ? Promise.reject(Error("private upstream HTML"))
        : Promise.resolve(mode === "error" ? { data: null, error: { message: "upstream 522", code: "" } }
          : { data: [], error: null })).then(resolve, reject),
    };
    return q;
  } };
  const exports = {};
  vm.runInNewContext(successfulPrefix ? prefix : compiled, {
    exports, Response, Date, Intl, process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only", POLYGON_API_KEY: "test-only",
    } },
    require: name => {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@supabase/supabase-js") return { createClient: () => db };
      if (name === "@/lib/database-health-probe") return { probeDatabaseHealth: read => probeDatabaseHealth(read, 15) };
      if (name === "@/lib/massive-stocks") return { probeMassiveRealtimeEntitlement: async () => {
        providers++; return { dataMode: "real_time" };
      } };
      return {};
    },
    fetch: () => { throw Error("Network forbidden"); },
  });
  const response = await exports.GET();
  return { response, body: await response.json(), reads, providers, signal };
}

test("actual health handler stops after one failed database read, before provider and pipeline work", async () => {
  for (const mode of ["error", "throw", "stuck"]) {
    const { response, body, reads, providers, signal } = await run({ mode });
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.auditComplete, false);
    assert.equal(body.status, "needs_attention");
    assert.ok(body.summary.failures.includes("database_connectivity"));
    assert.deepEqual(body.unverified, ["canonical", "prox", "crypto", "paper_trading", "ht_agent", "massive_entitlement"]);
    assert.deepEqual(reads, [{ table: "ht_scan_runs", fields: "id", limit: 1 }]);
    assert.equal(providers, 0);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("retry-after"), "30");
    assert.doesNotMatch(JSON.stringify(body), /private upstream|test-only/);
    if (mode === "stuck") assert.equal(signal.aborted, true);
  }
});

test("a reachable empty database continues into the original audit instead of being declared healthy", async () => {
  const { body, providers, reads } = await run({ mode: "success", successfulPrefix: true });
  assert.equal(body.continued, true);
  assert.equal(body.ok, undefined, "connectivity alone must not declare full health");
  assert.equal(body.checks.find(c => c.name === "database_connectivity").ok, true);
  assert.equal(providers, 1);
  assert.equal(reads.length, 1);
});
