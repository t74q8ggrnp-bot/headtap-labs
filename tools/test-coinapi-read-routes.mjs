// Run the real read-route handlers against isolated database/auth doubles.
// No session, credential, external provider, or production service is accessed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import { canonicalCryptoJson } from "../lib/crypto/coinapi-publication.ts";
import { assessCryptoEvidenceHealth } from "../lib/crypto/evidence-health.ts";

const paths = ["coinapi-research", "coinapi-evaluation"];
const compiled = Object.fromEntries(await Promise.all(paths.map(async name => [name,
  ts.transpileModule(await readFile(new URL(`../app/api/crypto/${name}/route.ts`, import.meta.url), "utf8"),
    { compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS } }).outputText])));
function harness(options = {}) {
  const trace = { auth:0, read:0, db:0, providerRequests:0, processingReads:0, assessed:[] };
  const sources = ["ht_crypto_prox_observations","ht_crypto_discovery_observations"]
    .map(source_table=>({ source_table,evaluation_allowed:false }));
  const storage = {
    ht_crypto_research_readiness:{ episodes:0,overdue_horizons:0,execution_authorized:false,profitability_established:false },
    ht_crypto_outcome_source_policy:sources,
    ht_crypto_verified_research_outcomes:[],
    ht_crypto_legacy_tracking_readiness:sources.map(row=>({ ...row,preserved_legacy_observations:10,legacy_overdue_15m:5 })),
  };
  const db = { rpc:async()=>options.snapshot ? {data:options.snapshot,error:null} : ({data:null,error:{code:'42883'}}),from:table=>{
    trace.db++;
    const result = { data: options.brokenSchema && table === "ht_crypto_research_readiness" ? null : storage[table],
      error: options.missing0037 && table === "ht_crypto_legacy_tracking_readiness" ? { code:"42P01" } : null };
    const query = { select:()=>query,order:()=>query,limit:()=>query,single:async()=>result,
      then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject) };
    return query;
  } };
  const bindings = {
    "@/lib/api-rate-limit":{ checkApiRateLimit:()=>({ allowed:!options.rateLimited,headers:{} }) },
    "@/lib/crypto/coinapi-pilot-server":{
      coinApiPilotReaderAuthorized:async()=>{ trace.auth++; return options.authorized === true; },
      coinApiPilotService:()=>db,
      readCoinApiPilot:async()=>{ trace.read++; if(options.brokenSchema) throw new Error("missing");
        return { status:"disabled",freshAlignedQuoteCount:0,providerRequests:0,executionAuthorized:false,publication:null }; },
    },
    "node:crypto":crypto,"@/lib/crypto/coinapi-publication":{ canonicalCryptoJson },
    "@/lib/crypto/evidence-health":{ assessCryptoEvidenceHealth:(value,...args)=>{trace.assessed.push(value);return assessCryptoEvidenceHealth(value,...args);} },
    "@/lib/crypto/outcome-processing-health":{ readCryptoOutcomeProcessingEvidence:async()=>{
      trace.processingReads++;return {version:"coinapi-outcome-processing-v1",available:!options.processingUnavailable,
        checkedAt:new Date().toISOString(),oldestPendingTargetAt:null};
    } },
    "@/lib/crypto/coinapi-runtime":{COINAPI_RESEARCH_RUNTIME:{paused:false,reason:"fixture-active"}},
    "@/lib/crypto/product-capabilities":{ withCryptoCapabilities:(required,handler)=>{
      assert.equal(required,"publicApiEnabled");
      return options.publicApiEnabled === true ? handler : async()=>Response.json({
        ok:false,code:"CRYPTO_PRODUCT_UNAVAILABLE",error:"Crypto is currently unavailable.",
      },{status:503,headers:{"Cache-Control":"private, no-store"}});
    } },
  };
  const handlers = Object.fromEntries(paths.map(name=>{
    const exports = {};
    vm.runInNewContext(compiled[name], { exports,URL,Response,process:{env:{}},
      require:name=>{ if(!(name in bindings)) throw new Error(`Unexpected import ${name}`); return bindings[name]; },
      fetch:()=>{ throw new Error("Provider/network requests forbidden"); } });
    return [name,exports.GET];
  }));
  return { handlers,trace };
}
test("shelved research reads reject before auth, database, evidence, or provider work",async()=>{
  const {handlers,trace}=harness();
  for(const name of paths) {
    const response=await handlers[name](new Request(`https://test.invalid/api/crypto/${name}`));
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{
      ok:false,code:"CRYPTO_PRODUCT_UNAVAILABLE",error:"Crypto is currently unavailable.",
    });
  }
  assert.deepEqual(trace,{auth:0,read:0,db:0,providerRequests:0,processingReads:0,assessed:[]});
});
test("both reads reject unauthenticated requests before database reads",async()=>{
  const { handlers,trace } = harness({publicApiEnabled:true});
  for(const name of paths) {
    const response = await handlers[name](new Request(`https://test.invalid/api/crypto/${name}`));
    assert.equal(response.status,401); assert.match(response.headers.get("cache-control"),/private.*no-store/);
  }
  assert.equal(trace.db,0); assert.equal(trace.read,0);
});
test("authenticated empty research is a successful connection, not a profitable active collector",async()=>{
  const { handlers } = harness({ publicApiEnabled:true,authorized:true });
  const response = await handlers["coinapi-research"](new Request("https://test.invalid"));
  assert.equal(response.status,200);
  const body = await response.json();
  assert.equal(body.status,"disabled"); assert.equal(body.ok,false); assert.equal(body.providerRequests,0);
});
test("authenticated evaluation preserves the legacy warning and reports no invented performance",async()=>{
  const { handlers } = harness({ publicApiEnabled:true,authorized:true });
  const response = await handlers["coinapi-evaluation"](new Request("https://test.invalid"));
  assert.equal(response.status,200);
  const body = await response.json();
  assert.equal(body.legacyTracking.schemaReady,true);
  assert.ok(body.legacyTracking.rows.every(row=>row.legacy_overdue_15m===5 && !row.evaluation_allowed));
  assert.equal(body.profitabilityEstablished,false); assert.equal(body.averageNetProfit,null);
  assert.equal(body.executionAuthorized,false); assert.equal(body.providerRequests,0);
  assert.equal(body.ledgerHealthy,false); assert.equal(body.healthVerified,false);
  assert.equal(body.healthChecks.length,3);assert.ok(body.healthChecks.every(check=>!check.ok));
});
test("missing observation retirement migration stays explicit without pretending 0036 is broken",async()=>{
  const { handlers } = harness({ publicApiEnabled:true,authorized:true,missing0037:true });
  const response = await handlers["coinapi-evaluation"](new Request("https://test.invalid"));
  assert.equal(response.status,200);
  const body = await response.json();
  assert.equal(body.schemaReady,true); assert.equal(body.legacyTracking.schemaReady,false);
  assert.match(body.legacyTracking.message,/0037/); assert.deepEqual(body.legacyTracking.rows,[]);
});
test("unavailable core evidence is not reported as a successful connection",async()=>{
  const { handlers } = harness({ publicApiEnabled:true,authorized:true,brokenSchema:true });
  for(const name of paths) assert.equal((await handlers[name](new Request("https://test.invalid"))).status,503);
});
test("authenticated evaluation passes fresh operational proof into the same health policy",async()=>{
  for(const processingUnavailable of [false,true]) {
    const {handlers,trace}=harness({publicApiEnabled:true,authorized:true,snapshot:{version:"test-incomplete-evidence"},processingUnavailable});
    const response=await handlers["coinapi-evaluation"](new Request("https://test.invalid"));
    const body=await response.json();
    assert.equal(trace.processingReads,1);
    assert.equal(trace.assessed[0].outcomeProcessing.version,"coinapi-outcome-processing-v1");
    assert.equal(trace.assessed[0].outcomeProcessing.available,!processingUnavailable);
    assert.equal(body.healthVerified,false); // Operational proof alone never blesses incomplete price evidence.
    assert.equal(body.profitabilityEstablished,false);assert.equal(body.providerRequests,0);
  }
});
test("invalid market/episode identity and rate limits fail before database work",async()=>{
  const { handlers,trace } = harness({ publicApiEnabled:true,authorized:true });
  assert.equal((await handlers["coinapi-research"](new Request("https://test.invalid?marketId=BTC"))).status,400);
  assert.equal((await handlers["coinapi-evaluation"](new Request("https://test.invalid?episodeId=wrong"))).status,400);
  const limited = harness({ publicApiEnabled:true,authorized:true,rateLimited:true });
  for(const name of paths) assert.equal((await limited.handlers[name](new Request("https://test.invalid"))).status,429);
  assert.equal(trace.db,0); assert.equal(trace.read,0); assert.equal(limited.trace.auth,0);
});
