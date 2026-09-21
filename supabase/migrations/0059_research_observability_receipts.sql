-- Prospective research observability repair. This migration does not change
-- Canonical, ProX, Agent X, Paper, or execution decisions. It makes the
-- existing Agent target-path seed deterministic, records otherwise-silent
-- seed failures, and exposes expected-versus-persisted coverage from the
-- migration boundary forward.
begin;

do $$ begin
  if to_regclass('public.ht_agent_target_research_episodes') is null or
     to_regclass('public.ht_agent_target_research_results') is null then
    raise exception 'Apply migration 0058 first';
  end if;
end $$;

create table if not exists public.ht_agent_target_research_observability (
  id text primary key check(id='global'),
  version text not null check(version='ht-agent-target-research-observability-v1'),
  coverage_started_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

insert into public.ht_agent_target_research_observability(
  id,version,coverage_started_at
) values(
  'global','ht-agent-target-research-observability-v1',clock_timestamp()
) on conflict(id) do nothing;

create table if not exists public.ht_agent_target_research_seed_failures (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null,
  decision_id uuid not null,
  horizon text not null,
  error_code text not null,
  error_message text not null,
  failed_at timestamptz not null default clock_timestamp(),
  unique(outcome_id)
);

create index if not exists ht_agent_target_research_seed_failures_time_idx
  on public.ht_agent_target_research_seed_failures(failed_at desc);

alter table public.ht_agent_target_research_observability enable row level security;
alter table public.ht_agent_target_research_seed_failures enable row level security;
revoke all on public.ht_agent_target_research_observability,
  public.ht_agent_target_research_seed_failures
  from public,anon,authenticated,service_role;
grant select on public.ht_agent_target_research_observability,
  public.ht_agent_target_research_seed_failures to service_role;
grant insert on public.ht_agent_target_research_seed_failures to service_role;

create or replace function public.ht_agent_target_research_reject_observability_mutation()
returns trigger language plpgsql as $$ begin
  raise exception 'ht_agent_target_research_observability_is_immutable';
end $$;

drop trigger if exists ht_agent_target_research_observability_immutable
  on public.ht_agent_target_research_observability;
create trigger ht_agent_target_research_observability_immutable
  before update or delete on public.ht_agent_target_research_observability
  for each row execute function public.ht_agent_target_research_reject_observability_mutation();

drop trigger if exists ht_agent_target_research_seed_failures_immutable
  on public.ht_agent_target_research_seed_failures;
create trigger ht_agent_target_research_seed_failures_immutable
  before update or delete on public.ht_agent_target_research_seed_failures
  for each row execute function public.ht_agent_target_research_reject_observability_mutation();

create or replace function public.ht_agent_seed_target_research_episode()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  d public.ht_agent_decisions%rowtype;
  f public.ht_agent_decision_frames%rowtype;
  cohort_name text;
  plan jsonb;
  lane text;
  provider_at timestamptz;
  valid_from timestamptz;
  entry_price numeric;
  trigger_price numeric;
  stop_price numeric;
  target_one numeric;
  target_two numeric;
  session_date date;
begin
  -- Each decision has three cohort outcomes per horizon. Seed from the full
  -- Agent cohort only, reducing identical trigger work from nine attempts to
  -- three without changing the de-correlated episode contract.
  if new.horizon not in ('15m','60m','session') or
     new.cohort_observation_id is null then return new; end if;
  select cohort into cohort_name
    from public.ht_agent_cohort_observations
    where id=new.cohort_observation_id;
  if cohort_name is distinct from 'ht_agent_full' then return new; end if;

  select * into strict d from public.ht_agent_decisions where id=new.decision_id;
  plan:=d.trade_plan;
  if d.risk_allowed is not true or
     jsonb_typeof(coalesce(plan,'null'::jsonb))<>'object' or
     plan->>'status' is distinct from 'paper_entry_eligible' then
    return new;
  end if;
  select * into strict f from public.ht_agent_decision_frames where id=d.frame_id;
  lane:=nullif(f.canonical_evidence->>'sourceLane','');
  provider_at:=f.provider_timestamp;
  if lane not in ('momentum','before_crowd') or provider_at is null then return new; end if;
  valid_from:=date_trunc('minute',provider_at)+
    case when provider_at=date_trunc('minute',provider_at)
      then interval '0 minutes' else interval '1 minute' end;
  trigger_price:=coalesce(nullif(plan->>'confirmationTrigger','')::numeric,d.proposed_entry);
  entry_price:=greatest(
    d.proposed_entry,
    nullif(plan#>>'{entryZone,high}','')::numeric,
    trigger_price
  );
  stop_price:=coalesce(nullif(plan->>'invalidation','')::numeric,d.proposed_stop);
  target_one:=coalesce(nullif(plan->>'targetOne','')::numeric,d.proposed_target);
  target_two:=nullif(plan->>'targetTwo','')::numeric;
  if entry_price is null or trigger_price is null or stop_price is null or
     target_one is null or entry_price<=0 or trigger_price<=0 or
     trigger_price>entry_price or stop_price<=0 or stop_price>=entry_price or
     target_one<=entry_price or (target_two is not null and target_two<=target_one) then
    return new;
  end if;
  session_date:=(provider_at at time zone 'America/New_York')::date;
  if new.target_at<=valid_from then return new; end if;
  insert into public.ht_agent_target_research_episodes(
    decision_id,frame_id,profile_id,user_id,symbol,session_date,
    canonical_lane,horizon,research_version,decision_version,
    risk_policy_version,provider_timestamp,valid_from,target_at,
    least_favorable_entry,trigger_price,stop_price,target_one,target_two,
    canonical_evidence,prox_evidence,market_facts
  ) values(
    d.id,d.frame_id,d.profile_id,d.user_id,d.symbol,session_date,
    lane,new.horizon,'ht-agent-target-path-research-v1',d.decision_version,
    d.policy_version,provider_at,valid_from,new.target_at,entry_price,
    trigger_price,stop_price,target_one,target_two,f.canonical_evidence,
    f.prox_evidence,f.market_facts
  ) on conflict(profile_id,symbol,session_date,canonical_lane,horizon) do nothing;
  return new;
exception when others then
  begin
    insert into public.ht_agent_target_research_seed_failures(
      outcome_id,decision_id,horizon,error_code,error_message
    ) values(
      new.id,new.decision_id,new.horizon,sqlstate,left(sqlerrm,1000)
    ) on conflict(outcome_id) do nothing;
  exception when others then
    raise warning 'HT Agent target research failure receipt could not be written: %',sqlerrm;
  end;
  raise warning 'HT Agent target research seed skipped: %',sqlerrm;
  return new;
end $$;

create or replace function public.ht_agent_target_research_health()
returns jsonb
language sql stable security definer set search_path='' set statement_timeout='15s' as $$
  with control as (
    select coverage_started_at
    from public.ht_agent_target_research_observability where id='global'
  ), candidate_values as (
    select
      d.id as decision_id,d.profile_id,d.symbol,o.horizon,o.target_at,
      d.decided_at,f.provider_timestamp,
      nullif(f.canonical_evidence->>'sourceLane','') as canonical_lane,
      case when coalesce(d.trade_plan->>'confirmationTrigger','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (d.trade_plan->>'confirmationTrigger')::numeric
        else d.proposed_entry end as trigger_price,
      greatest(
        d.proposed_entry,
        case when coalesce(d.trade_plan#>>'{entryZone,high}','') ~
          '^[+-]?[0-9]+([.][0-9]+)?$'
          then (d.trade_plan#>>'{entryZone,high}')::numeric end,
        case when coalesce(d.trade_plan->>'confirmationTrigger','') ~
          '^[+-]?[0-9]+([.][0-9]+)?$'
          then (d.trade_plan->>'confirmationTrigger')::numeric
          else d.proposed_entry end
      ) as entry_price,
      case when coalesce(d.trade_plan->>'invalidation','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (d.trade_plan->>'invalidation')::numeric
        else d.proposed_stop end as stop_price,
      case when coalesce(d.trade_plan->>'targetOne','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (d.trade_plan->>'targetOne')::numeric
        else d.proposed_target end as target_one,
      case when coalesce(d.trade_plan->>'targetTwo','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (d.trade_plan->>'targetTwo')::numeric end as target_two
    from public.ht_agent_outcomes o
    join public.ht_agent_cohort_observations c
      on c.id=o.cohort_observation_id and c.cohort='ht_agent_full'
    join public.ht_agent_decisions d on d.id=o.decision_id
    join public.ht_agent_decision_frames f on f.id=d.frame_id
    cross join control
    where o.horizon in ('15m','60m','session')
      and d.decided_at>=control.coverage_started_at
      and d.risk_allowed is true
      and jsonb_typeof(coalesce(d.trade_plan,'null'::jsonb))='object'
      and d.trade_plan->>'status'='paper_entry_eligible'
  ), expected as (
    select distinct
      profile_id,symbol,
      (provider_timestamp at time zone 'America/New_York')::date as session_date,
      canonical_lane,horizon,
      max(decided_at) over () as latest_eligible_decision_at
    from candidate_values
    where canonical_lane in ('momentum','before_crowd')
      and provider_timestamp is not null
      and entry_price>0 and trigger_price>0 and trigger_price<=entry_price
      and stop_price>0 and stop_price<entry_price
      and target_one>entry_price
      and (target_two is null or target_two>target_one)
      and target_at>date_trunc('minute',provider_timestamp)+
        case when provider_timestamp=date_trunc('minute',provider_timestamp)
          then interval '0 minutes' else interval '1 minute' end
  ), coverage as (
    select
      count(*) as expected_episode_count,
      count(e.id) as persisted_episode_count,
      count(*) filter(where e.id is null) as missing_episode_count,
      max(expected.latest_eligible_decision_at) as latest_eligible_decision_at
    from expected
    left join public.ht_agent_target_research_episodes e
      on e.profile_id=expected.profile_id
      and e.symbol=expected.symbol
      and e.session_date=expected.session_date
      and e.canonical_lane=expected.canonical_lane
      and e.horizon=expected.horizon
  ), counts as (
    select count(*) as episodes,
      count(distinct e.session_date) as sessions,
      count(r.episode_id) as completed,
      count(*) filter(where r.resolution_state='measured') as measured,
      count(*) filter(where r.resolution_state='ambiguous') as ambiguous,
      count(*) filter(where r.resolution_state='unavailable') as unavailable,
      max(r.evaluated_at) as latest_evaluated_at
    from public.ht_agent_target_research_episodes e
    left join public.ht_agent_target_research_results r on r.episode_id=e.id
  ), failures as (
    select count(*) as total,max(failed_at) as latest_failed_at
    from public.ht_agent_target_research_seed_failures
  ), outcomes as (
    select coalesce(jsonb_object_agg(outcome_code,total),'{}'::jsonb) as values
    from (select outcome_code,count(*) total
      from public.ht_agent_target_research_results group by outcome_code) grouped
  )
  select jsonb_build_object(
    'version','ht-agent-target-path-research-v1',
    'observabilityVersion','ht-agent-target-research-observability-v1',
    'coverageStartedAt',control.coverage_started_at,
    'authority','research_only','providerRequestsAdded',0,
    'episodes',counts.episodes,'sessions',counts.sessions,
    'completed',counts.completed,'measured',counts.measured,
    'ambiguous',counts.ambiguous,'unavailable',counts.unavailable,
    'pending',counts.episodes-counts.completed,
    'outcomeCounts',outcomes.values,
    'latestEvaluatedAt',counts.latest_evaluated_at,
    'expectedEpisodeCount',coverage.expected_episode_count,
    'persistedExpectedEpisodeCount',coverage.persisted_episode_count,
    'missingEpisodeCount',coverage.missing_episode_count,
    'coverageComplete',coverage.missing_episode_count=0,
    'latestEligibleDecisionAt',coverage.latest_eligible_decision_at,
    'seedFailureCount',failures.total,
    'latestSeedFailureAt',failures.latest_failed_at,
    'seedCohort','ht_agent_full',
    'triggerAttemptsPerEligibleDecision',3,
    'canonicalEntryChallengerReady',(
      counts.sessions>=30 and counts.measured>=500
    ),
    'executionAuthority','none'
  ) from counts cross join outcomes cross join coverage cross join failures cross join control;
$$;

revoke all on function public.ht_agent_target_research_reject_observability_mutation(),
  public.ht_agent_seed_target_research_episode(),
  public.ht_agent_target_research_health()
  from public,anon,authenticated,service_role;
grant execute on function public.ht_agent_target_research_reject_observability_mutation(),
  public.ht_agent_seed_target_research_episode(),
  public.ht_agent_target_research_health() to service_role;

comment on table public.ht_agent_target_research_observability is
  'Singleton boundary for prospective expected-versus-persisted Agent target research coverage.';
comment on table public.ht_agent_target_research_seed_failures is
  'Immutable exception-only receipts for Agent target research seeds; no decision or execution authority.';

notify pgrst,'reload schema';
commit;
