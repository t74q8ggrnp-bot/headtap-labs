-- HT Agent entry-to-target challenger scorecard.
--
-- This migration does not create or modify a live score. It summarizes the
-- immutable target-path episodes produced by migrations 0058-0061 so HT Labs
-- can learn which frozen entry bands, target margins and reward/risk profiles
-- have actually worked. Promotion remains separately reviewed and forward
-- validated. No provider request, Canonical write, Agent decision write,
-- Paper mutation or execution authority is added here.

begin;

do $$ begin
  if to_regclass('public.ht_agent_target_research_episodes') is null or
     to_regclass('public.ht_agent_target_research_results') is null then
    raise exception 'Apply HT Agent target research migrations 0058 through 0061 first';
  end if;
end $$;

create table if not exists public.ht_agent_entry_target_challenger_calibrations (
  cohort_key text primary key,
  model_version text not null
    check(model_version='ht-agent-entry-target-challenger-v1'),
  cohort_level text not null check(cohort_level in (
    'overall','lane_horizon','session_lane_horizon','plan_shape_horizon'
  )),
  dimensions jsonb not null check(jsonb_typeof(dimensions)='object'),
  sample_size integer not null check(sample_size>0),
  session_count integer not null check(session_count>0),
  entry_triggered_count integer not null check(entry_triggered_count between 0 and sample_size),
  target_one_count integer not null check(target_one_count between 0 and entry_triggered_count),
  target_two_count integer not null check(target_two_count between 0 and target_one_count),
  stop_before_target_count integer not null check(stop_before_target_count between 0 and entry_triggered_count),
  invalidated_before_entry_count integer not null check(invalidated_before_entry_count between 0 and sample_size),
  expired_untriggered_count integer not null check(expired_untriggered_count between 0 and sample_size),
  expired_after_entry_count integer not null check(expired_after_entry_count between 0 and entry_triggered_count),
  entry_trigger_rate numeric not null check(entry_trigger_rate between 0 and 1),
  target_one_after_trigger_rate numeric check(target_one_after_trigger_rate between 0 and 1),
  target_two_after_trigger_rate numeric check(target_two_after_trigger_rate between 0 and 1),
  stop_before_target_after_trigger_rate numeric check(stop_before_target_after_trigger_rate between 0 and 1),
  median_planned_target_one_percent numeric not null,
  median_planned_target_two_percent numeric,
  median_planned_risk_percent numeric not null,
  median_planned_rr_one numeric not null,
  median_planned_rr_two numeric,
  median_entry_band_percent numeric not null,
  median_mfe_percent numeric,
  median_mae_percent numeric,
  evidence_state text not null check(evidence_state in ('insufficient','emerging','calibrated')),
  sample_gate_met boolean not null default false,
  forward_validation_required boolean not null default true
    check(forward_validation_required=true),
  live_promotion_authorized boolean not null default false
    check(live_promotion_authorized=false),
  authority text not null default 'research_only' check(authority='research_only'),
  provider_requests_added integer not null default 0 check(provider_requests_added=0),
  computed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists ht_agent_entry_target_challenger_evidence_idx
  on public.ht_agent_entry_target_challenger_calibrations
  (evidence_state,cohort_level,sample_size desc,computed_at desc);

create table if not exists public.ht_agent_entry_target_challenger_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  model_version text not null
    check(model_version='ht-agent-entry-target-challenger-v1'),
  source_episode_count integer not null check(source_episode_count>=0),
  measured_result_count integer not null check(measured_result_count>=0),
  ambiguous_result_count integer not null check(ambiguous_result_count>=0),
  unavailable_result_count integer not null check(unavailable_result_count>=0),
  session_count integer not null check(session_count>=0),
  expected_cohort_count integer not null check(expected_cohort_count>=0),
  persisted_cohort_count integer not null check(persisted_cohort_count>=0),
  sample_gate_met boolean not null default false,
  complete boolean not null default false,
  diagnostics jsonb not null check(jsonb_typeof(diagnostics)='object'),
  provider_request_count integer not null default 0 check(provider_request_count=0),
  authority text not null default 'research_only' check(authority='research_only'),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(observation_minute,model_version)
);

create index if not exists ht_agent_entry_target_challenger_runs_time_idx
  on public.ht_agent_entry_target_challenger_runs(observed_at desc);

alter table public.ht_agent_entry_target_challenger_calibrations enable row level security;
alter table public.ht_agent_entry_target_challenger_runs enable row level security;

revoke all on public.ht_agent_entry_target_challenger_calibrations,
  public.ht_agent_entry_target_challenger_runs
  from public,anon,authenticated,service_role;
grant all on public.ht_agent_entry_target_challenger_calibrations,
  public.ht_agent_entry_target_challenger_runs to service_role;

create or replace function public.ht_agent_entry_target_challenger_reject_run_mutation()
returns trigger language plpgsql set search_path='' as $$ begin
  raise exception 'ht_agent_entry_target_challenger_run_is_immutable';
end $$;

drop trigger if exists ht_agent_entry_target_challenger_runs_immutable
  on public.ht_agent_entry_target_challenger_runs;
create trigger ht_agent_entry_target_challenger_runs_immutable
  before update or delete on public.ht_agent_entry_target_challenger_runs
  for each row execute function public.ht_agent_entry_target_challenger_reject_run_mutation();

create or replace function public.ht_agent_refresh_entry_target_challenger()
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
  now_at timestamptz:=clock_timestamp();
  minute_at timestamptz:=date_trunc('minute',now_at);
  source_episodes integer:=0;
  measured_results integer:=0;
  ambiguous_results integer:=0;
  unavailable_results integer:=0;
  source_sessions integer:=0;
  expected_cohorts integer:=0;
  persisted_cohorts integer:=0;
  global_gate boolean:=false;
  run_id uuid;
begin
  select count(*),count(distinct episode.session_date)
    into source_episodes,source_sessions
  from public.ht_agent_target_research_episodes as episode;

  select
    count(*) filter(where result.resolution_state='measured'),
    count(*) filter(where result.resolution_state='ambiguous'),
    count(*) filter(where result.resolution_state='unavailable')
    into measured_results,ambiguous_results,unavailable_results
  from public.ht_agent_target_research_results as result;

  global_gate:=source_sessions>=30 and measured_results>=500;

  with base as (
    select
      episode.id,
      episode.session_date,
      episode.canonical_lane,
      episode.horizon,
      case
        when episode.market_facts->>'marketSession' in ('regular','premarket','after_hours','closed')
          then episode.market_facts->>'marketSession'
        else 'unknown'
      end as market_session,
      ((episode.target_one-episode.least_favorable_entry)/episode.least_favorable_entry)*100 as target_one_percent,
      case when episode.target_two is null then null else
        ((episode.target_two-episode.least_favorable_entry)/episode.least_favorable_entry)*100 end as target_two_percent,
      ((episode.least_favorable_entry-episode.stop_price)/episode.least_favorable_entry)*100 as risk_percent,
      (episode.target_one-episode.least_favorable_entry)/(episode.least_favorable_entry-episode.stop_price) as rr_one,
      case when episode.target_two is null then null else
        (episode.target_two-episode.least_favorable_entry)/(episode.least_favorable_entry-episode.stop_price) end as rr_two,
      ((episode.least_favorable_entry-episode.trigger_price)/episode.trigger_price)*100 as entry_band_percent,
      result.outcome_code,
      result.entry_triggered_at,
      result.maximum_favorable_excursion_percent as mfe_percent,
      result.maximum_adverse_excursion_percent as mae_percent
    from public.ht_agent_target_research_episodes as episode
    join public.ht_agent_target_research_results as result on result.episode_id=episode.id
    where result.resolution_state='measured'
  ), shaped as (
    select base.*,
      case when target_one_percent<3 then 'under_3pct'
        when target_one_percent<7 then '3_to_7pct'
        when target_one_percent<15 then '7_to_15pct'
        else '15pct_plus' end as target_margin_bucket,
      case when rr_one<1 then 'under_1r'
        when rr_one<1.5 then '1_to_1_5r'
        when rr_one<2.5 then '1_5_to_2_5r'
        else '2_5r_plus' end as rr_bucket,
      case when entry_band_percent<=2 then 'tight_2pct'
        when entry_band_percent<=5 then 'moderate_2_to_5pct'
        else 'wide_5pct_plus' end as entry_band_bucket
    from base
  ), memberships as (
    select
      'ht-agent-entry-target-challenger-v1|overall'::text as cohort_key,
      'overall'::text as cohort_level,
      '{}'::jsonb as dimensions,
      shaped.*
    from shaped
    union all
    select
      'ht-agent-entry-target-challenger-v1|lane_horizon|lane='||canonical_lane||'|horizon='||horizon,
      'lane_horizon',
      jsonb_build_object('lane',canonical_lane,'horizon',horizon),
      shaped.*
    from shaped
    union all
    select
      'ht-agent-entry-target-challenger-v1|session_lane_horizon|session='||market_session||'|lane='||canonical_lane||'|horizon='||horizon,
      'session_lane_horizon',
      jsonb_build_object('marketSession',market_session,'lane',canonical_lane,'horizon',horizon),
      shaped.*
    from shaped
    union all
    select
      'ht-agent-entry-target-challenger-v1|plan_shape_horizon|margin='||target_margin_bucket||'|rr='||rr_bucket||'|entry='||entry_band_bucket||'|horizon='||horizon,
      'plan_shape_horizon',
      jsonb_build_object('targetMargin',target_margin_bucket,'rewardRisk',rr_bucket,'entryBand',entry_band_bucket,'horizon',horizon),
      shaped.*
    from shaped
  ), grouped as (
    select
      cohort_key,cohort_level,dimensions,
      count(*)::integer as sample_size,
      count(distinct session_date)::integer as session_count,
      count(*) filter(where entry_triggered_at is not null)::integer as entry_triggered_count,
      count(*) filter(where outcome_code in ('target_one_before_stop','target_one_then_stop','target_two_before_stop'))::integer as target_one_count,
      count(*) filter(where outcome_code='target_two_before_stop')::integer as target_two_count,
      count(*) filter(where outcome_code='stop_before_target')::integer as stop_before_target_count,
      count(*) filter(where outcome_code='invalidated_before_entry')::integer as invalidated_before_entry_count,
      count(*) filter(where outcome_code='expired_untriggered')::integer as expired_untriggered_count,
      count(*) filter(where outcome_code='expired_after_entry')::integer as expired_after_entry_count,
      round((count(*) filter(where entry_triggered_at is not null)::numeric/count(*))::numeric,4) as entry_trigger_rate,
      round((count(*) filter(where outcome_code in ('target_one_before_stop','target_one_then_stop','target_two_before_stop'))::numeric/nullif(count(*) filter(where entry_triggered_at is not null),0))::numeric,4) as target_one_rate,
      round((count(*) filter(where outcome_code='target_two_before_stop')::numeric/nullif(count(*) filter(where entry_triggered_at is not null),0))::numeric,4) as target_two_rate,
      round((count(*) filter(where outcome_code='stop_before_target')::numeric/nullif(count(*) filter(where entry_triggered_at is not null),0))::numeric,4) as stop_rate,
      round((percentile_cont(0.5) within group(order by target_one_percent))::numeric,4) as median_target_one,
      round((percentile_cont(0.5) within group(order by target_two_percent))::numeric,4) as median_target_two,
      round((percentile_cont(0.5) within group(order by risk_percent))::numeric,4) as median_risk,
      round((percentile_cont(0.5) within group(order by rr_one))::numeric,4) as median_rr_one,
      round((percentile_cont(0.5) within group(order by rr_two))::numeric,4) as median_rr_two,
      round((percentile_cont(0.5) within group(order by entry_band_percent))::numeric,4) as median_entry_band,
      round((percentile_cont(0.5) within group(order by mfe_percent))::numeric,4) as median_mfe,
      round((percentile_cont(0.5) within group(order by mae_percent))::numeric,4) as median_mae
    from memberships
    group by cohort_key,cohort_level,dimensions
  ), upserted as (
    insert into public.ht_agent_entry_target_challenger_calibrations(
      cohort_key,model_version,cohort_level,dimensions,sample_size,session_count,
      entry_triggered_count,target_one_count,target_two_count,stop_before_target_count,
      invalidated_before_entry_count,expired_untriggered_count,expired_after_entry_count,
      entry_trigger_rate,target_one_after_trigger_rate,target_two_after_trigger_rate,
      stop_before_target_after_trigger_rate,median_planned_target_one_percent,
      median_planned_target_two_percent,median_planned_risk_percent,median_planned_rr_one,
      median_planned_rr_two,median_entry_band_percent,median_mfe_percent,median_mae_percent,
      evidence_state,sample_gate_met,forward_validation_required,live_promotion_authorized,
      authority,provider_requests_added,computed_at
    ) select
      cohort_key,'ht-agent-entry-target-challenger-v1',cohort_level,dimensions,
      sample_size,session_count,entry_triggered_count,target_one_count,target_two_count,
      stop_before_target_count,invalidated_before_entry_count,expired_untriggered_count,
      expired_after_entry_count,entry_trigger_rate,target_one_rate,target_two_rate,stop_rate,
      median_target_one,median_target_two,median_risk,median_rr_one,median_rr_two,
      median_entry_band,median_mfe,median_mae,
      case when sample_size>=100 and session_count>=30 then 'calibrated'
        when sample_size>=30 then 'emerging' else 'insufficient' end,
      global_gate and sample_size>=100 and session_count>=30,
      true,false,'research_only',0,now_at
    from grouped
    on conflict(cohort_key) do update set
      dimensions=excluded.dimensions,sample_size=excluded.sample_size,
      session_count=excluded.session_count,entry_triggered_count=excluded.entry_triggered_count,
      target_one_count=excluded.target_one_count,target_two_count=excluded.target_two_count,
      stop_before_target_count=excluded.stop_before_target_count,
      invalidated_before_entry_count=excluded.invalidated_before_entry_count,
      expired_untriggered_count=excluded.expired_untriggered_count,
      expired_after_entry_count=excluded.expired_after_entry_count,
      entry_trigger_rate=excluded.entry_trigger_rate,
      target_one_after_trigger_rate=excluded.target_one_after_trigger_rate,
      target_two_after_trigger_rate=excluded.target_two_after_trigger_rate,
      stop_before_target_after_trigger_rate=excluded.stop_before_target_after_trigger_rate,
      median_planned_target_one_percent=excluded.median_planned_target_one_percent,
      median_planned_target_two_percent=excluded.median_planned_target_two_percent,
      median_planned_risk_percent=excluded.median_planned_risk_percent,
      median_planned_rr_one=excluded.median_planned_rr_one,
      median_planned_rr_two=excluded.median_planned_rr_two,
      median_entry_band_percent=excluded.median_entry_band_percent,
      median_mfe_percent=excluded.median_mfe_percent,median_mae_percent=excluded.median_mae_percent,
      evidence_state=excluded.evidence_state,sample_gate_met=excluded.sample_gate_met,
      computed_at=excluded.computed_at,updated_at=clock_timestamp()
    returning cohort_key
  ) select count(*) into persisted_cohorts from upserted;

  -- Calibrations are a current derived projection, not immutable source
  -- evidence. Remove only stale derived groups; episodes, results and run
  -- receipts remain untouched.
  delete from public.ht_agent_entry_target_challenger_calibrations
  where computed_at<now_at;

  select count(*) into expected_cohorts
  from public.ht_agent_entry_target_challenger_calibrations
  where computed_at=now_at;

  insert into public.ht_agent_entry_target_challenger_runs(
    observed_at,observation_minute,model_version,source_episode_count,
    measured_result_count,ambiguous_result_count,unavailable_result_count,
    session_count,expected_cohort_count,persisted_cohort_count,sample_gate_met,
    complete,diagnostics,provider_request_count,authority,completed_at
  ) values(
    now_at,minute_at,'ht-agent-entry-target-challenger-v1',source_episodes,
    measured_results,ambiguous_results,unavailable_results,source_sessions,
    expected_cohorts,persisted_cohorts,global_gate,
    expected_cohorts=persisted_cohorts,
    jsonb_build_object(
      'source','immutable_ht_agent_target_path_research',
      'denominator','measured_resolved_episodes',
      'sampleGate',jsonb_build_object('measuredRequired',500,'sessionsRequired',30),
      'forwardValidationRequired',true,
      'livePromotionAuthorized',false,
      'canonicalScoringChanged',false,
      'agentRiskChanged',false,
      'paperBehaviorChanged',false,
      'executionAuthority','none'
    ),0,'research_only',clock_timestamp()
  ) on conflict(observation_minute,model_version) do nothing
  returning id into run_id;

  return jsonb_build_object(
    'ok',expected_cohorts=persisted_cohorts,
    'version','ht-agent-entry-target-challenger-v1',
    'runId',run_id,'sourceEpisodes',source_episodes,'measured',measured_results,
    'ambiguous',ambiguous_results,'unavailable',unavailable_results,
    'sessions',source_sessions,'expectedCohorts',expected_cohorts,
    'persistedCohorts',persisted_cohorts,'sampleGateMet',global_gate,
    'forwardValidationRequired',true,'livePromotionAuthorized',false,
    'providerRequestsAdded',0,'authority','research_only','executionAuthority','none'
  );
end $$;

create or replace function public.ht_agent_entry_target_challenger_health()
returns jsonb
language sql security definer set search_path='' set statement_timeout='15s' stable as $$
  with latest_run as (
    select * from public.ht_agent_entry_target_challenger_runs
    order by observed_at desc limit 1
  ), cohorts as (
    select
      count(*)::integer as total,
      count(*) filter(where evidence_state='calibrated')::integer as calibrated,
      count(*) filter(where evidence_state='emerging')::integer as emerging,
      count(*) filter(where evidence_state='insufficient')::integer as insufficient,
      max(computed_at) as latest_computed_at
    from public.ht_agent_entry_target_challenger_calibrations
  ), overall as (
    select to_jsonb(calibration) as value
    from public.ht_agent_entry_target_challenger_calibrations as calibration
    where calibration.cohort_key='ht-agent-entry-target-challenger-v1|overall'
  )
  select jsonb_build_object(
    'version','ht-agent-entry-target-challenger-health-v1',
    'modelVersion','ht-agent-entry-target-challenger-v1',
    'authority','research_only','executionAuthority','none',
    'providerRequestsAdded',0,'primaryProductImpact',false,
    'sourceEpisodes',coalesce(latest_run.source_episode_count,0),
    'measured',coalesce(latest_run.measured_result_count,0),
    'ambiguous',coalesce(latest_run.ambiguous_result_count,0),
    'unavailable',coalesce(latest_run.unavailable_result_count,0),
    'sessions',coalesce(latest_run.session_count,0),
    'sampleGateMet',coalesce(latest_run.sample_gate_met,false),
    'forwardValidationRequired',true,'livePromotionAuthorized',false,
    'canonicalScoringChanged',false,'agentRiskChanged',false,
    'paperBehaviorChanged',false,
    'cohorts',jsonb_build_object(
      'total',cohorts.total,'calibrated',cohorts.calibrated,
      'emerging',cohorts.emerging,'insufficient',cohorts.insufficient,
      'latestComputedAt',cohorts.latest_computed_at
    ),
    'overall',coalesce(overall.value,'{}'::jsonb),
    'latestRun',coalesce(to_jsonb(latest_run),'{}'::jsonb)
  )
  from cohorts left join latest_run on true left join overall on true;
$$;

revoke all on function public.ht_agent_refresh_entry_target_challenger(),
  public.ht_agent_entry_target_challenger_health()
  from public,anon,authenticated,service_role;
grant execute on function public.ht_agent_refresh_entry_target_challenger(),
  public.ht_agent_entry_target_challenger_health() to service_role;

comment on table public.ht_agent_entry_target_challenger_calibrations is
  'Read-only research scorecard over immutable Agent target-path outcomes. It has no live scoring or execution authority.';
comment on table public.ht_agent_entry_target_challenger_runs is
  'Immutable refresh receipts for the zero-provider-request Agent entry-to-target research scorecard.';

select public.ht_agent_refresh_entry_target_challenger();

commit;
