-- Audit saved legacy evidence, not historical market reconstruction.
-- No original observation, price, return, score, allowance or order is changed.
begin;
do $$ begin
  if to_regclass('public.ht_crypto_legacy_tracking_readiness') is null then
    raise exception 'Apply migration 0037 first';
  end if;
end $$;

create table if not exists public.ht_crypto_legacy_evidence_audits (
  source_table text not null references public.ht_crypto_outcome_source_policy(source_table),
  observation_id uuid not null,
  audit_version text not null check (audit_version = 'legacy-saved-evidence-audit-v1'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('unverifiable_from_saved_evidence','review_required')),
  reason text not null,
  evidence jsonb not null,
  audited_at timestamptz not null default now(),
  evaluation_allowed boolean not null default false check (evaluation_allowed = false),
  primary key(source_table,observation_id)
);
alter table public.ht_crypto_legacy_evidence_audits enable row level security;
revoke all on public.ht_crypto_legacy_evidence_audits from public,anon,authenticated,service_role;
grant select on public.ht_crypto_legacy_evidence_audits to service_role;

-- Keep the exact original row in its existing immutable table. Fingerprints
-- exclude only updated_at, the sole mutable administrative field allowed by 0037.
create or replace view public.ht_crypto_legacy_audit_inputs with (security_invoker = true) as
select 'ht_crypto_prox_observations'::text as source_table,id as observation_id,
  to_jsonb(o)-'updated_at' as original,
  jsonb_build_object('productId',product_id,'packet',prox_packet,'snapshot',decision_snapshot) as entry_context
from public.ht_crypto_prox_observations o where outcome_tracking_status='legacy_quarantined'
union all
select 'ht_crypto_discovery_observations',id,to_jsonb(o)-'updated_at',
  jsonb_build_object('assetId',asset_id,'packet',discovery_packet)
from public.ht_crypto_discovery_observations o where outcome_tracking_status='legacy_quarantined';
revoke all on public.ht_crypto_legacy_audit_inputs from public,anon,authenticated;
grant select on public.ht_crypto_legacy_audit_inputs to service_role;

create or replace function public.ht_crypto_audit_legacy_evidence(p_limit integer default 2000)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20000 then raise exception 'Invalid audit batch size'; end if;
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
  from public.ht_crypto_legacy_audit_inputs i
  where not exists(select 1 from public.ht_crypto_legacy_evidence_audits a
    where a.source_table=i.source_table and a.observation_id=i.observation_id)
  order by i.source_table,i.observation_id limit p_limit
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ht_crypto_audit_legacy_evidence(integer) from public,anon,authenticated;
grant execute on function public.ht_crypto_audit_legacy_evidence(integer) to service_role;

create or replace view public.ht_crypto_legacy_audit_readiness with (security_invoker = true) as
select t.*,
  (select count(*) from public.ht_crypto_legacy_evidence_audits a where a.source_table=t.source_table) as audited_records,
  (select count(*) from public.ht_crypto_legacy_audit_inputs i left join public.ht_crypto_legacy_evidence_audits a
    on a.source_table=i.source_table and a.observation_id=i.observation_id
    where i.source_table=t.source_table and a.observation_id is null) as missing_audits,
  (select count(*) from public.ht_crypto_legacy_evidence_audits a left join public.ht_crypto_legacy_audit_inputs i
    on a.source_table=i.source_table and a.observation_id=i.observation_id
    where a.source_table=t.source_table and (i.observation_id is null or
      a.source_sha256 <> encode(sha256(convert_to(i.original::text,'UTF8')),'hex'))) as evidence_mismatches,
  (select count(*) from public.ht_crypto_legacy_evidence_audits a where a.source_table=t.source_table
    and a.status='review_required') as reviews_required,
  (select count(*)=2 from pg_trigger g where g.tgrelid=to_regclass('public.'||t.source_table)
    and not g.tgisinternal and g.tgenabled in ('O','A')
    and ((g.tgname='ht_crypto_observation_only' and g.tgfoid='public.ht_crypto_observation_only_guard()'::regprocedure)
      or (g.tgname='ht_crypto_legacy_outcome_guard' and g.tgfoid='public.ht_crypto_guard_legacy_outcomes()'::regprocedure))) as guards_enabled,
  not has_table_privilege('service_role','public.'||t.source_table,'DELETE') and
    not has_table_privilege('service_role','public.'||t.source_table,'TRUNCATE') as deletion_protected
from public.ht_crypto_legacy_tracking_readiness t;
revoke all on public.ht_crypto_legacy_audit_readiness from public,anon,authenticated;
grant select on public.ht_crypto_legacy_audit_readiness to service_role;

-- Maintenance costs zero provider requests and continues under a budget pause.
create or replace function public.ht_coinapi_research_maintenance()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return jsonb_build_object('resolved',public.ht_coinapi_resolve_saved_outcomes(clock_timestamp()),
    'legacyAudited',public.ht_crypto_audit_legacy_evidence(2000),
    'providerRequests',0,'executionAuthorized',false);
end $$;

-- One statement snapshot prevents latest-pointer/frame/receipt races.
-- Only the server may call it; public health exposes aggregates, not raw frames.
create or replace function public.ht_crypto_evidence_health_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'version','crypto-evidence-health-v1','checkedAt',now(),
    'archive',(select jsonb_agg(to_jsonb(a) order by source_table) from public.ht_crypto_legacy_audit_readiness a),
    'control',(select to_jsonb(c)-'state' from public.ht_coinapi_pilot_control c where id='global'),
    'publication',(select to_jsonb(p) from public.ht_coinapi_pilot_cycles p
      join public.ht_coinapi_pilot_control c on c.latest_cycle_id=p.id where c.id='global'),
    'latestAttempt',(select to_jsonb(p)-'frame' from public.ht_coinapi_pilot_cycles p order by started_at desc limit 1),
    'receipts',(select jsonb_build_object('count',count(*),'unsettled',count(*) filter(where settled_at is null),
      'unknownCosts',count(*) filter(where settled_at is not null and reported_credits is null),
      'reportedCredits',sum(reported_credits),'latestRequestAt',max(reserved_at),
      'publicationRequests',count(*) filter(where cycle_id=(select latest_cycle_id from public.ht_coinapi_pilot_control where id='global')),
      'publicationErrors',count(*) filter(where cycle_id=(select latest_cycle_id from public.ht_coinapi_pilot_control where id='global') and
        (settled_at is null or reported_credits is null or http_status not between 200 and 299 or http_status is null)),
      'publicationCredits',sum(reported_credits) filter(where cycle_id=(select latest_cycle_id from public.ht_coinapi_pilot_control where id='global')))
      from public.ht_coinapi_pilot_requests),
    'ledger',(select to_jsonb(r) from public.ht_crypto_research_readiness r),
    'ledgerIntegrity',jsonb_build_object(
      'verifiedEntries',(select count(*) from public.ht_crypto_research_episodes where entry_status='verified'),
      'missingHorizons',(select count(*) from public.ht_crypto_research_episodes e cross join unnest(array[300,900,1800,3600]) h
        where not exists(select 1 from public.ht_crypto_research_outcomes o where o.episode_id=e.id and o.horizon_seconds=h)),
      'invalidOutcomes',(select count(*) from public.ht_crypto_research_outcomes o
        join public.ht_crypto_research_episodes e on e.id=o.episode_id
        left join public.ht_crypto_research_books b on b.id=o.exit_book_id
        left join public.ht_crypto_research_books entry on entry.id=e.entry_book_id
        where o.target_at <> e.decision_at + make_interval(secs=>o.horizon_seconds)
          or (o.status='observed' and (entry.id is null or b.id is null or b.market_id <> e.market_id or entry.market_id <> e.market_id
            or b.provider_at not between o.target_at-interval '5 seconds' and o.target_at
            or entry.provider_at not between e.decision_at-interval '15 seconds' and e.decision_at
            or abs(o.gross_quote_return_percent - (b.bid/entry.ask-1)*100) > 0.00000001))
          or (o.status='unavailable' and (o.reason is null or o.gross_quote_return_percent is not null or o.exit_book_id is not null))),
      'maturedHorizons',(select count(*) from public.ht_crypto_research_outcomes where target_at < now()-interval '90 seconds')
    )
  );
$$;
revoke all on function public.ht_crypto_evidence_health_snapshot() from public,anon,authenticated;
grant execute on function public.ht_crypto_evidence_health_snapshot() to service_role;

-- Bounded first batch. Subsequent scheduled maintenance drains larger archives.
select public.ht_crypto_audit_legacy_evidence(20000);
commit;
