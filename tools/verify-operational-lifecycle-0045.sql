-- Read-only release proof for migration 0045.
-- This makes zero provider requests and does not change budgets, balances,
-- orders, Agent modes, kill switches, scoring, or execution authority.
select jsonb_build_object(
  'migration_0045', jsonb_build_object(
    'unsettled_hold_table_installed',
      to_regclass('public.ht_coinapi_unsettled_cost_holds') is not null,
    'one_running_agent_index_installed',
      to_regclass('public.ht_agent_one_running_cycle_per_profile') is not null,
    'recovery_function_installed',
      to_regprocedure('public.ht_coinapi_recover_bounded_timeouts()') is not null,
    'agent_health_function_installed',
      to_regprocedure('public.ht_agent_lifecycle_health()') is not null
  ),
  'coinapi_control', (
    select jsonb_build_object(
      'enabled', enabled,
      'blocked_reason', blocked_reason,
      'daily_credit_limit', daily_credit_limit,
      'lifetime_credit_limit', lifetime_credit_limit,
      'daily_reserved', daily_reserved,
      'lifetime_reserved', lifetime_reserved,
      'lease_id', lease_id,
      'lease_until', lease_until,
      'latest_cycle_id', latest_cycle_id
    )
    from public.ht_coinapi_pilot_control
    where id = 'global'
  ),
  'coinapi_accounting', public.ht_coinapi_pilot_accounting_snapshot(),
  'agent_lifecycle', public.ht_agent_lifecycle_health(),
  'execution_authority', jsonb_build_object(
    'coinapi', 'research_only',
    'ht_agent', 'ht_labs_paper_only',
    'live_brokerage', false
  ),
  'provider_requests', 0
) as operational_lifecycle_verification;
