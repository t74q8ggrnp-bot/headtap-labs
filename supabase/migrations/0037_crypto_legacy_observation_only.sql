-- Stop creating unmeasurable legacy deadlines, without rewriting any historical
-- price, return, target time, score, or decision. Apply after 0036.
-- Does NOT enable CoinAPI, alter budgets, change public ranks, or create orders.
begin;

do $$
begin
  if to_regclass('public.ht_crypto_outcome_source_policy') is null then
    raise exception 'Apply crypto evidence migration 0036 first';
  end if;
end $$;

-- The first default classifies existing evidence; subsequent inserts use the
-- observation-only default. Re-running this migration never reclassifies rows.
alter table public.ht_crypto_prox_observations
  add column if not exists outcome_tracking_status text not null default 'legacy_quarantined';
alter table public.ht_crypto_discovery_observations
  add column if not exists outcome_tracking_status text not null default 'legacy_quarantined';

alter table public.ht_crypto_prox_observations
  alter column outcome_tracking_status set default 'not_scheduled',
  alter column target_15m_at drop not null,
  alter column target_1h_at drop not null,
  alter column target_4h_at drop not null,
  alter column target_24h_at drop not null;
alter table public.ht_crypto_discovery_observations
  alter column outcome_tracking_status set default 'not_scheduled',
  alter column target_15m_at drop not null,
  alter column target_1h_at drop not null,
  alter column target_4h_at drop not null,
  alter column target_24h_at drop not null;

create or replace function public.ht_crypto_observation_only_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    -- Rolling-deploy compatibility: the old collector still sends deadlines.
    -- Suppress NEW deadlines only. Never apply this branch to existing rows.
    NEW.outcome_tracking_status := 'not_scheduled';
    NEW.target_15m_at := null;
    NEW.target_1h_at := null;
    NEW.target_4h_at := null;
    NEW.target_24h_at := null;
  elsif (to_jsonb(NEW) - 'updated_at') is distinct from (to_jsonb(OLD) - 'updated_at') then
    raise exception 'Legacy crypto observations are immutable; preserve original evidence';
  end if;
  return NEW;
end $$;

drop trigger if exists ht_crypto_observation_only on public.ht_crypto_prox_observations;
create trigger ht_crypto_observation_only before insert or update on public.ht_crypto_prox_observations
  for each row execute function public.ht_crypto_observation_only_guard();
drop trigger if exists ht_crypto_observation_only on public.ht_crypto_discovery_observations;
create trigger ht_crypto_observation_only before insert or update on public.ht_crypto_discovery_observations
  for each row execute function public.ht_crypto_observation_only_guard();

alter table public.ht_crypto_prox_observations drop constraint if exists ht_crypto_prox_tracking_status;
alter table public.ht_crypto_prox_observations add constraint ht_crypto_prox_tracking_status check (
  outcome_tracking_status in ('legacy_quarantined','not_scheduled') and
  (outcome_tracking_status = 'legacy_quarantined' or
    (target_15m_at is null and target_1h_at is null and target_4h_at is null and target_24h_at is null))
);
alter table public.ht_crypto_discovery_observations drop constraint if exists ht_crypto_discovery_tracking_status;
alter table public.ht_crypto_discovery_observations add constraint ht_crypto_discovery_tracking_status check (
  outcome_tracking_status in ('legacy_quarantined','not_scheduled') and
  (outcome_tracking_status = 'legacy_quarantined' or
    (target_15m_at is null and target_1h_at is null and target_4h_at is null and target_24h_at is null))
);
revoke all on function public.ht_crypto_observation_only_guard() from public, anon, authenticated, service_role;
revoke delete, truncate on public.ht_crypto_prox_observations, public.ht_crypto_discovery_observations
  from public, anon, authenticated, service_role;
grant select on public.ht_crypto_prox_observations, public.ht_crypto_discovery_observations to service_role;

-- Old overdue targets remain visible and excluded. New observation-only records
-- are a separate denominator, NOT repaired/measured outcomes or successful trades.
create or replace view public.ht_crypto_legacy_tracking_readiness with (security_invoker = true) as
with evidence as (
  select 'ht_crypto_prox_observations'::text as source_table, outcome_tracking_status, observed_at,
    target_15m_at, price_15m as price_15m, target_1h_at, price_1h as price_1h,
    target_4h_at, price_4h as price_4h, target_24h_at, price_24h as price_24h
  from public.ht_crypto_prox_observations
  union all
  select 'ht_crypto_discovery_observations', outcome_tracking_status, observed_at,
    target_15m_at, price_15m_usd, target_1h_at, price_1h_usd,
    target_4h_at, price_4h_usd, target_24h_at, price_24h_usd
  from public.ht_crypto_discovery_observations
)
select p.source_table, 'crypto-legacy-observation-only-v1'::text as tracking_version,
  count(e.source_table) filter (where outcome_tracking_status = 'legacy_quarantined') as preserved_legacy_observations,
  count(e.source_table) filter (where outcome_tracking_status = 'not_scheduled') as observation_only_records,
  count(e.source_table) filter (where target_15m_at < now() - interval '10 minutes' and price_15m is null) as legacy_overdue_15m,
  coalesce(sum(case when outcome_tracking_status = 'legacy_quarantined' then
    (price_15m is not null)::int + (price_1h is not null)::int + (price_4h is not null)::int + (price_24h is not null)::int
    else 0 end),0) as unverified_recorded_horizons,
  count(e.source_table) filter (where outcome_tracking_status = 'not_scheduled' and
    (target_15m_at is not null or target_1h_at is not null or target_4h_at is not null or target_24h_at is not null)) as invalid_new_deadlines,
  max(observed_at) filter (where outcome_tracking_status = 'not_scheduled') as latest_observation_only_at,
  p.evaluation_allowed, p.reason
from public.ht_crypto_outcome_source_policy p
left join evidence e on e.source_table = p.source_table
group by p.source_table, p.evaluation_allowed, p.reason;
revoke all on public.ht_crypto_legacy_tracking_readiness from public, anon, authenticated;
grant select on public.ht_crypto_legacy_tracking_readiness to service_role;

commit;
