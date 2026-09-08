-- Renew the owner-approved CoinAPI research allowance once per UTC day.
-- This changes only HT Labs' internal request authorization. CoinAPI credits
-- remain paid provider credits and do not reset here.
begin;

alter table public.ht_coinapi_pilot_control
  add column if not exists daily_auto_renew boolean not null default false;

alter table public.ht_coinapi_pilot_control
  drop constraint if exists ht_coinapi_pilot_control_daily_credit_limit_check,
  drop constraint if exists ht_coinapi_pilot_control_lifetime_credit_limit_check;

alter table public.ht_coinapi_pilot_control
  add constraint ht_coinapi_pilot_control_daily_credit_limit_check
    check (daily_credit_limit between 1 and 1000),
  add constraint ht_coinapi_pilot_control_lifetime_credit_limit_check
    check (lifetime_credit_limit between 1 and 1000000000);

-- Enable the recurring daily envelope exactly once. The previous test script
-- may already have advanced credit_day today while the old lifetime ceiling
-- prevented a request. Grant only today's unused allowance in that case.
do $$
declare
  c public.ht_coinapi_pilot_control%rowtype;
  today date := (clock_timestamp() at time zone 'UTC')::date;
  renewed_limit integer;
begin
  select * into strict c
  from public.ht_coinapi_pilot_control
  where id = 'global'
  for update;

  if not c.daily_auto_renew then
    if c.credit_day <> today then
      renewed_limit := greatest(
        c.lifetime_credit_limit,
        ceil(c.lifetime_reserved)::integer + c.daily_credit_limit
      );
      update public.ht_coinapi_pilot_control
      set daily_auto_renew = true,
          credit_day = today,
          daily_reserved = 0,
          lifetime_credit_limit = renewed_limit,
          updated_at = clock_timestamp()
      where id = 'global';
    else
      renewed_limit := greatest(
        c.lifetime_credit_limit,
        ceil(c.lifetime_reserved)::integer + greatest(0, c.daily_credit_limit - ceil(c.daily_reserved)::integer)
      );
      update public.ht_coinapi_pilot_control
      set daily_auto_renew = true,
          lifetime_credit_limit = renewed_limit,
          updated_at = clock_timestamp()
      where id = 'global';
    end if;
  end if;
end $$;

-- 0045 owns the current accounting-hold behavior. Preserve it while adding
-- the daily rollover to the same locked control row.
create or replace function public.ht_coinapi_pilot_begin(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.ht_coinapi_pilot_control%rowtype;
  n timestamptz := clock_timestamp();
  today date := (n at time zone 'UTC')::date;
begin
  select * into strict c from public.ht_coinapi_pilot_control where id='global' for update;
  if not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled'); end if;
  if c.blocked_reason is not null then return jsonb_build_object('allowed',false,'reason',c.blocked_reason); end if;
  if c.lease_until>n then return jsonb_build_object('allowed',false,'reason','cycle_in_progress'); end if;
  if exists(select 1 from public.ht_coinapi_pilot_requests r where public.ht_coinapi_request_usage_blocking(r.id)) then
    update public.ht_coinapi_pilot_control set blocked_reason='unsettled_provider_usage',updated_at=n where id='global';
    return jsonb_build_object('allowed',false,'reason','unsettled_provider_usage');
  end if;

  if c.credit_day<>today then
    if c.daily_auto_renew then
      c.lifetime_credit_limit := greatest(
        c.lifetime_credit_limit,
        ceil(c.lifetime_reserved)::integer + c.daily_credit_limit
      );
    end if;
    c.credit_day := today;
    c.daily_reserved := 0;
    update public.ht_coinapi_pilot_control
    set credit_day=c.credit_day,
        daily_reserved=c.daily_reserved,
        lifetime_credit_limit=c.lifetime_credit_limit,
        updated_at=n
    where id='global';
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
  return jsonb_build_object('allowed',true,'state',c.state,
    'budgetMode',case when c.daily_auto_renew then 'recurring_daily_utc' else 'lifetime_capped' end);
end $$;

create or replace function public.ht_coinapi_pilot_reserve(p_cycle uuid,p_request uuid,p_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.ht_coinapi_pilot_control%rowtype;
  n timestamptz := clock_timestamp();
  today date := (n at time zone 'UTC')::date;
begin
  select * into strict c from public.ht_coinapi_pilot_control where id='global' for update;
  if not c.enabled or c.blocked_reason is not null or c.lease_id is distinct from p_cycle or c.lease_until is null or c.lease_until<=n then
    return jsonb_build_object('allowed',false,'reason','collector_not_authorized');
  end if;
  if p_path is null or length(p_path)>200 or p_path !~ '^/v1/(symbols\?|quotes/current\?|ohlcv/[A-Z0-9_.-]+/latest\?)' then
    raise exception 'Unsupported pilot data path';
  end if;

  -- Handles the rare case where an authorized cycle crosses UTC midnight.
  if c.credit_day<>today then
    if c.daily_auto_renew then
      c.lifetime_credit_limit := greatest(
        c.lifetime_credit_limit,
        ceil(c.lifetime_reserved)::integer + c.daily_credit_limit
      );
    end if;
    c.credit_day := today;
    c.daily_reserved := 0;
    update public.ht_coinapi_pilot_control
    set credit_day=c.credit_day,
        daily_reserved=c.daily_reserved,
        lifetime_credit_limit=c.lifetime_credit_limit,
        updated_at=n
    where id='global';
  end if;

  if c.daily_reserved+1>c.daily_credit_limit or c.lifetime_reserved+1>c.lifetime_credit_limit then
    return jsonb_build_object('allowed',false,'reason','credit_budget_reached');
  end if;
  if exists(select 1 from public.ht_coinapi_pilot_requests where cycle_id=p_cycle and path=p_path) or
      (select count(*) from public.ht_coinapi_pilot_requests where cycle_id=p_cycle)>=4 then
    return jsonb_build_object('allowed',false,'reason','duplicate_or_cycle_limit');
  end if;
  insert into public.ht_coinapi_pilot_requests(id,cycle_id,path) values(p_request,p_cycle,p_path);
  update public.ht_coinapi_pilot_control
  set daily_reserved=daily_reserved+1,lifetime_reserved=lifetime_reserved+1,updated_at=n
  where id='global';
  return jsonb_build_object('allowed',true);
end $$;

revoke all on function public.ht_coinapi_pilot_begin(uuid),
  public.ht_coinapi_pilot_reserve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ht_coinapi_pilot_begin(uuid),
  public.ht_coinapi_pilot_reserve(uuid,uuid,text) to service_role;

commit;
