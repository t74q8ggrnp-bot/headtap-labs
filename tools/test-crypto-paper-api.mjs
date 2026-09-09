// Run the real API with isolated capability/authentication/ledger doubles. Network forbidden.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as contracts from "../lib/crypto/paper-contracts.ts";

const code = ts.transpileModule(
  await readFile(new URL("../app/api/crypto/paper/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

class CryptoPaperError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

function harness(options = {}) {
  const calls = [];
  const trace = { rateLimit: 0, auth: 0 };
  const fake = (name) => async (...args) => {
    calls.push({ name, args });
    if (options.error) throw options.error;
    return name === "read"
      ? { realExecution: false, agentAutopilot: false }
      : { ok: true, orderId: "saved" };
  };
  const capabilities = {
    publicApiEnabled: options.enabled === true,
    paperOrderEntryEnabled: options.enabled === true,
  };
  const dependencies = {
    "@/lib/api-rate-limit": {
      checkApiRateLimit: () => {
        trace.rateLimit++;
        return { allowed: !options.limited, headers: {} };
      },
    },
    "@/lib/paper-trading/server": {
      authenticatePaperRequest: async () => {
        trace.auth++;
        return options.signedOut ? null : { user: { id: "trusted-user" } };
      },
    },
    "@/lib/crypto/paper-contracts": contracts,
    "@/lib/crypto/paper-server": {
      CryptoPaperError,
      readCryptoPaper: fake("read"),
      openCryptoPaper: fake("open"),
      previewCryptoPaper: fake("preview"),
      previewCryptoPaperBudget: fake("dollars"),
      submitCryptoPaper: fake("submit"),
      cancelCryptoPaper: fake("cancel"),
    },
    "@/lib/crypto/product-capabilities": {
      withCryptoCapabilities: (required, handler) => {
        const needs = Array.isArray(required) ? required : [required];
        const enabled = needs.every((capability) => capabilities[capability] === true);
        return enabled
          ? handler
          : async () => Response.json({
            ok: false,
            code: "CRYPTO_PRODUCT_UNAVAILABLE",
            error: "Crypto is currently unavailable.",
          }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      },
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Response,
    require: (name) => {
      assert.ok(name in dependencies, `Forbidden dependency ${name}`);
      return dependencies[name];
    },
    fetch: () => {
      throw new Error("Network forbidden");
    },
  });
  return {
    calls,
    trace,
    run: async (input) => {
      const method = input === undefined ? "GET" : "POST";
      const response = await exports[method](new Request(
        "https://fixture.invalid/api/crypto/paper",
        { method, ...(input === undefined ? {} : { body: JSON.stringify(input) }) },
      ));
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
  };
}

const activeHarness = (options = {}) => harness({ ...options, enabled: true });
const intent = {
  marketId: "COINBASE_SPOT_PEPE_USD",
  side: "buy",
  quantity: "123.000000000001",
  limitPrice: "0.000001",
  clientId: "00000000-0000-0000-0000-000000000001",
  previewCycleId: "00000000-0000-0000-0000-000000000002",
};

test("shelved GET and POST fail before rate limiting, auth, ledger, or network", async () => {
  for (const input of [undefined, { action: "open_account" }]) {
    const h = harness();
    const response = await h.run(input);
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      ok: false,
      code: "CRYPTO_PRODUCT_UNAVAILABLE",
      error: "Crypto is currently unavailable.",
    });
    assert.equal(h.trace.rateLimit, 0);
    assert.equal(h.trace.auth, 0);
    assert.deepEqual(h.calls, []);
  }
});

test("controlled active path keeps anonymous and rate-limited clients away from the ledger", async () => {
  for (const [options, status] of [[{ signedOut: true }, 401], [{ limited: true }, 429]]) {
    const h = activeHarness(options);
    assert.equal((await h.run({ action: "open_account" })).status, status);
    assert.deepEqual(h.calls, []);
  }
});

test("controlled active GET is private/read-only and does not create a paper account", async () => {
  const h = activeHarness();
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(h.calls, [{ name: "read", args: ["trusted-user"] }]);
  assert.equal(response.body.dashboard.realExecution, false);
});

test("controlled active path uses authenticated identity and ignores client totals/user ids", async () => {
  const h = activeHarness();
  const response = await h.run({
    action: "submit",
    ...intent,
    userId: "victim",
    total: 0,
    fee: 0,
    executeLive: true,
  });
  assert.equal(response.status, 201);
  assert.equal(h.calls[0].args[0], "trusted-user");
  assert.deepEqual(
    h.calls[0].args.slice(1),
    [contracts.parseCryptoPaperIntent(intent), intent.clientId, intent.previewCycleId],
  );
});

test("controlled active dollar sizing remains server-side and exact sell quantity survives", async () => {
  const h = activeHarness();
  assert.equal((await h.run({ action: "preview", ...intent, amountDollars: "25.00" })).status, 200);
  assert.deepEqual(h.calls[0], {
    name: "dollars",
    args: ["trusted-user", intent.marketId, "25.00", intent.limitPrice],
  });
  await h.run({ action: "preview", ...intent, side: "sell" });
  assert.equal(h.calls[1].args[1].quantity, intent.quantity);
});

test("controlled active invalid requests fail before ledger calls; cancellation remains owner scoped", async () => {
  const h = activeHarness();
  for (const input of [
    { action: "execute" },
    { action: "submit", ...intent, clientId: "bad" },
    { action: "preview", ...intent, side: "short" },
    { action: "cancel", orderId: "bad" },
    { action: "preview", ...intent, amountDollars: "Infinity" },
  ]) {
    assert.equal((await h.run(input)).status, 400);
  }
  assert.deepEqual(h.calls, []);
  await h.run({ action: "cancel", orderId: intent.clientId, userId: "victim" });
  assert.deepEqual(h.calls, [{ name: "cancel", args: ["trusted-user", intent.clientId] }]);
});

test("controlled active ledger rejection is explicit and unknown storage details stay private", async () => {
  const rejected = await activeHarness({
    error: new CryptoPaperError("Insufficient crypto paper buying power including fees"),
  }).run({ action: "submit", ...intent });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Insufficient/);

  const failed = await activeHarness({ error: new Error("SECRET private SQL") }).run();
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.body), /SECRET/);
});
