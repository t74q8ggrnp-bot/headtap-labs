-- CoinAPI-only Vercel research pilot. No existing crypto/stock/paper tables changed.
-- Starts OFF. Budgets are application credit allowances, NOT provider dollar caps.
begin;

create table if not exists public.ht_coinapi_pilot_control (
  id text primary key check (id = 'global'),
  enabled boolean not null default false,
  daily_credit_limit integer not null default 300 check (daily_credit_limit between 1 and 900),
  lifetime_credit_limit integer not null default 900 check (lifetime_credit_limit between 1 and 900),
  credit_day date not null default ((now() at time zone 'UTC')::date),
  daily_reserved numeric not null default 0 check (daily_reserved >= 0),
  lifetime_reserved numeric not null default 0 check (lifetime_reserved >= 0),
  blocked_reason text,
  lease_id uuid,
  lease_until timestamptz,
  state jsonb,
  latest_cycle_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.ht_coinapi_pilot_control(id) values ('global') on conflict do nothing;

create table if not exists public.ht_coinapi_pilot_cycles (
  id uuid primary key,
  minute_at timestamptz not null unique,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running','complete','failed')),
  error_code text,
  frame jsonb,
  evidence_sha256 text,
  check (status <> 'complete' or (frame is not null and evidence_sha256 ~ '^[a-f0-9]{64}$'))
);

create table if not exists public.ht_coinapi_pilot_requests (
  id uuid primary key,
  cycle_id uuid not null references public.ht_coinapi_pilot_cycles(id),
  path text not null,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  reserved_credits numeric not null default 1 check (reserved_credits = 1),
  reported_credits numeric check (reported_credits >= 0 and reported_credits <> 'NaN'::numeric),
  http_status integer,
  unique(cycle_id, path)
);
create index if not exists ht_coinapi_pilot_requests_pending
  on public.ht_coinapi_pilot_requests(reserved_at) where settled_at is null;

alter table public.ht_coinapi_pilot_control enable row level security;
alter table public.ht_coinapi_pilot_cycles enable row level security;
alter table public.ht_coinapi_pilot_requests enable row level security;
revoke all on public.ht_coinapi_pilot_control, public.ht_coinapi_pilot_cycles,
  public.ht_coinapi_pilot_requests from anon, authenticated, service_role;
grant select, update on public.ht_coinapi_pilot_control to service_role;
grant select on public.ht_coinapi_pilot_cycles, public.ht_coinapi_pilot_requests to service_role;

-- All mutations lock the SAME control row. Different Vercel instances cannot
-- reset an allowance, oversubscribe credits, or publish over an active cycle.
create or replace function public.ht_coinapi_pilot_begin(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ht_coinapi_pilot_control%rowtype; n timestamptz := clock_timestamp();
begin
  select * into strict c from public.ht_coinapi_pilot_control where id = 'global' for update;
  if not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled'); end if;
  if c.blocked_reason is not null then return jsonb_build_object('allowed',false,'reason',c.blocked_reason); end if;
  if c.lease_until > n then return jsonb_build_object('allowed',false,'reason','cycle_in_progress'); end if;
  if exists(select 1 from public.ht_coinapi_pilot_requests where settled_at is null) then
    update public.ht_coinapi_pilot_control set blocked_reason = 'unsettled_provider_usage', updated_at = n where id = 'global';
    return jsonb_build_object('allowed',false,'reason','unsettled_provider_usage');
  end if;
  if c.credit_day <> (n at time zone 'UTC')::date then
    c.daily_reserved := 0;
    update public.ht_coinapi_pilot_control set credit_day = (n at time zone 'UTC')::date, daily_reserved = 0 where id = 'global';
  end if;
  if c.daily_reserved >= c.daily_credit_limit or c.lifetime_reserved >= c.lifetime_credit_limit then
    return jsonb_build_object('allowed',false,'reason','credit_budget_reached');
  end if;
  if exists(select 1 from public.ht_coinapi_pilot_cycles where minute_at = date_trunc('minute',n)) then
    return jsonb_build_object('allowed',false,'reason','minute_already_attempted');
  end if;
  update public.ht_coinapi_pilot_cycles set status = 'failed', error_code = 'lease_expired', completed_at = n
    where status = 'running';
  insert into public.ht_coinapi_pilot_cycles(id, minute_at, status) values(p_cycle,date_trunc('minute',n),'running');
  update public.ht_coinapi_pilot_control set lease_id = p_cycle, lease_until = n + interval '90 seconds', updated_at = n where id = 'global';
  return jsonb_build_object('allowed',true,'state',c.state);
end $$;

create or replace function public.ht_coinapi_pilot_reserve(p_cycle uuid, p_request uuid, p_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ht_coinapi_pilot_control%rowtype; n timestamptz := clock_timestamp();
begin
  select * into strict c from public.ht_coinapi_pilot_control where id = 'global' for update;
  if not c.enabled or c.blocked_reason is not null or c.lease_id is distinct from p_cycle or c.lease_until is null or c.lease_until <= n then
    return jsonb_build_object('allowed',false,'reason','collector_not_authorized');
  end if;
  if p_path is null or length(p_path) > 200 or p_path !~ '^/v1/(symbols\?|quotes/current\?|ohlcv/[A-Z0-9_.-]+/latest\?)' then
    raise exception 'Unsupported pilot data path';
  end if;
  if c.credit_day <> (n at time zone 'UTC')::date then
    c.daily_reserved := 0;
    update public.ht_coinapi_pilot_control set credit_day = (n at time zone 'UTC')::date, daily_reserved = 0 where id = 'global';
  end if;
  if c.daily_reserved + 1 > c.daily_credit_limit or c.lifetime_reserved + 1 > c.lifetime_credit_limit then
    return jsonb_build_object('allowed',false,'reason','credit_budget_reached');
  end if;
  if exists(select 1 from public.ht_coinapi_pilot_requests where cycle_id = p_cycle and path = p_path) or
      (select count(*) from public.ht_coinapi_pilot_requests where cycle_id = p_cycle) >= 4 then
    return jsonb_build_object('allowed',false,'reason','duplicate_or_cycle_limit');
  end if;
  insert into public.ht_coinapi_pilot_requests(id,cycle_id,path) values(p_request,p_cycle,p_path);
  update public.ht_coinapi_pilot_control set daily_reserved = daily_reserved + 1,
    lifetime_reserved = lifetime_reserved + 1, updated_at = n where id = 'global';
  return jsonb_build_object('allowed',true);
end $$;

create or replace function public.ht_coinapi_pilot_settle(p_request uuid, p_cost numeric, p_status integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.ht_coinapi_pilot_requests%rowtype; extra numeric; reason text; n timestamptz := clock_timestamp();
begin
  perform 1 from public.ht_coinapi_pilot_control where id = 'global' for update;
  select * into strict r from public.ht_coinapi_pilot_requests where id = p_request for update;
  if r.settled_at is not null then
    return jsonb_build_object('allowed',false,'reason','receipt_already_settled');
  end if;
  if p_cost is null or p_cost < 0 or p_cost = 'NaN'::numeric or p_cost = 'Infinity'::numeric then
    p_cost := null;
    reason := 'unknown_provider_cost';
  elsif p_cost > r.reserved_credits then reason := 'provider_cost_exceeded_reservation';
  end if;
  if p_status is null or p_status = 0 then reason := coalesce(reason,'uncertain_provider_response');
  elsif p_status in (401,403,429) then reason := coalesce(reason,'provider_access_blocked'); end if;
  extra := greatest(0, coalesce(p_cost, r.reserved_credits) - r.reserved_credits);
  update public.ht_coinapi_pilot_requests set settled_at = n, reported_credits = p_cost, http_status = p_status where id = p_request;
  -- Reservations are never refunded, even after timeouts or a lower reported cost.
  -- Crossing midnight cannot reset a lifetime cap or erase an uncertain request.
  update public.ht_coinapi_pilot_control set lifetime_reserved = lifetime_reserved + extra,
    daily_reserved = daily_reserved + extra, blocked_reason = coalesce(blocked_reason,reason), updated_at = n where id = 'global';
  return jsonb_build_object('allowed',reason is null,'reason',reason);
end $$;

create or replace function public.ht_coinapi_pilot_finish(p_cycle uuid, p_state jsonb, p_frame jsonb, p_hash text, p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.ht_coinapi_pilot_control%rowtype; n timestamptz := clock_timestamp();
begin
  select * into strict c from public.ht_coinapi_pilot_control where id = 'global' for update;
  if c.lease_id is distinct from p_cycle or c.lease_until is null or c.lease_until <= n then raise exception 'Pilot lease expired'; end if;
  if not exists(select 1 from public.ht_coinapi_pilot_cycles where id = p_cycle and status = 'running') then
    raise exception 'Pilot cycle already finalized';
  end if;
  if p_error is null then
    if not c.enabled or c.blocked_reason is not null or p_frame is null or p_state is null or
        p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or
        p_frame->>'provider' is distinct from 'coinapi' or
        p_frame->>'version' is distinct from 'coinapi-vercel-pilot-v1' or
        p_frame->>'authority' is distinct from 'research_only' or
        p_frame->>'executionAuthorized' is distinct from 'false' or
        p_frame->>'publicRankingChanged' is distinct from 'false' or
        exists(select 1 from public.ht_coinapi_pilot_requests where cycle_id = p_cycle and settled_at is null) then
      raise exception 'Pilot publication requires complete accounted evidence';
    end if;
    update public.ht_coinapi_pilot_cycles set status = 'complete', frame = p_frame,
      evidence_sha256 = p_hash, completed_at = n where id = p_cycle;
    update public.ht_coinapi_pilot_control set state = p_state, latest_cycle_id = p_cycle where id = 'global';
  else
    update public.ht_coinapi_pilot_cycles set status = 'failed', error_code = left(p_error,80), completed_at = n where id = p_cycle;
  end if;
  update public.ht_coinapi_pilot_control set lease_id = null, lease_until = null, updated_at = n where id = 'global';
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.ht_coinapi_pilot_begin(uuid),
  public.ht_coinapi_pilot_reserve(uuid,uuid,text), public.ht_coinapi_pilot_settle(uuid,numeric,integer),
  public.ht_coinapi_pilot_finish(uuid,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.ht_coinapi_pilot_begin(uuid),
  public.ht_coinapi_pilot_reserve(uuid,uuid,text), public.ht_coinapi_pilot_settle(uuid,numeric,integer),
  public.ht_coinapi_pilot_finish(uuid,jsonb,jsonb,text,text) to service_role;

commit;
