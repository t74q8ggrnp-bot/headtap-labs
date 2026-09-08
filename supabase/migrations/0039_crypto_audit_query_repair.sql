-- Repair archive-scale timeouts without weakening evidence verification.
-- No original row, price, return, budget, provider cadence or trading rule changes.
begin;
do $$ begin
  if to_regclass('public.ht_crypto_legacy_evidence_audits') is null then
    raise exception 'Apply migration 0038 first';
  end if;
end $$;

create index if not exists ht_crypto_prox_legacy_audit_ids
  on public.ht_crypto_prox_observations(id) where outcome_tracking_status='legacy_quarantined';
create index if not exists ht_crypto_discovery_legacy_audit_ids
  on public.ht_crypto_discovery_observations(id) where outcome_tracking_status='legacy_quarantined';
create index if not exists ht_crypto_evidence_audit_cover
  on public.ht_crypto_legacy_evidence_audits(source_table,observation_id) include(source_sha256,status);

-- Select the bounded ID set BEFORE loading/serializing large saved packets.
create or replace function public.ht_crypto_audit_legacy_evidence(p_limit integer default 2000)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20000 then raise exception 'Invalid audit batch size'; end if;
  with pending as materialized (
    select 'ht_crypto_prox_observations'::text as source_table,o.id as observation_id
    from public.ht_crypto_prox_observations o
    where o.outcome_tracking_status='legacy_quarantined' and not exists(
      select 1 from public.ht_crypto_legacy_evidence_audits a
      where a.source_table='ht_crypto_prox_observations' and a.observation_id=o.id)
    union all
    select 'ht_crypto_discovery_observations',o.id
    from public.ht_crypto_discovery_observations o
    where o.outcome_tracking_status='legacy_quarantined' and not exists(
      select 1 from public.ht_crypto_legacy_evidence_audits a
      where a.source_table='ht_crypto_discovery_observations' and a.observation_id=o.id)
    order by source_table,observation_id limit p_limit
  ), inputs as (
    select p.source_table,p.observation_id,to_jsonb(o)-'updated_at' as original,
      jsonb_build_object('productId',o.product_id,'packet',o.prox_packet,'snapshot',o.decision_snapshot) as entry_context
    from pending p join public.ht_crypto_prox_observations o on o.id=p.observation_id
    where p.source_table='ht_crypto_prox_observations'
    union all
    select p.source_table,p.observation_id,to_jsonb(o)-'updated_at',
      jsonb_build_object('assetId',o.asset_id,'packet',o.discovery_packet)
    from pending p join public.ht_crypto_discovery_observations o on o.id=p.observation_id
    where p.source_table='ht_crypto_discovery_observations'
  )
  insert into public.ht_crypto_legacy_evidence_audits
    (source_table,observation_id,audit_version,source_sha256,status,reason,evidence)
  select i.source_table,i.observation_id,'legacy-saved-evidence-audit-v1',
    encode(sha256(convert_to(i.original::text,'UTF8')),'hex'),
    -- The documented legacy writers saved processing time/derived features, not
    -- entry quote provenance or per-horizon provider receipts. Unexpected raw
    -- evidence must be reviewed, never automatically dismissed or blessed.
    case when i.entry_context::text ~* '"(provider_at|providerAt|provider_timestamp|market_as_of|marketAsOf|time_exchange|time_coinapi|entry_evidence|outcome_evidence|source_evidence)"'
      then 'review_required' else 'unverifiable_from_saved_evidence' end,
    'saved_entry_and_horizon_provider_provenance_not_established',
    jsonb_build_object(
      'scope','saved_legacy_observation_only','providerRequests',0,
      'externalHistoricalReconstructionAttempted',false,
      'observedAt',i.original->'observed_at',
      'observedAtIsProcessingTime',true,
      'storedEntryPrice',coalesce(i.original->'entry_price',i.original->'entry_price_usd'),
      'identity',coalesce(i.original->'product_id',i.original->'asset_id'),
      'entryContextKeys',(select coalesce(jsonb_agg(k),'[]'::jsonb) from jsonb_object_keys(i.entry_context) k),
      'horizons',(select jsonb_agg(jsonb_build_object(
        'horizon',h,'targetAt',i.original->('target_'||h||'_at'),
        'storedPrice',coalesce(i.original->('price_'||h),i.original->('price_'||h||'_usd')),
        'storedReturnPercent',i.original->('return_'||h||'_percent'),
        'providerProvenanceVerified',false,
        'reason',case when coalesce(i.original->>('price_'||h),i.original->>('price_'||h||'_usd')) is null
          then 'no_saved_horizon_price_or_provider_receipt' else 'saved_price_has_no_verified_provider_receipt' end
      ) order by ord) from unnest(array['15m','1h','4h','24h']) with ordinality x(h,ord))
    )
  from inputs i
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ht_crypto_audit_legacy_evidence(integer) from public,anon,authenticated;
grant execute on function public.ht_crypto_audit_legacy_evidence(integer) to service_role;


-- Check every fingerprint exactly as before; join each source directly once.
-- Never serialize unaudited rows merely to find out that their audits are missing.
create or replace view public.ht_crypto_legacy_audit_readiness with (security_invoker = true) as
with audit_counts as (
  select 'ht_crypto_prox_observations'::text as source_table,
    count(a.observation_id) as audited_records,
    count(o.id) filter(where a.observation_id is null) as missing_audits,
    coalesce(sum(case when a.observation_id is null then 0 when o.id is null then 1
      when a.source_sha256 <> encode(sha256(convert_to((to_jsonb(o)-'updated_at')::text,'UTF8')),'hex')
      then 1 else 0 end),0)::bigint as evidence_mismatches,
    count(a.observation_id) filter(where a.status='review_required') as reviews_required
  from (select * from public.ht_crypto_prox_observations where outcome_tracking_status='legacy_quarantined') o
  full join (select observation_id,source_sha256,status from public.ht_crypto_legacy_evidence_audits
    where source_table='ht_crypto_prox_observations') a on a.observation_id=o.id
  union all
  select 'ht_crypto_discovery_observations'::text as source_table,
    count(a.observation_id) as audited_records,
    count(o.id) filter(where a.observation_id is null) as missing_audits,
    coalesce(sum(case when a.observation_id is null then 0 when o.id is null then 1
      when a.source_sha256 <> encode(sha256(convert_to((to_jsonb(o)-'updated_at')::text,'UTF8')),'hex')
      then 1 else 0 end),0)::bigint as evidence_mismatches,
    count(a.observation_id) filter(where a.status='review_required') as reviews_required
  from (select * from public.ht_crypto_discovery_observations where outcome_tracking_status='legacy_quarantined') o
  full join (select observation_id,source_sha256,status from public.ht_crypto_legacy_evidence_audits
    where source_table='ht_crypto_discovery_observations') a on a.observation_id=o.id
)
select t.*,a.audited_records,a.missing_audits,a.evidence_mismatches,a.reviews_required,
  (select count(*)=2 from pg_trigger g where g.tgrelid=to_regclass('public.'||t.source_table)
    and not g.tgisinternal and g.tgenabled in ('O','A')
    and ((g.tgname='ht_crypto_observation_only' and g.tgfoid='public.ht_crypto_observation_only_guard()'::regprocedure)
      or (g.tgname='ht_crypto_legacy_outcome_guard' and g.tgfoid='public.ht_crypto_guard_legacy_outcomes()'::regprocedure))) as guards_enabled,
  not has_table_privilege('service_role','public.'||t.source_table,'DELETE') and
    not has_table_privilege('service_role','public.'||t.source_table,'TRUNCATE') as deletion_protected
from public.ht_crypto_legacy_tracking_readiness t join audit_counts a using(source_table);

-- Live outcome resolution must commit independently of archive maintenance.
-- The collector runs the bounded archive RPC separately AFTER collection.
create or replace function public.ht_coinapi_research_maintenance()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if to_regclass('public.ht_crypto_legacy_evidence_audits') is null then
    raise exception 'Crypto evidence audit schema required';
  end if;
  return jsonb_build_object('resolved',public.ht_coinapi_resolve_saved_outcomes(clock_timestamp()),
    'legacyAudited',0,'legacyAuditScheduledSeparately',true,
    'providerRequests',0,'executionAuthorized',false);
end $$;

-- Refresh planner estimates: these tables can contain hundreds of thousands of
-- records even though small development fixtures passed the original tests.
analyze public.ht_crypto_outcome_source_policy;
analyze public.ht_crypto_prox_observations;
analyze public.ht_crypto_discovery_observations;
analyze public.ht_crypto_legacy_evidence_audits;

-- Full-history SHA verification is intentionally still exhaustive. Give ONLY
-- this read-only RPC a bounded archive-inspection execution allowance. This is
-- not a quote-age threshold, a freshness exception, or a role-wide timeout.
-- PostgREST hoists this function setting before the transaction starts.
alter function public.ht_crypto_evidence_health_snapshot() set statement_timeout='30s';
notify pgrst,'reload schema';
commit;
