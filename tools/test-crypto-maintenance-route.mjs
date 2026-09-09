// Actual route with isolated dependencies. No database or provider access.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../app/api/crypto/evidence-maintenance/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function run({
  capabilityEnabled = false,
  authorized = true,
  environment = "production",
  runtimeAllowed = true,
  ok = true,
} = {}) {
  let authorizationCalls = 0;
  let auditCalls = 0;
  const exports = {};
  const unavailable = () => Response.json({
    ok: false,
    code: "CRYPTO_PRODUCT_UNAVAILABLE",
    error: "Crypto is currently unavailable.",
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const dependencies = {
    "@/lib/crypto/coinapi-pilot-server": {
      coinApiPilotCronAuthorized: () => {
        authorizationCalls++;
        return authorized;
      },
      auditLegacyCryptoBatch: async () => {
        auditCalls++;
        return { ok, audited: ok ? 500 : null, providerRequests: 0 };
      },
    },
    "@/lib/crypto/coinapi-runtime": {
      COINAPI_RESEARCH_RUNTIME: {
        archiveMaintenanceAllowed: runtimeAllowed,
        reason: "fixture-paused",
      },
    },
    "@/lib/crypto/product-capabilities": {
      withCryptoCapabilities: (required, handler) => {
        assert.equal(required, "coinApiEvidenceMaintenanceEnabled");
        return capabilityEnabled ? handler : async () => unavailable();
      },
    },
  };
  vm.runInNewContext(compiled, {
    exports,
    Response,
    console: { info: () => {} },
    process: { env: { VERCEL_ENV: environment } },
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  const response = await exports.GET(new Request("https://test.invalid"));
  return {
    response,
    body: await response.json(),
    authorizationCalls,
    auditCalls,
  };
}

test("shelved maintenance fails closed before auth, database audit, or provider work", async () => {
  const result = await run();
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.body, {
    ok: false,
    code: "CRYPTO_PRODUCT_UNAVAILABLE",
    error: "Crypto is currently unavailable.",
  });
  assert.equal(result.authorizationCalls, 0);
  assert.equal(result.auditCalls, 0);
});

test("controlled reactivation preserves auth, environment, and runtime gates", async () => {
  const denied = await run({ capabilityEnabled: true, authorized: false });
  assert.equal(denied.response.status, 401);
  assert.equal(denied.auditCalls, 0);

  const preview = await run({ capabilityEnabled: true, environment: "preview" });
  assert.equal(preview.body.status, "disabled");
  assert.equal(preview.auditCalls, 0);

  const paused = await run({ capabilityEnabled: true, runtimeAllowed: false });
  assert.equal(paused.body.status, "paused");
  assert.equal(paused.body.providerRequests, 0);
  assert.equal(paused.auditCalls, 0);
});

test("controlled reactivation keeps archive success and failure explicit and unbilled", async () => {
  for (const ok of [true, false]) {
    const result = await run({ capabilityEnabled: true, ok });
    assert.equal(result.response.status, ok ? 200 : 503);
    assert.equal(result.auditCalls, 1);
    assert.equal(result.body.providerRequests, 0);
    assert.match(result.response.headers.get("cache-control"), /private, no-store/);
  }
});

test("all crypto schedules are absent while required stock schedules remain", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    config.crons.filter((cron) => cron.path.startsWith("/api/crypto/")),
    [],
  );
  for (const path of [
    "/api/paper-trading/match",
    "/api/prox-market-sensor",
    "/api/ht-agent/cycle",
    "/api/ht-agent/outcomes",
  ]) {
    assert.equal(config.crons.some((cron) => cron.path === path), true, path);
  }
  assert.doesNotMatch(source, /createCoinApiClient|runCoinApiPilot|matchCryptoPaperOrders/);
});
