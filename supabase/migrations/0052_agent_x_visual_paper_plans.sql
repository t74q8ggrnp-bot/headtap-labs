-- Agent X Phase 2 visual paper plans. This migration is additive and keeps all
-- new capabilities fail-closed. Canonical/ProX scoring and paper execution are
-- unchanged. Plan definitions/evidence/events are immutable.
begin;

do $$ begin
  if to_regclass('public.ht_agent_global_control') is null or
     to_regclass('public.ht_agent_decisions') is null or
     to_regclass('public.ht_agent_decision_frames') is null or
     to_regclass('public.paper_orders') is null then
    raise exception 'Apply HT Agent Phase 1 and Paper Trading migrations first';
  end if;
end $$;

alter table public.ht_agent_global_control
  add column if not exists visual_plan_mode text not null default 'off',
  add column if not exists visual_plan_lifecycle_enabled boolean not null default false,
  add column if not exists visual_plan_paper_handoff_enabled boolean not null default false,
  add column if not exists visual_plan_symbol_scope jsonb not null
    default '{"symbols":["SPY","QQQ"]}'::jsonb;

alter table public.ht_agent_global_control
  drop constraint if exists ht_agent_visual_plan_mode_check;
alter table public.ht_agent_global_control
  add constraint ht_agent_visual_plan_mode_check
  check (visual_plan_mode in ('off','shadow','visible'));
alter table public.ht_agent_global_control
  drop constraint if exists ht_agent_visual_plan_scope_object_check;
alter table public.ht_agent_global_control
  add constraint ht_agent_visual_plan_scope_object_check
  check (
    jsonb_typeof(visual_plan_symbol_scope)='object' and
    jsonb_typeof(visual_plan_symbol_scope->'symbols')='array'
  );

create table if not exists public.ht_agent_visual_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  session_date date not null,
  canonical_lane text not null check (canonical_lane in ('momentum','before_crowd')),
  active_version_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(profile_id,symbol,session_date,canonical_lane)
);

create table if not exists public.ht_agent_visual_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ht_agent_visual_plans(id) on delete cascade,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_id uuid not null references public.ht_agent_decisions(id) on delete restrict,
  frame_id uuid not null references public.ht_agent_decision_frames(id) on delete restrict,
  version_number integer not null check(version_number>0),
  idempotency_key text not null check(length(idempotency_key) between 32 and 128),
  definition_hash text not null check(definition_hash ~ '^[0-9a-f]{64}$'),
  schema_version text not null check(schema_version='agent-x-visual-paper-plan-v1'),
  policy_version text not null check(policy_version='agent-x-visual-plan-expiry-v1-15-provider-minutes'),
  generator_version text not null,
  direction text not null check(direction='long'),
  entry_condition text not null check(entry_condition='crosses_above_trigger'),
  entry_low numeric not null check(entry_low>0),
  entry_high numeric not null check(entry_high>=entry_low),
  trigger_price numeric not null check(trigger_price>=entry_low),
  stop_price numeric not null check(stop_price>0 and stop_price<entry_low),
  target_one numeric not null check(target_one>greatest(entry_high,trigger_price)),
  target_two numeric check(target_two is null or target_two>target_one),
  estimated_risk_reward numeric not null check(estimated_risk_reward>0),
  proposed_quantity numeric not null check(proposed_quantity>0),
  estimated_notional numeric not null check(estimated_notional>0),
  maximum_risk numeric not null check(maximum_risk>=0),
  provider_timestamp timestamptz not null,
  canonical_timestamp timestamptz not null,
  prox_timestamp timestamptz,
  valid_from timestamptz not null,
  expires_at timestamptz not null check(expires_at>valid_from),
  definition jsonb not null check(jsonb_typeof(definition)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(plan_id,version_number),
  unique(profile_id,idempotency_key)
);

do $$ begin
  alter table public.ht_agent_visual_plans
    add constraint ht_agent_visual_plans_active_version_fk
    foreign key(active_version_id)
    references public.ht_agent_visual_plan_versions(id) on delete restrict;
exception when duplicate_object then null; end $$;

create table if not exists public.ht_agent_visual_plan_market_evidence (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check(symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  candle_opened_at timestamptz not null,
  candle_closed_at timestamptz not null,
  provider_timestamp timestamptz not null,
  open numeric not null check(open>0),
  high numeric not null check(high>0),
  low numeric not null check(low>0),
  close numeric not null check(close>0),
  volume numeric not null check(volume>=0),
  source text not null check(source='massive_polygon_minute_aggregate'),
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  collected_at timestamptz not null default clock_timestamp(),
  check(candle_closed_at-candle_opened_at=interval '1 minute'),
  check(provider_timestamp=candle_closed_at),
  check(high>=greatest(open,close,low)),
  check(low<=least(open,close,high)),
  unique(symbol,candle_closed_at,evidence_hash)
);

create table if not exists public.ht_agent_visual_plan_states (
  plan_version_id uuid primary key references public.ht_agent_visual_plan_versions(id) on delete cascade,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lifecycle_state text not null default 'watching'
    check(lifecycle_state in (
      'watching','triggered','target_reached','invalidated','expired','needs_review_ambiguous'
    )),
  state_version bigint not null default 0 check(state_version>=0),
  last_evaluated_candle_at timestamptz,
  last_evidence_id uuid references public.ht_agent_visual_plan_market_evidence(id) on delete restrict,
  state_provider_timestamp timestamptz not null,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ht_agent_visual_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.ht_agent_visual_plan_versions(id) on delete cascade,
  profile_id uuid not null references public.ht_agent_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_state text,
  to_state text not null check(to_state in (
    'watching','triggered','target_reached','invalidated','expired','needs_review_ambiguous'
  )),
  event_type text not null check(event_type in (
    'plan_created','entry_triggered','target_reached','plan_invalidated',
    'plan_expired','price_order_ambiguous'
  )),
  evidence_id uuid references public.ht_agent_visual_plan_market_evidence(id) on delete restrict,
  provider_timestamp timestamptz not null,
  price numeric check(price is null or price>0),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
  transition_version bigint not null check(transition_version>=0),
  created_at timestamptz not null default clock_timestamp(),
  unique(plan_version_id,transition_version)
);

create table if not exists public.ht_agent_visual_plan_worker_runs (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null,
  started_at timestamptz not null,
  completed_at timestamptz not null check(completed_at>=started_at),
  status text not null check(status in ('success','failed','skipped')),
  claimed_plan_count integer not null default 0 check(claimed_plan_count>=0),
  unique_symbol_count integer not null default 0 check(unique_symbol_count>=0),
  provider_request_count integer not null default 0 check(provider_request_count>=0),
  accepted_evidence_count integer not null default 0 check(accepted_evidence_count>=0),
  transition_counts jsonb not null default '{}'::jsonb check(jsonb_typeof(transition_counts)='object'),
  error_message text,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.paper_orders
  add column if not exists ht_agent_visual_plan_version_id uuid;
alter table public.paper_orders
  drop constraint if exists paper_orders_strategy_source_check;
alter table public.paper_orders
  add constraint paper_orders_strategy_source_check
  check (strategy_source in (
    'manual','spot_momentum','before_crowd','scanner','ticker_detail','ht_agent'
  ));
do $$ begin
  alter table public.paper_orders
    add constraint paper_orders_visual_plan_version_fk
    foreign key(ht_agent_visual_plan_version_id)
    references public.ht_agent_visual_plan_versions(id) on delete restrict;
exception when duplicate_object then null; end $$;

create unique index if not exists paper_orders_visual_plan_active_unique
  on public.paper_orders(ht_agent_visual_plan_version_id)
  where ht_agent_visual_plan_version_id is not null and
    status in ('accepted','open','partially_filled','filled');
create index if not exists ht_agent_visual_plan_versions_profile_symbol_idx
  on public.ht_agent_visual_plan_versions(profile_id,created_at desc);
create index if not exists ht_agent_visual_plan_states_active_idx
  on public.ht_agent_visual_plan_states(lifecycle_state,updated_at);
create index if not exists ht_agent_visual_plan_events_plan_idx
  on public.ht_agent_visual_plan_events(plan_version_id,transition_version);
create index if not exists ht_agent_visual_plan_evidence_symbol_time_idx
  on public.ht_agent_visual_plan_market_evidence(symbol,candle_closed_at desc);
create index if not exists ht_agent_visual_plan_worker_time_idx
  on public.ht_agent_visual_plan_worker_runs(completed_at desc);

alter table public.ht_agent_visual_plans enable row level security;
alter table public.ht_agent_visual_plan_versions enable row level security;
alter table public.ht_agent_visual_plan_states enable row level security;
alter table public.ht_agent_visual_plan_events enable row level security;
alter table public.ht_agent_visual_plan_market_evidence enable row level security;
alter table public.ht_agent_visual_plan_worker_runs enable row level security;

revoke all on public.ht_agent_visual_plans from public,anon,authenticated,service_role;
revoke all on public.ht_agent_visual_plan_versions from public,anon,authenticated,service_role;
revoke all on public.ht_agent_visual_plan_states from public,anon,authenticated,service_role;
revoke all on public.ht_agent_visual_plan_events from public,anon,authenticated,service_role;
revoke all on public.ht_agent_visual_plan_market_evidence from public,anon,authenticated,service_role;
revoke all on public.ht_agent_visual_plan_worker_runs from public,anon,authenticated,service_role;
grant select on public.ht_agent_visual_plans,public.ht_agent_visual_plan_versions,
  public.ht_agent_visual_plan_states,public.ht_agent_visual_plan_events to authenticated;
grant all on public.ht_agent_visual_plans,public.ht_agent_visual_plan_versions,
  public.ht_agent_visual_plan_states,public.ht_agent_visual_plan_events,
  public.ht_agent_visual_plan_market_evidence,public.ht_agent_visual_plan_worker_runs to service_role;

drop policy if exists ht_agent_visual_plans_owner_read on public.ht_agent_visual_plans;
drop policy if exists ht_agent_visual_plan_versions_owner_read on public.ht_agent_visual_plan_versions;
drop policy if exists ht_agent_visual_plan_states_owner_read on public.ht_agent_visual_plan_states;
drop policy if exists ht_agent_visual_plan_events_owner_read on public.ht_agent_visual_plan_events;
create policy ht_agent_visual_plans_owner_read on public.ht_agent_visual_plans
  for select to authenticated using(auth.uid()=user_id);
create policy ht_agent_visual_plan_versions_owner_read on public.ht_agent_visual_plan_versions
  for select to authenticated using(auth.uid()=user_id);
create policy ht_agent_visual_plan_states_owner_read on public.ht_agent_visual_plan_states
  for select to authenticated using(auth.uid()=user_id);
create policy ht_agent_visual_plan_events_owner_read on public.ht_agent_visual_plan_events
  for select to authenticated using(auth.uid()=user_id);

create or replace function public.ht_agent_visual_plan_reject_immutable_mutation()
returns trigger language plpgsql as $$ begin
  raise exception 'ht_agent_visual_plan_record_is_immutable';
end $$;

drop trigger if exists ht_agent_visual_plan_versions_immutable on public.ht_agent_visual_plan_versions;
create trigger ht_agent_visual_plan_versions_immutable before update or delete
  on public.ht_agent_visual_plan_versions for each row
  execute function public.ht_agent_visual_plan_reject_immutable_mutation();
drop trigger if exists ht_agent_visual_plan_events_immutable on public.ht_agent_visual_plan_events;
create trigger ht_agent_visual_plan_events_immutable before update or delete
  on public.ht_agent_visual_plan_events for each row
  execute function public.ht_agent_visual_plan_reject_immutable_mutation();
drop trigger if exists ht_agent_visual_plan_evidence_immutable on public.ht_agent_visual_plan_market_evidence;
create trigger ht_agent_visual_plan_evidence_immutable before update or delete
  on public.ht_agent_visual_plan_market_evidence for each row
  execute function public.ht_agent_visual_plan_reject_immutable_mutation();
drop trigger if exists ht_agent_visual_plan_worker_runs_immutable on public.ht_agent_visual_plan_worker_runs;
create trigger ht_agent_visual_plan_worker_runs_immutable before update or delete
  on public.ht_agent_visual_plan_worker_runs for each row
  execute function public.ht_agent_visual_plan_reject_immutable_mutation();

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
begin
  if p_decision_id is null or p_frame_id is null or
     length(coalesce(p_idempotency_key,'')) not between 32 and 128 or
     coalesce(p_definition_hash,'') !~ '^[0-9a-f]{64}$' or
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

  if p_definition->>'schemaVersion' is distinct from 'agent-x-visual-paper-plan-v1' or
     p_definition->>'policyVersion' is distinct from 'agent-x-visual-plan-expiry-v1-15-provider-minutes' or
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
  if not (
    v_scope @> '{"symbols":["*"]}'::jsonb or
    exists(
      select 1 from jsonb_array_elements_text(v_scope->'symbols') scoped(symbol)
      where scoped.symbol=v_symbol
    )
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
    from public.ht_agent_visual_plan_states
    where plan_version_id=v_active_version_id;
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
    canonical_timestamp,prox_timestamp,valid_from,expires_at,definition
  ) values(
    v_plan_id,v_profile_id,v_user_id,p_decision_id,p_frame_id,v_version_number,
    p_idempotency_key,p_definition_hash,p_definition->>'schemaVersion',
    p_definition->>'policyVersion',p_generator_version,p_definition->>'direction',
    p_definition->>'entryCondition',(p_definition#>>'{entryZone,low}')::numeric,
    (p_definition#>>'{entryZone,high}')::numeric,(p_definition->>'triggerPrice')::numeric,
    (p_definition->>'stopPrice')::numeric,(p_definition->>'targetOne')::numeric,
    nullif(p_definition->>'targetTwo','')::numeric,
    (p_definition->>'estimatedRiskReward')::numeric,
    (p_definition#>>'{positionRisk,quantity}')::numeric,
    (p_definition#>>'{positionRisk,estimatedNotional}')::numeric,
    (p_definition#>>'{positionRisk,maximumRisk}')::numeric,
    v_provider_timestamp,v_canonical_timestamp,v_prox_timestamp,
    v_valid_from,v_expires_at,p_definition
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

create or replace function public.ht_agent_claim_visual_plan_batch(
  p_limit integer default 50
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare v_limit integer:=least(100,greatest(1,coalesce(p_limit,50)));
declare v_enabled boolean;
declare v_scope jsonb;
declare v_rows jsonb;
begin
  select visual_plan_lifecycle_enabled,visual_plan_symbol_scope
  into strict v_enabled,v_scope
  from public.ht_agent_global_control where id='global';
  if not v_enabled then
    return jsonb_build_object('allowed',false,'reason','lifecycle_disabled','plans','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows from (
    select v.id as "planVersionId",v.plan_id as "planId",v.profile_id as "profileId",
      v.user_id as "userId",p.symbol,v.definition,s.lifecycle_state as "state",
      s.state_version as "stateVersion",s.last_evaluated_candle_at as "lastEvaluatedCandleAt"
    from public.ht_agent_visual_plans p
    join public.ht_agent_visual_plan_versions v on v.id=p.active_version_id
    join public.ht_agent_visual_plan_states s on s.plan_version_id=v.id
    where s.lifecycle_state in ('watching','triggered') and
      (
        v_scope @> '{"symbols":["*"]}'::jsonb or
        exists(
          select 1 from jsonb_array_elements_text(v_scope->'symbols') scoped(symbol)
          where scoped.symbol=p.symbol
        )
      )
    order by s.updated_at asc
    limit v_limit
  ) q;
  return jsonb_build_object('allowed',true,'plans',v_rows);
end $$;

create or replace function public.ht_agent_apply_visual_plan_lifecycle(
  p_plan_version_id uuid,
  p_expected_state_version bigint,
  p_evidence jsonb,
  p_result jsonb
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
  v_state public.ht_agent_visual_plan_states%rowtype;
  v_version public.ht_agent_visual_plan_versions%rowtype;
  v_evidence_id uuid;
  v_kind text:=p_result->>'kind';
  v_to text:=p_result->>'to';
  v_event text:=p_result->>'event';
  v_new_version bigint;
  v_opened_at timestamptz:=(p_evidence->>'openedAt')::timestamptz;
  v_closed_at timestamptz:=(p_evidence->>'closedAt')::timestamptz;
begin
  if p_plan_version_id is null or p_expected_state_version is null or
     jsonb_typeof(coalesce(p_evidence,'null'::jsonb))<>'object' or
     jsonb_typeof(coalesce(p_result,'null'::jsonb))<>'object' or
     coalesce(v_kind,'') not in ('no_change','transition') then
    raise exception 'invalid_visual_plan_lifecycle_request';
  end if;
  select * into strict v_version from public.ht_agent_visual_plan_versions
    where id=p_plan_version_id;
  select * into strict v_state from public.ht_agent_visual_plan_states
    where plan_version_id=p_plan_version_id for update;
  if v_state.state_version<>p_expected_state_version then
    raise exception 'visual_plan_state_version_conflict';
  end if;
  if p_evidence->>'symbol' is distinct from v_version.definition->>'symbol' or
     p_evidence->>'source' is distinct from 'massive_polygon_minute_aggregate' or
     v_closed_at-v_opened_at<>interval '1 minute' or
     v_closed_at<=coalesce(v_state.last_evaluated_candle_at,'-infinity'::timestamptz) then
    raise exception 'visual_plan_evidence_contract_mismatch';
  end if;

  insert into public.ht_agent_visual_plan_market_evidence(
    symbol,candle_opened_at,candle_closed_at,provider_timestamp,
    open,high,low,close,volume,source,evidence_hash
  ) values(
    p_evidence->>'symbol',v_opened_at,v_closed_at,v_closed_at,
    (p_evidence->>'open')::numeric,(p_evidence->>'high')::numeric,
    (p_evidence->>'low')::numeric,(p_evidence->>'close')::numeric,
    (p_evidence->>'volume')::numeric,p_evidence->>'source',
    p_evidence->>'evidenceHash'
  ) on conflict(symbol,candle_closed_at,evidence_hash) do nothing
  returning id into v_evidence_id;
  if v_evidence_id is null then
    select id into strict v_evidence_id
    from public.ht_agent_visual_plan_market_evidence
    where symbol=p_evidence->>'symbol' and candle_closed_at=v_closed_at and
      evidence_hash=p_evidence->>'evidenceHash';
  end if;

  v_new_version:=v_state.state_version+1;
  if v_kind='no_change' then
    update public.ht_agent_visual_plan_states set
      state_version=v_new_version,last_evaluated_candle_at=v_closed_at,
      last_evidence_id=v_evidence_id,state_provider_timestamp=v_closed_at,
      updated_at=clock_timestamp()
    where plan_version_id=p_plan_version_id;
    return jsonb_build_object('ok',true,'transitioned',false,
      'state',v_state.lifecycle_state,'stateVersion',v_new_version);
  end if;

  if p_result->>'from' is distinct from v_state.lifecycle_state or
     not (
       (v_state.lifecycle_state='watching' and v_to in (
         'triggered','invalidated','expired','needs_review_ambiguous'
       )) or
       (v_state.lifecycle_state='triggered' and v_to in (
         'target_reached','invalidated','expired','needs_review_ambiguous'
       ))
     ) then
    raise exception 'visual_plan_non_monotonic_transition';
  end if;
  if not (
    (v_to='triggered' and v_event='entry_triggered') or
    (v_to='target_reached' and v_event='target_reached') or
    (v_to='invalidated' and v_event='plan_invalidated') or
    (v_to='expired' and v_event='plan_expired') or
    (v_to='needs_review_ambiguous' and v_event='price_order_ambiguous')
  ) then
    raise exception 'visual_plan_event_transition_mismatch';
  end if;

  update public.ht_agent_visual_plan_states set
    lifecycle_state=v_to,state_version=v_new_version,
    last_evaluated_candle_at=v_closed_at,last_evidence_id=v_evidence_id,
    state_provider_timestamp=v_closed_at,updated_at=clock_timestamp()
  where plan_version_id=p_plan_version_id;
  insert into public.ht_agent_visual_plan_events(
    plan_version_id,profile_id,user_id,from_state,to_state,event_type,
    evidence_id,provider_timestamp,price,detail,transition_version
  ) values(
    p_plan_version_id,v_state.profile_id,v_state.user_id,v_state.lifecycle_state,
    v_to,v_event,v_evidence_id,v_closed_at,
    nullif(p_result->>'price','')::numeric,
    coalesce(p_result->'detail','{}'::jsonb),v_new_version
  );
  return jsonb_build_object('ok',true,'transitioned',true,
    'state',v_to,'stateVersion',v_new_version,'event',v_event);
end $$;

create or replace function public.ht_agent_validate_visual_plan_handoff(
  p_plan_version_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare
  v_row record;
  v_control public.ht_agent_global_control%rowtype;
begin
  select * into strict v_control from public.ht_agent_global_control where id='global';
  if v_control.visual_plan_mode<>'visible' or not v_control.visual_plan_paper_handoff_enabled then
    return jsonb_build_object('eligible',false,'reason','paper_handoff_disabled');
  end if;
  select v.id,v.user_id,v.profile_id,v.decision_id,v.definition,v.expires_at,
    s.lifecycle_state,p.active_version_id,pr.kill_switch,pr.status
  into v_row
  from public.ht_agent_visual_plan_versions v
  join public.ht_agent_visual_plans p on p.id=v.plan_id
  join public.ht_agent_visual_plan_states s on s.plan_version_id=v.id
  join public.ht_agent_profiles pr on pr.id=v.profile_id
  where v.id=p_plan_version_id and v.user_id=p_user_id;
  if not found then return jsonb_build_object('eligible',false,'reason','plan_not_found'); end if;
  if v_control.kill_switch or v_row.kill_switch or v_row.status<>'active' then
    return jsonb_build_object('eligible',false,'reason','agent_kill_switch');
  end if;
  if v_row.active_version_id<>v_row.id then
    return jsonb_build_object('eligible',false,'reason','historical_plan');
  end if;
  if v_row.lifecycle_state not in ('watching','triggered') then
    return jsonb_build_object('eligible',false,'reason',v_row.lifecycle_state);
  end if;
  if v_row.expires_at<=clock_timestamp() then
    return jsonb_build_object('eligible',false,'reason','plan_expired_pending_lifecycle');
  end if;
  return jsonb_build_object(
    'eligible',true,'reason',null,'planVersionId',v_row.id,
    'decisionId',v_row.decision_id,'definition',v_row.definition,
    'lifecycleState',v_row.lifecycle_state
  );
end $$;

revoke all on function public.ht_agent_create_visual_plan(uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.ht_agent_claim_visual_plan_batch(integer)
  from public,anon,authenticated;
revoke all on function public.ht_agent_apply_visual_plan_lifecycle(uuid,bigint,jsonb,jsonb)
  from public,anon,authenticated;
revoke all on function public.ht_agent_validate_visual_plan_handoff(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ht_agent_create_visual_plan(uuid,uuid,text,text,text,jsonb)
  to service_role;
grant execute on function public.ht_agent_claim_visual_plan_batch(integer)
  to service_role;
grant execute on function public.ht_agent_apply_visual_plan_lifecycle(uuid,bigint,jsonb,jsonb)
  to service_role;
grant execute on function public.ht_agent_validate_visual_plan_handoff(uuid,uuid)
  to service_role;

comment on table public.ht_agent_visual_plan_versions is
  'Immutable Agent X paper-only visual plan definitions. No brokerage execution authority.';
comment on table public.ht_agent_visual_plan_market_evidence is
  'Immutable completed Massive one-minute evidence used independently of the selected chart timeframe.';
comment on column public.paper_orders.ht_agent_visual_plan_version_id is
  'Optional reviewed Agent X visual-plan provenance. The normal Paper Trading validator remains authoritative.';

commit;
