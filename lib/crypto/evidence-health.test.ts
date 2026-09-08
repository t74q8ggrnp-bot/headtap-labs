import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
// @ts-expect-error Node source tests.
import { assessCryptoEvidenceHealth, isObservationOnlyRow } from "./evidence-health.ts";
// @ts-expect-error Node source tests.
import { canonicalCryptoJson } from "./coinapi-publication.ts";
const now=Date.parse("2026-09-03T02:00:30Z"), stamp=(offset=0)=>new Date(now+offset).toISOString();
const config={ production:true,environmentEnabled:true,credentialConfigured:true };
const mid="COINBASE_SPOT_TEST_USD";
function fixture() {
  const frame={ version:"coinapi-vercel-pilot-v1",dataContractVersion:"coinapi-research-data-v2",provider:"coinapi",authority:"research_only",
    executionAuthorized:false,publicRankingChanged:false,profitabilityEstablished:false,intervalSeconds:60,decisionAt:stamp(),
    selectedMarkets:[mid],quotes:[{marketId:mid,failures:[],trade:{symbolId:mid,price:10,asOf:stamp(-1000)},book:{symbolId:mid,bid:9.99,ask:10.01,asOf:stamp(-500)}}],
    summary:{nativeUsdMarkets:1,freshAlignedQuotes:1,scored:1},usage:{requests:3,reportedCredits:3} };
  return {version:"crypto-evidence-health-v1",archive:["ht_crypto_prox_observations","ht_crypto_discovery_observations"].map(source_table=>({
    source_table,tracking_version:"crypto-legacy-observation-only-v1",evaluation_allowed:false,guards_enabled:true,deletion_protected:true,
    preserved_legacy_observations:20,audited_records:20,missing_audits:0,evidence_mismatches:0,reviews_required:0,invalid_new_deadlines:0,
    legacy_overdue_15m:10,unverified_recorded_horizons:4})),
    control:{enabled:true,daily_auto_renew:true,latest_cycle_id:"cycle",blocked_reason:null,credit_day:"2026-09-03",daily_reserved:3,lifetime_reserved:3,daily_credit_limit:300,lifetime_credit_limit:900},
    publication:{id:"cycle",status:"complete",started_at:stamp(-5000),completed_at:stamp(100),frame,evidence_sha256:createHash("sha256").update(canonicalCryptoJson(frame)).digest("hex")},
    latestAttempt:{status:"complete",started_at:stamp(-5000)},
    receipts:{count:3,unsettled:0,unknownCosts:0,publicationRequests:3,publicationErrors:0,publicationCredits:3},
    ledger:{source_version:"coinapi-provider-book-ledger-v1",saved_books:12,episodes:2,overdue_horizons:0,observed_horizons:2,execution_authorized:false,profitability_established:false},
    ledgerIntegrity:{verifiedEntries:2,missingHorizons:0,invalidOutcomes:0,maturedHorizons:4} };
}
type Fixture=ReturnType<typeof fixture>;
const checks=(f:unknown,at=now)=>assessCryptoEvidenceHealth(f,config,at).checks;
const check=(f:unknown,name:string,at=now)=>checks(f,at).find(c=>c.name===name)!;
const rehash=(f:Fixture)=>{f.publication.evidence_sha256=createHash("sha256").update(canonicalCryptoJson(f.publication.frame)).digest("hex");};

test("full proof passes while original bad history remains disclosed and excluded",()=>{
  const r=assessCryptoEvidenceHealth(fixture(),config,now);
  assert.ok(r.checks.every(c=>c.ok)); assert.equal(r.warnings.length,2);
  assert.equal(r.warnings[0].originalOverdue15m,10); assert.equal(r.warnings[0].evaluationEligible,false);
  assert.equal(r.checks[1].detail.executionAuthorized,false);
});
test("old quarantine alone, empty schema and absent data cannot make health green",()=>{
  assert.ok(checks(null).every(c=>!c.ok));
  const f=fixture(); f.archive=[];
  assert.equal(check(f,"crypto_legacy_evidence_audit").ok,false);
  assert.equal(check({...f,publication:null},"crypto_coinapi_collection").ok,false);
  assert.equal(check({...f,ledger:{}},"crypto_coinapi_outcomes").ok,false);
});
test("failed reads stay red with unknown state, not invented budget, switch or outcome failures",()=>{
  const result=assessCryptoEvidenceHealth(null,config,now,{code:"57014",message:"private database content",details:"secret"});
  assert.ok(result.checks.every(c=>!c.ok));
  for(const c of result.checks) {
    assert.deepEqual(c.detail.issues,["evidence_snapshot_unavailable"]);
    assert.equal(c.detail.databaseEnabled,null);
    assert.deepEqual(c.detail.diagnostic,{stage:"evidence_snapshot",code:"57014",kind:"timeout"});
  }
  assert.ok(!JSON.stringify(result).includes("private database content"));
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.equal(result.warnings[0].evaluationEligible,false);
});
test("every missing audit, altered source, review case or disabled guard is a hard failure",()=>{
  for(const field of ["missing_audits","evidence_mismatches","reviews_required","invalid_new_deadlines"] as const){const f=fixture();f.archive[0][field]=1;assert.equal(check(f,"crypto_legacy_evidence_audit").ok,false,field);}
  for(const field of ["guards_enabled","deletion_protected"] as const){const f=fixture();f.archive[0][field]=false;assert.equal(check(f,"crypto_legacy_evidence_audit").ok,false,field);}
  const f=fixture();f.archive[0].audited_records=19;assert.equal(check(f,"crypto_legacy_evidence_audit").ok,false);
  f.archive[0].evaluation_allowed=true;assert.equal(check(f,"crypto_legacy_evidence_audit").ok,false);
});
test("tampered, future, stale or unauthorized publications are rejected",()=>{
  const f=fixture();f.publication.frame.quotes[0].trade.price=20;
  assert.equal(check(f,"crypto_coinapi_collection").ok,false);
  for(const field of ["executionAuthorized","publicRankingChanged","profitabilityEstablished"] as const){const x=fixture();x.publication.frame[field]=true;rehash(x);assert.equal(check(x,"crypto_coinapi_collection").ok,false,field);}
  assert.equal(check(fixture(),"crypto_coinapi_collection",now+91_000).ok,false);
  assert.equal(check(fixture(),"crypto_coinapi_collection",now-10_000).ok,false);
});
test("research cadence does not fabricate current execution-fresh quotes",()=>{
  const c=check(fixture(),"crypto_coinapi_collection",now+60_000);
  assert.equal(c.ok,true);assert.equal(c.detail.alignedAtCollection,1);assert.equal(c.detail.executionFreshQuotesNow,0);
  assert.equal(c.detail.executionAuthorized,false);
});
test("stale, misaligned, different-market, crossed or absent provider facts fail collection proof",()=>{
  const changes=[(f:Fixture)=>{f.publication.frame.quotes[0].book.asOf=stamp(-16_000);},
    (f:Fixture)=>{f.publication.frame.quotes[0].trade.asOf=stamp(-31_000);},
    (f:Fixture)=>{f.publication.frame.quotes[0].book.symbolId="KRAKEN_SPOT_TEST_USD";},
    (f:Fixture)=>{f.publication.frame.quotes[0].book.ask=9;},
    (f:Fixture)=>{f.publication.frame.summary.freshAlignedQuotes=9;}];
  for(const change of changes){const f=fixture();change(f);rehash(f);assert.equal(check(f,"crypto_coinapi_collection").ok,false);}
});
test("paid request receipts, budget pauses, credentials and runtime failures stay visible",()=>{
  for(const field of ["production","environmentEnabled","credentialConfigured"] as const){assert.equal(assessCryptoEvidenceHealth(fixture(),{...config,[field]:false},now).checks[1].ok,false);}
  const disabled=fixture();disabled.control.enabled=false;assert.equal(check(disabled,"crypto_coinapi_collection").ok,false);
  const paused=fixture();paused.control.daily_reserved=300;assert.ok(check(paused,"crypto_coinapi_collection").message.includes("credit_budget_paused"));
  const failed=fixture();failed.latestAttempt.status="failed";assert.equal(check(failed,"crypto_coinapi_collection").ok,false);
  for(const field of ["unknownCosts","unsettled","publicationErrors"] as const){const f=fixture();f.receipts[field]=1;assert.equal(check(f,"crypto_coinapi_collection").ok,false);}
  const f=fixture();f.receipts.publicationCredits=4;assert.equal(check(f,"crypto_coinapi_collection").ok,false);
});
test("recurring UTC budget exposes a pending rollover without erasing cumulative usage",()=>{
  const pending=fixture();pending.control.credit_day="2026-09-02";pending.control.daily_reserved=300;
  pending.control.lifetime_reserved=900;pending.control.lifetime_credit_limit=900;
  const c=check(pending,"crypto_coinapi_collection");
  const detail=c.detail as {issues:string[];budgetMode:string;rolloverPending:boolean};
  assert.ok(!detail.issues.includes("credit_budget_paused"));
  assert.equal(detail.budgetMode,"recurring_daily_utc");
  assert.equal(detail.rolloverPending,true);

  const capped=fixture();capped.control.daily_reserved=300;capped.control.lifetime_reserved=900;
  capped.control.lifetime_credit_limit=900;
  assert.ok((check(capped,"crypto_coinapi_collection").detail as {issues:string[]}).issues.includes("credit_budget_paused"));

  const legacy=fixture();legacy.control.daily_auto_renew=false;legacy.control.credit_day="2026-09-02";
  legacy.control.lifetime_reserved=900;legacy.control.lifetime_credit_limit=900;
  assert.ok((check(legacy,"crypto_coinapi_collection").detail as {issues:string[]}).issues.includes("credit_budget_paused"));
});
test("a currently running next collection can have reserved requests without poisoning the prior verified publication",()=>{
  const f=fixture();f.latestAttempt={status:"running",started_at:stamp(-1000)};f.receipts.unsettled=1;
  assert.equal(check(f,"crypto_coinapi_collection").ok,true);
  assert.equal(check(f,"crypto_coinapi_collection",now+95_000).ok,false);
});
test("missing, overdue, invalid, or all-unavailable mature outcomes cannot masquerade as healthy learning",()=>{
  for(const field of ["missingHorizons","invalidOutcomes"] as const){const f=fixture();f.ledgerIntegrity[field]=1;assert.equal(check(f,"crypto_coinapi_outcomes").ok,false);}
  const f=fixture();f.ledger.overdue_horizons=1;assert.equal(check(f,"crypto_coinapi_outcomes").ok,false);
  f.ledger.overdue_horizons=0;f.ledger.observed_horizons=0;assert.equal(check(f,"crypto_coinapi_outcomes").ok,false);
  f.ledgerIntegrity.maturedHorizons=0;assert.equal(check(f,"crypto_coinapi_outcomes").ok,true);
});
test("new legacy observations cannot quietly restart invalid outcome schedules",()=>{
  const r={outcome_tracking_status:"not_scheduled",target_15m_at:null,target_1h_at:null,target_4h_at:null,target_24h_at:null};
  assert.equal(isObservationOnlyRow(r),true);assert.equal(isObservationOnlyRow({}),false);
  assert.equal(isObservationOnlyRow({...r,target_15m_at:stamp()}),false);
  assert.equal(isObservationOnlyRow({...r,outcome_tracking_status:"legacy_quarantined"}),false);
});
test("approved processing grace exposes due evidence without changing provider or integrity rules",()=>{
  const f=fixture(); f.ledger.overdue_horizons=1;
  const outcomeProcessing={version:"coinapi-outcome-processing-v1",available:true,checkedAt:stamp(),oldestPendingTargetAt:stamp(-120_000)};
  const within={...f,outcomeProcessing};
  const result=check(within,"crypto_coinapi_outcomes");
  assert.equal(result.ok,true);
  assert.equal(result.detail.dueAtEvidenceSnapshot,1);
  assert.equal(check(f,"crypto_coinapi_outcomes").ok,false); // Legacy caller stays strict.
  assert.equal(check({...within,outcomeProcessing:{...outcomeProcessing,oldestPendingTargetAt:stamp(-150_001)}},"crypto_coinapi_outcomes").ok,false);
  assert.equal(check({...within,outcomeProcessing:{...outcomeProcessing,available:false}},"crypto_coinapi_outcomes").ok,false);
  assert.equal(check({...within,outcomeProcessing:null},"crypto_coinapi_outcomes").ok,false);
  for (const field of ["missingHorizons","invalidOutcomes"] as const) {
    assert.equal(check({...within,ledgerIntegrity:{...f.ledgerIntegrity,[field]:1}},"crypto_coinapi_outcomes").ok,false);
  }
  assert.equal(check({...within,ledger:{...f.ledger,overdue_horizons:-1}},"crypto_coinapi_outcomes").ok,false);
  assert.equal(check(within,"crypto_coinapi_collection",now+91_000).ok,false);
  f.publication.frame.quotes[0].book.asOf=stamp(-16_000); rehash(f);
  assert.equal(check({...f,outcomeProcessing},"crypto_coinapi_collection").ok,false);
});
function heldFixture() {
  const f=fixture();f.receipts.unknownCosts=1;f.receipts.count=4;
  f.control.daily_reserved=4;f.control.lifetime_reserved=4;
  return {...f,accounting:{version:"coinapi-bounded-timeout-v1",reservationCovered:true,receiptNotFabricated:true,
    heldUnknownRequests:1,heldMaximumCredits:1,unboundedUnknownRequests:0,invalidHolds:0}};
}
test("documented maximum holds disclose unknown actual charges without invalidating new verified evidence",()=>{
  const result=assessCryptoEvidenceHealth(heldFixture(),config,now);
  assert.ok(result.checks.every(c=>c.ok));
  const warning=result.warnings.find(w=>w.name==="coinapi_unconfirmed_charges_fully_reserved")!;
  assert.equal(warning.actualChargesConfirmed,false);assert.equal(warning.maximumReservedCredits,1);
  assert.equal(warning.providerRequests,0);assert.equal(heldFixture().receipts.publicationCredits,3);
});
test("a hold never masks unbounded costs, missing reservations or tampered provenance",()=>{
  for(const patch of [{version:"other"},{reservationCovered:false},{receiptNotFabricated:false},
    {heldUnknownRequests:0},{heldUnknownRequests:1.5},{heldMaximumCredits:0},{heldMaximumCredits:2},
    {unboundedUnknownRequests:1},{invalidHolds:1}]) {
    const f=heldFixture();Object.assign(f.accounting,patch);
    assert.equal(check(f,"crypto_coinapi_collection").ok,false,JSON.stringify(patch));
  }
});
test("old maximum-cost holds cannot validate failed current receipts, stale prices, or changed evidence",()=>{
  const f=heldFixture();f.receipts.publicationErrors=1;
  assert.equal(check(f,"crypto_coinapi_collection").ok,false);
  assert.equal(check(heldFixture(),"crypto_coinapi_collection",now+91_000).ok,false);
  const altered=heldFixture();altered.publication.frame.quotes[0].trade.price=999;
  assert.equal(check(altered,"crypto_coinapi_collection").ok,false);
  const unknown=heldFixture();unknown.receipts.unknownCosts=2;
  assert.equal(check(unknown,"crypto_coinapi_collection").ok,false);
});

function unsettledHoldFixture(active = 0) {
  const f=fixture();
  f.receipts.unsettled=1+active;
  f.receipts.count=4+active;
  f.control.daily_reserved=4+active;
  f.control.lifetime_reserved=4+active;
  if(active) f.latestAttempt={status:"running",started_at:stamp(-1_000)};
  return {...f,accounting:{version:"coinapi-accounting-holds-v2",reservationCovered:true,receiptNotFabricated:true,
    heldUnknownRequests:1,heldSettledUnknownRequests:0,heldUnsettledRequests:1,heldMaximumCredits:1,
    rawUnsettledRequests:1+active,activeUnsettledRequests:active,unaccountedRequests:active,
    unboundedUnknownRequests:active,invalidHolds:0}};
}

test("an old unsettled database-write ambiguity is healthy only with an immutable full-cost hold",()=>{
  const f=unsettledHoldFixture();
  const result=assessCryptoEvidenceHealth(f,config,now);
  assert.ok(result.checks.every(c=>c.ok));
  const warning=result.warnings.find(w=>w.name==="coinapi_unconfirmed_charges_fully_reserved")!;
  assert.equal(warning.requests,1);assert.equal(warning.maximumReservedCredits,1);
  assert.equal(warning.actualChargesConfirmed,false);
});

test("v2 accounting permits only current leased requests beyond historical holds",()=>{
  assert.equal(check(unsettledHoldFixture(1),"crypto_coinapi_collection").ok,true);
  assert.equal(check(unsettledHoldFixture(1),"crypto_coinapi_collection",now+95_000).ok,false);
  for(const patch of [{heldUnsettledRequests:0},{heldMaximumCredits:0},{unaccountedRequests:0},
    {activeUnsettledRequests:0},{invalidHolds:1},{reservationCovered:false}]) {
    const f=unsettledHoldFixture(1);Object.assign(f.accounting,patch);
    assert.equal(check(f,"crypto_coinapi_collection").ok,false,JSON.stringify(patch));
  }
});
