-- Bound and batch HT Agent paper-research outcome maintenance. This migration
-- preserves every decision/outcome and does not change Canonical, ProX,
-- scoring, risk, Agent modes, paper balances, provider budgets or execution.
begin;

do $$ begin
  if to_regclass('public.ht_agent_outcomes') is null or
     to_regclass('public.ht_agent_runs') is null then
    raise exception 'Apply migration 0030 first';
  end if;
  if to_regprocedure('public.ht_agent_lifecycle_health()') is null then
    raise exception 'Apply migration 0045 first';
  end if;
end $$;

create table if not exists public.ht_agent_outcome_worker_control (
  id text primary key check (id='global'),
  lease_id uuid,
  lease_until timestamptz,
  claimed_count integer not null default 0 check (claimed_count>=0),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.ht_agent_outcome_worker_control(id) values('global')
on conflict(id) do nothing;
alter table public.ht_agent_outcome_worker_control enable row level security;
revoke all on public.ht_agent_outcome_worker_control from public,anon,authenticated,service_role;
grant select on public.ht_agent_outcome_worker_control to service_role;

-- ProX has a separate research-outcome worker, but it shares the same outage
-- failure mode: a five-minute invocation can overlap the next one after a
-- provider/database stall. Keep its lease independent from HT Agent.
create table if not exists public.prox_shadow_outcome_worker_control (
  id text primary key check (id='global'),
  lease_id uuid,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.prox_shadow_outcome_worker_control(id) values('global')
on conflict(id) do nothing;
alter table public.prox_shadow_outcome_worker_control enable row level security;
revoke all on public.prox_shadow_outcome_worker_control from public,anon,authenticated,service_role;
grant select on public.prox_shadow_outcome_worker_control to service_role;

create or replace function public.prox_shadow_outcome_worker_begin(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare c public.prox_shadow_outcome_worker_control%rowtype; n timestamptz:=clock_timestamp();
begin
  if p_worker_id is null then raise exception 'worker_id_required'; end if;
  select * into strict c from public.prox_shadow_outcome_worker_control where id='global' for update;
  if c.lease_id is not null and c.lease_until>n and c.lease_id<>p_worker_id then
    return jsonb_build_object('allowed',false,'reason','worker_in_progress','leaseUntil',c.lease_until,'providerRequests',0);
  end if;
  update public.prox_shadow_outcome_worker_control set lease_id=p_worker_id,
    lease_until=n+interval '6 minutes',last_started_at=n,updated_at=n where id='global';
  return jsonb_build_object('allowed',true,'version','prox-shadow-outcome-worker-v1','providerRequests',0);
end $$;

create or replace function public.prox_shadow_outcome_worker_finish(p_worker_id uuid,p_summary jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare c public.prox_shadow_outcome_worker_control%rowtype; n timestamptz:=clock_timestamp();
begin
  if p_worker_id is null then raise exception 'worker_id_required'; end if;
  if jsonb_typeof(coalesce(p_summary,'null'::jsonb))<>'object' or length(p_summary::text)>20000 then
    raise exception 'invalid_summary';
  end if;
  select * into strict c from public.prox_shadow_outcome_worker_control where id='global' for update;
  if c.lease_id is distinct from p_worker_id then raise exception 'prox_outcome_worker_lease_lost'; end if;
  update public.prox_shadow_outcome_worker_control set lease_id=null,lease_until=null,
    last_completed_at=n,last_summary=p_summary || jsonb_build_object('finishedAt',n),updated_at=n
    where id='global';
  return jsonb_build_object('ok',true,'version','prox-shadow-outcome-worker-v1','providerRequests',0);
end $$;

-- A single database lease prevents overlapping Vercel cron invocations from
-- resolving the same provider-time rows. The RPC also retires abandoned Agent
-- cycles as failed; it never deletes them or rewrites their evidence.
create or replace function public.ht_agent_claim_outcome_batch(
  p_worker_id uuid,
  p_limit integer default 900
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s' as $$
declare
  c public.ht_agent_outcome_worker_control%rowtype;
  n timestamptz:=clock_timestamp();
  claimed jsonb:='[]'::jsonb;
  bounded_limit integer;
  retired integer:=0;
begin
  if p_worker_id is null then raise exception 'worker_id_required'; end if;
  bounded_limit:=least(1200,greatest(1,coalesce(p_limit,900)));
  select * into strict c from public.ht_agent_outcome_worker_control
    where id='global' for update;
  if c.lease_id is not null and c.lease_until>n and c.lease_id<>p_worker_id then
    return jsonb_build_object(
      'allowed',false,'reason','worker_in_progress','providerRequests',0,
      'leaseUntil',c.lease_until
    );
  end if;

  update public.ht_agent_runs set
    status='failed',
    completed_at=n,
    error_message=coalesce(error_message,'Abandoned running cycle retired by outcome worker v2')
  where status='running' and started_at<n-interval '5 minutes';
  get diagnostics retired=row_count;

  with due as (
    select o.id,o.target_at,o.decision_id,o.cohort_observation_id
    from public.ht_agent_outcomes o
    where o.complete=false and o.target_at<=n
    order by (o.target_at<=n-interval '10 minutes') desc,o.target_at,o.id
    limit bounded_limit
    for update skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,
    'targetAt',d.target_at,
    'symbol',x.symbol,
    'proposedEntry',x.proposed_entry,
    'cohort',h.cohort,
    'wouldEnter',h.would_enter,
    'conservativeSlippageBps',h.conservative_slippage_bps
  ) order by d.target_at,d.id),'[]'::jsonb)
  into claimed
  from due d
  join public.ht_agent_decisions x on x.id=d.decision_id
  join public.ht_agent_cohort_observations h on h.id=d.cohort_observation_id;

  update public.ht_agent_outcome_worker_control set
    lease_id=p_worker_id,
    lease_until=n+interval '6 minutes',
    claimed_count=jsonb_array_length(claimed),
    last_started_at=n,
    updated_at=n
  where id='global';
  return jsonb_build_object(
    'allowed',true,
    'version','ht-agent-outcome-worker-v2',
    'rows',claimed,
    'claimed',jsonb_array_length(claimed),
    'retiredAgentRuns',retired,
    'providerRequests',0
  );
end $$;

create or replace function public.ht_agent_finish_outcome_batch(
  p_worker_id uuid,
  p_updates jsonb,
  p_summary jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s' as $$
declare
  c public.ht_agent_outcome_worker_control%rowtype;
  n timestamptz:=clock_timestamp();
  updated_count integer:=0;
  claimed integer:=0;
begin
  if p_worker_id is null then raise exception 'worker_id_required'; end if;
  if jsonb_typeof(coalesce(p_updates,'null'::jsonb))<>'array' then
    raise exception 'updates_must_be_array';
  end if;
  if jsonb_array_length(p_updates)>1200 then raise exception 'update_batch_too_large'; end if;
  if jsonb_typeof(coalesce(p_summary,'null'::jsonb))<>'object' or length(p_summary::text)>20000 then
    raise exception 'invalid_summary';
  end if;
  if (select count(*) from jsonb_array_elements(p_updates)) <>
     (select count(distinct value->>'id') from jsonb_array_elements(p_updates)) then
    raise exception 'duplicate_outcome_update';
  end if;

  select * into strict c from public.ht_agent_outcome_worker_control
    where id='global' for update;
  if c.lease_id is distinct from p_worker_id then raise exception 'outcome_worker_lease_lost'; end if;
  claimed:=c.claimed_count;

  if exists(
    select 1 from jsonb_to_recordset(p_updates) as u(
      id uuid, observed_at timestamptz, provider_timestamp timestamptz,
      quote_provider_timestamp timestamptz, bid numeric, ask numeric,
      spread_percent numeric, price numeric, return_percent numeric,
      resolution_state text, unavailable_reason text
    ) where
      id is null or observed_at is null or resolution_state not in ('measured','unavailable') or
      (resolution_state='measured' and (
        provider_timestamp is null or provider_timestamp>observed_at+interval '1 minute' or
        price is null or price<=0 or price in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or
        ((bid is null)<>(ask is null)) or
        (bid is not null and (
          quote_provider_timestamp is null or bid<=0 or ask<bid or
          bid in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or
          ask in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
        ))
      )) or
      (resolution_state='unavailable' and coalesce(btrim(unavailable_reason),'')='')
  ) then raise exception 'invalid_outcome_update'; end if;

  with input as (
    select * from jsonb_to_recordset(p_updates) as u(
      id uuid, observed_at timestamptz, provider_timestamp timestamptz,
      quote_provider_timestamp timestamptz, bid numeric, ask numeric,
      spread_percent numeric, price numeric, return_percent numeric,
      resolution_state text, unavailable_reason text
    )
  ), changed as (
    update public.ht_agent_outcomes o set
      observed_at=u.observed_at,
      provider_timestamp=u.provider_timestamp,
      quote_provider_timestamp=u.quote_provider_timestamp,
      bid=u.bid,
      ask=u.ask,
      spread_percent=u.spread_percent,
      price=u.price,
      return_percent=u.return_percent,
      resolution_state=u.resolution_state,
      unavailable_reason=u.unavailable_reason,
      complete=true
    from input u
    where o.id=u.id and o.complete=false and o.target_at<=n
    returning o.id
  ) select count(*) into updated_count from changed;

  if updated_count<>jsonb_array_length(p_updates) then
    raise exception 'outcome_batch_changed_count_mismatch';
  end if;
  update public.ht_agent_outcome_worker_control set
    lease_id=null,
    lease_until=null,
    claimed_count=0,
    last_completed_at=n,
    last_summary=p_summary || jsonb_build_object(
      'claimed',claimed,'completed',updated_count,
      'pending',claimed-updated_count,'finishedAt',n
    ),
    updated_at=n
  where id='global';
  return jsonb_build_object(
    'ok',true,'version','ht-agent-outcome-worker-v2',
    'claimed',claimed,'completed',updated_count,'pending',claimed-updated_count,
    'providerRequests',0
  );
end $$;

-- Migration-time recovery is explicit and append-preserving.
update public.ht_agent_runs set
  status='failed',
  completed_at=clock_timestamp(),
  error_message=coalesce(error_message,'Abandoned running cycle retired by migration 0046')
where status='running' and started_at<clock_timestamp()-interval '5 minutes';

create or replace function public.ht_agent_lifecycle_health()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'version','ht-agent-run-lifecycle-v2',
    'oneRunningIndexInstalled',to_regclass('public.ht_agent_one_running_cycle_per_profile') is not null,
    'outcomeWorkerInstalled',to_regclass('public.ht_agent_outcome_worker_control') is not null,
    'proxOutcomeWorkerInstalled',to_regclass('public.prox_shadow_outcome_worker_control') is not null,
    'duplicateRunningProfiles',(select count(*) from (
      select profile_id from public.ht_agent_runs where status='running'
      group by profile_id having count(*)>1
    ) duplicates),
    'overdueRunningCycles',(select count(*) from public.ht_agent_runs
      where status='running' and started_at<clock_timestamp()-interval '5 minutes'),
    'outcomeWorker',(
      select jsonb_build_object(
        'leaseActive',lease_id is not null and lease_until>clock_timestamp(),
        'leaseUntil',lease_until,
        'claimedCount',claimed_count,
        'lastStartedAt',last_started_at,
        'lastCompletedAt',last_completed_at,
        'lastSummary',last_summary
      ) from public.ht_agent_outcome_worker_control where id='global'
    )
  );
$$;

revoke all on function public.ht_agent_claim_outcome_batch(uuid,integer),
  public.ht_agent_finish_outcome_batch(uuid,jsonb,jsonb),
  public.prox_shadow_outcome_worker_begin(uuid),
  public.prox_shadow_outcome_worker_finish(uuid,jsonb),
  public.ht_agent_lifecycle_health()
  from public,anon,authenticated;
grant execute on function public.ht_agent_claim_outcome_batch(uuid,integer),
  public.ht_agent_finish_outcome_batch(uuid,jsonb,jsonb),
  public.prox_shadow_outcome_worker_begin(uuid),
  public.prox_shadow_outcome_worker_finish(uuid,jsonb),
  public.ht_agent_lifecycle_health()
  to service_role;

notify pgrst,'reload schema';
commit;
