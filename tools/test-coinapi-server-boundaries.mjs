/** Execute the actual server module with in-memory storage and no network.
 * Credentials, account changes and billable CoinAPI calls are impossible here. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import * as pilot from "../lib/crypto/coinapi-pilot.ts";
import * as publication from "../lib/crypto/coinapi-publication.ts";
import * as diagnostics from "../lib/crypto/storage-diagnostics.ts";

const source = await readFile(new URL("../lib/crypto/coinapi-pilot-server.ts",import.meta.url),"utf8");
const compiled = ts.transpileModule(source,{ compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS } }).outputText;
function harness(options = {}) {
  const trace = { factories:0, providerClients:0, auth:0, rpc:[], rpcArgs:[], reads:[],updates:[] };
  let auditCalls = 0;
  let clock = options.clock ?? 0;
  const frame = options.frame ?? null;
  const control = { enabled:false,daily_credit_limit:300,lifetime_credit_limit:900,credit_day:new Date().toISOString().slice(0,10),
    daily_reserved:0,lifetime_reserved:0,blocked_reason:null,latest_cycle_id:frame ? "fixture-cycle" : null };
  const db = { auth:{ getUser:async()=>{ trace.auth++; return { data:{ user:{ id:"fixture-user" } },error:null }; } },
    rpc:async(name,args)=>{ trace.rpc.push(name); trace.rpcArgs.push(args);
      if(name === "ht_crypto_audit_legacy_evidence") {
        clock += options.auditDurationMs ?? 0;
        const result = options.auditResults?.[auditCalls++] ?? {data:500,error:options.auditError??null};
        return result;
      }
      if(name === "ht_coinapi_recover_bounded_timeouts") return {error:options.recoveryError??null,data:{recovered:false}};
      return name === "ht_coinapi_research_maintenance"
      ? { error:options.integrityError ?? null, data:{ resolved:0 } }
      : { data:{ allowed:false,reason:"disabled" },error:null }; },
    from:table=>{
      trace.reads.push(table); let columns = "";
      const query = { update:values=>{
          const update={table,values,filters:[]};trace.updates.push(update);
          const mutation={eq:(key,value)=>{update.filters.push([key,'eq',value]);return mutation;},
            lt:(key,value)=>{update.filters.push([key,'lt',value]);return mutation;},
            select:async()=>({data:[],error:options.updateError??null})};return mutation;
        },select:value=>{ columns = value; return query; },eq:()=>query,order:()=>query,limit:()=>query,
        single:async()=>({ error:null,data:table === "ht_coinapi_pilot_control" ? control :
          columns === "frame,evidence_sha256" ? { frame,evidence_sha256:options.hash ?? crypto.createHash("sha256").update(publication.canonicalCryptoJson(frame)).digest("hex") } : null }),
        maybeSingle:async()=>({ error:null,data:null }) };
      return query;
    } };
  const exports = {};
  const bindings = { "node:crypto":crypto,"@supabase/supabase-js":{ createClient:()=>{ trace.factories++; return db; } },
    "./coinapi-client":{ createCoinApiClient:()=>{ trace.providerClients++; throw new Error("Provider requests prohibited in offline test"); } },
    "./coinapi-pilot-budget":{ budgetedCoinApiFetch:()=>{ throw new Error("Network prohibited in offline test"); } },
    "./coinapi-pilot":pilot,"./coinapi-publication":publication,"./storage-diagnostics":diagnostics };
  vm.runInNewContext(compiled,{ exports,Buffer,AbortSignal,Date:class extends Date { static now(){ return clock; } },
    process:{ env:{ NEXT_PUBLIC_SUPABASE_URL:"https://storage.invalid",SUPABASE_SERVICE_ROLE_KEY:"fixture-not-a-key",
      COINAPI_API_KEY:"fixture-not-a-key",VERCEL_ENV:"production",CRON_SECRET:"fixture-cron",...options.env } },
    require:name=>{ if (!(name in bindings)) throw new Error(`Unexpected dependency ${name}`); return bindings[name]; },
    fetch:()=>{ throw new Error("Network prohibited in offline test"); } },{ timeout:1000 });
  return { api:exports,trace };
}

test("deploy/preview cannot start CoinAPI requests or database collection", async()=>{
  for (const env of [{},{ COINAPI_PILOT_ENABLED:"false" },{ COINAPI_PILOT_ENABLED:"true",VERCEL_ENV:"preview" }]) {
    const { api,trace } = harness({ env });
    assert.equal((await api.runCoinApiPilot()).status,"disabled");
    assert.equal(trace.factories,0); assert.equal(trace.providerClients,0);
  }
});
test("collector cannot repeat the retired one-time budget adjustment",async()=>{
  const {api,trace}=harness({clock:Date.parse('2026-09-03T05:00:00Z'),env:{COINAPI_PILOT_ENABLED:'true'}});
  await api.runCoinApiPilot();
  assert.equal(trace.updates.length,0);assert.equal(trace.providerClients,0);
  assert.doesNotMatch(source,/applyApprovedCoinApiDailyBudget|\.update\(\s*\{/);
});
test("missing integrity schema blocks collection before credit claims or provider requests",async()=>{
  const { api,trace } = harness({ env:{ COINAPI_PILOT_ENABLED:"true" },integrityError:{ message:"missing" } });
  await assert.rejects(api.runCoinApiPilot(),/maintenance/);
  assert.deepEqual(trace.rpc,["ht_coinapi_research_maintenance"]); assert.equal(trace.providerClients,0);
});
test("database failure stage and safe code survive without printing raw database messages",async()=>{
  const { api,trace } = harness({ env:{ COINAPI_PILOT_ENABLED:"true" },integrityError:{ code:"57014",message:"private database content" } });
  await assert.rejects(api.runCoinApiPilot(),error=>{
    assert.equal(error.stage,"maintenance");assert.equal(error.diagnostic.code,"57014");assert.equal(error.diagnostic.kind,"timeout");
    assert.ok(!JSON.stringify(error).includes("private database content"));return true;
  });
  assert.equal(trace.providerClients,0);
});
test("database disabled switch keeps saved-book maintenance unbilled",async()=>{
  const { api,trace } = harness({ env:{ COINAPI_PILOT_ENABLED:"true" } });
  assert.equal((await api.runCoinApiPilot()).status,"paused");
  assert.deepEqual(trace.rpc,["ht_coinapi_research_maintenance","ht_coinapi_recover_bounded_timeouts","ht_coinapi_pilot_begin"]);
  assert.equal(trace.providerClients,0);
});
test("missing timeout recovery schema fails before any provider call or credit claim",async()=>{
  const {api,trace}=harness({env:{COINAPI_PILOT_ENABLED:"true"},recoveryError:{code:"PGRST202",message:"missing"}});
  await assert.rejects(api.runCoinApiPilot(),error=>error.stage==="usage_recovery");
  assert.deepEqual(trace.rpc,["ht_coinapi_research_maintenance","ht_coinapi_recover_bounded_timeouts"]);
  assert.equal(trace.providerClients,0);
});
test("historical audit has a separate unbilled transaction and an honest failure result",async()=>{
  for(const auditError of [null,{code:"57014",message:"private"}]) {
    const {api,trace}=harness({auditError});
    const result=await api.auditLegacyCryptoBatch();
    assert.equal(result.ok,!auditError);assert.equal(result.providerRequests,0);
    assert.equal(result.audited,auditError?null:20000);
    assert.equal(trace.rpc.length,auditError?1:40);
    assert.ok(trace.rpc.every(name=>name === "ht_crypto_audit_legacy_evidence"));
    assert.ok(trace.rpcArgs.every(args=>args.p_limit === 500)); assert.equal(trace.providerClients,0);
  }
});
test("archive draining stops at a short batch without redundant calls",async()=>{
  const {api,trace}=harness({auditResults:[{data:500,error:null},{data:17,error:null}]});
  const result=await api.auditLegacyCryptoBatch();
  assert.equal(result.ok,true);assert.equal(result.audited,517);assert.equal(result.stopReason,"drained");
  assert.equal(result.committedBatches,2);assert.equal(trace.rpc.length,2);
});
test("slow archive batches stop starting calls at their wall-time budget",async()=>{
  const {api,trace}=harness({auditDurationMs:2600});
  const result=await api.auditLegacyCryptoBatch();
  assert.equal(result.ok,true);assert.equal(result.audited,4000);assert.equal(result.stopReason,"time_budget");
  assert.equal(result.elapsedMs,20800);assert.equal(trace.rpc.length,8);
});
test("archive leaves deadline headroom for a last slow RPC and never starts another",async()=>{
  const {api,trace}=harness({auditDurationMs:7999});
  const result=await api.auditLegacyCryptoBatch();
  assert.equal(result.ok,true);assert.equal(result.audited,1500);
  assert.equal(result.stopReason,"time_budget");assert.equal(trace.rpc.length,3);
  assert.ok(result.elapsedMs<28000);assert.equal(trace.providerClients,0);
});
test("a failed archive call retains confirmed progress and is never silently retried",async()=>{
  const {api,trace}=harness({auditResults:[{data:500,error:null},{data:null,error:{code:"57014"}}]});
  const result=await api.auditLegacyCryptoBatch();
  assert.equal(result.ok,false);assert.equal(result.audited,null);assert.equal(result.confirmedAudited,500);
  assert.equal(result.committedBatches,1);assert.equal(trace.rpc.length,2);assert.equal(result.providerRequests,0);
});
test("invalid audit counts cannot be claimed as progress",async()=>{
  for(const data of [-2,501,null,1.5,"500"]) {
    const {api,trace}=harness({auditResults:[{data,error:null}]});
    const result=await api.auditLegacyCryptoBatch();
    assert.equal(result.ok,false);assert.equal(result.confirmedAudited,0);assert.equal(trace.rpc.length,1);
  }
});
test("another archive worker is a no-op, not a second drain",async()=>{
  const {api,trace}=harness({auditResults:[{data:-1,error:null}]});
  const result=await api.auditLegacyCryptoBatch();
  assert.equal(result.ok,true);assert.equal(result.audited,0);assert.equal(result.stopReason,"another_worker_active");
  assert.equal(trace.rpc.length,1);assert.equal(trace.providerClients,0);
});
test("unauthenticated readers are refused and cron authorization requires exact token",async()=>{
  const { api,trace } = harness();
  assert.equal(await api.coinApiPilotReaderAuthorized(new Request("https://app.invalid")),false);
  assert.equal(api.coinApiPilotCronAuthorized(new Request("https://app.invalid",{ headers:{ authorization:"Bearer fixture-cron-extra" } })),false);
  assert.equal(api.coinApiPilotCronAuthorized(new Request("https://app.invalid",{ headers:{ authorization:"Bearer fixture-cron" } })),true);
  assert.equal(trace.factories,0);
});
test("research readers reuse storage with no provider client, even when no frame exists",async()=>{
  const { api,trace } = harness();
  const result = await api.readCoinApiPilot();
  assert.equal(result.status,"disabled"); assert.equal(result.publication,null);
  assert.equal(trace.providerClients,0); assert.equal(trace.rpc.length,0);
});
test("tampered or old publications fail closed without paid fallback",async()=>{
  const base = { dataContractVersion:"coinapi-research-data-v2",decisionAt:new Date().toISOString(),quotes:[],evidence:[],coverage:[],research:{ decisions:[] } };
  for (const options of [{ frame:base,hash:"b".repeat(64) },{ frame:{ ...base,dataContractVersion:"old" } }]) {
    const { api,trace } = harness(options);
    await assert.rejects(api.readCoinApiPilot(),/unverified/); assert.equal(trace.providerClients,0);
  }
  const { api,trace } = harness({ frame:base });
  assert.equal((await api.readCoinApiPilot()).publication.marketCount,0); assert.equal(trace.providerClients,0);
});
