-- Pro X security-type routing and learning isolation.
--
-- Canonical HT security eligibility remains unchanged. Pro X stores useful
-- basket/benchmark and linked-instrument context in separate shadow lanes,
-- while only verified CS and ADRC observations may seed opportunity outcome
-- learning. Nothing here grants public-score or execution authority.

create table if not exists public.ht_security_metadata (
  ticker text primary key,
  security_type text,
  is_supported boolean not null default false,
  issuer_name text,
  is_leveraged_or_inverse boolean,
  fetched_at timestamptz not null default now(),
  source_last_updated_at timestamptz,
  data_quality_state text not null default 'insufficient',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (data_quality_state in ('fresh', 'insufficient'))
);

alter table public.ht_security_metadata
  add column if not exists security_type text,
  add column if not exists is_supported boolean not null default false,
  add column if not exists issuer_name text,
  add column if not exists is_leveraged_or_inverse boolean,
  add column if not exists fetched_at timestamptz not null default now(),
  add column if not exists source_last_updated_at timestamptz,
  add column if not exists data_quality_state text not null default 'insufficient',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists ht_security_metadata_type_idx
  on public.ht_security_metadata (security_type, fetched_at desc);

create table if not exists public.ht_security_type_registry (
  security_type text primary key,
  asset_class text,
  locale text,
  description text,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ht_security_type_registry_fetched_idx
  on public.ht_security_type_registry (fetched_at desc);

alter table public.prox_market_discovery_observations
  add column if not exists security_type text,
  add column if not exists instrument_lane text,
  add column if not exists opportunity_eligible boolean not null default false,
  add column if not exists metadata_state text;

alter table public.prox_research_queue
  add column if not exists security_type text,
  add column if not exists instrument_lane text,
  add column if not exists opportunity_eligible boolean not null default false,
  add column if not exists metadata_state text;

alter table public.prox_research_episodes
  add column if not exists security_type text,
  add column if not exists instrument_lane text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_market_observation_lane_check'
  ) then
    alter table public.prox_market_discovery_observations
      add constraint prox_market_observation_lane_check
      check (instrument_lane is null or instrument_lane in (
        'opportunity_equity',
        'market_context',
        'linked_instrument_context',
        'excluded_asset',
        'pending_verification'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_market_observation_metadata_state_check'
  ) then
    alter table public.prox_market_discovery_observations
      add constraint prox_market_observation_metadata_state_check
      check (metadata_state is null or metadata_state in ('verified', 'pending'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_market_observation_opportunity_route_check'
  ) then
    alter table public.prox_market_discovery_observations
      add constraint prox_market_observation_opportunity_route_check
      check (
        opportunity_eligible = false
        or coalesce((
          instrument_lane = 'opportunity_equity'
          and security_type in ('CS', 'ADRC')
          and metadata_state = 'verified'
        ), false)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_research_queue_lane_check'
  ) then
    alter table public.prox_research_queue
      add constraint prox_research_queue_lane_check
      check (instrument_lane is null or instrument_lane in (
        'opportunity_equity',
        'market_context',
        'linked_instrument_context',
        'excluded_asset',
        'pending_verification'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_research_queue_metadata_state_check'
  ) then
    alter table public.prox_research_queue
      add constraint prox_research_queue_metadata_state_check
      check (metadata_state is null or metadata_state in ('verified', 'pending'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_research_queue_opportunity_route_check'
  ) then
    alter table public.prox_research_queue
      add constraint prox_research_queue_opportunity_route_check
      check (
        opportunity_eligible = false
        or coalesce((
          instrument_lane = 'opportunity_equity'
          and security_type in ('CS', 'ADRC')
          and metadata_state = 'verified'
        ), false)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'prox_research_episode_equity_lane_check'
  ) then
    alter table public.prox_research_episodes
      add constraint prox_research_episode_equity_lane_check
      check (
        methodology_version <> 'prox-outcome-memory-v2-security-routed'
        or coalesce((
          instrument_lane = 'opportunity_equity'
          and security_type in ('CS', 'ADRC')
        ), false)
      );
  end if;
end $$;

create index if not exists prox_market_observations_lane_time_idx
  on public.prox_market_discovery_observations
  (instrument_lane, opportunity_eligible, observed_at desc);

create index if not exists prox_research_queue_lane_priority_idx
  on public.prox_research_queue
  (instrument_lane, opportunity_eligible, research_priority desc);

alter table public.ht_security_metadata enable row level security;
alter table public.ht_security_type_registry enable row level security;

comment on table public.ht_security_type_registry is
  'Cached Polygon/Massive stock security-type registry used to detect new provider codes. Server-side research only.';

comment on column public.prox_market_discovery_observations.instrument_lane is
  'Versioned Pro X research route. Security type routes evidence; it does not add or subtract Edge Score.';

comment on column public.prox_market_discovery_observations.opportunity_eligible is
  'True only for verified CS/ADRC observations. This remains shadow research and is not canonical eligibility.';

comment on column public.prox_research_episodes.instrument_lane is
  'Outcome Memory v2 accepts only the opportunity_equity lane so context instruments cannot teach bullish opportunity patterns.';
