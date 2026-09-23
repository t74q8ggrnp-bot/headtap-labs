-- Agent target-path research persistence and bounded health repair.
--
-- This migration is forward-only and research-only. It preserves every
-- immutable failure receipt and outcome, makes zero provider requests, and
-- changes no Canonical, ProX, Agent, Paper, risk, or execution authority.
begin;

do $$ begin
  if to_regclass('public.ht_agent_target_research_episodes') is null or
     to_regclass('public.ht_agent_target_research_results') is null or
     to_regclass('public.ht_agent_target_research_seed_failures') is null or
     to_regclass('public.ht_agent_target_research_observability') is null then
    raise exception 'Apply migrations 0058 and 0059 first';
  end if;
end $$;

create table if not exists public.ht_agent_target_research_repair_receipts (
  id text primary key check(id='0061_target_research_persistence_and_health'),
  version text not null check(version='ht-agent-target-research-repair-v1'),
  failure_receipts_preserved bigint not null check(failure_receipts_preserved>=0),
  missing_deduplicated_episodes_before bigint not null
    check(missing_deduplicated_episodes_before>=0),
  backfilled_episode_count bigint not null check(backfilled_episode_count>=0),
  missing_deduplicated_episodes_after bigint not null
    check(missing_deduplicated_episodes_after>=0),
  provider_requests_added integer not null default 0
    check(provider_requests_added=0),
  authority text not null default 'research_only'
    check(authority='research_only'),
  execution_authority text not null default 'none'
    check(execution_authority='none'),
  applied_at timestamptz not null default clock_timestamp()
);

alter table public.ht_agent_target_research_repair_receipts enable row level security;
revoke all on public.ht_agent_target_research_repair_receipts
  from public,anon,authenticated,service_role;
grant select on public.ht_agent_target_research_repair_receipts to service_role;

drop trigger if exists ht_agent_target_research_repair_receipts_immutable
  on public.ht_agent_target_research_repair_receipts;
create trigger ht_agent_target_research_repair_receipts_immutable
  before update or delete on public.ht_agent_target_research_repair_receipts
  for each row execute function
    public.ht_agent_target_research_reject_observability_mutation();

-- Migration 0059 used a PL/pgSQL variable named session_date and an
-- ON CONFLICT inference list containing a session_date column. PostgreSQL
-- correctly rejected that ambiguous reference with 42702. The variable is
-- now unambiguously named episode_session_date. Untargeted DO NOTHING keeps
-- both pre-existing uniqueness contracts authoritative:
--   (decision_id,horizon)
--   (profile_id,symbol,session_date,canonical_lane,horizon)
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
  episode_session_date date;
begin
  if new.horizon not in ('15m','60m','session') or
     new.cohort_observation_id is null then return new; end if;
  select c.cohort into cohort_name
    from public.ht_agent_cohort_observations as c
    where c.id=new.cohort_observation_id;
  if cohort_name is distinct from 'ht_agent_full' then return new; end if;

  select decision.* into strict d
    from public.ht_agent_decisions as decision where decision.id=new.decision_id;
  plan:=d.trade_plan;
  if d.risk_allowed is not true or
     jsonb_typeof(coalesce(plan,'null'::jsonb))<>'object' or
     plan->>'status' is distinct from 'paper_entry_eligible' then
    return new;
  end if;
  select frame.* into strict f
    from public.ht_agent_decision_frames as frame where frame.id=d.frame_id;
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
  episode_session_date:=(provider_at at time zone 'America/New_York')::date;
  if new.target_at<=valid_from then return new; end if;
  insert into public.ht_agent_target_research_episodes(
    decision_id,frame_id,profile_id,user_id,symbol,session_date,
    canonical_lane,horizon,research_version,decision_version,
    risk_policy_version,provider_timestamp,valid_from,target_at,
    least_favorable_entry,trigger_price,stop_price,target_one,target_two,
    canonical_evidence,prox_evidence,market_facts
  ) values(
    d.id,d.frame_id,d.profile_id,d.user_id,d.symbol,episode_session_date,
    lane,new.horizon,'ht-agent-target-path-research-v1',d.decision_version,
    d.policy_version,provider_at,valid_from,new.target_at,entry_price,
    trigger_price,stop_price,target_one,target_two,f.canonical_evidence,
    f.prox_evidence,f.market_facts
  ) on conflict do nothing;
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

-- Backfill only the immutable 42702 failures that pass the same deterministic
-- eligibility and price validation as the trigger. The first decision for a
-- deduplicated profile/symbol/session/lane/horizon key wins, exactly as it
-- would have when the trigger originally ran. No market/provider read occurs.
do $$
declare
  failures_before bigint;
  missing_before bigint;
  inserted_count bigint;
  missing_after bigint;
begin
  select count(*) into failures_before
  from public.ht_agent_target_research_seed_failures;

  with candidate_values as materialized (
    select
      outcome.id as outcome_id,
      decision.id as decision_id,
      decision.frame_id,
      decision.profile_id,
      decision.user_id,
      decision.symbol,
      decision.decision_version,
      decision.policy_version,
      decision.decided_at,
      outcome.horizon,
      outcome.target_at,
      frame.provider_timestamp,
      nullif(frame.canonical_evidence->>'sourceLane','') as canonical_lane,
      frame.canonical_evidence,
      frame.prox_evidence,
      frame.market_facts,
      case when coalesce(decision.trade_plan->>'confirmationTrigger','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'confirmationTrigger')::numeric
        else decision.proposed_entry end as trigger_price,
      greatest(
        decision.proposed_entry,
        case when coalesce(decision.trade_plan#>>'{entryZone,high}','') ~
          '^[+-]?[0-9]+([.][0-9]+)?$'
          then (decision.trade_plan#>>'{entryZone,high}')::numeric end,
        case when coalesce(decision.trade_plan->>'confirmationTrigger','') ~
          '^[+-]?[0-9]+([.][0-9]+)?$'
          then (decision.trade_plan->>'confirmationTrigger')::numeric
          else decision.proposed_entry end
      ) as entry_price,
      case when coalesce(decision.trade_plan->>'invalidation','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'invalidation')::numeric
        else decision.proposed_stop end as stop_price,
      case when coalesce(decision.trade_plan->>'targetOne','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'targetOne')::numeric
        else decision.proposed_target end as target_one,
      case when coalesce(decision.trade_plan->>'targetTwo','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'targetTwo')::numeric end as target_two
    from public.ht_agent_target_research_seed_failures as failure
    join public.ht_agent_outcomes as outcome on outcome.id=failure.outcome_id
    join public.ht_agent_cohort_observations as cohort
      on cohort.id=outcome.cohort_observation_id
      and cohort.cohort='ht_agent_full'
    join public.ht_agent_decisions as decision on decision.id=outcome.decision_id
    join public.ht_agent_decision_frames as frame on frame.id=decision.frame_id
    where failure.error_code='42702'
      and outcome.horizon in ('15m','60m','session')
      and decision.risk_allowed is true
      and jsonb_typeof(coalesce(decision.trade_plan,'null'::jsonb))='object'
      and decision.trade_plan->>'status'='paper_entry_eligible'
  ), eligible as materialized (
    select candidate_values.*,
      (candidate_values.provider_timestamp at time zone 'America/New_York')::date
        as episode_session_date,
      date_trunc('minute',candidate_values.provider_timestamp)+
        case when candidate_values.provider_timestamp=
          date_trunc('minute',candidate_values.provider_timestamp)
          then interval '0 minutes' else interval '1 minute' end as valid_from
    from candidate_values
    where candidate_values.canonical_lane in ('momentum','before_crowd')
      and candidate_values.provider_timestamp is not null
      and candidate_values.entry_price>0
      and candidate_values.trigger_price>0
      and candidate_values.trigger_price<=candidate_values.entry_price
      and candidate_values.stop_price>0
      and candidate_values.stop_price<candidate_values.entry_price
      and candidate_values.target_one>candidate_values.entry_price
      and (candidate_values.target_two is null or
        candidate_values.target_two>candidate_values.target_one)
  ), deduplicated as materialized (
    select distinct on (
      eligible.profile_id,eligible.symbol,eligible.episode_session_date,
      eligible.canonical_lane,eligible.horizon
    ) eligible.*
    from eligible
    where eligible.target_at>eligible.valid_from
    order by eligible.profile_id,eligible.symbol,eligible.episode_session_date,
      eligible.canonical_lane,eligible.horizon,eligible.decided_at,eligible.outcome_id
  )
  select count(*) into missing_before
  from deduplicated as expected
  left join public.ht_agent_target_research_episodes as episode
    on episode.profile_id=expected.profile_id
    and episode.symbol=expected.symbol
    and episode.session_date=expected.episode_session_date
    and episode.canonical_lane=expected.canonical_lane
    and episode.horizon=expected.horizon
  where episode.id is null;

  with candidate_values as materialized (
    select
      outcome.id as outcome_id,
      decision.id as decision_id,
      decision.frame_id,
      decision.profile_id,
      decision.user_id,
      decision.symbol,
      decision.decision_version,
      decision.policy_version,
      decision.decided_at,
      outcome.horizon,
      outcome.target_at,
      frame.provider_timestamp,
      nullif(frame.canonical_evidence->>'sourceLane','') as canonical_lane,
      frame.canonical_evidence,
      frame.prox_evidence,
      frame.market_facts,
      case when coalesce(decision.trade_plan->>'confirmationTrigger','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'confirmationTrigger')::numeric
        else decision.proposed_entry end as trigger_price,
      greatest(
        decision.proposed_entry,
        case when coalesce(decision.trade_plan#>>'{entryZone,high}','') ~
          '^[+-]?[0-9]+([.][0-9]+)?$'
          then (decision.trade_plan#>>'{entryZone,high}')::numeric end,
        case when coalesce(decision.trade_plan->>'confirmationTrigger','') ~
          '^[+-]?[0-9]+([.][0-9]+)?$'
          then (decision.trade_plan->>'confirmationTrigger')::numeric
          else decision.proposed_entry end
      ) as entry_price,
      case when coalesce(decision.trade_plan->>'invalidation','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'invalidation')::numeric
        else decision.proposed_stop end as stop_price,
      case when coalesce(decision.trade_plan->>'targetOne','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'targetOne')::numeric
        else decision.proposed_target end as target_one,
      case when coalesce(decision.trade_plan->>'targetTwo','') ~
        '^[+-]?[0-9]+([.][0-9]+)?$'
        then (decision.trade_plan->>'targetTwo')::numeric end as target_two
    from public.ht_agent_target_research_seed_failures as failure
    join public.ht_agent_outcomes as outcome on outcome.id=failure.outcome_id
    join public.ht_agent_cohort_observations as cohort
      on cohort.id=outcome.cohort_observation_id
      and cohort.cohort='ht_agent_full'
    join public.ht_agent_decisions as decision on decision.id=outcome.decision_id
    join public.ht_agent_decision_frames as frame on frame.id=decision.frame_id
    where failure.error_code='42702'
      and outcome.horizon in ('15m','60m','session')
      and decision.risk_allowed is true
      and jsonb_typeof(coalesce(decision.trade_plan,'null'::jsonb))='object'
      and decision.trade_plan->>'status'='paper_entry_eligible'
  ), eligible as materialized (
    select candidate_values.*,
      (candidate_values.provider_timestamp at time zone 'America/New_York')::date
        as episode_session_date,
      date_trunc('minute',candidate_values.provider_timestamp)+
        case when candidate_values.provider_timestamp=
          date_trunc('minute',candidate_values.provider_timestamp)
          then interval '0 minutes' else interval '1 minute' end as valid_from
    from candidate_values
    where candidate_values.canonical_lane in ('momentum','before_crowd')
      and candidate_values.provider_timestamp is not null
      and candidate_values.entry_price>0
      and candidate_values.trigger_price>0
      and candidate_values.trigger_price<=candidate_values.entry_price
      and candidate_values.stop_price>0
      and candidate_values.stop_price<candidate_values.entry_price
      and candidate_values.target_one>candidate_values.entry_price
      and (candidate_values.target_two is null or
        candidate_values.target_two>candidate_values.target_one)
  ), deduplicated as materialized (
    select distinct on (
      eligible.profile_id,eligible.symbol,eligible.episode_session_date,
      eligible.canonical_lane,eligible.horizon
    ) eligible.*
    from eligible
    where eligible.target_at>eligible.valid_from
    order by eligible.profile_id,eligible.symbol,eligible.episode_session_date,
      eligible.canonical_lane,eligible.horizon,eligible.decided_at,eligible.outcome_id
  ), inserted as (
    insert into public.ht_agent_target_research_episodes(
      decision_id,frame_id,profile_id,user_id,symbol,session_date,
      canonical_lane,horizon,research_version,decision_version,
      risk_policy_version,provider_timestamp,valid_from,target_at,
      least_favorable_entry,trigger_price,stop_price,target_one,target_two,
      canonical_evidence,prox_evidence,market_facts
    )
    select
      expected.decision_id,expected.frame_id,expected.profile_id,
      expected.user_id,expected.symbol,expected.episode_session_date,
      expected.canonical_lane,expected.horizon,
      'ht-agent-target-path-research-v1',expected.decision_version,
      expected.policy_version,expected.provider_timestamp,expected.valid_from,
      expected.target_at,expected.entry_price,expected.trigger_price,
      expected.stop_price,expected.target_one,expected.target_two,
      expected.canonical_evidence,expected.prox_evidence,expected.market_facts
    from deduplicated as expected
    on conflict do nothing
    returning id
  )
  select count(*) into inserted_count from inserted;

  with failure_keys as (
    select distinct
      decision.profile_id,decision.symbol,
      (frame.provider_timestamp at time zone 'America/New_York')::date
        as episode_session_date,
      nullif(frame.canonical_evidence->>'sourceLane','') as canonical_lane,
      outcome.horizon
    from public.ht_agent_target_research_seed_failures as failure
    join public.ht_agent_outcomes as outcome on outcome.id=failure.outcome_id
    join public.ht_agent_decisions as decision on decision.id=outcome.decision_id
    join public.ht_agent_decision_frames as frame on frame.id=decision.frame_id
    where failure.error_code='42702'
  )
  select count(*) into missing_after
  from failure_keys as expected
  left join public.ht_agent_target_research_episodes as episode
    on episode.profile_id=expected.profile_id
    and episode.symbol=expected.symbol
    and episode.session_date=expected.episode_session_date
    and episode.canonical_lane=expected.canonical_lane
    and episode.horizon=expected.horizon
  where episode.id is null;

  insert into public.ht_agent_target_research_repair_receipts(
    id,version,failure_receipts_preserved,
    missing_deduplicated_episodes_before,backfilled_episode_count,
    missing_deduplicated_episodes_after,provider_requests_added,
    authority,execution_authority
  ) values(
    '0061_target_research_persistence_and_health',
    'ht-agent-target-research-repair-v1',failures_before,missing_before,
    inserted_count,missing_after,0,'research_only','none'
  ) on conflict(id) do nothing;
end $$;

-- Bounded health projection. It reads the compact append-only research ledger
-- plus indexed immutable failure receipts instead of rescanning the complete
-- Agent outcome history. Existing primary/unique indexes support every join;
-- no speculative index is added.
create or replace function public.ht_agent_target_research_health()
returns jsonb
language sql stable security definer set search_path='' set statement_timeout='15s' as $$
  with horizons(horizon) as (
    values ('15m'::text),('60m'::text),('session'::text)
  ), repair_receipt as (
    select receipt.*
    from public.ht_agent_target_research_repair_receipts as receipt
    where receipt.id='0061_target_research_persistence_and_health'
  ), failure_sources as materialized (
    select
      decision.profile_id,decision.symbol,
      (frame.provider_timestamp at time zone 'America/New_York')::date
        as session_date,
      nullif(frame.canonical_evidence->>'sourceLane','') as canonical_lane,
      outcome.horizon,decision.decided_at
    from public.ht_agent_target_research_seed_failures as failure
    join public.ht_agent_outcomes as outcome on outcome.id=failure.outcome_id
    join public.ht_agent_decisions as decision on decision.id=outcome.decision_id
    join public.ht_agent_decision_frames as frame on frame.id=decision.frame_id
    cross join repair_receipt
    where (
        failure.error_code='42702' or
        failure.failed_at>repair_receipt.applied_at
      )
      and outcome.horizon in ('15m','60m','session')
      and frame.provider_timestamp is not null
      and nullif(frame.canonical_evidence->>'sourceLane','')
        in ('momentum','before_crowd')
  ), expected as materialized (
    select sources.profile_id,sources.symbol,sources.session_date,
      sources.canonical_lane,sources.horizon,max(sources.decided_at) as latest_decided_at
    from (
      select episode.profile_id,episode.symbol,episode.session_date,
        episode.canonical_lane,episode.horizon,decision.decided_at
      from public.ht_agent_target_research_episodes as episode
      join public.ht_agent_decisions as decision on decision.id=episode.decision_id
      union all
      select failure_sources.profile_id,failure_sources.symbol,
        failure_sources.session_date,failure_sources.canonical_lane,
        failure_sources.horizon,failure_sources.decided_at
      from failure_sources
    ) as sources
    group by sources.profile_id,sources.symbol,sources.session_date,
      sources.canonical_lane,sources.horizon
  ), coverage as (
    select horizon.horizon,
      count(expected.horizon) as expected,
      count(episode.id) as persisted,
      count(expected.horizon) filter(where episode.id is null) as missing,
      max(expected.latest_decided_at) as latest_eligible_decision_at
    from horizons as horizon
    left join expected on expected.horizon=horizon.horizon
    left join public.ht_agent_target_research_episodes as episode
      on episode.profile_id=expected.profile_id
      and episode.symbol=expected.symbol
      and episode.session_date=expected.session_date
      and episode.canonical_lane=expected.canonical_lane
      and episode.horizon=expected.horizon
    group by horizon.horizon
  ), episode_counts as (
    select horizon.horizon,
      count(episode.id) as episodes,
      count(result.episode_id) as completed,
      count(episode.id) filter(where result.episode_id is null) as pending,
      count(result.episode_id) filter(
        where result.resolution_state='measured') as measured,
      count(result.episode_id) filter(
        where result.resolution_state='ambiguous') as ambiguous,
      count(result.episode_id) filter(
        where result.resolution_state='unavailable') as unavailable,
      max(result.evaluated_at) as latest_evaluated_at
    from horizons as horizon
    left join public.ht_agent_target_research_episodes as episode
      on episode.horizon=horizon.horizon
    left join public.ht_agent_target_research_results as result
      on result.episode_id=episode.id
    group by horizon.horizon
  ), failure_counts as (
    select horizon.horizon,count(failure.id) as failed,
      count(failure.id) filter(
        where failure.failed_at>repair_receipt.applied_at
      ) as post_repair_failed,
      max(failure.failed_at) as latest_failed_at
    from horizons as horizon
    cross join repair_receipt
    left join public.ht_agent_target_research_seed_failures as failure
      on failure.horizon=horizon.horizon
    group by horizon.horizon,repair_receipt.applied_at
  ), per_horizon as (
    select coverage.horizon,coverage.expected,coverage.persisted,
      coverage.missing,failure_counts.failed,
      failure_counts.post_repair_failed,failure_counts.latest_failed_at,
      episode_counts.episodes,
      episode_counts.completed,episode_counts.pending,episode_counts.measured,
      episode_counts.ambiguous,episode_counts.unavailable,
      episode_counts.latest_evaluated_at,
      coverage.latest_eligible_decision_at
    from coverage
    join episode_counts using(horizon)
    join failure_counts using(horizon)
  ), horizon_json as (
    select jsonb_object_agg(per_horizon.horizon,jsonb_build_object(
      'expected',per_horizon.expected,
      'persisted',per_horizon.persisted,
      'missing',per_horizon.missing,
      'historicalSeedFailures',per_horizon.failed,
      'postRepairSeedFailures',per_horizon.post_repair_failed,
      'episodes',per_horizon.episodes,
      'completed',per_horizon.completed,
      'pending',per_horizon.pending,
      'measured',per_horizon.measured,
      'ambiguous',per_horizon.ambiguous,
      'unavailable',per_horizon.unavailable,
      'latestEvaluatedAt',per_horizon.latest_evaluated_at
    ) order by case per_horizon.horizon
      when '15m' then 1 when '60m' then 2 else 3 end) as value
    from per_horizon
  ), totals as (
    select sum(expected) as expected,sum(persisted) as persisted,
      sum(missing) as missing,sum(failed) as failed,sum(episodes) as episodes,
      sum(post_repair_failed) as post_repair_failed,
      sum(completed) as completed,sum(pending) as pending,
      sum(measured) as measured,sum(ambiguous) as ambiguous,
      sum(unavailable) as unavailable,
      max(latest_evaluated_at) as latest_evaluated_at,
      max(latest_failed_at) as latest_failed_at,
      max(latest_eligible_decision_at) as latest_eligible_decision_at
    from per_horizon
  ), sessions as (
    select count(distinct episode.session_date) as total
    from public.ht_agent_target_research_episodes as episode
  ), outcomes as (
    select coalesce(jsonb_object_agg(grouped.outcome_code,grouped.total),
      '{}'::jsonb) as value
    from (
      select result.outcome_code,count(*) as total
      from public.ht_agent_target_research_results as result
      group by result.outcome_code
    ) as grouped
  ), control as (
    select observability.coverage_started_at
    from public.ht_agent_target_research_observability as observability
    where observability.id='global'
  ), repair as (
    select to_jsonb(repair_receipt) as value from repair_receipt
  )
  select jsonb_build_object(
    'version','ht-agent-target-path-research-v1',
    'observabilityVersion','ht-agent-target-research-observability-v1',
    'repairVersion','ht-agent-target-research-repair-v1',
    'coverageStartedAt',control.coverage_started_at,
    'authority','research_only','providerRequestsAdded',0,
    'episodes',totals.episodes,'sessions',sessions.total,
    'completed',totals.completed,'measured',totals.measured,
    'ambiguous',totals.ambiguous,'unavailable',totals.unavailable,
    'pending',totals.pending,'outcomeCounts',outcomes.value,
    'latestEvaluatedAt',totals.latest_evaluated_at,
    'expectedEpisodeCount',totals.expected,
    'persistedExpectedEpisodeCount',totals.persisted,
    'missingEpisodeCount',totals.missing,
    'coverageComplete',(
      totals.missing=0 and totals.post_repair_failed=0
    ),
    'latestEligibleDecisionAt',totals.latest_eligible_decision_at,
    'seedFailureCount',totals.failed,
    'postRepairSeedFailureCount',totals.post_repair_failed,
    'latestSeedFailureAt',totals.latest_failed_at,
    'countsByHorizon',horizon_json.value,
    'migrationRepair',repair.value,
    'seedCohort','ht_agent_full',
    'triggerAttemptsPerEligibleDecision',3,
    'canonicalEntryChallengerReady',(
      sessions.total>=30 and totals.measured>=500
    ),
    'executionAuthority','none'
  )
  from totals cross join sessions cross join outcomes cross join control
    cross join horizon_json cross join repair;
$$;

revoke all on function public.ht_agent_seed_target_research_episode(),
  public.ht_agent_target_research_health()
  from public,anon,authenticated,service_role;
grant execute on function public.ht_agent_seed_target_research_episode(),
  public.ht_agent_target_research_health() to service_role;

comment on table public.ht_agent_target_research_repair_receipts is
  'Immutable 0061 persistence/backfill receipt; research-only and provider-free.';

notify pgrst,'reload schema';
commit;
