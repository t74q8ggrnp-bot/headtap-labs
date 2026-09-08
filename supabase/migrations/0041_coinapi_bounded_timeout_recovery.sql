-- Recover transport timeouts using documented MAXIMUM request cost, never a
-- fabricated provider receipt. No refund, new budget, cadence or price change.
begin;

create table if not exists public.ht_coinapi_pilot_cost_holds (
  request_id uuid primary key references public.ht_coinapi_pilot_requests(id),
  created_at timestamptz not null default clock_timestamp(),
  policy_version text not null check (policy_version='coinapi-bounded-timeout-v1'),
  maximum_credits numeric not null check (maximum_credits=1),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  basis text not null check (basis='documented_request_limit_full_reservation'),
  source_url text not null check (source_url='https://docs.coinapi.io/market-data/api-limits-and-billing-metrics')
);
alter table public.ht_coinapi_pilot_cost_holds enable row level security;
revoke all on public.ht_coinapi_pilot_cost_holds from public,anon,authenticated,service_role;
grant select on public.ht_coinapi_pilot_cost_holds to service_role;

-- These are the ONLY request shapes emitted by this collector. Unknown query
-- parameters, duplicate limits, >100 bars, unrecognized endpoints never qualify.
create or replace function public.ht_coinapi_one_credit_path(p_path text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    p_path in ('/v1/quotes/current?filter_exchange_id=COINBASE,KRAKEN,CRYPTOCOM',
               '/v1/symbols?filter_exchange_id=COINBASE,KRAKEN,CRYPTOCOM') or
    p_path ~ '^/v1/ohlcv/(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD/latest\?period_id=1MIN&limit=([1-9][0-9]?|100)$',false);
$$;

create or replace function public.ht_coinapi_request_hold_valid(p_request uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ht_coinapi_pilot_requests r
    join public.ht_coinapi_pilot_cycles c on c.id=r.cycle_id
    join public.ht_coinapi_pilot_cost_holds h on h.request_id=r.id
    where r.id=p_request and r.reported_credits is null and r.http_status=0
      and r.settled_at is not null and r.settled_at>=r.reserved_at
      and c.status='failed' and r.reserved_credits=1 and h.maximum_credits=1
      and h.policy_version='coinapi-bounded-timeout-v1'
      and h.basis='documented_request_limit_full_reservation'
      and public.ht_coinapi_one_credit_path(r.path)
      and h.request_sha256=encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'));
$$;

create or replace function public.ht_coinapi_recover_bounded_timeouts()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ht_coinapi_pilot_control%rowtype; n timestamptz:=clock_timestamp(); added integer:=0;
  expected_lifetime numeric; expected_today numeric; unresolved bigint;
begin
  -- Same lock as reservations and settlement. Never release a running collector.
  select * into strict c from public.ht_coinapi_pilot_control where id='global' for update;
  if not c.enabled or c.lease_until>n then
    return jsonb_build_object('recovered',false,'reason','disabled_or_active_cycle','providerRequests',0);
  end if;
  if c.blocked_reason is distinct from 'unknown_provider_cost' then
    return jsonb_build_object('recovered',false,'reason','no_recoverable_pause','providerRequests',0);
  end if;
  -- A charge exceeding its reservation, an entitlement/rate-limit error or an
  -- unresolved DB write cannot be disguised as a bounded network timeout.
  if exists(select 1 from public.ht_coinapi_pilot_requests r where
      r.settled_at is null or r.http_status in (401,403,429) or
      r.reported_credits>r.reserved_credits or r.reported_credits in ('NaN'::numeric,'Infinity'::numeric)) then
    return jsonb_build_object('recovered',false,'reason','unbounded_or_access_error','providerRequests',0);
  end if;
  select coalesce(sum(greatest(r.reserved_credits,coalesce(r.reported_credits,r.reserved_credits))),0),
    coalesce(sum(greatest(r.reserved_credits,coalesce(r.reported_credits,r.reserved_credits)))
      filter(where (r.reserved_at at time zone 'UTC')::date=c.credit_day),0)
    into expected_lifetime,expected_today from public.ht_coinapi_pilot_requests r;
  if c.lifetime_reserved<expected_lifetime or c.daily_reserved<expected_today then
    return jsonb_build_object('recovered',false,'reason','reservation_mismatch','providerRequests',0);
  end if;
  insert into public.ht_coinapi_pilot_cost_holds(request_id,policy_version,maximum_credits,request_sha256,basis,source_url)
    select r.id,'coinapi-bounded-timeout-v1',1,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
      'documented_request_limit_full_reservation','https://docs.coinapi.io/market-data/api-limits-and-billing-metrics'
    from public.ht_coinapi_pilot_requests r join public.ht_coinapi_pilot_cycles f on f.id=r.cycle_id
    where r.reported_credits is null and r.http_status=0 and r.settled_at is not null
      and r.settled_at>=r.reserved_at and r.reserved_credits=1 and f.status='failed'
      and r.settled_at<=n-interval '15 seconds' and public.ht_coinapi_one_credit_path(r.path)
    on conflict do nothing;
  get diagnostics added=row_count;
  select count(*) into unresolved from public.ht_coinapi_pilot_requests r
    where r.reported_credits is null and not public.ht_coinapi_request_hold_valid(r.id);
  if unresolved>0 then return jsonb_build_object('recovered',false,'reason','unbounded_request_cost',
    'newHolds',added,'unresolved',unresolved,'providerRequests',0); end if;
  -- Only the old pause is released. Every reservation remains charged at its
  -- full maximum. The original null receipt/status and failed cycle are intact.
  update public.ht_coinapi_pilot_control set blocked_reason=null,updated_at=n where id='global';
  return jsonb_build_object('recovered',true,'newHolds',added,'policyVersion','coinapi-bounded-timeout-v1',
    'reportedChargeStillUnknown',true,'providerRequests',0);
end $$;

create or replace function public.ht_coinapi_pilot_accounting_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('version','coinapi-bounded-timeout-v1',
    'heldUnknownRequests',(select count(*) from public.ht_coinapi_pilot_requests r where public.ht_coinapi_request_hold_valid(r.id)),
    'heldMaximumCredits',(select coalesce(sum(h.maximum_credits),0) from public.ht_coinapi_pilot_cost_holds h where public.ht_coinapi_request_hold_valid(h.request_id)),
    'unboundedUnknownRequests',(select count(*) from public.ht_coinapi_pilot_requests r where r.settled_at is not null
      and r.reported_credits is null and not public.ht_coinapi_request_hold_valid(r.id)),
    'invalidHolds',(select count(*) from public.ht_coinapi_pilot_cost_holds h where not public.ht_coinapi_request_hold_valid(h.request_id)),
    'reservationCovered',c.lifetime_reserved >= (select coalesce(sum(greatest(r.reserved_credits,coalesce(r.reported_credits,r.reserved_credits))),0) from public.ht_coinapi_pilot_requests r)
      and c.daily_reserved >= (select coalesce(sum(greatest(r.reserved_credits,coalesce(r.reported_credits,r.reserved_credits))),0)
        from public.ht_coinapi_pilot_requests r where (r.reserved_at at time zone 'UTC')::date=c.credit_day),
    'receiptNotFabricated',true,'providerRequests',0)
  from public.ht_coinapi_pilot_control c where c.id='global';
$$;

-- Preserve the entire existing atomic health snapshot and its criteria. Add
-- explicit accounting provenance so a hold is never reported as a paid receipt.
do $$ begin
  if to_regprocedure('public.ht_crypto_evidence_health_v0039()') is null then
    alter function public.ht_crypto_evidence_health_snapshot() rename to ht_crypto_evidence_health_v0039;
  end if;
end $$;
create or replace function public.ht_crypto_evidence_health_snapshot()
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='30s' as $$
  select public.ht_crypto_evidence_health_v0039() ||
    jsonb_build_object('accounting',public.ht_coinapi_pilot_accounting_snapshot());
$$;

-- Only old failed, fully reserved transport attempts may use cost holds.
-- Current publication requests still need real successful provider receipts.
create or replace function public.ht_crypto_paper_quote(p_market text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.ht_coinapi_pilot_control%rowtype; f public.ht_coinapi_pilot_cycles%rowtype; q jsonb;
begin
  select * into c from public.ht_coinapi_pilot_control where id='global';
  if not coalesce(c.enabled,false) or c.blocked_reason is not null then
    return jsonb_build_object('ok',false,'reason','collector_paused'); end if;
  select * into f from public.ht_coinapi_pilot_cycles where id=c.latest_cycle_id and status='complete';
  if f.id is null or f.frame->>'provider' is distinct from 'coinapi' or
     f.frame->>'dataContractVersion' is distinct from 'coinapi-research-data-v2' or
     f.frame->>'authority' is distinct from 'research_only' or
     f.frame->>'executionAuthorized' is distinct from 'false' or
     f.evidence_sha256 !~ '^[a-f0-9]{64}$' or
     exists(select 1 from public.ht_coinapi_pilot_requests r where r.settled_at is null or
       (r.reported_credits is null and not public.ht_coinapi_request_hold_valid(r.id))) or
     (public.ht_coinapi_pilot_accounting_snapshot()->>'reservationCovered') is distinct from 'true' then
    return jsonb_build_object('ok',false,'reason','publication_unverified'); end if;
  if (f.frame->>'decisionAt')::timestamptz is null or
     (f.frame->>'decisionAt')::timestamptz < clock_timestamp()-interval '90 seconds' or
     (f.frame->>'decisionAt')::timestamptz > clock_timestamp() then
    return jsonb_build_object('ok',false,'reason','collection_stale'); end if;
  select value into q from jsonb_array_elements(f.frame->'quotes') where value->>'marketId'=p_market;
  if q is null or p_market !~ '^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD$' or
     (select count(*) from jsonb_array_elements(f.frame->'quotes') where value->>'marketId'=p_market)<>1 or
     not exists(select 1 from jsonb_array_elements(f.frame->'coverage') x where x->>'marketId'=p_market
       and x->>'status' in ('evaluated','quote_only_not_deep_scored')) or
     exists(select 1 from jsonb_array_elements(f.frame->'coverage') x where x->>'marketId'=p_market and x->>'status'='asset_policy_excluded') then
    return jsonb_build_object('ok',false,'reason','market_unavailable'); end if;
  if q->'book'->>'symbolId' is distinct from p_market or q->'trade'->>'symbolId' is distinct from p_market or
     coalesce(jsonb_array_length(q->'failures'),1)<>0 or
     not coalesce((q->'book'->>'bid')::numeric>0 and (q->'book'->>'ask')::numeric>=(q->'book'->>'bid')::numeric
       and (q->'book'->>'ask')::numeric<'Infinity'::numeric and (q->'trade'->>'price')::numeric>0
       and (q->'trade'->>'price')::numeric<'Infinity'::numeric,false) then
    return jsonb_build_object('ok',false,'reason','market_evidence_invalid'); end if;
  if q->'book'->>'bid' is null or q->'book'->>'ask' is null or q->'trade'->>'price' is null or
     q->'book'->>'asOf' is null or q->'trade'->>'asOf' is null then
    return jsonb_build_object('ok',false,'reason','market_evidence_missing'); end if;
  return jsonb_build_object('ok',true,'cycleId',f.id,'evidenceHash',f.evidence_sha256,
    'decisionAt',f.frame->'decisionAt','quote',q);
end $$;

revoke all on function public.ht_coinapi_one_credit_path(text),public.ht_coinapi_request_hold_valid(uuid),
  public.ht_coinapi_recover_bounded_timeouts(),public.ht_coinapi_pilot_accounting_snapshot(),
  public.ht_crypto_evidence_health_snapshot(),public.ht_crypto_evidence_health_v0039()
  from public,anon,authenticated;
grant execute on function public.ht_coinapi_one_credit_path(text),public.ht_coinapi_request_hold_valid(uuid),
  public.ht_coinapi_recover_bounded_timeouts(),public.ht_coinapi_pilot_accounting_snapshot(),
  public.ht_crypto_evidence_health_snapshot(),public.ht_crypto_evidence_health_v0039() to service_role;

-- One safe recovery on application, then the cron repeats this idempotently.
select public.ht_coinapi_recover_bounded_timeouts();
notify pgrst,'reload schema';
commit;
