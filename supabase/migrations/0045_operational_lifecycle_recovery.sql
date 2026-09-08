-- Close two outage-exposed lifecycle gaps without changing provider budgets,
-- scoring, Agent policy/mode, balances, orders or execution authority.
begin;

do $$ begin
  if to_regprocedure('public.ht_coinapi_recover_bounded_timeouts()') is null then
    raise exception 'Apply migration 0041 first';
  end if;
  if to_regclass('public.ht_agent_runs') is null then
    raise exception 'Apply migration 0030 first';
  end if;
end $$;

-- Preserve an unsettled database-write ambiguity as an immutable full-cost
-- hold. The raw request stays unsettled with a null provider receipt; no refund
-- or invented HTTP response is written and no provider request is made here.
create table if not exists public.ht_coinapi_unsettled_cost_holds (
  request_id uuid primary key references public.ht_coinapi_pilot_requests(id),
  created_at timestamptz not null default clock_timestamp(),
  policy_version text not null check(policy_version='coinapi-unsettled-write-max-hold-v1'),
  maximum_credits numeric not null check(maximum_credits=1),
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  basis text not null check(basis='database_settlement_write_unconfirmed_full_reservation')
);
alter table public.ht_coinapi_unsettled_cost_holds enable row level security;
revoke all on public.ht_coinapi_unsettled_cost_holds from public,anon,authenticated,service_role;
grant select on public.ht_coinapi_unsettled_cost_holds to service_role;

create or replace function public.ht_coinapi_unsettled_hold_valid(p_request uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.ht_coinapi_pilot_requests r
    join public.ht_coinapi_pilot_cycles c on c.id=r.cycle_id
    join public.ht_coinapi_unsettled_cost_holds h on h.request_id=r.id
    where r.id=p_request
      and r.settled_at is null and r.reported_credits is null and r.http_status is null
      and r.reserved_credits=1 and r.reserved_at <= clock_timestamp()-interval '2 minutes'
      and c.status='failed'
      and h.policy_version='coinapi-unsettled-write-max-hold-v1'
      and h.maximum_credits=1
      and h.basis='database_settlement_write_unconfirmed_full_reservation'
      and public.ht_coinapi_one_credit_path(r.path)
      and h.request_sha256=encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')
  );
$$;

create or replace function public.ht_coinapi_request_usage_accounted(p_request uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.ht_coinapi_pilot_requests r
    where r.id=p_request and (
      (r.settled_at is not null and r.reported_credits is not null) or
      public.ht_coinapi_request_hold_valid(r.id) or
      public.ht_coinapi_unsettled_hold_valid(r.id)
    )
  );
$$;

-- An in-flight request belonging to the one valid lease is allowed to coexist
-- with the prior immutable publication. Every older unaccounted request blocks.
create or replace function public.ht_coinapi_request_usage_blocking(p_request uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.ht_coinapi_pilot_requests r
    cross join public.ht_coinapi_pilot_control ctl
    left join public.ht_coinapi_pilot_cycles c on c.id=r.cycle_id
    where r.id=p_request and ctl.id='global'
      and not public.ht_coinapi_request_usage_accounted(r.id)
      and not (
        r.settled_at is null and r.cycle_id=ctl.lease_id and ctl.lease_until>clock_timestamp()
        and c.status='running'
      )
  );
$$;

create or replace function public.ht_coinapi_recover_bounded_timeouts()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ht_coinapi_pilot_control%rowtype; n timestamptz:=clock_timestamp();
  old_added integer:=0; unsettled_added integer:=0; expected_lifetime numeric;
  expected_today numeric; unresolved bigint;
begin
  select * into strict c from public.ht_coinapi_pilot_control where id='global' for update;
  if not c.enabled or c.lease_until>n then
    return jsonb_build_object('recovered',false,'reason','disabled_or_active_cycle','providerRequests',0);
  end if;
  if c.blocked_reason is null or c.blocked_reason not in ('unknown_provider_cost','unsettled_provider_usage') then
    return jsonb_build_object('recovered',false,'reason','no_recoverable_pause','providerRequests',0);
  end if;

  -- A dead lease is terminal before any hold is considered. A live lease was
  -- rejected above, so this cannot interrupt an active collector.
  update public.ht_coinapi_pilot_cycles set status='failed',
    error_code=coalesce(error_code,'lease_expired_unsettled_usage'),completed_at=coalesce(completed_at,n)
    where id=c.lease_id and status='running';
  update public.ht_coinapi_pilot_control set lease_id=null,lease_until=null where id='global';

  if exists(select 1 from public.ht_coinapi_pilot_requests r where
      r.http_status in (401,403,429) or r.reported_credits>r.reserved_credits or
      r.reported_credits in ('NaN'::numeric,'Infinity'::numeric)) then
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
    select r.id,'coinapi-bounded-timeout-v1',1,
      encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
      'documented_request_limit_full_reservation',
      'https://docs.coinapi.io/market-data/api-limits-and-billing-metrics'
    from public.ht_coinapi_pilot_requests r
    join public.ht_coinapi_pilot_cycles f on f.id=r.cycle_id
    where r.reported_credits is null and r.http_status=0 and r.settled_at is not null
      and r.settled_at>=r.reserved_at and r.reserved_credits=1 and f.status='failed'
      and r.settled_at<=n-interval '15 seconds' and public.ht_coinapi_one_credit_path(r.path)
    on conflict do nothing;
  get diagnostics old_added=row_count;

  insert into public.ht_coinapi_unsettled_cost_holds
    (request_id,policy_version,maximum_credits,request_sha256,basis)
    select r.id,'coinapi-unsettled-write-max-hold-v1',1,
      encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
      'database_settlement_write_unconfirmed_full_reservation'
    from public.ht_coinapi_pilot_requests r
    join public.ht_coinapi_pilot_cycles f on f.id=r.cycle_id
    where r.settled_at is null and r.reported_credits is null and r.http_status is null
      and r.reserved_credits=1 and f.status='failed'
      and r.reserved_at<=n-interval '2 minutes' and public.ht_coinapi_one_credit_path(r.path)
    on conflict do nothing;
  get diagnostics unsettled_added=row_count;

  select count(*) into unresolved from public.ht_coinapi_pilot_requests r
    where not public.ht_coinapi_request_usage_accounted(r.id);
  if unresolved>0 then
    return jsonb_build_object('recovered',false,'reason','unbounded_request_cost',
      'newSettledHolds',old_added,'newUnsettledHolds',unsettled_added,
      'unresolved',unresolved,'providerRequests',0);
  end if;

  update public.ht_coinapi_pilot_control set blocked_reason=null,updated_at=n where id='global';
  return jsonb_build_object('recovered',true,'newSettledHolds',old_added,
    'newUnsettledHolds',unsettled_added,'policyVersion','coinapi-accounting-holds-v2',
    'reportedChargeStillUnknown',true,'providerRequests',0);
end $$;

create or replace function public.ht_coinapi_pilot_begin(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ht_coinapi_pilot_control%rowtype; n timestamptz:=clock_timestamp();
begin
  select * into strict c from public.ht_coinapi_pilot_control where id='global' for update;
  if not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled'); end if;
  if c.blocked_reason is not null then return jsonb_build_object('allowed',false,'reason',c.blocked_reason); end if;
  if c.lease_until>n then return jsonb_build_object('allowed',false,'reason','cycle_in_progress'); end if;
  if exists(select 1 from public.ht_coinapi_pilot_requests r where public.ht_coinapi_request_usage_blocking(r.id)) then
    update public.ht_coinapi_pilot_control set blocked_reason='unsettled_provider_usage',updated_at=n where id='global';
    return jsonb_build_object('allowed',false,'reason','unsettled_provider_usage');
  end if;
  if c.credit_day<>(n at time zone 'UTC')::date then
    c.daily_reserved:=0;
    update public.ht_coinapi_pilot_control set credit_day=(n at time zone 'UTC')::date,daily_reserved=0 where id='global';
  end if;
  if c.daily_reserved>=c.daily_credit_limit or c.lifetime_reserved>=c.lifetime_credit_limit then
    return jsonb_build_object('allowed',false,'reason','credit_budget_reached');
  end if;
  if exists(select 1 from public.ht_coinapi_pilot_cycles where minute_at=date_trunc('minute',n)) then
    return jsonb_build_object('allowed',false,'reason','minute_already_attempted');
  end if;
  update public.ht_coinapi_pilot_cycles set status='failed',error_code='lease_expired',completed_at=n where status='running';
  insert into public.ht_coinapi_pilot_cycles(id,minute_at,status) values(p_cycle,date_trunc('minute',n),'running');
  update public.ht_coinapi_pilot_control set lease_id=p_cycle,lease_until=n+interval '90 seconds',updated_at=n where id='global';
  return jsonb_build_object('allowed',true,'state',c.state);
end $$;

-- A late settlement may not rewrite a request after its immutable maximum-cost
-- hold has been issued.
create or replace function public.ht_coinapi_pilot_settle(p_request uuid,p_cost numeric,p_status integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.ht_coinapi_pilot_requests%rowtype; extra numeric; reason text; n timestamptz:=clock_timestamp();
begin
  perform 1 from public.ht_coinapi_pilot_control where id='global' for update;
  select * into strict r from public.ht_coinapi_pilot_requests where id=p_request for update;
  if r.settled_at is not null then return jsonb_build_object('allowed',false,'reason','receipt_already_settled'); end if;
  if exists(select 1 from public.ht_coinapi_unsettled_cost_holds where request_id=p_request) then
    return jsonb_build_object('allowed',false,'reason','accounting_hold_finalized');
  end if;
  if p_cost is null or p_cost<0 or p_cost='NaN'::numeric or p_cost='Infinity'::numeric then
    p_cost:=null;reason:='unknown_provider_cost';
  elsif p_cost>r.reserved_credits then reason:='provider_cost_exceeded_reservation'; end if;
  if p_status is null or p_status=0 then reason:=coalesce(reason,'uncertain_provider_response');
  elsif p_status in (401,403,429) then reason:=coalesce(reason,'provider_access_blocked'); end if;
  extra:=greatest(0,coalesce(p_cost,r.reserved_credits)-r.reserved_credits);
  update public.ht_coinapi_pilot_requests set settled_at=n,reported_credits=p_cost,http_status=p_status where id=p_request;
  update public.ht_coinapi_pilot_control set lifetime_reserved=lifetime_reserved+extra,
    daily_reserved=daily_reserved+extra,blocked_reason=coalesce(blocked_reason,reason),updated_at=n where id='global';
  return jsonb_build_object('allowed',reason is null,'reason',reason);
end $$;

create or replace function public.ht_coinapi_pilot_accounting_snapshot()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'version','coinapi-accounting-holds-v2',
    'heldUnknownRequests',
      (select count(*) from public.ht_coinapi_pilot_requests r where
        public.ht_coinapi_request_hold_valid(r.id) or public.ht_coinapi_unsettled_hold_valid(r.id)),
    'heldSettledUnknownRequests',
      (select count(*) from public.ht_coinapi_pilot_requests r where public.ht_coinapi_request_hold_valid(r.id)),
    'heldUnsettledRequests',
      (select count(*) from public.ht_coinapi_pilot_requests r where public.ht_coinapi_unsettled_hold_valid(r.id)),
    'heldMaximumCredits',
      (select coalesce(sum(x.maximum_credits),0) from (
        select h.maximum_credits from public.ht_coinapi_pilot_cost_holds h where public.ht_coinapi_request_hold_valid(h.request_id)
        union all
        select h.maximum_credits from public.ht_coinapi_unsettled_cost_holds h where public.ht_coinapi_unsettled_hold_valid(h.request_id)
      ) x),
    'rawUnsettledRequests',(select count(*) from public.ht_coinapi_pilot_requests where settled_at is null),
    'activeUnsettledRequests',(select count(*) from public.ht_coinapi_pilot_requests r
      join public.ht_coinapi_pilot_cycles x on x.id=r.cycle_id
      where r.settled_at is null and r.cycle_id=c.lease_id and c.lease_until>clock_timestamp() and x.status='running'),
    'unaccountedRequests',(select count(*) from public.ht_coinapi_pilot_requests r
      where not public.ht_coinapi_request_usage_accounted(r.id)),
    'unboundedUnknownRequests',(select count(*) from public.ht_coinapi_pilot_requests r
      where r.reported_credits is null and not public.ht_coinapi_request_usage_accounted(r.id)),
    'invalidHolds',(select
      (select count(*) from public.ht_coinapi_pilot_cost_holds h where not public.ht_coinapi_request_hold_valid(h.request_id))+
      (select count(*) from public.ht_coinapi_unsettled_cost_holds h where not public.ht_coinapi_unsettled_hold_valid(h.request_id))),
    'reservationCovered',c.lifetime_reserved >= (select coalesce(sum(greatest(r.reserved_credits,coalesce(r.reported_credits,r.reserved_credits))),0) from public.ht_coinapi_pilot_requests r)
      and c.daily_reserved >= (select coalesce(sum(greatest(r.reserved_credits,coalesce(r.reported_credits,r.reserved_credits))),0)
        from public.ht_coinapi_pilot_requests r where (r.reserved_at at time zone 'UTC')::date=c.credit_day),
    'receiptNotFabricated',true,'providerRequests',0)
  from public.ht_coinapi_pilot_control c where c.id='global';
$$;

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
     exists(select 1 from public.ht_coinapi_pilot_requests r where public.ht_coinapi_request_usage_blocking(r.id)) or
     exists(select 1 from public.ht_coinapi_pilot_requests r where r.cycle_id=f.id and
       (r.settled_at is null or r.reported_credits is null or r.http_status not between 200 and 299)) or
     (public.ht_coinapi_pilot_accounting_snapshot()->>'reservationCovered') is distinct from 'true' then
    return jsonb_build_object('ok',false,'reason','publication_unverified'); end if;
  if (f.frame->>'decisionAt')::timestamptz is null or
     (f.frame->>'decisionAt')::timestamptz<clock_timestamp()-interval '90 seconds' or
     (f.frame->>'decisionAt')::timestamptz>clock_timestamp() then
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

-- Database-enforced one-running-cycle ownership per Agent profile. Existing
-- duplicates are closed as failed, never deleted; the newest row is retained.
with duplicates as (
  select id,row_number() over(partition by profile_id order by started_at desc,id desc) as position
  from public.ht_agent_runs where status='running'
)
update public.ht_agent_runs r set status='failed',completed_at=clock_timestamp(),
  error_message='Duplicate running cycle closed by lifecycle migration 0045'
from duplicates d where r.id=d.id and d.position>1;
create unique index if not exists ht_agent_one_running_cycle_per_profile
  on public.ht_agent_runs(profile_id) where status='running';

create or replace function public.ht_agent_lifecycle_health()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'version','ht-agent-run-lifecycle-v1',
    'oneRunningIndexInstalled',to_regclass('public.ht_agent_one_running_cycle_per_profile') is not null,
    'duplicateRunningProfiles',(select count(*) from (
      select profile_id from public.ht_agent_runs where status='running' group by profile_id having count(*)>1
    ) duplicates),
    'overdueRunningCycles',(select count(*) from public.ht_agent_runs
      where status='running' and started_at<clock_timestamp()-interval '5 minutes')
  );
$$;

revoke all on function public.ht_coinapi_unsettled_hold_valid(uuid),
  public.ht_coinapi_request_usage_accounted(uuid),public.ht_coinapi_request_usage_blocking(uuid),
  public.ht_coinapi_recover_bounded_timeouts(),public.ht_coinapi_pilot_begin(uuid),
  public.ht_coinapi_pilot_settle(uuid,numeric,integer),public.ht_coinapi_pilot_accounting_snapshot(),
  public.ht_crypto_paper_quote(text),public.ht_agent_lifecycle_health()
  from public,anon,authenticated;
grant execute on function public.ht_coinapi_unsettled_hold_valid(uuid),
  public.ht_coinapi_request_usage_accounted(uuid),public.ht_coinapi_request_usage_blocking(uuid),
  public.ht_coinapi_recover_bounded_timeouts(),public.ht_coinapi_pilot_begin(uuid),
  public.ht_coinapi_pilot_settle(uuid,numeric,integer),public.ht_coinapi_pilot_accounting_snapshot(),
  public.ht_crypto_paper_quote(text),public.ht_agent_lifecycle_health() to service_role;

-- Safe and idempotent: zero provider requests, no budget/cap mutation.
select public.ht_coinapi_recover_bounded_timeouts();
notify pgrst,'reload schema';
commit;
