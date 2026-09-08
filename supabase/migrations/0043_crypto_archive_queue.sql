-- Bounded archive selection: replace repeated whole-history anti-joins with an
-- indexed private queue. No source history, fills, prices or budgets are deleted.
begin;
do $$ begin
  if to_regclass('public.ht_crypto_legacy_source_fingerprints') is null then
    raise exception 'Apply migration 0042 first';
  end if;
end $$;

create table if not exists public.ht_crypto_legacy_audit_queue (
  source_table text not null references public.ht_crypto_outcome_source_policy(source_table),
  observation_id uuid not null,
  primary key(source_table,observation_id)
);
alter table public.ht_crypto_legacy_audit_queue enable row level security;
revoke all on public.ht_crypto_legacy_audit_queue from public,anon,authenticated,service_role;
grant select on public.ht_crypto_legacy_audit_queue to service_role;

-- One-time metadata-only seed. LEFT JOIN (not OR-correlated subplans) keeps the
-- planner from re-reading large audit sets for each source ID under small work_mem.
insert into public.ht_crypto_legacy_audit_queue(source_table,observation_id)
select 'ht_crypto_prox_observations',o.id from public.ht_crypto_prox_observations o
left join public.ht_crypto_legacy_evidence_audits a on a.source_table='ht_crypto_prox_observations' and a.observation_id=o.id
left join public.ht_crypto_legacy_source_fingerprints f on f.source_table='ht_crypto_prox_observations' and f.observation_id=o.id
where o.outcome_tracking_status='legacy_quarantined' and (a.observation_id is null or f.observation_id is null)
union all
select 'ht_crypto_discovery_observations',o.id from public.ht_crypto_discovery_observations o
left join public.ht_crypto_legacy_evidence_audits a on a.source_table='ht_crypto_discovery_observations' and a.observation_id=o.id
left join public.ht_crypto_legacy_source_fingerprints f on f.source_table='ht_crypto_discovery_observations' and f.observation_id=o.id
where o.outcome_tracking_status='legacy_quarantined' and (a.observation_id is null or f.observation_id is null)
on conflict do nothing;

-- A privileged removal of a verification record schedules repair. Application
-- roles cannot delete these records. Audit hashes that exist are never replaced.
create or replace function public.ht_crypto_requeue_removed_verification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.ht_crypto_legacy_audit_queue(source_table,observation_id)
    values(OLD.source_table,OLD.observation_id) on conflict do nothing;
  return OLD;
end $$;
revoke all on function public.ht_crypto_requeue_removed_verification() from public,anon,authenticated,service_role;
drop trigger if exists ht_crypto_requeue_removed on public.ht_crypto_legacy_source_fingerprints;
create trigger ht_crypto_requeue_removed after delete on public.ht_crypto_legacy_source_fingerprints
  for each row execute function public.ht_crypto_requeue_removed_verification();
drop trigger if exists ht_crypto_requeue_removed on public.ht_crypto_legacy_evidence_audits;
create trigger ht_crypto_requeue_removed after delete on public.ht_crypto_legacy_evidence_audits
  for each row execute function public.ht_crypto_requeue_removed_verification();

create or replace function public.ht_crypto_audit_legacy_evidence(p_limit integer default 2000)
returns integer language plpgsql security definer set search_path='' set statement_timeout='6s' set lock_timeout='500ms' as $$
declare n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20000 then raise exception 'Invalid audit batch size'; end if;
  -- One archive worker at a time; no live-account/control locks are acquired.
  if not pg_try_advisory_xact_lock(4242, 42) then return -1; end if;
  with pending as materialized (
    select q.source_table,q.observation_id from public.ht_crypto_legacy_audit_queue q
    order by q.source_table,q.observation_id limit p_limit for update of q skip locked
  ), inputs as materialized (
    select p.source_table,p.observation_id,to_jsonb(o)-'updated_at' as original,
      jsonb_build_object('productId',o.product_id,'packet',o.prox_packet,'snapshot',o.decision_snapshot) as entry_context
    from pending p join public.ht_crypto_prox_observations o on o.id=p.observation_id
    where p.source_table='ht_crypto_prox_observations'
    union all
    select p.source_table,p.observation_id,to_jsonb(o)-'updated_at',
      jsonb_build_object('assetId',o.asset_id,'packet',o.discovery_packet)
    from pending p join public.ht_crypto_discovery_observations o on o.id=p.observation_id
    where p.source_table='ht_crypto_discovery_observations'
  ), fingerprints as (
    insert into public.ht_crypto_legacy_source_fingerprints(source_table,observation_id,source_sha256)
    select source_table,observation_id,encode(sha256(convert_to(original::text,'UTF8')),'hex') from inputs
    on conflict do nothing returning observation_id
  ), audits as (
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
  on conflict do nothing returning observation_id
  ), completed as (
    delete from public.ht_crypto_legacy_audit_queue q using pending p
    where q.source_table=p.source_table and q.observation_id=p.observation_id
    returning q.observation_id
  ) select count(*) into n from completed;
  return n;
end $$;
revoke all on function public.ht_crypto_audit_legacy_evidence(integer) from public,anon,authenticated;
grant execute on function public.ht_crypto_audit_legacy_evidence(integer) to service_role;

analyze public.ht_crypto_legacy_audit_queue;
notify pgrst,'reload schema';
commit;
