-- Phase 2 release contract: deterministic per-target R/R, machine-readable
-- cancellation, lifecycle telemetry, and the approved SPY/QQQ shadow rollout.
-- Paper handoff stays disabled. Existing v1 plan rows remain immutable.
begin;

do $$ begin
  if to_regclass('public.ht_agent_visual_plan_versions') is null or
     to_regclass('public.ht_agent_visual_plan_worker_runs') is null or
     to_regprocedure('public.ht_agent_create_visual_plan(uuid,uuid,text,text,text,jsonb)') is null then
    raise exception 'Apply migrations 0052 and 0053 first';
  end if;
end $$;

alter table public.ht_agent_visual_plan_versions
  add column if not exists risk_reward_policy_version text,
  add column if not exists target_one_risk_reward numeric,
  add column if not exists target_two_risk_reward numeric,
  add column if not exists cancellation_policy_version text;

alter table public.ht_agent_visual_plan_versions
  drop constraint if exists ht_agent_visual_plan_versions_schema_version_check;
alter table public.ht_agent_visual_plan_versions
  add constraint ht_agent_visual_plan_versions_schema_version_check
  check(schema_version in ('agent-x-visual-paper-plan-v1','agent-x-visual-paper-plan-v2'));

alter table public.ht_agent_visual_plan_versions
  drop constraint if exists ht_agent_visual_plan_versions_policy_version_check;
alter table public.ht_agent_visual_plan_versions
  add constraint ht_agent_visual_plan_versions_policy_version_check
  check(policy_version='agent-x-visual-plan-expiry-v1-15-provider-minutes');

alter table public.ht_agent_visual_plan_versions
  drop constraint if exists ht_agent_visual_plan_versions_release_v2_check;
alter table public.ht_agent_visual_plan_versions
  add constraint ht_agent_visual_plan_versions_release_v2_check check(
    schema_version<>'agent-x-visual-paper-plan-v2' or (
      risk_reward_policy_version='agent-x-risk-reward-v1-least-favorable-entry' and
      target_one_risk_reward is not null and target_one_risk_reward>0 and
      (
        (target_two is null and target_two_risk_reward is null) or
        (target_two is not null and target_two_risk_reward is not null and
          target_two_risk_reward>target_one_risk_reward)
      ) and
      cancellation_policy_version='agent-x-cancellation-v1-provider-minute'
    )
  );

alter table public.ht_agent_visual_plan_worker_runs
  add column if not exists lifecycle_session text not null default 'unknown',
  add column if not exists closed_market_skipped boolean not null default false,
  add column if not exists reused_provider_request_count integer not null default 0;

alter table public.ht_agent_visual_plan_worker_runs
  drop constraint if exists ht_agent_visual_plan_worker_runs_lifecycle_session_check;
alter table public.ht_agent_visual_plan_worker_runs
  add constraint ht_agent_visual_plan_worker_runs_lifecycle_session_check
  check(lifecycle_session in ('unknown','active','closed'));
alter table public.ht_agent_visual_plan_worker_runs
  drop constraint if exists ht_agent_visual_plan_worker_runs_reused_provider_request_count_check;
alter table public.ht_agent_visual_plan_worker_runs
  add constraint ht_agent_visual_plan_worker_runs_reused_provider_request_count_check
  check(reused_provider_request_count>=0);
alter table public.ht_agent_visual_plan_worker_runs
  drop constraint if exists ht_agent_visual_plan_worker_runs_closed_request_check;
alter table public.ht_agent_visual_plan_worker_runs
  add constraint ht_agent_visual_plan_worker_runs_closed_request_check
  check(not closed_market_skipped or (
    lifecycle_session='closed' and claimed_plan_count=0 and
    unique_symbol_count=0 and provider_request_count=0 and
    accepted_evidence_count=0
  ));

alter table public.ht_agent_global_control
  add column if not exists visual_plan_rollout_started_at timestamptz,
  add column if not exists visual_plan_shadow_verified_at timestamptz;

create or replace function public.ht_agent_create_visual_plan(
  p_decision_id uuid,
  p_frame_id uuid,
  p_idempotency_key text,
  p_definition_hash text,
  p_generator_version text,
  p_definition jsonb
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='20s' as $$
declare
  v_profile_id uuid;
  v_user_id uuid;
  v_symbol text;
  v_provider_timestamp timestamptz;
  v_canonical_timestamp timestamptz;
  v_prox_timestamp timestamptz;
  v_canonical_source_run_id uuid;
  v_prox_source_run_id uuid;
  v_valid_from timestamptz;
  v_expires_at timestamptz;
  v_lane text;
  v_plan_id uuid;
  v_active_version_id uuid;
  v_active_state text;
  v_existing_id uuid;
  v_existing_hash text;
  v_version_number integer;
  v_version_id uuid;
  v_mode text;
  v_scope jsonb;
  v_canonical jsonb;
  v_prox jsonb;
  v_action text;
  v_entry_low numeric;
  v_entry_high numeric;
  v_trigger numeric;
  v_stop numeric;
  v_target_one numeric;
  v_target_two numeric;
  v_target_one_rr numeric;
  v_target_two_rr numeric;
begin
  if p_decision_id is null or p_frame_id is null or
     length(coalesce(p_idempotency_key,'')) not between 32 and 128 or
     coalesce(p_definition_hash,'') !~ '^[0-9a-f]{64}$' or
     p_generator_version is distinct from 'agent-x-visual-plan-generator-v2-risk-reward-cancellation' or
     jsonb_typeof(coalesce(p_definition,'null'::jsonb))<>'object' then
    raise exception 'invalid_visual_plan_request';
  end if;

  select visual_plan_mode,visual_plan_symbol_scope into strict v_mode,v_scope
  from public.ht_agent_global_control where id='global';
  if v_mode='off' then
    return jsonb_build_object('created',false,'idempotent',false,
      'reason','visual_plan_mode_off');
  end if;

  select d.profile_id,d.user_id,d.symbol,f.provider_timestamp,
    f.canonical_decision_timestamp,f.prox_decision_timestamp,
    f.canonical_source_run_id,f.prox_source_run_id,
    nullif(p_definition#>>'{provenance,canonicalLane}',''),
    f.canonical_evidence,f.prox_evidence,d.action
  into strict v_profile_id,v_user_id,v_symbol,v_provider_timestamp,
    v_canonical_timestamp,v_prox_timestamp,v_canonical_source_run_id,
    v_prox_source_run_id,v_lane,v_canonical,v_prox,v_action
  from public.ht_agent_decisions d
  join public.ht_agent_decision_frames f on f.id=d.frame_id
  where d.id=p_decision_id and d.frame_id=p_frame_id and d.risk_allowed=true;

  if p_definition->>'schemaVersion' is distinct from 'agent-x-visual-paper-plan-v2' or
     p_definition->>'policyVersion' is distinct from 'agent-x-visual-plan-expiry-v1-15-provider-minutes' or
     p_definition#>>'{riskReward,policyVersion}' is distinct from 'agent-x-risk-reward-v1-least-favorable-entry' or
     p_definition#>>'{riskReward,entryBasis}' is distinct from 'least_favorable_permitted_entry' or
     p_definition#>>'{cancellation,policyVersion}' is distinct from 'agent-x-cancellation-v1-provider-minute' or
     p_definition->>'symbol' is distinct from v_symbol or
     p_definition->>'decisionId' is distinct from p_decision_id::text or
     p_definition->>'frameId' is distinct from p_frame_id::text or
     p_definition->>'direction' is distinct from 'long' or
     p_definition->>'entryCondition' is distinct from 'crosses_above_trigger' or
     p_definition->>'executionAuthority' is distinct from 'none' or
     p_definition->>'paperOnly' is distinct from 'true' or
     coalesce(v_lane,'') not in ('momentum','before_crowd') or
     coalesce(v_canonical->>'eligible','false')<>'true' or
     coalesce(v_prox->>'stance','abstain')='veto' or
     coalesce(v_action,'') not in ('observe','prepare','enter') or
     (p_definition#>>'{provenance,marketProviderAt}')::timestamptz is distinct from v_provider_timestamp or
     (p_definition#>>'{provenance,canonicalDecisionAt}')::timestamptz is distinct from v_canonical_timestamp or
     (p_definition#>>'{provenance,proxComputedAt}')::timestamptz is distinct from v_prox_timestamp or
     p_definition#>>'{provenance,canonicalSourceRunId}' is distinct from v_canonical_source_run_id::text or
     p_definition#>>'{provenance,proxSourceRunId}' is distinct from v_prox_source_run_id::text or
     p_definition#>>'{provenance,canonicalProviderAt}' is distinct from v_canonical->>'sourceProviderTimestamp' then
    raise exception 'visual_plan_definition_contract_mismatch';
  end if;

  v_entry_low:=(p_definition#>>'{entryZone,low}')::numeric;
  v_entry_high:=(p_definition#>>'{entryZone,high}')::numeric;
  v_trigger:=(p_definition->>'triggerPrice')::numeric;
  v_stop:=(p_definition->>'stopPrice')::numeric;
  v_target_one:=(p_definition->>'targetOne')::numeric;
  v_target_two:=nullif(p_definition->>'targetTwo','')::numeric;
  v_target_one_rr:=(p_definition#>>'{riskReward,targetOne}')::numeric;
  v_target_two_rr:=nullif(p_definition#>>'{riskReward,targetTwo}','')::numeric;
  if not (
    v_entry_low>0 and v_entry_high>=v_entry_low and v_stop>0 and v_stop<v_entry_low and
    v_trigger>=v_entry_low and v_target_one>greatest(v_entry_high,v_trigger)
  ) or
    round((v_target_one-greatest(v_entry_high,v_trigger))/(greatest(v_entry_high,v_trigger)-v_stop),6) is distinct from v_target_one_rr or
    (p_definition#>>'{riskReward,entryPrice}')::numeric is distinct from greatest(v_entry_high,v_trigger) or
    (p_definition#>>'{riskReward,riskPerShare}')::numeric is distinct from round(greatest(v_entry_high,v_trigger)-v_stop,6) or
    (p_definition->>'estimatedRiskReward')::numeric is distinct from v_target_one_rr or
    (v_target_two is null and v_target_two_rr is not null) or
    (v_target_two is not null and v_target_two_rr is null) or
    (v_target_two is not null and (
      v_target_two<=v_target_one or
      round((v_target_two-greatest(v_entry_high,v_trigger))/(greatest(v_entry_high,v_trigger)-v_stop),6) is distinct from v_target_two_rr or
      v_target_two_rr<=v_target_one_rr
    )) then
    raise exception 'visual_plan_risk_reward_contract_mismatch';
  end if;

  v_valid_from:=(p_definition->>'validFrom')::timestamptz;
  v_expires_at:=(p_definition->>'expiresAt')::timestamptz;
  if v_valid_from is distinct from (
      date_trunc('minute',v_provider_timestamp) +
      case when v_provider_timestamp=date_trunc('minute',v_provider_timestamp)
        then interval '0 minutes' else interval '1 minute' end
    ) or
    v_expires_at<=v_valid_from or
    v_expires_at>v_valid_from+interval '15 minutes' or
    (v_expires_at at time zone 'America/New_York')::date<>
      (v_valid_from at time zone 'America/New_York')::date then
    raise exception 'visual_plan_expiration_contract_mismatch';
  end if;

  if jsonb_typeof(p_definition#>'{cancellation,conditions}') is distinct from 'array' or
     jsonb_array_length(p_definition#>'{cancellation,conditions}')<>3 or
     p_definition#>>'{cancellation,conditions,0,code}' is distinct from 'stop_touched' or
     p_definition#>>'{cancellation,conditions,0,evidence}' is distinct from 'completed_provider_minute' or
     p_definition#>>'{cancellation,conditions,0,field}' is distinct from 'low' or
     p_definition#>>'{cancellation,conditions,0,operator}' is distinct from 'lte' or
     p_definition#>>'{cancellation,conditions,0,transition}' is distinct from 'invalidated' or
     (p_definition#>>'{cancellation,conditions,0,value}')::numeric<>v_stop or
     p_definition#>>'{cancellation,conditions,1,code}' is distinct from 'plan_expiration_reached' or
     p_definition#>>'{cancellation,conditions,1,evidence}' is distinct from 'completed_provider_minute' or
     p_definition#>>'{cancellation,conditions,1,field}' is distinct from 'closedAt' or
     p_definition#>>'{cancellation,conditions,1,operator}' is distinct from 'gte' or
     p_definition#>>'{cancellation,conditions,1,transition}' is distinct from 'expired' or
     (p_definition#>>'{cancellation,conditions,1,value}')::timestamptz<>v_expires_at or
     p_definition#>>'{cancellation,conditions,2,code}' is distinct from 'intraminute_order_unprovable' or
     p_definition#>>'{cancellation,conditions,2,evidence}' is distinct from 'completed_provider_minute' or
     p_definition#>>'{cancellation,conditions,2,field}' is distinct from 'high_low_range' or
     p_definition#>>'{cancellation,conditions,2,operator}' is distinct from 'contains_conflicting_thresholds' or
     p_definition#>>'{cancellation,conditions,2,transition}' is distinct from 'needs_review_ambiguous' or
     p_definition#>'{cancellation,conditions,2,value}' is distinct from 'null'::jsonb then
    raise exception 'visual_plan_cancellation_contract_mismatch';
  end if;

  if not (
    v_scope @> '{"symbols":["*"]}'::jsonb or
    exists(select 1 from jsonb_array_elements_text(v_scope->'symbols') scoped(symbol)
      where scoped.symbol=v_symbol)
  ) then
    return jsonb_build_object('created',false,'idempotent',false,
      'reason','symbol_out_of_scope');
  end if;

  insert into public.ht_agent_visual_plans(
    profile_id,user_id,symbol,session_date,canonical_lane
  ) values(
    v_profile_id,v_user_id,v_symbol,
    (v_provider_timestamp at time zone 'America/New_York')::date,v_lane
  ) on conflict(profile_id,symbol,session_date,canonical_lane) do nothing;

  select id,active_version_id into strict v_plan_id,v_active_version_id
  from public.ht_agent_visual_plans
  where profile_id=v_profile_id and symbol=v_symbol and
    session_date=(v_provider_timestamp at time zone 'America/New_York')::date and
    canonical_lane=v_lane for update;

  select id,definition_hash into v_existing_id,v_existing_hash
  from public.ht_agent_visual_plan_versions
  where profile_id=v_profile_id and idempotency_key=p_idempotency_key;
  if v_existing_id is not null then
    if v_existing_hash<>p_definition_hash then
      raise exception 'visual_plan_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'created',false,'idempotent',true,'planId',v_plan_id,
      'versionId',v_existing_id,'reason','existing_idempotent_plan'
    );
  end if;

  if v_active_version_id is not null then
    select lifecycle_state into v_active_state
    from public.ht_agent_visual_plan_states where plan_version_id=v_active_version_id;
    if v_active_state in ('watching','triggered') then
      return jsonb_build_object(
        'created',false,'idempotent',false,'planId',v_plan_id,
        'versionId',v_active_version_id,'reason','active_plan_exists'
      );
    end if;
  end if;

  select coalesce(max(version_number),0)+1 into v_version_number
  from public.ht_agent_visual_plan_versions where plan_id=v_plan_id;

  insert into public.ht_agent_visual_plan_versions(
    plan_id,profile_id,user_id,decision_id,frame_id,version_number,
    idempotency_key,definition_hash,schema_version,policy_version,
    generator_version,direction,entry_condition,entry_low,entry_high,
    trigger_price,stop_price,target_one,target_two,estimated_risk_reward,
    proposed_quantity,estimated_notional,maximum_risk,provider_timestamp,
    canonical_timestamp,prox_timestamp,valid_from,expires_at,definition,
    risk_reward_policy_version,target_one_risk_reward,target_two_risk_reward,
    cancellation_policy_version
  ) values(
    v_plan_id,v_profile_id,v_user_id,p_decision_id,p_frame_id,v_version_number,
    p_idempotency_key,p_definition_hash,p_definition->>'schemaVersion',
    p_definition->>'policyVersion',p_generator_version,p_definition->>'direction',
    p_definition->>'entryCondition',v_entry_low,v_entry_high,v_trigger,v_stop,
    v_target_one,v_target_two,v_target_one_rr,
    (p_definition#>>'{positionRisk,quantity}')::numeric,
    (p_definition#>>'{positionRisk,estimatedNotional}')::numeric,
    (p_definition#>>'{positionRisk,maximumRisk}')::numeric,
    v_provider_timestamp,v_canonical_timestamp,v_prox_timestamp,
    v_valid_from,v_expires_at,p_definition,
    p_definition#>>'{riskReward,policyVersion}',v_target_one_rr,v_target_two_rr,
    p_definition#>>'{cancellation,policyVersion}'
  ) returning id into v_version_id;

  insert into public.ht_agent_visual_plan_states(
    plan_version_id,profile_id,user_id,lifecycle_state,state_version,
    state_provider_timestamp
  ) values(v_version_id,v_profile_id,v_user_id,'watching',0,v_provider_timestamp);
  insert into public.ht_agent_visual_plan_events(
    plan_version_id,profile_id,user_id,from_state,to_state,event_type,
    provider_timestamp,detail,transition_version
  ) values(
    v_version_id,v_profile_id,v_user_id,null,'watching','plan_created',
    v_provider_timestamp,jsonb_build_object(
      'schemaVersion',p_definition->>'schemaVersion',
      'policyVersion',p_definition->>'policyVersion',
      'riskRewardPolicyVersion',p_definition#>>'{riskReward,policyVersion}',
      'cancellationPolicyVersion',p_definition#>>'{cancellation,policyVersion}',
      'executionAuthority','none'
    ),0
  );
  update public.ht_agent_visual_plans set active_version_id=v_version_id
  where id=v_plan_id;
  return jsonb_build_object(
    'created',true,'idempotent',false,'planId',v_plan_id,
    'versionId',v_version_id,'versionNumber',v_version_number
  );
end $$;

create or replace function public.ht_agent_phase2_visual_plan_release_health()
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
  v_control public.ht_agent_global_control%rowtype;
  v_duplicate_idempotency bigint:=0;
  v_duplicate_active_roots bigint:=0;
  v_state_regressions bigint:=0;
  v_closed_market_requests bigint:=0;
  v_v2_versions bigint:=0;
  v_evidence bigint:=0;
  v_transitions jsonb:='{}'::jsonb;
  v_latest_worker jsonb;
  v_worker_after_rollout boolean:=false;
  v_contract_ready boolean:=false;
  v_shadow_ready boolean:=false;
begin
  select * into strict v_control from public.ht_agent_global_control where id='global';
  select count(*)-count(distinct (profile_id,idempotency_key))
    into v_duplicate_idempotency from public.ht_agent_visual_plan_versions;
  select count(*) into v_duplicate_active_roots from (
    select profile_id,symbol,session_date,canonical_lane
    from public.ht_agent_visual_plans
    group by profile_id,symbol,session_date,canonical_lane having count(*)>1
  ) duplicates;
  select count(*) into v_state_regressions
  from public.ht_agent_visual_plan_events
  where
    (event_type='plan_created' and (from_state is not null or to_state<>'watching' or transition_version<>0)) or
    (event_type<>'plan_created' and from_state is null) or
    (from_state='watching' and to_state not in ('triggered','invalidated','expired','needs_review_ambiguous')) or
    (from_state='triggered' and to_state not in ('target_reached','invalidated','expired','needs_review_ambiguous')) or
    from_state in ('target_reached','invalidated','expired','needs_review_ambiguous');
  select coalesce(sum(provider_request_count),0) into v_closed_market_requests
  from public.ht_agent_visual_plan_worker_runs
  where lifecycle_session='closed' or closed_market_skipped;
  select count(*) into v_v2_versions from public.ht_agent_visual_plan_versions
  where schema_version='agent-x-visual-paper-plan-v2';
  select count(*) into v_evidence from public.ht_agent_visual_plan_market_evidence;
  select coalesce(jsonb_object_agg(to_state,total),'{}'::jsonb) into v_transitions from (
    select to_state,count(*) as total from public.ht_agent_visual_plan_events
    where event_type<>'plan_created' group by to_state
  ) counts;
  select to_jsonb(w) into v_latest_worker from (
    select completed_at,status,claimed_plan_count,unique_symbol_count,
      provider_request_count,reused_provider_request_count,accepted_evidence_count,
      transition_counts,lifecycle_session,closed_market_skipped
    from public.ht_agent_visual_plan_worker_runs
    order by completed_at desc limit 1
  ) w;
  v_worker_after_rollout:=
    v_latest_worker is not null and
    v_latest_worker->>'status'='success' and
    (v_latest_worker->>'completed_at')::timestamptz>=v_control.visual_plan_rollout_started_at and
    not (
      v_latest_worker->>'lifecycle_session'='closed' and
      coalesce((v_latest_worker->>'provider_request_count')::integer,0)<>0
    );
  v_contract_ready:=
    to_regprocedure('public.ht_agent_create_visual_plan(uuid,uuid,text,text,text,jsonb)') is not null and
    exists(select 1 from pg_catalog.pg_attribute where
      attrelid='public.ht_agent_visual_plan_versions'::regclass and
      attname='target_one_risk_reward' and not attisdropped) and
    exists(select 1 from pg_catalog.pg_attribute where
      attrelid='public.ht_agent_visual_plan_versions'::regclass and
      attname='target_two_risk_reward' and not attisdropped) and
    exists(select 1 from pg_catalog.pg_constraint where
      conrelid='public.ht_agent_visual_plan_worker_runs'::regclass and
      conname='ht_agent_visual_plan_worker_runs_closed_request_check');
  v_shadow_ready:=v_contract_ready and
    v_control.visual_plan_mode='shadow' and
    v_control.visual_plan_lifecycle_enabled and
    not v_control.visual_plan_paper_handoff_enabled and
    v_control.visual_plan_symbol_scope='{"symbols":["SPY","QQQ"]}'::jsonb and
    v_worker_after_rollout and v_duplicate_idempotency=0 and
    v_duplicate_active_roots=0 and v_state_regressions=0 and
    v_closed_market_requests=0;
  return jsonb_build_object(
    'contractVersion','agent-x-visual-plan-release-gates-v1',
    'releaseContractReady',v_contract_ready,
    'shadowReady',v_shadow_ready,
    'rollout',jsonb_build_object(
      'mode',v_control.visual_plan_mode,
      'lifecycleEnabled',v_control.visual_plan_lifecycle_enabled,
      'paperHandoffEnabled',v_control.visual_plan_paper_handoff_enabled,
      'symbolScope',v_control.visual_plan_symbol_scope,
      'startedAt',v_control.visual_plan_rollout_started_at,
      'shadowVerifiedAt',v_control.visual_plan_shadow_verified_at
    ),
    'planEvidence',jsonb_build_object(
      'v2Versions',v_v2_versions,
      'completedProviderMinutes',v_evidence,
      'transitionCounts',v_transitions,
      'duplicateIdempotencyKeys',v_duplicate_idempotency,
      'duplicateActiveRoots',v_duplicate_active_roots,
      'stateRegressions',v_state_regressions
    ),
    'providerRequests',jsonb_build_object(
      'closedMarketLifecycleRequests',v_closed_market_requests,
      'chartLayerRequests',0,
      'chartLayerAuthority','database_read_only_no_provider_path'
    ),
    'latestWorker',v_latest_worker,
    'workerAfterRollout',v_worker_after_rollout,
    'paperOnly',true,
    'executionAuthority','none',
    'verifiedAt',clock_timestamp()
  );
end $$;

create or replace function public.ht_agent_promote_visual_plan_internal_visible()
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare v_health jsonb;
begin
  select public.ht_agent_phase2_visual_plan_release_health() into v_health;
  if coalesce((v_health->>'shadowReady')::boolean,false) is not true then
    raise exception 'phase2_shadow_verification_not_ready';
  end if;
  update public.ht_agent_global_control set
    visual_plan_mode='visible',
    visual_plan_lifecycle_enabled=true,
    visual_plan_paper_handoff_enabled=false,
    visual_plan_shadow_verified_at=clock_timestamp()
  where id='global' and visual_plan_mode='shadow';
  if not found then raise exception 'phase2_shadow_mode_required'; end if;
  return jsonb_build_object(
    'promoted',true,'mode','visible','paperHandoffEnabled',false,
    'symbolScope','{"symbols":["SPY","QQQ"]}'::jsonb,
    'verifiedAt',clock_timestamp()
  );
end $$;

revoke all on function public.ht_agent_phase2_visual_plan_release_health()
  from public,anon,authenticated;
revoke all on function public.ht_agent_promote_visual_plan_internal_visible()
  from public,anon,authenticated;
grant execute on function public.ht_agent_phase2_visual_plan_release_health()
  to service_role;
grant execute on function public.ht_agent_promote_visual_plan_internal_visible()
  to service_role;

-- Enter the owner-approved shadow stage only after every forward-only object
-- above exists. The Paper handoff gate deliberately remains false.
update public.ht_agent_global_control set
  visual_plan_mode='shadow',
  visual_plan_lifecycle_enabled=true,
  visual_plan_paper_handoff_enabled=false,
  visual_plan_symbol_scope='{"symbols":["SPY","QQQ"]}'::jsonb,
  visual_plan_rollout_started_at=clock_timestamp(),
  visual_plan_shadow_verified_at=null
where id='global';

comment on function public.ht_agent_phase2_visual_plan_release_health() is
  'Service-only Phase 2 release evidence. It never changes rollout state.';
comment on function public.ht_agent_promote_visual_plan_internal_visible() is
  'Fail-closed shadow-to-internal-visible promotion. It never enables Paper handoff.';

commit;
