-- Prospective Agent X target-path research. This is an additive, read-only
-- learning ledger. It cannot change Canonical, ProX, Agent decisions, Paper,
-- or execution. Episodes are de-correlated to the first eligible setup for a
-- symbol/session/lane and evaluated only from completed Massive minute bars
-- already requested by the existing Agent outcome worker.
begin;

do $$ begin
  if to_regclass('public.ht_agent_decisions') is null or
     to_regclass('public.ht_agent_decision_frames') is null or
     to_regclass('public.ht_agent_outcomes') is null or
     to_regclass('public.ht_agent_outcome_worker_control') is null then
    raise exception 'Apply HT Agent Phase 1 and outcome-worker migrations first';
  end if;
end $$;

create table if not exists public.ht_agent_target_research_episodes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.ht_agent_decisions(id) on delete restrict,
  frame_id uuid not null references public.ht_agent_decision_frames(id) on delete restrict,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check(symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  session_date date not null,
  canonical_lane text not null check(canonical_lane in ('momentum','before_crowd')),
  horizon text not null check(horizon in ('15m','60m','session')),
  research_version text not null check(research_version='ht-agent-target-path-research-v1'),
  decision_version text not null,
  risk_policy_version text not null,
  provider_timestamp timestamptz not null,
  valid_from timestamptz not null,
  target_at timestamptz not null check(target_at>valid_from),
  least_favorable_entry numeric not null check(least_favorable_entry>0),
  trigger_price numeric not null check(trigger_price>0 and trigger_price<=least_favorable_entry),
  stop_price numeric not null check(stop_price>0 and stop_price<least_favorable_entry),
  target_one numeric not null check(target_one>least_favorable_entry),
  target_two numeric check(target_two is null or target_two>target_one),
  canonical_evidence jsonb not null check(jsonb_typeof(canonical_evidence)='object'),
  prox_evidence jsonb not null check(jsonb_typeof(prox_evidence)='object'),
  market_facts jsonb not null check(jsonb_typeof(market_facts)='object'),
  authority text not null default 'research_only' check(authority='research_only'),
  created_at timestamptz not null default clock_timestamp(),
  unique(decision_id,horizon),
  unique(profile_id,symbol,session_date,canonical_lane,horizon)
);

create table if not exists public.ht_agent_target_research_results (
  episode_id uuid primary key references public.ht_agent_target_research_episodes(id) on delete restrict,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  evaluation_version text not null check(evaluation_version='ht-agent-target-path-research-v1'),
  resolution_state text not null check(resolution_state in ('measured','ambiguous','unavailable')),
  outcome_code text not null check(outcome_code in (
    'target_two_before_stop','target_one_before_stop','target_one_then_stop',
    'stop_before_target','invalidated_before_entry','expired_after_entry',
    'expired_untriggered','ambiguous_entry_candle',
    'ambiguous_target_stop_candle','insufficient_provider_coverage'
  )),
  entry_triggered_at timestamptz,
  target_one_reached_at timestamptz,
  target_two_reached_at timestamptz,
  stop_reached_at timestamptz,
  post_entry_maximum_high numeric,
  post_entry_minimum_low numeric,
  maximum_favorable_excursion_percent numeric,
  maximum_adverse_excursion_percent numeric,
  expected_interval_count integer not null check(expected_interval_count>0),
  provider_bar_count integer not null check(provider_bar_count>=0),
  coverage_percent numeric not null check(coverage_percent>=0 and coverage_percent<=100),
  first_provider_bar_at timestamptz,
  last_provider_bar_at timestamptz,
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  reason text not null,
  authority jsonb not null check(authority=jsonb_build_object(
    'canonicalDecision',false,'canonicalRanking',false,'agentDecision',false,
    'paperExecution',false,'liveExecution',false
  )),
  evaluated_at timestamptz not null default clock_timestamp(),
  check(provider_bar_count<=expected_interval_count),
  check((post_entry_maximum_high is null)=(post_entry_minimum_low is null)),
  check(post_entry_maximum_high is null or (
    post_entry_maximum_high>0 and post_entry_minimum_low>0 and
    post_entry_maximum_high>=post_entry_minimum_low
  )),
  check((resolution_state='unavailable')=(outcome_code='insufficient_provider_coverage')),
  check((resolution_state='ambiguous')=(outcome_code in (
    'ambiguous_entry_candle','ambiguous_target_stop_candle'
  )))
);

create index if not exists ht_agent_target_research_episodes_due_idx
  on public.ht_agent_target_research_episodes(target_at,id);
create index if not exists ht_agent_target_research_episodes_symbol_idx
  on public.ht_agent_target_research_episodes(symbol,provider_timestamp desc);
create index if not exists ht_agent_target_research_results_time_idx
  on public.ht_agent_target_research_results(evaluated_at desc);

alter table public.ht_agent_target_research_episodes enable row level security;
alter table public.ht_agent_target_research_results enable row level security;
revoke all on public.ht_agent_target_research_episodes,
  public.ht_agent_target_research_results from public,anon,authenticated,service_role;
grant select on public.ht_agent_target_research_episodes,
  public.ht_agent_target_research_results to authenticated;
grant all on public.ht_agent_target_research_episodes,
  public.ht_agent_target_research_results to service_role;

create policy ht_agent_target_research_episodes_owner_read
  on public.ht_agent_target_research_episodes for select to authenticated
  using(auth.uid()=user_id);
create policy ht_agent_target_research_results_owner_read
  on public.ht_agent_target_research_results for select to authenticated
  using(auth.uid()=user_id);

create or replace function public.ht_agent_target_research_reject_mutation()
returns trigger language plpgsql as $$ begin
  raise exception 'ht_agent_target_research_record_is_immutable';
end $$;

create trigger ht_agent_target_research_episodes_immutable
  before update or delete on public.ht_agent_target_research_episodes
  for each row execute function public.ht_agent_target_research_reject_mutation();
create trigger ht_agent_target_research_results_immutable
  before update or delete on public.ht_agent_target_research_results
  for each row execute function public.ht_agent_target_research_reject_mutation();

create or replace function public.ht_agent_seed_target_research_episode()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  d public.ht_agent_decisions%rowtype;
  f public.ht_agent_decision_frames%rowtype;
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
  if new.horizon not in ('15m','60m','session') then return new; end if;
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
  raise warning 'HT Agent target research seed skipped: %',sqlerrm;
  return new;
end $$;

create trigger ht_agent_seed_target_research_episode_after_outcome
  after insert on public.ht_agent_outcomes for each row
  execute function public.ht_agent_seed_target_research_episode();

create or replace function public.ht_agent_claim_outcome_batch(
  p_worker_id uuid,
  p_limit integer default 900
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s' as $$
declare
  c public.ht_agent_outcome_worker_control%rowtype;
  n timestamptz:=clock_timestamp();
  claimed jsonb:='[]'::jsonb;
  target_claimed jsonb:='[]'::jsonb;
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
    status='failed',completed_at=n,
    error_message=coalesce(error_message,'Abandoned running cycle retired by outcome worker v2')
  where status='running' and started_at<n-interval '5 minutes';
  get diagnostics retired=row_count;

  with due as (
    select o.id,o.target_at,o.decision_id,o.cohort_observation_id,o.horizon
    from public.ht_agent_outcomes o
    where o.complete=false and o.target_at<=n
    order by (o.target_at<=n-interval '10 minutes') desc,o.target_at,o.id
    limit bounded_limit for update skip locked
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'decisionId',d.decision_id,'horizon',d.horizon,
    'targetAt',d.target_at,'symbol',x.symbol,
    'proposedEntry',x.proposed_entry,'cohort',h.cohort,
    'wouldEnter',h.would_enter,
    'conservativeSlippageBps',h.conservative_slippage_bps
  ) order by d.target_at,d.id),'[]'::jsonb)
  into claimed
  from due d
  join public.ht_agent_decisions x on x.id=d.decision_id
  join public.ht_agent_cohort_observations h on h.id=d.cohort_observation_id;

  with target_due as (
    select e.*
    from public.ht_agent_target_research_episodes e
    left join public.ht_agent_target_research_results r on r.episode_id=e.id
    where r.episode_id is null and e.target_at<=n-interval '10 minutes' and exists(
      select 1 from jsonb_array_elements(claimed) row
      where row->>'symbol'=e.symbol
    )
    order by e.target_at,e.id
    limit bounded_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'decisionId',e.decision_id,'symbol',e.symbol,
    'horizon',e.horizon,'validFrom',e.valid_from,'targetAt',e.target_at,
    'leastFavorableEntry',e.least_favorable_entry,
    'triggerPrice',e.trigger_price,'stopPrice',e.stop_price,
    'targetOne',e.target_one,'targetTwo',e.target_two
  ) order by e.target_at,e.id),'[]'::jsonb)
  into target_claimed
  from target_due e;

  update public.ht_agent_outcome_worker_control set
    lease_id=p_worker_id,lease_until=n+interval '6 minutes',
    claimed_count=jsonb_array_length(claimed),last_started_at=n,updated_at=n
  where id='global';
  return jsonb_build_object(
    'allowed',true,'version','ht-agent-outcome-worker-v4-target-research',
    'rows',claimed,'targetEpisodes',target_claimed,
    'claimed',jsonb_array_length(claimed),'retiredAgentRuns',retired,
    'providerRequests',0
  );
end $$;

create or replace function public.ht_agent_record_target_research_results(
  p_worker_id uuid,
  p_results jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='30s' as $$
declare
  c public.ht_agent_outcome_worker_control%rowtype;
  item jsonb;
  e public.ht_agent_target_research_episodes%rowtype;
  inserted_count integer:=0;
begin
  if p_worker_id is null or jsonb_typeof(coalesce(p_results,'null'::jsonb))<>'array' or
     jsonb_array_length(p_results)>1200 then raise exception 'invalid_target_research_batch'; end if;
  select * into strict c from public.ht_agent_outcome_worker_control
    where id='global' for update;
  if c.lease_id is distinct from p_worker_id or c.lease_until<=clock_timestamp() then
    raise exception 'outcome_worker_lease_lost';
  end if;
  for item in select value from jsonb_array_elements(p_results) loop
    select * into strict e from public.ht_agent_target_research_episodes
      where id=(item->>'episodeId')::uuid;
    if item->>'version' is distinct from 'ht-agent-target-path-research-v1' or
       item#>>'{authority,canonicalDecision}' is distinct from 'false' or
       item#>>'{authority,canonicalRanking}' is distinct from 'false' or
       item#>>'{authority,agentDecision}' is distinct from 'false' or
       item#>>'{authority,paperExecution}' is distinct from 'false' or
       item#>>'{authority,liveExecution}' is distinct from 'false' then
      raise exception 'invalid_target_research_authority';
    end if;
    insert into public.ht_agent_target_research_results(
      episode_id,profile_id,user_id,evaluation_version,resolution_state,
      outcome_code,entry_triggered_at,target_one_reached_at,
      target_two_reached_at,stop_reached_at,
      post_entry_maximum_high,post_entry_minimum_low,
      maximum_favorable_excursion_percent,maximum_adverse_excursion_percent,
      expected_interval_count,provider_bar_count,coverage_percent,
      first_provider_bar_at,last_provider_bar_at,evidence_hash,reason,authority
    ) values(
      e.id,e.profile_id,e.user_id,item->>'version',item->>'resolutionState',
      item->>'outcomeCode',nullif(item->>'entryTriggeredAt','')::timestamptz,
      nullif(item->>'targetOneReachedAt','')::timestamptz,
      nullif(item->>'targetTwoReachedAt','')::timestamptz,
      nullif(item->>'stopReachedAt','')::timestamptz,
      nullif(item->>'postEntryMaximumHigh','')::numeric,
      nullif(item->>'postEntryMinimumLow','')::numeric,
      nullif(item->>'maximumFavorableExcursionPercent','')::numeric,
      nullif(item->>'maximumAdverseExcursionPercent','')::numeric,
      (item->>'expectedIntervalCount')::integer,
      (item->>'providerBarCount')::integer,(item->>'coveragePercent')::numeric,
      nullif(item->>'firstProviderBarAt','')::timestamptz,
      nullif(item->>'lastProviderBarAt','')::timestamptz,
      item->>'evidenceHash',item->>'reason',item->'authority'
    ) on conflict(episode_id) do nothing;
    if found then inserted_count:=inserted_count+1; end if;
  end loop;
  return jsonb_build_object(
    'ok',true,'version','ht-agent-target-path-research-v1',
    'inserted',inserted_count,'providerRequests',0,
    'authority','research_only'
  );
end $$;

create or replace function public.ht_agent_target_research_health()
returns jsonb
language sql stable security definer set search_path='' set statement_timeout='15s' as $$
  with counts as (
    select count(*) as episodes,
      count(distinct e.session_date) as sessions,
      count(r.episode_id) as completed,
      count(*) filter(where r.resolution_state='measured') as measured,
      count(*) filter(where r.resolution_state='ambiguous') as ambiguous,
      count(*) filter(where r.resolution_state='unavailable') as unavailable,
      max(r.evaluated_at) as latest_evaluated_at
    from public.ht_agent_target_research_episodes e
    left join public.ht_agent_target_research_results r on r.episode_id=e.id
  ), outcomes as (
    select coalesce(jsonb_object_agg(outcome_code,total),'{}'::jsonb) as values
    from (select outcome_code,count(*) total
      from public.ht_agent_target_research_results group by outcome_code) grouped
  )
  select jsonb_build_object(
    'version','ht-agent-target-path-research-v1',
    'authority','research_only','providerRequestsAdded',0,
    'episodes',counts.episodes,'sessions',counts.sessions,
    'completed',counts.completed,'measured',counts.measured,
    'ambiguous',counts.ambiguous,'unavailable',counts.unavailable,
    'pending',counts.episodes-counts.completed,
    'outcomeCounts',outcomes.values,
    'latestEvaluatedAt',counts.latest_evaluated_at,
    'canonicalEntryChallengerReady',(
      counts.sessions>=30 and counts.measured>=500
    ),
    'executionAuthority','none'
  ) from counts cross join outcomes;
$$;

revoke all on function public.ht_agent_target_research_reject_mutation(),
  public.ht_agent_seed_target_research_episode(),
  public.ht_agent_record_target_research_results(uuid,jsonb),
  public.ht_agent_target_research_health()
  from public,anon,authenticated,service_role;
grant execute on function public.ht_agent_target_research_reject_mutation(),
  public.ht_agent_seed_target_research_episode(),
  public.ht_agent_record_target_research_results(uuid,jsonb),
  public.ht_agent_target_research_health() to service_role;

comment on table public.ht_agent_target_research_episodes is
  'Immutable, de-correlated Agent target definitions for prospective research only; no Canonical, Agent, Paper, or execution authority.';
comment on table public.ht_agent_target_research_results is
  'Immutable Target 1/Target 2/stop path outcomes from completed provider minutes; ambiguity and missing coverage are never losses.';

notify pgrst,'reload schema';
commit;
