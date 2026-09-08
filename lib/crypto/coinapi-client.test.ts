import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node strip-types requires source extensions.
import { createCoinApiClient } from "./coinapi-client.ts";

const path = "/v1/quotes/COINBASE_SPOT_BTC_USD/current";
test("CoinAPI credentials stay in headers on the fixed provider origin", async () => {
  const client = createCoinApiClient({ apiKey: "test-only-placeholder", fetcher: async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://rest.coinapi.io");
    assert.ok(!String(url).includes("test-only-placeholder"));
    assert.equal(new Headers(init?.headers).get("X-CoinAPI-Key"), "test-only-placeholder");
    assert.equal(init?.redirect, "error");
    return Response.json({ price: 10 }, { headers: { "x-ratelimit-request-cost": "1" } });
  } });
  assert.deepEqual(await client.get(path), { price: 10 });
  assert.equal(client.usage().reportedCredits, 1);
  await assert.rejects(client.get("https://other.example/v1/quotes/test/current"));
  await assert.rejects(client.get(`${path}?apiKey=secret`));
  await assert.rejects(client.get(`${path}#secret`));
});

test("concurrent consumers share one request and cached values cannot be mutated", async () => {
  let calls = 0, now = 0;
  const client = createCoinApiClient({ apiKey: "test", now: () => now, fetcher: async () => {
    calls++; return Response.json({ nested: { price: calls } });
  } });
  const [one, two] = await Promise.all([client.get(path, 1_000), client.get(path, 1_000)]) as Array<{ nested: { price: number } }>;
  one.nested.price = 99;
  assert.equal(two.nested.price, 1); assert.equal(calls, 1);
  assert.deepEqual(await client.get(path, 1_000), { nested: { price: 1 } });
  now = 1_001;
  assert.deepEqual(await client.get(path, 1_000), { nested: { price: 2 } });
  assert.equal(client.usage().unreportedCosts, 2);
});

for (const status of [401, 403, 429]) {
  test(`${status} opens a local circuit without exposing error bodies or retrying`, async () => {
    let calls = 0;
    const client = createCoinApiClient({ apiKey: "test", fetcher: async () => {
      calls++; return new Response("sensitive-provider-body", { status });
    } });
    await assert.rejects(client.get(path), error => error instanceof Error && !error.message.includes("sensitive-provider-body"));
    await assert.rejects(client.get(path), /blocked/);
    assert.equal(calls, 1);
  });
}

test("manual diagnostic request allowance blocks additional network requests", async () => {
  let calls = 0;
  const client = createCoinApiClient({ apiKey: "test", maxRequests: 1, fetcher: async () => {
    calls++; return Response.json({});
  } });
  await client.get(path);
  await assert.rejects(client.get(path), /allowance/);
  assert.equal(calls, 1);
});

test("malformed response and connection errors do not echo provider secrets", async () => {
  for (const fetcher of [async () => new Response("sensitive-provider-body"), async () => { throw new Error("sensitive-provider-body"); }]) {
    const client = createCoinApiClient({ apiKey: "test", fetcher });
    await assert.rejects(client.get(path), error => error instanceof Error && !error.message.includes("sensitive-provider-body"));
  }
});
