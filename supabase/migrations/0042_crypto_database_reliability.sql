-- Database-only reliability repair. No provider requests, score changes, budget
-- resets, historical outcome edits, or order/trading-policy changes.
begin;
do $$ begin
  if to_regprocedure('public.ht_coinapi_recover_bounded_timeouts()') is null then
    raise exception 'Apply migration 0041 first';
  end if;
end $$;

-- Transaction-maintained source fingerprints: initial rows must be actually
-- hashed by the bounded audit; never copy an old audit hash as verification.
create table if not exists public.ht_crypto_legacy_source_fingerprints (
  source_table text not null references public.ht_crypto_outcome_source_policy(source_table),
  observation_id uuid not null,
  source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null default clock_timestamp(),
  primary key(source_table,observation_id)
);
alter table public.ht_crypto_legacy_source_fingerprints enable row level security;
revoke all on public.ht_crypto_legacy_source_fingerprints from public,anon,authenticated,service_role;
grant select on public.ht_crypto_legacy_source_fingerprints to service_role;

-- Independent of the original immutability guards. A source change (including
-- an owner repair with the old guard temporarily disabled) updates this hash in
-- the SAME transaction; existing audit hashes are never rewritten.
create or replace function public.ht_crypto_fingerprint_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP = 'TRUNCATE' then raise exception 'Preserve original crypto evidence; truncation forbidden'; end if;
  if TG_OP = 'DELETE' then return OLD; end if; -- source/audit anti-join exposes deletion
  if NEW.outcome_tracking_status <> 'legacy_quarantined' then return NEW; end if;
  if TG_OP = 'UPDATE' and (to_jsonb(NEW)-'updated_at') = (to_jsonb(OLD)-'updated_at') then return NEW; end if;
  insert into public.ht_crypto_legacy_source_fingerprints(source_table,observation_id,source_sha256)
    values(TG_TABLE_NAME,NEW.id,encode(sha256(convert_to((to_jsonb(NEW)-'updated_at')::text,'UTF8')),'hex'))
  on conflict(source_table,observation_id) do update set source_sha256=excluded.source_sha256,verified_at=clock_timestamp();
  return NEW;
end $$;
revoke all on function public.ht_crypto_fingerprint_guard() from public,anon,authenticated,service_role;
do $$ declare tab text; begin
  foreach tab in array array['ht_crypto_prox_observations','ht_crypto_discovery_observations'] loop
    execute format('drop trigger if exists ht_crypto_fingerprint_guard on public.%I',tab);
    execute format('create trigger ht_crypto_fingerprint_guard after insert or update or delete on public.%I for each row execute function public.ht_crypto_fingerprint_guard()',tab);
    execute format('drop trigger if exists ht_crypto_no_archive_truncate on public.%I',tab);
    execute format('create trigger ht_crypto_no_archive_truncate before truncate on public.%I for each statement execute function public.ht_crypto_fingerprint_guard()',tab);
  end loop;
end $$;
create index if not exists ht_crypto_source_fingerprint_cover on
  public.ht_crypto_legacy_source_fingerprints(source_table,observation_id) include(source_sha256);
create index if not exists ht_crypto_research_recent_episodes on
  public.ht_crypto_research_episodes(decision_at,market_id);

create or replace function public.ht_crypto_audit_legacy_evidence(p_limit integer default 2000)
returns integer language plpgsql security definer set search_path='' set statement_timeout='6s' set lock_timeout='500ms' as $$
declare n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20000 then raise exception 'Invalid audit batch size'; end if;
  -- One archive worker at a time; no live-account/control locks are acquired.
  if not pg_try_advisory_xact_lock(4242, 42) then return -1; end if;
  with pending as materialized (
    select 'ht_crypto_prox_observations'::text as source_table,o.id as observation_id
    from public.ht_crypto_prox_observations o
    where o.outcome_tracking_status='legacy_quarantined' and (not exists(
      select 1 from public.ht_crypto_legacy_evidence_audits a
      where a.source_table='ht_crypto_prox_observations' and a.observation_id=o.id)
      or not exists(select 1 from public.ht_crypto_legacy_source_fingerprints f
        where f.source_table='ht_crypto_prox_observations' and f.observation_id=o.id))
    union all
    select 'ht_crypto_discovery_observations',o.id
    from public.ht_crypto_discovery_observations o
    where o.outcome_tracking_status='legacy_quarantined' and (not exists(
      select 1 from public.ht_crypto_legacy_evidence_audits a
      where a.source_table='ht_crypto_discovery_observations' and a.observation_id=o.id)
      or not exists(select 1 from public.ht_crypto_legacy_source_fingerprints f
        where f.source_table='ht_crypto_discovery_observations' and f.observation_id=o.id))
    order by source_table,observation_id limit p_limit
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
  ) select count(*) into n from pending;
  return n;
end $$;
revoke all on function public.ht_crypto_audit_legacy_evidence(integer) from public,anon,authenticated;
grant execute on function public.ht_crypto_audit_legacy_evidence(integer) to service_role;

create or replace view public.ht_crypto_legacy_audit_readiness with (security_invoker = true) as
with audit_counts as (
  select 'ht_crypto_prox_observations'::text as source_table,
    count(a.observation_id) as audited_records,
    count(o.id) filter(where a.observation_id is null) as missing_audits,
    coalesce(sum(case when a.observation_id is null then 0 when o.id is null then 1
      when f.observation_id is null or a.source_sha256 <> f.source_sha256
      then 1 else 0 end),0)::bigint as evidence_mismatches,
    count(a.observation_id) filter(where a.status='review_required') as reviews_required
  from (select id from public.ht_crypto_prox_observations where outcome_tracking_status='legacy_quarantined') o
  left join (select observation_id,source_sha256 from public.ht_crypto_legacy_source_fingerprints
    where source_table='ht_crypto_prox_observations') f on f.observation_id=o.id
  full join (select observation_id,source_sha256,status from public.ht_crypto_legacy_evidence_audits
    where source_table='ht_crypto_prox_observations') a on a.observation_id=o.id
  union all
  select 'ht_crypto_discovery_observations'::text as source_table,
    count(a.observation_id) as audited_records,
    count(o.id) filter(where a.observation_id is null) as missing_audits,
    coalesce(sum(case when a.observation_id is null then 0 when o.id is null then 1
      when f.observation_id is null or a.source_sha256 <> f.source_sha256
      then 1 else 0 end),0)::bigint as evidence_mismatches,
    count(a.observation_id) filter(where a.status='review_required') as reviews_required
  from (select id from public.ht_crypto_discovery_observations where outcome_tracking_status='legacy_quarantined') o
  left join (select observation_id,source_sha256 from public.ht_crypto_legacy_source_fingerprints
    where source_table='ht_crypto_discovery_observations') f on f.observation_id=o.id
  full join (select observation_id,source_sha256,status from public.ht_crypto_legacy_evidence_audits
    where source_table='ht_crypto_discovery_observations') a on a.observation_id=o.id
)
select t.*,a.audited_records,a.missing_audits,a.evidence_mismatches,a.reviews_required,
  (select count(*)=3 from pg_trigger g where g.tgrelid=to_regclass('public.'||t.source_table)
    and not g.tgisinternal and g.tgenabled in ('O','A')
    and ((g.tgname='ht_crypto_observation_only' and g.tgfoid='public.ht_crypto_observation_only_guard()'::regprocedure)
      or (g.tgname='ht_crypto_legacy_outcome_guard' and g.tgfoid='public.ht_crypto_guard_legacy_outcomes()'::regprocedure)
      or (g.tgname='ht_crypto_fingerprint_guard' and g.tgfoid='public.ht_crypto_fingerprint_guard()'::regprocedure))) as guards_enabled,
  not has_table_privilege('service_role','public.'||t.source_table,'DELETE') and
    not has_table_privilege('service_role','public.'||t.source_table,'TRUNCATE') and not has_table_privilege('service_role','public.ht_crypto_legacy_source_fingerprints','INSERT,UPDATE,DELETE,TRUNCATE') as deletion_protected
from public.ht_crypto_legacy_tracking_readiness t join audit_counts a using(source_table);

create or replace function public.ht_coinapi_capture_research_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected jsonb; quotes jsonb; all_evidence jsonb; decisions jsonb; recent text[]; q jsonb; mid text; t timestamptz; book_time timestamptz; evidence jsonb; decision jsonb;
  entry_id uuid; episode_id uuid; verified boolean; h integer; entry_book public.ht_crypto_research_books%rowtype;
begin
  if NEW.status <> 'complete' or OLD.status = 'complete' then return NEW; end if;
  -- Old pilot frames lack this evidence contract; never retroactively bless them.
  if NEW.frame->>'dataContractVersion' is distinct from 'coinapi-research-data-v2' then return NEW; end if;
  t := (NEW.frame->>'decisionAt')::timestamptz;
  if t is null or t > clock_timestamp() + interval '2 seconds' or NEW.frame->>'provider' is distinct from 'coinapi' then
    raise exception 'Invalid research evidence clock/provider';
  end if;
  -- Detoast/extract the broad publication once, not once per market.
  selected := NEW.frame->'selectedMarkets';
  quotes := NEW.frame->'quotes';
  all_evidence := NEW.frame->'evidence';
  decisions := NEW.frame->'research'->'decisions';
  select coalesce(array_agg(distinct e.market_id),'{}'::text[]) into recent
    from public.ht_crypto_research_episodes e where e.decision_at between t-interval '62 minutes' and t;
  for q in select value from jsonb_array_elements(quotes)
    where coalesce(selected ? (value->>'marketId'),false) or (value->>'marketId') = any(recent)
  loop
    mid := q->>'marketId';
    if q->'book' is null or q->'book' = 'null'::jsonb then continue; end if;
    if q->'book'->>'symbolId' is distinct from mid then raise exception 'Research book market identity mismatch'; end if;
    book_time := (q->'book'->>'asOf')::timestamptz;
    if book_time is null or book_time > t or (q->'failures') ? 'conflicting_quote_versions' then continue; end if;
    insert into public.ht_crypto_research_books(cycle_id,market_id,provider_at,received_at,bid,ask,bid_size,ask_size)
    values(NEW.id,mid,book_time,t,(q->'book'->>'bid')::numeric,(q->'book'->>'ask')::numeric,
      (q->'book'->>'bidSize')::numeric,(q->'book'->>'askSize')::numeric);
  end loop;
  for mid in select value from jsonb_array_elements_text(selected) loop
    select value into evidence from jsonb_array_elements(all_evidence) where value->'identity'->>'marketId' = mid;
    select value into decision from jsonb_array_elements(decisions) where value->'identity'->>'marketId' = mid;
    select * into entry_book from public.ht_crypto_research_books where cycle_id = NEW.id and market_id = mid
      and provider_at between t - interval '15 seconds' and t;
    entry_id := entry_book.id;
    verified := entry_id is not null and evidence is not null and evidence->'identity'->>'provider' = 'coinapi'
      and evidence->'identity'->>'quote' = 'USD' and evidence->'identity'->>'base' = split_part(mid,'_',3)
      and (evidence->'book'->>'asOf')::timestamptz = entry_book.provider_at
      and (evidence->'book'->>'bid')::numeric = entry_book.bid and (evidence->'book'->>'ask')::numeric = entry_book.ask and
      (evidence->'trade'->>'asOf')::timestamptz between t - interval '30 seconds' and t and
      abs(extract(epoch from ((evidence->'trade'->>'asOf')::timestamptz - (evidence->'book'->>'asOf')::timestamptz))) <= 15;
    if not coalesce(verified,false) then entry_id := null; end if;
    episode_id := null;
    insert into public.ht_crypto_research_episodes(cycle_id,market_id,episode_hour,decision_at,input_evidence,
      research_decision,policy_version,entry_book_id,entry_status,entry_reason)
    values(NEW.id,mid,date_trunc('hour',t at time zone 'UTC') at time zone 'UTC',t,evidence,decision,
      coalesce(decision->>'policyVersion','crypto-live-research-v1'),entry_id,
      case when entry_id is null then 'unavailable' else 'verified' end,
      case when entry_id is null then 'unverified_entry_book' else null end)
    on conflict(market_id,episode_hour) do nothing returning id into episode_id;
    if episode_id is not null then
      foreach h in array ARRAY[300,900,1800,3600] loop
        insert into public.ht_crypto_research_outcomes(episode_id,horizon_seconds,target_at,status,reason,resolved_at)
        values(episode_id,h,t + make_interval(secs => h),
          case when entry_id is null then 'unavailable' else 'pending' end,
          case when entry_id is null then 'unverified_entry_book' else null end,
          case when entry_id is null then t else null end);
      end loop;
    end if;
  end loop;
  perform public.ht_coinapi_resolve_saved_outcomes(t);
  return NEW;
end $$;


-- Keep the complete old-history comparison available for explicit forensic
-- checks, but normal health uses transaction-maintained, protected fingerprints.
comment on table public.ht_crypto_legacy_source_fingerprints is
  'SHA256 of preserved source excluding updated_at; initial verification is bounded, changes are transactional, app writes forbidden. Not outcome provenance.';

analyze public.ht_crypto_legacy_source_fingerprints;
notify pgrst,'reload schema';
commit;
