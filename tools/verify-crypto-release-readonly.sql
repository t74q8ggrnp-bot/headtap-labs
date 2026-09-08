-- Verification only: one SELECT, no data changes, no provider requests.
-- Run in the existing HT Labs Supabase SQL Editor and return the JSON result.
-- This is NOT another migration and does NOT enable collection.
select jsonb_build_object(
  'pilot', (
    select jsonb_build_object(
      'collection_enabled_in_database', c.enabled,
      'daily_credit_limit', c.daily_credit_limit,
      'lifetime_credit_limit', c.lifetime_credit_limit,
      'credit_day', c.credit_day,
      'daily_reserved', c.daily_reserved,
      'lifetime_reserved', c.lifetime_reserved,
      'blocked_reason', c.blocked_reason,
      'latest_cycle_id', c.latest_cycle_id
    )
    from public.ht_coinapi_pilot_control c where c.id = 'global'
  ),
  'source_policies', (
    select jsonb_agg(jsonb_build_object(
      'source_table', p.source_table,
      'evaluation_allowed', p.evaluation_allowed,
      'policy_version', p.policy_version
    ) order by p.source_table)
    from public.ht_crypto_outcome_source_policy p
  ),
  'research_readiness', (
    select to_jsonb(r) from public.ht_crypto_research_readiness r
  ),
  'recent_cycles', (
    select coalesce(jsonb_agg(to_jsonb(c) order by c.started_at desc), '[]'::jsonb)
    from (
      select id, status, started_at, completed_at, error_code,
        frame->'summary' as coverage, frame->'usage' as provider_usage
      from public.ht_coinapi_pilot_cycles
      order by started_at desc limit 5
    ) c
  ),
  'usage_receipts', (
    select jsonb_build_object(
      'requests', count(*),
      'unsettled_requests', count(*) filter (where settled_at is null),
      'reported_request_credits', sum(reported_credits),
      'latest_request_at', max(reserved_at)
    ) from public.ht_coinapi_pilot_requests
  ),
  'legacy_observation_only_schema_present',
    to_regclass('public.ht_crypto_legacy_tracking_readiness') is not null
    and to_regprocedure('public.ht_crypto_observation_only_guard()') is not null,
  'installed_triggers', (
    select jsonb_agg(jsonb_build_object(
      'table', t.tgrelid::regclass::text,
      'trigger', t.tgname,
      'enabled_mode', t.tgenabled::text
    ) order by t.tgrelid::regclass::text)
    from pg_trigger t
    where not t.tgisinternal and (
      (t.tgname = 'ht_crypto_legacy_outcome_guard' and t.tgrelid in (
        'public.ht_crypto_prox_observations'::regclass,
        'public.ht_crypto_discovery_observations'::regclass
      )) or
      (t.tgname = 'ht_coinapi_capture_evidence' and
        t.tgrelid = 'public.ht_coinapi_pilot_cycles'::regclass)
    )
  ),
  'maintenance_function_installed',
    to_regprocedure('public.ht_coinapi_research_maintenance()') is not null
) as release_verification;
