-- Final Phase 2 acceptance gate. The isolated staging receipt is release
-- metadata only; it is never counted as production plan or market evidence.
-- This enables only authenticated, explicitly reviewed HT Paper orders.
begin;

alter table public.ht_agent_global_control
  add column if not exists visual_plan_acceptance_contract_version text,
  add column if not exists visual_plan_acceptance_verified_at timestamptz,
  add column if not exists visual_plan_acceptance_receipt jsonb;

alter table public.ht_agent_global_control
  drop constraint if exists ht_agent_visual_plan_paper_handoff_release_check;
alter table public.ht_agent_global_control
  add constraint ht_agent_visual_plan_paper_handoff_release_check check(
    not visual_plan_paper_handoff_enabled or (
      visual_plan_mode='visible' and
      visual_plan_lifecycle_enabled and
      visual_plan_shadow_verified_at is not null and
      visual_plan_acceptance_contract_version is not distinct from 'agent-x-phase2-acceptance-v1' and
      visual_plan_acceptance_verified_at is not null and
      jsonb_typeof(visual_plan_acceptance_receipt) is not distinct from 'object' and
      visual_plan_acceptance_receipt->>'productionPlanEvidence' is not distinct from 'false' and
      visual_plan_acceptance_receipt->>'executionAuthority' is not distinct from 'none' and
      visual_plan_acceptance_receipt->>'liveBrokerConnection' is not distinct from 'false'
    )
  );

create or replace function public.ht_agent_phase2_visual_plan_acceptance_health()
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
  v_control public.ht_agent_global_control%rowtype;
  v_receipt jsonb;
  v_verified boolean:=false;
begin
  select * into strict v_control from public.ht_agent_global_control where id='global';
  v_receipt:=v_control.visual_plan_acceptance_receipt;
  v_verified:=
    v_control.visual_plan_acceptance_contract_version='agent-x-phase2-acceptance-v1' and
    v_control.visual_plan_acceptance_verified_at is not null and
    v_control.visual_plan_mode='visible' and
    v_control.visual_plan_lifecycle_enabled and
    v_control.visual_plan_shadow_verified_at is not null and
    v_control.visual_plan_symbol_scope='{"symbols":["SPY","QQQ"]}'::jsonb and
    jsonb_typeof(v_receipt)='object' and
    v_receipt->>'environment'='isolated_staging_fixture' and
    v_receipt->>'productionPlanEvidence'='false' and
    v_receipt->>'planId'='10000000-0000-4000-8000-000000000001' and
    v_receipt->>'planVersionId'='10000000-0000-4000-8000-000000000002' and
    (v_receipt->>'versionNumber')::integer=1 and
    (v_receipt->>'completedProviderMinutes')::integer=3 and
    v_receipt->>'initialState'='watching' and
    v_receipt->>'terminalState'='needs_review_ambiguous' and
    v_receipt->>'initialDesktopFingerprint'=v_receipt->>'initialIphoneFingerprint' and
    v_receipt->>'terminalDesktopFingerprint'=v_receipt->>'terminalIphoneFingerprint' and
    v_receipt#>'{chart,timeframes}'='["1m","5m","15m"]'::jsonb and
    (v_receipt#>>'{chart,nativeObjectLayerAttached}')::boolean and
    (v_receipt#>>'{chart,mobileBottomSheetVerified}')::boolean and
    (v_receipt#>>'{chart,providerRequestsOnSwitch}')::integer=0 and
    (v_receipt#>>'{paperReview,existingValidatorPassed}')::boolean and
    (v_receipt#>>'{paperReview,prefillMatchedImmutablePlan}')::boolean and
    (v_receipt#>>'{paperReview,submissionLockedDuringFixture}')::boolean and
    v_receipt->>'executionAuthority'='none' and
    v_receipt->>'liveBrokerConnection'='false';
  return jsonb_build_object(
    'contractVersion','agent-x-phase2-acceptance-v1',
    'verified',v_verified,
    'verifiedAt',v_control.visual_plan_acceptance_verified_at,
    'paperHandoffEnabled',v_control.visual_plan_paper_handoff_enabled,
    'manualUserReviewOnly',true,
    'initialPublicSymbolScope',v_control.visual_plan_symbol_scope,
    'productionPlanEvidence',false,
    'receipt',coalesce(v_receipt,'{}'::jsonb),
    'executionAuthority','none',
    'liveBrokerConnection',false
  );
end $$;

create or replace function public.ht_agent_enable_visual_plan_manual_paper_handoff()
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
  v_control public.ht_agent_global_control%rowtype;
  v_release jsonb;
  v_acceptance jsonb;
begin
  select * into strict v_control from public.ht_agent_global_control where id='global';
  select public.ht_agent_phase2_visual_plan_release_health() into v_release;
  select public.ht_agent_phase2_visual_plan_acceptance_health() into v_acceptance;
  if v_control.visual_plan_mode<>'visible' or
     not v_control.visual_plan_lifecycle_enabled or
     v_control.visual_plan_shadow_verified_at is null or
     v_control.visual_plan_symbol_scope<>'{"symbols":["SPY","QQQ"]}'::jsonb or
     coalesce((v_release->>'releaseContractReady')::boolean,false) is not true or
     coalesce((v_release->>'workerAfterRollout')::boolean,false) is not true or
     coalesce((v_release#>>'{planEvidence,duplicateIdempotencyKeys}')::integer,0)<>0 or
     coalesce((v_release#>>'{planEvidence,duplicateActiveRoots}')::integer,0)<>0 or
     coalesce((v_release#>>'{planEvidence,stateRegressions}')::integer,0)<>0 or
     coalesce((v_release#>>'{providerRequests,closedMarketLifecycleRequests}')::integer,0)<>0 or
     coalesce((v_release#>>'{providerRequests,chartLayerRequests}')::integer,0)<>0 or
     coalesce((v_acceptance->>'verified')::boolean,false) is not true then
    raise exception 'phase2_manual_paper_handoff_not_ready';
  end if;
  update public.ht_agent_global_control set
    visual_plan_paper_handoff_enabled=true
  where id='global' and not visual_plan_paper_handoff_enabled;
  return jsonb_build_object(
    'enabled',true,
    'idempotent',not found,
    'mode','visible',
    'manualUserReviewOnly',true,
    'paperHandoffEnabled',true,
    'symbolScope','{"symbols":["SPY","QQQ"]}'::jsonb,
    'executionAuthority','none',
    'liveBrokerConnection',false,
    'verifiedAt',clock_timestamp()
  );
end $$;

revoke all on function public.ht_agent_phase2_visual_plan_acceptance_health()
  from public,anon,authenticated;
revoke all on function public.ht_agent_enable_visual_plan_manual_paper_handoff()
  from public,anon,authenticated;
grant execute on function public.ht_agent_phase2_visual_plan_acceptance_health()
  to service_role;
grant execute on function public.ht_agent_enable_visual_plan_manual_paper_handoff()
  to service_role;

update public.ht_agent_global_control set
  visual_plan_acceptance_contract_version='agent-x-phase2-acceptance-v1',
  visual_plan_acceptance_verified_at=clock_timestamp(),
  visual_plan_acceptance_receipt=jsonb_build_object(
    'contractVersion','agent-x-phase2-acceptance-v1',
    'environment','isolated_staging_fixture',
    'productionPlanEvidence',false,
    'planId','10000000-0000-4000-8000-000000000001',
    'planVersionId','10000000-0000-4000-8000-000000000002',
    'versionNumber',1,
    'providerTimestamp','2026-09-10T18:32:20.000Z',
    'completedProviderMinutes',3,
    'initialState','watching',
    'terminalState','needs_review_ambiguous',
    'transitions',jsonb_build_array('watching','triggered','needs_review_ambiguous'),
    'initialDesktopFingerprint','5d12f914d5b2113df5574b788a06bc9ec91d8b014a796ff61e0bbdfa8edba8bd',
    'initialIphoneFingerprint','5d12f914d5b2113df5574b788a06bc9ec91d8b014a796ff61e0bbdfa8edba8bd',
    'terminalDesktopFingerprint','7fe5c727e46909a7d0cc38ae2d7b002334d6139c65ac6af53a1a2227c197a446',
    'terminalIphoneFingerprint','7fe5c727e46909a7d0cc38ae2d7b002334d6139c65ac6af53a1a2227c197a446',
    'chart',jsonb_build_object(
      'timeframes',jsonb_build_array('1m','5m','15m'),
      'nativeObjectLayerAttached',true,
      'mobileBottomSheetVerified',true,
      'providerRequestsOnSwitch',0
    ),
    'paperReview',jsonb_build_object(
      'existingValidatorPassed',true,
      'prefillMatchedImmutablePlan',true,
      'submissionLockedDuringFixture',true,
      'strategySource','ht_agent'
    ),
    'executionAuthority','none',
    'liveBrokerConnection',false
  )
where id='global';

do $$
declare v_result jsonb;
begin
  select public.ht_agent_enable_visual_plan_manual_paper_handoff() into v_result;
  if coalesce((v_result->>'enabled')::boolean,false) is not true or
     coalesce((v_result->>'paperHandoffEnabled')::boolean,false) is not true or
     coalesce((v_result->>'manualUserReviewOnly')::boolean,false) is not true or
     v_result->>'executionAuthority'<>'none' or
     coalesce((v_result->>'liveBrokerConnection')::boolean,true) is not false then
    raise exception 'phase2_manual_paper_handoff_enable_failed';
  end if;
end $$;

comment on function public.ht_agent_phase2_visual_plan_acceptance_health() is
  'Service-only final Phase 2 acceptance receipt. Isolated fixture facts never become production plan evidence.';
comment on function public.ht_agent_enable_visual_plan_manual_paper_handoff() is
  'Fail-closed enablement for authenticated, user-reviewed HT Paper handoff only. No execution or live brokerage authority.';

commit;
