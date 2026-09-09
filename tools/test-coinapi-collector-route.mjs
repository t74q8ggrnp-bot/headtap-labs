// Actual route, isolated dependencies: no database, provider or brokerage access.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { CryptoStorageError } from "../lib/crypto/storage-diagnostics.ts";

const source = await readFile(
  new URL("../app/api/crypto/coinapi-collector/route.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function run(options = {}) {
  const calls = [];
  const logs = [];
  const unavailable = () => Response.json({
    ok: false,
    code: "CRYPTO_PRODUCT_UNAVAILABLE",
    error: "Crypto is currently unavailable.",
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  const dependencies = {
    "@/lib/crypto/coinapi-pilot-server": {
      coinApiPilotCronAuthorized: () => {
        calls.push("auth");
        return !options.unauthorized;
      },
      runCoinApiPilot: async () => {
        calls.push("collect");
        if (options.failure) throw options.failure;
        return {
          status: options.status ?? "collected",
          cycleId: "saved-cycle",
          usage: { requests: 3 },
          freshAlignedQuotes: 10,
          scored: 2,
        };
      },
    },
    "@/lib/crypto/storage-diagnostics": { CryptoStorageError },
    "@/lib/crypto/paper-server": {
      matchCryptoPaperOrders: async () => {
        calls.push("paper");
        return { ok: true, providerRequests: 0 };
      },
    },
    "@/lib/crypto/product-capabilities": {
      isCryptoCapabilityEnabled: (capability) => {
        assert.equal(capability, "paperMatchingEnabled");
        return options.paperMatchingEnabled === true;
      },
      withCryptoCapabilities: (required, handler) => {
        assert.equal(required, "coinApiResearchCollectionEnabled");
        return options.collectionEnabled === true
          ? handler
          : async () => unavailable();
      },
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Response,
    console: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  const response = await exports.GET(new Request("https://test.invalid"));
  return { response, body: await response.json(), calls, logs };
}

test("shelved collector rejects before auth, collection, matching, or provider work", async () => {
  const result = await run();
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.body, {
    ok: false,
    code: "CRYPTO_PRODUCT_UNAVAILABLE",
    error: "Crypto is currently unavailable.",
  });
});

test("controlled collection still authenticates before doing any work", async () => {
  const result = await run({ collectionEnabled: true, unauthorized: true });
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.calls, ["auth"]);
});

test("controlled collection leaves paper matching shelved by default", async () => {
  const result = await run({ collectionEnabled: true });
  assert.deepEqual(result.calls, ["auth", "collect"]);
  assert.equal(result.body.status, "collected");
  assert.equal(result.body.paper.status, "shelved");
  assert.equal(result.body.paper.processed, 0);
  assert.equal(result.body.paper.fills, 0);
  assert.equal(result.body.paper.providerRequests, 0);
  assert.equal(result.body.archiveScheduledSeparately, true);
});

test("controlled paper-matching injection preserves the dormant saved-order path", async () => {
  const result = await run({ collectionEnabled: true, paperMatchingEnabled: true });
  assert.deepEqual(result.calls, ["auth", "collect", "paper"]);
  assert.equal(result.body.paper.ok, true);
  assert.equal(result.body.paper.providerRequests, 0);
});

test("collection failure cannot wake paper matching or leak storage details", async () => {
  const result = await run({
    collectionEnabled: true,
    failure: new CryptoStorageError("maintenance", {
      code: "42501",
      message: "private",
    }),
  });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, ["auth", "collect"]);
  assert.deepEqual(result.body.diagnostic, {
    stage: "maintenance",
    code: "42501",
    kind: "permission_denied",
  });
  assert.equal(result.body.paper.status, "shelved");
  assert.equal(JSON.stringify(result.logs).includes("private"), false);
});

test("collector remains absent from every deployed schedule", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.equal(
    config.crons.some((cron) => cron.path === "/api/crypto/coinapi-collector"),
    false,
  );
  assert.match(source, /withCryptoCapabilities/);
});
