// Isolated PostgreSQL only. Synthetic rows, no network or production credentials.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
if (!isAbsolute(process.argv[2]??'')) throw new Error('Absolute PGlite module required');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const count=Number(process.argv[3]??20000);
if(!Number.isSafeInteger(count)||count<10||count>200000) throw new Error('Invalid fixture size');
const read=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
async function timed(label,sql){const start=performance.now();const result=await db.query(sql);console.log(JSON.stringify({label,ms:Math.round(performance.now()-start),rows:result.rows}));}
try {
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['0011_crypto_prox_observation_history.sql','0012_crypto_multivenue_discovery.sql','0035_coinapi_vercel_pilot.sql']) await db.exec(await read(file));
  await db.exec(`insert into public.ht_crypto_prox_observations(product_id,symbol,observed_at,observation_minute,role,rank,entry_price,canonical_score,methodology_version,target_15m_at,target_1h_at,target_4h_at,target_24h_at,prox_packet)
    select 'TEST-USD','TEST',now(),now()+n*interval '1 minute','radar',1,10,60,'legacy',now(),now(),now(),now(),jsonb_build_object('details',repeat('x',2000)) from generate_series(1,${count}) n;`);
  for(const file of ['0036_crypto_research_evidence_integrity.sql','0037_crypto_legacy_observation_only.sql']) await db.exec(await read(file));
  await db.exec((await read('0038_crypto_audit_and_health.sql')).replace('select public.ht_crypto_audit_legacy_evidence(20000);',''));
  if(process.argv[4]) await db.exec(await read(process.argv[4]));
  await db.exec('analyze public.ht_crypto_prox_observations;analyze public.ht_crypto_legacy_evidence_audits;');
  await timed('audit_2000','select public.ht_crypto_audit_legacy_evidence(2000)');
  await timed('audit_next_2000','select public.ht_crypto_audit_legacy_evidence(2000)');
  if(process.argv[5]==='full') {
    for(let batch=0;batch<11;batch++) {
      const start=performance.now();
      const result=await db.query('select public.ht_crypto_audit_legacy_evidence(20000) as audited');
      console.log(JSON.stringify({label:'drain_batch',batch,ms:Math.round(performance.now()-start),audited:result.rows[0].audited}));
      if(result.rows[0].audited===0) break;
    }
  }
  await db.exec('analyze public.ht_crypto_legacy_evidence_audits');
  await timed('readiness','select source_table,preserved_legacy_observations,audited_records,missing_audits,evidence_mismatches from public.ht_crypto_legacy_audit_readiness');
  await timed('snapshot','select (public.ht_crypto_evidence_health_snapshot()->>\'version\') as version');
  const plan=await db.query("explain select * from public.ht_crypto_legacy_audit_readiness");
  console.log(plan.rows.map(r=>r['QUERY PLAN']).join('\n'));
}finally{await db.close();}
