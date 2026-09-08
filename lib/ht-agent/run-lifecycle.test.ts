import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node's strip-types runner resolves source extensions.
import { completeHtAgentRun, failHtAgentRun } from "./run-lifecycle.ts";

function service(result: { data: unknown; error: unknown }) {
  const calls: Array<{ table: string; values: Record<string, unknown>; filters: unknown[] }> = [];
  const client = { from(table: string) {
    const call = { table, values: {} as Record<string, unknown>, filters: [] as unknown[] };
    calls.push(call);
    const chain = {
      update(values: Record<string, unknown>) { call.values = values; return chain; },
      eq(field: string, value: unknown) { call.filters.push([field, value]); return chain; },
      select() { return chain; },
      async maybeSingle() { return result; },
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { client, calls };
}

test("success is returned only after the database confirms the running row", async () => {
  const ok = service({ data: { id: "run", status: "success" }, error: null });
  await completeHtAgentRun(ok.client, "run", { decisionCount: 3, orderCount: 0, diagnostics: { paper_only: true } });
  assert.deepEqual(ok.calls[0].filters, [["id", "run"], ["status", "running"]]);
  assert.equal(ok.calls[0].values.status, "success");

  await assert.rejects(
    completeHtAgentRun(service({ data: null, error: { code: "57014" } }).client, "run", {
      decisionCount: 3,
      orderCount: 0,
      diagnostics: {},
    }),
  );
  await assert.rejects(
    completeHtAgentRun(service({ data: null, error: null }).client, "run", {
      decisionCount: 3,
      orderCount: 0,
      diagnostics: {},
    }),
    /did not match one running cycle/,
  );
});

test("failure finalization is also verified and keeps the run fail-closed", async () => {
  const failed = service({ data: { id: "run", status: "failed" }, error: null });
  await failHtAgentRun(failed.client, "run", "provider frame unavailable");
  assert.equal(failed.calls[0].values.status, "failed");
  assert.equal(failed.calls[0].values.error_message, "provider frame unavailable");
  await assert.rejects(failHtAgentRun(service({ data: null, error: { code: "53300" } }).client, "run", "failed"));
});
