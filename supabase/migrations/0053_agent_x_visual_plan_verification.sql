-- Service-only Phase 2 infrastructure verifier. This never enables a feature.
begin;

create or replace function public.ht_agent_phase2_visual_plan_infrastructure_health()
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='15s' as $$
declare
  v_tables boolean;
  v_functions boolean;
  v_immutability boolean;
  v_constraints boolean;
  v_access boolean;
  v_paper_handoff_schema boolean;
  v_duplicate_idempotency bigint:=0;
  v_orphan_states bigint:=0;
  v_control jsonb;
begin
  v_tables:=
    to_regclass('public.ht_agent_visual_plans') is not null and
    to_regclass('public.ht_agent_visual_plan_versions') is not null and
    to_regclass('public.ht_agent_visual_plan_states') is not null and
    to_regclass('public.ht_agent_visual_plan_events') is not null and
    to_regclass('public.ht_agent_visual_plan_market_evidence') is not null and
    to_regclass('public.ht_agent_visual_plan_worker_runs') is not null;
  v_functions:=
    to_regprocedure('public.ht_agent_create_visual_plan(uuid,uuid,text,text,text,jsonb)') is not null and
    to_regprocedure('public.ht_agent_claim_visual_plan_batch(integer)') is not null and
    to_regprocedure('public.ht_agent_apply_visual_plan_lifecycle(uuid,bigint,jsonb,jsonb)') is not null and
    to_regprocedure('public.ht_agent_validate_visual_plan_handoff(uuid,uuid)') is not null;
  select count(*)=4 into v_immutability
  from pg_catalog.pg_trigger
  where not tgisinternal and tgenabled='O' and tgname in (
    'ht_agent_visual_plan_versions_immutable','ht_agent_visual_plan_events_immutable',
    'ht_agent_visual_plan_evidence_immutable','ht_agent_visual_plan_worker_runs_immutable'
  );
  select
    exists(
      select 1 from pg_catalog.pg_constraint
      where conrelid='public.ht_agent_visual_plan_versions'::regclass and
        conname='ht_agent_visual_plan_versions_profile_id_idempotency_key_key'
    ) and
    exists(
      select 1 from pg_catalog.pg_constraint
      where conrelid='public.ht_agent_visual_plan_states'::regclass and
        conname='ht_agent_visual_plan_states_lifecycle_state_check'
    ) and
    exists(
      select 1 from pg_catalog.pg_constraint
      where conrelid='public.ht_agent_visual_plan_market_evidence'::regclass and
        contype='c' and
        pg_catalog.pg_get_constraintdef(oid) like '%candle_closed_at%' and
        pg_catalog.pg_get_constraintdef(oid) like '%candle_opened_at%'
    ) into v_constraints;
  select
    exists(
      select 1 from pg_catalog.pg_attribute
      where attrelid='public.paper_orders'::regclass and
        attname='ht_agent_visual_plan_version_id' and not attisdropped
    ) and
    exists(
      select 1 from pg_catalog.pg_constraint
      where conrelid='public.paper_orders'::regclass and
        conname='paper_orders_strategy_source_check' and
        pg_catalog.pg_get_constraintdef(oid) like '%ht_agent%'
    ) and
    to_regclass('public.paper_orders_visual_plan_active_unique') is not null
  into v_paper_handoff_schema;
  v_access:=
    not has_table_privilege('authenticated','public.ht_agent_visual_plan_versions','INSERT') and
    not has_table_privilege('authenticated','public.ht_agent_visual_plan_states','UPDATE') and
    not has_table_privilege('authenticated','public.ht_agent_visual_plan_events','INSERT') and
    not has_table_privilege('anon','public.ht_agent_visual_plan_versions','SELECT') and
    not has_function_privilege('authenticated',
      'public.ht_agent_apply_visual_plan_lifecycle(uuid,bigint,jsonb,jsonb)','EXECUTE');

  if v_tables then
    select count(*)-count(distinct (profile_id,idempotency_key))
    into v_duplicate_idempotency
    from public.ht_agent_visual_plan_versions;
    select count(*) into v_orphan_states
    from public.ht_agent_visual_plan_states s
    left join public.ht_agent_visual_plan_versions v on v.id=s.plan_version_id
    where v.id is null;
  end if;
  select jsonb_build_object(
    'mode',visual_plan_mode,
    'lifecycleEnabled',visual_plan_lifecycle_enabled,
    'paperHandoffEnabled',visual_plan_paper_handoff_enabled,
    'symbolScope',visual_plan_symbol_scope
  ) into v_control from public.ht_agent_global_control where id='global';

  return jsonb_build_object(
    'contractVersion','agent-x-visual-plan-infrastructure-v1',
    'verified',v_tables and v_functions and v_immutability and v_constraints and
      v_paper_handoff_schema and
      v_access and v_duplicate_idempotency=0 and v_orphan_states=0,
    'tablesReady',v_tables,
    'functionsReady',v_functions,
    'immutabilityReady',v_immutability,
    'constraintsReady',v_constraints,
    'paperHandoffSchemaReady',v_paper_handoff_schema,
    'accessBoundaryReady',v_access,
    'duplicateIdempotencyKeys',v_duplicate_idempotency,
    'orphanStates',v_orphan_states,
    'rollout',coalesce(v_control,'{}'::jsonb),
    'verifiedAt',clock_timestamp()
  );
end $$;

revoke all on function public.ht_agent_phase2_visual_plan_infrastructure_health()
  from public,anon,authenticated;
grant execute on function public.ht_agent_phase2_visual_plan_infrastructure_health()
  to service_role;

commit;
