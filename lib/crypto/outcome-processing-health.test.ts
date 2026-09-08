import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
// @ts-expect-error Node source tests.
import { assessCryptoOutcomeProcessing, readCryptoOutcomeProcessingEvidence, CRYPTO_OUTCOME_PROCESSING_POLICY } from "./outcome-processing-health.ts";

const now = Date.parse("2026-09-03T05:00:00Z");
const evidence = (age: number | null) => ({version:CRYPTO_OUTCOME_PROCESSING_POLICY,available:true,
  checkedAt:new Date(now).toISOString(),oldestPendingTargetAt:age === null ? null : new Date(now-age).toISOString()});

test("evidence wait and scheduler deadline remain separate at exact boundaries", () => {
  for (const [age,due,overdue] of [[90_000,false,false],[90_001,true,false],[149_999,true,false],[150_000,true,false],[150_001,true,true]] as const) {
    const result = assessCryptoOutcomeProcessing(evidence(age),now);
    assert.equal(result.available,true); assert.equal(result.due,due); assert.equal(result.overdue,overdue);
    assert.equal(result.evidenceWaitSeconds,90); assert.equal(result.schedulerGraceSeconds,60);
    assert.equal(result.providerRequests,0);
  }
});
test("no pending outcomes and future scheduled horizons are not overdue", () => {
  for (const age of [null,-300_000]) {
    const result=assessCryptoOutcomeProcessing(evidence(age),now);
    assert.equal(result.available,true); assert.equal(result.due,false); assert.equal(result.overdue,false);
  }
});
test("failed, missing, stale, future and malformed operational evidence is unavailable", () => {
  for (const patch of [{available:false},{version:"other"},{checkedAt:"bad"},
    {checkedAt:new Date(now-10_001).toISOString()},{checkedAt:new Date(now+1).toISOString()},
    {oldestPendingTargetAt:"bad"},{oldestPendingTargetAt:undefined},{oldestPendingTargetAt:0}]) {
    assert.equal(assessCryptoOutcomeProcessing({...evidence(100_000),...patch},now).available,false,JSON.stringify(patch));
  }
  assert.equal(assessCryptoOutcomeProcessing(null,now).available,false);
  assert.equal(assessCryptoOutcomeProcessing({},now).available,false);
});
test("oldest-pending reader performs only the indexed read and preserves unknown errors", async () => {
  for (const reply of [{data:null,error:null},{data:{target_at:new Date(now-151_000).toISOString()},error:null},
    {data:null,error:{code:"57014",message:"private details"}}]) {
    const calls: unknown[][]=[];
    const query={select:(...args:unknown[])=>{calls.push(["select",...args]);return query;},
      eq:(...args:unknown[])=>{calls.push(["eq",...args]);return query;},
      order:(...args:unknown[])=>{calls.push(["order",...args]);return query;},
      limit:(...args:unknown[])=>{calls.push(["limit",...args]);return query;},
      abortSignal:(signal:AbortSignal)=>{assert.equal(signal.aborted,false);return query;},
      maybeSingle:async()=>reply};
    const db={from:(name:string)=>{calls.push(["from",name]);return query;}} as unknown as SupabaseClient;
    const result=await readCryptoOutcomeProcessingEvidence(db);
    assert.deepEqual(calls,[["from","ht_crypto_research_outcomes"],["select","target_at"],
      ["eq","status","pending"],["order","target_at",{ascending:true}],["limit",1]]);
    assert.equal(result.available,!reply.error);
    if (!reply.error) assert.equal(result.oldestPendingTargetAt,reply.data?.target_at ?? null);
    assert.ok(!JSON.stringify(result).includes("private details"));
  }
});
