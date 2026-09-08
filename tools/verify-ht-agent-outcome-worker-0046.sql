-- Read-only release proof. No provider calls or state changes.
select jsonb_build_object(
  'migration_0046',jsonb_build_object(
    'worker_control_installed',to_regclass('public.ht_agent_outcome_worker_control') is not null,
    'claim_function_installed',to_regprocedure('public.ht_agent_claim_outcome_batch(uuid,integer)') is not null,
    'finish_function_installed',to_regprocedure('public.ht_agent_finish_outcome_batch(uuid,jsonb,jsonb)') is not null
    ,'prox_worker_control_installed',to_regclass('public.prox_shadow_outcome_worker_control') is not null
    ,'prox_begin_function_installed',to_regprocedure('public.prox_shadow_outcome_worker_begin(uuid)') is not null
    ,'prox_finish_function_installed',to_regprocedure('public.prox_shadow_outcome_worker_finish(uuid,jsonb)') is not null
  ),
  'lifecycle',public.ht_agent_lifecycle_health(),
  'overdue_outcomes',(
    select count(*) from public.ht_agent_outcomes
    where complete=false and target_at<clock_timestamp()-interval '12 minutes'
  ),
  'execution_authority',jsonb_build_object(
    'ht_agent','ht_labs_paper_only','live_brokerage',false
  ),
  'provider_requests',0
) as ht_agent_outcome_worker_verification;
