-- Read-performance repair only. Preserve every original row, outcome, policy,
-- balance, request allowance and health criterion. No provider requests.
begin;
do $$ begin
  if to_regclass('public.ht_crypto_legacy_audit_queue') is null then
    raise exception 'Apply migration 0043 first';
  end if;
end $$;

-- Cover exactly the scalar fields used by exhaustive archive tracking. Large
-- ProX/discovery packets are not needed for these counts and are not indexed.
create index if not exists ht_crypto_prox_tracking_cover
  on public.ht_crypto_prox_observations(outcome_tracking_status)
  include(observed_at,target_15m_at,price_15m,target_1h_at,price_1h,
    target_4h_at,price_4h,target_24h_at,price_24h);
create index if not exists ht_crypto_discovery_tracking_cover
  on public.ht_crypto_discovery_observations(outcome_tracking_status)
  include(observed_at,target_15m_at,price_15m_usd,target_1h_at,price_1h_usd,
    target_4h_at,price_4h_usd,target_24h_at,price_24h_usd);

-- Aggregate each source BEFORE joining its policy. The old UNION under a
-- policy LEFT JOIN let the planner repeatedly scan wide historical relations.
-- These are live exhaustive counts, not estimates, cached green results or a
-- sample. The legacy overdue count still uses its original moving cutoff.
create or replace view public.ht_crypto_legacy_tracking_readiness with (security_invoker = true) as
with counts as (
  select 'ht_crypto_prox_observations'::text as source_table,
    count(*) filter(where outcome_tracking_status='legacy_quarantined') as preserved_legacy_observations,
    count(*) filter(where outcome_tracking_status='not_scheduled') as observation_only_records,
    count(*) filter(where target_15m_at < now()-interval '10 minutes' and price_15m is null) as legacy_overdue_15m,
    coalesce(sum(case when outcome_tracking_status='legacy_quarantined' then
      (price_15m is not null)::int+(price_1h is not null)::int+(price_4h is not null)::int+(price_24h is not null)::int else 0 end),0) as unverified_recorded_horizons,
    count(*) filter(where outcome_tracking_status='not_scheduled' and
      (target_15m_at is not null or target_1h_at is not null or target_4h_at is not null or target_24h_at is not null)) as invalid_new_deadlines,
    max(observed_at) filter(where outcome_tracking_status='not_scheduled') as latest_observation_only_at
  from public.ht_crypto_prox_observations
  union all
  select 'ht_crypto_discovery_observations'::text,
    count(*) filter(where outcome_tracking_status='legacy_quarantined'),
    count(*) filter(where outcome_tracking_status='not_scheduled'),
    count(*) filter(where target_15m_at < now()-interval '10 minutes' and price_15m_usd is null),
    coalesce(sum(case when outcome_tracking_status='legacy_quarantined' then
      (price_15m_usd is not null)::int+(price_1h_usd is not null)::int+(price_4h_usd is not null)::int+(price_24h_usd is not null)::int else 0 end),0),
    count(*) filter(where outcome_tracking_status='not_scheduled' and
      (target_15m_at is not null or target_1h_at is not null or target_4h_at is not null or target_24h_at is not null)),
    max(observed_at) filter(where outcome_tracking_status='not_scheduled')
  from public.ht_crypto_discovery_observations
)
select p.source_table,'crypto-legacy-observation-only-v1'::text as tracking_version,
  coalesce(c.preserved_legacy_observations,0)::bigint as preserved_legacy_observations,
  coalesce(c.observation_only_records,0)::bigint as observation_only_records,
  coalesce(c.legacy_overdue_15m,0)::bigint as legacy_overdue_15m,
  coalesce(c.unverified_recorded_horizons,0)::bigint as unverified_recorded_horizons,
  coalesce(c.invalid_new_deadlines,0)::bigint as invalid_new_deadlines,
  c.latest_observation_only_at,p.evaluation_allowed,p.reason
from public.ht_crypto_outcome_source_policy p left join counts c using(source_table);

-- Refresh planner statistics after the completed one-time fingerprint drain.
analyze public.ht_crypto_prox_observations;
analyze public.ht_crypto_discovery_observations;
analyze public.ht_crypto_legacy_evidence_audits;
analyze public.ht_crypto_legacy_source_fingerprints;
notify pgrst,'reload schema';
commit;
