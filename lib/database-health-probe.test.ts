import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error strip-types runner requires the source extension
import { probeDatabaseHealth } from "./database-health-probe.ts";

test("database availability accepts an empty table, not missing or malformed evidence", async () => {
  for (const data of [[], [{ id: "test" }]]) {
    const result = await probeDatabaseHealth(async () => ({ data, error: null }));
    assert.equal(result.ok, true);
    assert.equal(result.reason, "reachable");
  }
  for (const data of [null, undefined, {}, "upstream HTML"]) {
    assert.equal((await probeDatabaseHealth(async () => ({ data, error: null }))).reason, "invalid_response");
  }
});

test("database timeout aborts the request and does not retry a stuck read", async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const result = await probeDatabaseHealth((value) => {
    calls++;
    signal = value;
    return new Promise(() => {});
  }, 10);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
});

test("query and transport failures stay failed without exposing upstream details", async () => {
  for (const code of ["42P01", "PGRST301", "sensitive SQL or token", undefined]) {
    const result = await probeDatabaseHealth(async () => ({ data: [], error: { code, message: "secret upstream HTML" } }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "query_failed");
    assert.equal(result.code, code === "42P01" || code === "PGRST301" ? code : null);
    assert.doesNotMatch(JSON.stringify(result), /secret|sensitive/);
  }
  assert.equal((await probeDatabaseHealth(() => { throw Error("secret transport error"); })).reason, "transport_failed");
});

test("an earlier failed request cannot poison a subsequent recovered probe", async () => {
  await probeDatabaseHealth(async () => ({ data: null, error: { code: "53300" } }));
  assert.equal((await probeDatabaseHealth(async () => ({ data: [], error: null }))).ok, true);
});
