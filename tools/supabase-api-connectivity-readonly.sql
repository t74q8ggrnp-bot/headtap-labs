-- Diagnostic only: no migration, reset, provider request or budget change.
-- Helps distinguish overloaded/blocked DB sessions from an API-service issue.
begin read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

select jsonb_build_object(
  'checked_at', clock_timestamp(),
  'database_reachable', true,
  'coinapi_budget', (
    select jsonb_build_object(
      'enabled', enabled,
      'daily_limit', daily_credit_limit,
      'lifetime_limit', lifetime_credit_limit,
      'daily_reserved', daily_reserved,
      'lifetime_reserved', lifetime_reserved,
      'remaining_test_requests', greatest(0, lifetime_credit_limit - lifetime_reserved),
      'blocked_reason', blocked_reason,
      'latest_cycle_id', latest_cycle_id
    ) from public.ht_coinapi_pilot_control where id = 'global'
  ),
  'sessions', (
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    from (
      select usename as database_role,
        application_name,
        state,
        wait_event_type,
        wait_event,
        count(*) as connections,
        count(*) filter (where cardinality(pg_blocking_pids(pid)) > 0) as blocked_connections,
        round(max(extract(epoch from clock_timestamp() - xact_start))) as oldest_transaction_seconds
      from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
      group by usename, application_name, state, wait_event_type, wait_event
      order by count(*) desc
      limit 20
    ) s
  )
) as connectivity_diagnostic;

rollback;
