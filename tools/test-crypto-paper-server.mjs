// Real server module, mocked storage/read publication. No external calls allowed.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import * as contracts from "../lib/crypto/paper-contracts.ts";

const code = ts.transpileModule(
  await readFile(new URL("../lib/crypto/paper-server.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function harness(options = {}) {
  const calls = [];
  const dashboard = {
    enabled: true,
    account: { cash: 900, starting_cash: 1000, realized_pnl: 0 },
    reservedCash: 100,
    positions: [{
      market_id: "COINBASE_SPOT_TEST_USD",
      quantity: "2",
      available_quantity: "2",
      cost_basis: 100,
    }],
    orders: [],
    fills: [],
  };
  const database = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return options.error
        ? { data: null, error: options.error }
        : {
          data: name === "ht_crypto_paper_dashboard"
            ? dashboard
            : { ok: true, fillId: "fixture-fill" },
          error: null,
        };
    },
    from: (table) => {
      assert.equal(table, "ht_crypto_paper_orders");
      calls.push({ name: "orders" });
      const query = {
        select: () => query,
        in: (_column, values) => {
          assert.deepEqual(Array.from(values), ["open", "partially_filled"]);
          return query;
        },
        order: () => query,
        limit: () => Promise.resolve({ data: options.orders ?? [], error: null }),
      };
      return query;
    },
  };
  const capabilityState = {
    publicApiEnabled: options.publicApiEnabled === true,
    paperOrderEntryEnabled: options.paperOrderEntryEnabled === true,
    paperMatchingEnabled: options.paperMatchingEnabled === true,
  };
  const dependencies = {
    "./paper-contracts": contracts,
    "./coinapi-pilot-server": {
      coinApiPilotService: () => database,
      readCoinApiPilot: async () => {
        calls.push({ name: "saved-feed" });
        return {
          status: options.stale ? "paused" : "collecting",
          budget: { blocked_reason: null },
          publicationId: "same-cycle",
          publication: {
            markets: options.missing ? [] : [{
              marketId: "COINBASE_SPOT_TEST_USD",
              price: 55,
              priceAsOf: "2026-09-03T03:00:00Z",
              priceStatus: "current",
            }],
          },
        };
      },
    },
    "./product-capabilities": {
      isCryptoCapabilityEnabled: (capability) => capabilityState[capability] === true,
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Date,
    Map,
    Math,
    require: (name) => {
      assert.ok(name in dependencies, `Forbidden provider/broker dependency ${name}`);
      return dependencies[name];
    },
    fetch: () => {
      throw new Error("Network forbidden");
    },
  });
  return { exports, calls };
}

test("shelved entry, read, and matching paths do zero storage/provider work", async () => {
  const h = harness();
  const intent = { marketId: "EXACT", side: "buy", quantity: "1", limitPrice: "2" };
  for (const operation of [
    () => h.exports.openCryptoPaper("owner"),
    () => h.exports.previewCryptoPaper("owner", intent),
    () => h.exports.previewCryptoPaperBudget("owner", "EXACT", "10", "2"),
    () => h.exports.submitCryptoPaper("owner", intent, "client", "preview"),
    () => h.exports.cancelCryptoPaper("owner", "order"),
    () => h.exports.readCryptoPaper("owner"),
  ]) {
    await assert.rejects(operation, (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /currently unavailable/i);
      return true;
    });
  }
  const matching = await h.exports.matchCryptoPaperOrders();
  assert.deepEqual(
    {
      status: matching.status,
      processed: matching.processed,
      fills: matching.fills,
      providerRequests: matching.providerRequests,
    },
    { status: "shelved", processed: 0, fills: 0, providerRequests: 0 },
  );
  assert.deepEqual(h.calls, []);
});

test("controlled read injection preserves one saved publication with no provider call", async () => {
  const h = harness({ publicApiEnabled: true });
  const result = await h.exports.readCryptoPaper("owner");
  assert.equal(result.buyingPower, 800);
  assert.equal(result.equity, 1010);
  assert.equal(result.positions[0].unrealizedPnl, 10);
  assert.equal(result.positions[0].currentPrice, result.feed.publication.markets[0].price);
  assert.equal(result.realExecution, false);
  assert.equal(result.agentAutopilot, false);
  assert.equal(h.calls.filter((call) => call.name === "saved-feed").length, 1);
});

test("controlled read keeps missing marks missing and paused feed non-current", async () => {
  const missing = await harness({ publicApiEnabled: true, missing: true }).exports.readCryptoPaper("owner");
  assert.equal(missing.equity, null);
  assert.equal(missing.positions[0].marketValue, null);

  const stale = await harness({ publicApiEnabled: true, stale: true }).exports.readCryptoPaper("owner");
  assert.equal(stale.marksCurrent, false);
});

test("controlled entry and matching injections preserve explicit saved-order behavior", async () => {
  const h = harness({
    paperOrderEntryEnabled: true,
    paperMatchingEnabled: true,
    orders: [{ id: "existing-1" }, { id: "existing-2" }],
  });
  await h.exports.submitCryptoPaper(
    "owner",
    { marketId: "EXACT", side: "buy", quantity: "1", limitPrice: "2" },
    "client",
    "preview",
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, "ht_crypto_paper_submit");
  const result = await h.exports.matchCryptoPaperOrders();
  assert.equal(result.processed, 2);
  assert.equal(result.providerRequests, 0);
  assert.equal(h.calls.filter((call) => call.name === "ht_crypto_paper_match").length, 2);
});

test("controlled entry storage failures preserve safe actionable messages", async () => {
  await assert.rejects(
    harness({ paperOrderEntryEnabled: true, error: { code: "42883", message: "secret" } }).exports.openCryptoPaper("owner"),
    /migration 0040/,
  );
  await assert.rejects(
    harness({ paperOrderEntryEnabled: true, error: { code: "P0001", message: "Insufficient crypto paper buying power" } }).exports.openCryptoPaper("owner"),
    /Insufficient/,
  );
  await assert.rejects(
    harness({ paperOrderEntryEnabled: true, error: { code: "P0001", message: "secret SQL detail" } }).exports.openCryptoPaper("owner"),
    (error) => !error.message.includes("secret"),
  );
});
