-- Read-only verification: no changes, no provider calls, no CoinAPI credits.
-- Paste this complete query into the existing HT Labs Supabase SQL Editor.
-- It returns ONE result with installed repair checks and uncertain cost receipts.
select jsonb_build_object(
  'migration_0039', jsonb_build_object(
    'bounded_audit_installed', coalesce((
      select position('with pending as materialized' in lower(pg_get_functiondef(p.oid))) > 0
      from pg_proc p where p.oid = to_regprocedure('public.ht_crypto_audit_legacy_evidence(integer)')
    ), false),
    'separate_maintenance_installed', coalesce((
      select position('legacyAuditScheduledSeparately' in pg_get_functiondef(p.oid)) > 0
      from pg_proc p where p.oid = to_regprocedure('public.ht_coinapi_research_maintenance()')
    ), false),
    'health_function_settings', (
      select to_jsonb(p.proconfig) from pg_proc p
      where p.oid = to_regprocedure('public.ht_crypto_evidence_health_snapshot()')
    ),
    'audit_indexes_installed',
      to_regclass('public.ht_crypto_prox_legacy_audit_ids') is not null and
      to_regclass('public.ht_crypto_discovery_legacy_audit_ids') is not null and
      to_regclass('public.ht_crypto_evidence_audit_cover') is not null
  ),
  'collection', (
    select jsonb_build_object('enabled', c.enabled, 'blocked_reason', c.blocked_reason,
      'daily_reserved', c.daily_reserved, 'lifetime_reserved', c.lifetime_reserved,
      'daily_credit_limit', c.daily_credit_limit, 'lifetime_credit_limit', c.lifetime_credit_limit)
    from public.ht_coinapi_pilot_control c where c.id = 'global'
  ),
  'uncertain_cost_receipts', (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.reserved_at desc), '[]'::jsonb)
    from (
      select id, cycle_id, path, reserved_at, settled_at,
        reserved_credits, reported_credits, http_status
      from public.ht_coinapi_pilot_requests
      where reported_credits is null or settled_at is null
      order by reserved_at desc limit 10
    ) r
  ),
  'completed_audits', (
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from (
      select source_table, count(*) as audited, max(audited_at) as latest_audit_at
      from public.ht_crypto_legacy_evidence_audits group by source_table
    ) a
  )
) as crypto_repair_verification;
