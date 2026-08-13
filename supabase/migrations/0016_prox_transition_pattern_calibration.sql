-- Pro X transition-pattern calibration.
--
-- This phase adds the honest denominator missing from graduation-only memory:
-- every finalized Before The Crowd case, including names that never reached
-- Spot Momentum. Aggregate cohorts remain shadow research. They publish no HT
-- score and carry no execution authority.

create table if not exists public.prox_strategy_learning_cases (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  trading_date date not null,
  methodology_version text not null,
  before_crowd_observation_id uuid not null references public.ht_opportunity_observations(id) on delete restrict,
  before_crowd_ledger_id uuid not null references public.ht_opportunity_ledger(id) on delete restrict,
  transition_case_id uuid references public.prox_strategy_transition_cases(id) on delete set null,
  first_seen_at timestamptz not null,
  first_seen_price numeric not null,
  first_role text not null,
  first_rank int not null,
  first_score numeric not null,
  first_source_run_id text,
  first_engine_version text,
  first_decision_snapshot jsonb not null default '{}'::jsonb,
  market_session text not null default 'unknown',
  entry_relative_volume numeric,
  entry_momentum_score numeric,
  entry_crowd_score numeric,
  entry_trap_score numeric,
  price_bucket text not null,
  relative_volume_bucket text not null,
  momentum_bucket text not null,
  crowd_bucket text not null,
  trap_bucket text not null,
  score_bucket text not null,
  graduated_to_spot boolean not null default false,
  spot_first_at timestamptz,
  spot_first_price numeric,
  transition_minutes numeric,
  highest_price_after_early numeric not null,
  highest_price_at timestamptz not null,
  lowest_price_after_early numeric not null,
  lowest_price_at timestamptz not null,
  max_gain_percent numeric not null,
  max_drawdown_percent numeric not null,
  time_to_peak_minutes numeric not null,
  outcome_label text not null,
  missed_explosion boolean not null default false,
  status text not null default 'active',
  calibratable boolean not null default false,
  fingerprint jsonb not null default '{}'::jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, trading_date, methodology_version),
  unique (before_crowd_observation_id, methodology_version),
  check (first_seen_price > 0),
  check (first_rank > 0),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'unknown')),
  check (spot_first_price is null or spot_first_price > 0),
  check (highest_price_after_early >= first_seen_price),
  check (lowest_price_after_early > 0 and lowest_price_after_early <= first_seen_price),
  check (time_to_peak_minutes >= 0),
  check (status in ('active', 'complete', 'quarantined')),
  check (outcome_label in ('explosion', 'continuation', 'failure', 'ordinary')),
  check (
    (graduated_to_spot = true and transition_case_id is not null and spot_first_at > first_seen_at and spot_first_price > 0 and transition_minutes > 0)
    or
    (graduated_to_spot = false and transition_case_id is null and spot_first_at is null and spot_first_price is null and transition_minutes is null)
  )
);

create index if not exists prox_strategy_learning_cases_status_idx
  on public.prox_strategy_learning_cases
  (status, trading_date desc, first_seen_at asc);

create index if not exists prox_strategy_learning_cases_profile_idx
  on public.prox_strategy_learning_cases
  (market_session, relative_volume_bucket, momentum_bucket, crowd_bucket, trap_bucket, trading_date desc);

create table if not exists public.prox_transition_pattern_calibrations (
  cohort_key text primary key,
  methodology_version text not null,
  cohort_level text not null,
  dimensions jsonb not null default '{}'::jsonb,
  sample_size int not null,
  graduated_count int not null,
  graduation_rate numeric not null,
  explosion_count int not null,
  explosion_rate numeric not null,
  continuation_count int not null,
  continuation_rate numeric not null,
  failure_count int not null,
  failure_rate numeric not null,
  missed_explosion_count int not null,
  missed_explosion_rate numeric not null,
  median_max_gain_percent numeric not null,
  median_max_drawdown_percent numeric not null,
  median_time_to_peak_minutes numeric not null,
  median_transition_minutes numeric,
  evidence_state text not null,
  authority text not null default 'shadow_research_only',
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cohort_level in ('full_profile', 'behavior_profile', 'session_momentum', 'market_session')),
  check (sample_size > 0),
  check (graduated_count between 0 and sample_size),
  check (explosion_count between 0 and sample_size),
  check (continuation_count between 0 and sample_size),
  check (failure_count between 0 and sample_size),
  check (missed_explosion_count between 0 and explosion_count),
  check (graduation_rate between 0 and 1),
  check (explosion_rate between 0 and 1),
  check (continuation_rate between 0 and 1),
  check (failure_rate between 0 and 1),
  check (missed_explosion_rate between 0 and 1),
  check (median_time_to_peak_minutes >= 0),
  check (median_transition_minutes is null or median_transition_minutes > 0),
  check (evidence_state in ('insufficient', 'emerging', 'calibrated')),
  check (authority = 'shadow_research_only')
);

create index if not exists prox_transition_pattern_calibrations_evidence_idx
  on public.prox_transition_pattern_calibrations
  (evidence_state, cohort_level, sample_size desc, computed_at desc);

create table if not exists public.prox_transition_calibration_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  trading_date date not null,
  methodology_version text not null,
  source_case_count int not null default 0,
  mature_case_count int not null default 0,
  expected_cohort_count int not null default 0,
  persisted_cohort_count int not null default 0,
  emerging_cohort_count int not null default 0,
  calibrated_cohort_count int not null default 0,
  complete boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (observation_minute, methodology_version),
  check (source_case_count >= 0),
  check (mature_case_count >= 0),
  check (expected_cohort_count >= 0),
  check (persisted_cohort_count >= 0),
  check (emerging_cohort_count >= 0),
  check (calibrated_cohort_count >= 0)
);

create index if not exists prox_transition_calibration_runs_time_idx
  on public.prox_transition_calibration_runs (observed_at desc);

-- Backfill every historical Before The Crowd case. Graduated cases retain the
-- exact transition provenance from migration 0015; non-graduates remain in
-- the denominator so calibration cannot learn from winners alone.
with first_before_crowd as (
  select distinct on (observation.trading_date, observation.ticker)
    observation.*
  from public.ht_opportunity_observations observation
  where observation.strategy = 'before_the_crowd'
  order by observation.trading_date, observation.ticker, observation.observed_at asc, observation.id asc
),
source as (
  select
    observation.*,
    greatest(
      ledger.highest_price_after_signal,
      transition.spot_first_price,
      observation.price
    ) as highest_price_after_signal,
    case
      when transition.spot_first_price > ledger.highest_price_after_signal
        then transition.spot_first_at
      else ledger.highest_price_at
    end as highest_price_at,
    least(ledger.lowest_price_after_signal, observation.price) as lowest_price_after_signal,
    case
      when observation.price < ledger.lowest_price_after_signal
        then observation.observed_at
      else ledger.lowest_price_at
    end as lowest_price_at,
    ledger.max_gain_percent,
    ledger.max_drawdown_percent,
    ledger.time_to_peak_minutes,
    ledger.finalized_at,
    transition.id as transition_case_id,
    transition.spot_first_at,
    transition.spot_first_price,
    transition.transition_minutes,
    case
      when jsonb_typeof(observation.decision_snapshot -> 'relativeVolume') = 'number'
        then (observation.decision_snapshot ->> 'relativeVolume')::numeric
      else null
    end as relative_volume,
    case
      when jsonb_typeof(observation.decision_snapshot -> 'momentumScore') = 'number'
        then (observation.decision_snapshot ->> 'momentumScore')::numeric
      else null
    end as momentum_score,
    case
      when jsonb_typeof(observation.decision_snapshot -> 'crowdScore') = 'number'
        then (observation.decision_snapshot ->> 'crowdScore')::numeric
      else null
    end as crowd_score,
    case
      when jsonb_typeof(observation.decision_snapshot -> 'trapScore') = 'number'
        then (observation.decision_snapshot ->> 'trapScore')::numeric
      else null
    end as trap_score,
    case
      when observation.decision_snapshot ->> 'scanSession' in ('pre_market', 'regular', 'after_hours')
        then observation.decision_snapshot ->> 'scanSession'
      else 'unknown'
    end as market_session
  from first_before_crowd observation
  join public.ht_opportunity_ledger ledger on ledger.id = observation.ledger_id
  left join public.prox_strategy_transition_cases transition
    on transition.before_crowd_observation_id = observation.id
    and transition.methodology_version = 'prox-canonical-transition-v1'
)
insert into public.prox_strategy_learning_cases (
  ticker,
  trading_date,
  methodology_version,
  before_crowd_observation_id,
  before_crowd_ledger_id,
  transition_case_id,
  first_seen_at,
  first_seen_price,
  first_role,
  first_rank,
  first_score,
  first_source_run_id,
  first_engine_version,
  first_decision_snapshot,
  market_session,
  entry_relative_volume,
  entry_momentum_score,
  entry_crowd_score,
  entry_trap_score,
  price_bucket,
  relative_volume_bucket,
  momentum_bucket,
  crowd_bucket,
  trap_bucket,
  score_bucket,
  graduated_to_spot,
  spot_first_at,
  spot_first_price,
  transition_minutes,
  highest_price_after_early,
  highest_price_at,
  lowest_price_after_early,
  lowest_price_at,
  max_gain_percent,
  max_drawdown_percent,
  time_to_peak_minutes,
  outcome_label,
  missed_explosion,
  status,
  calibratable,
  fingerprint,
  finalized_at
)
select
  source.ticker,
  source.trading_date,
  'prox-transition-learning-case-v1',
  source.id,
  source.ledger_id,
  source.transition_case_id,
  source.observed_at,
  source.price,
  source.role,
  source.rank,
  source.score,
  source.source_run_id,
  source.engine_version,
  source.decision_snapshot,
  source.market_session,
  source.relative_volume,
  source.momentum_score,
  source.crowd_score,
  source.trap_score,
  case when source.price < 1 then 'under_1' when source.price < 5 then '1_to_5' when source.price < 20 then '5_to_20' else '20_plus' end,
  case when source.relative_volume is null then 'unknown' when source.relative_volume < 1 then 'under_1x' when source.relative_volume < 2 then '1_to_2x' when source.relative_volume < 5 then '2_to_5x' when source.relative_volume < 10 then '5_to_10x' when source.relative_volume < 20 then '10_to_20x' else '20x_plus' end,
  case when source.momentum_score is null then 'unknown' when source.momentum_score < 40 then 'under_40' when source.momentum_score < 60 then '40_to_59' when source.momentum_score < 80 then '60_to_79' else '80_plus' end,
  case when source.crowd_score is null then 'unknown' when source.crowd_score < 35 then 'under_35' when source.crowd_score < 60 then '35_to_59' else '60_plus' end,
  case when source.trap_score is null then 'unknown' when source.trap_score < 35 then 'under_35' when source.trap_score < 60 then '35_to_59' else '60_plus' end,
  case when source.score < 50 then 'under_50' when source.score < 65 then '50_to_64' when source.score < 80 then '65_to_79' else '80_plus' end,
  source.transition_case_id is not null,
  source.spot_first_at,
  source.spot_first_price,
  source.transition_minutes,
  greatest(source.highest_price_after_signal, source.price),
  source.highest_price_at,
  least(source.lowest_price_after_signal, source.price),
  source.lowest_price_at,
  round((((greatest(source.highest_price_after_signal, source.price) - source.price) / source.price) * 100)::numeric, 3),
  round((((least(source.lowest_price_after_signal, source.price) - source.price) / source.price) * 100)::numeric, 3),
  greatest(0, source.time_to_peak_minutes),
  case
    when ((greatest(source.highest_price_after_signal, source.price) - source.price) / source.price) * 100 >= 100 then 'explosion'
    when ((greatest(source.highest_price_after_signal, source.price) - source.price) / source.price) * 100 >= 20 then 'continuation'
    when ((greatest(source.highest_price_after_signal, source.price) - source.price) / source.price) * 100 < 10
      and ((least(source.lowest_price_after_signal, source.price) - source.price) / source.price) * 100 <= -10 then 'failure'
    else 'ordinary'
  end,
  source.transition_case_id is null
    and ((greatest(source.highest_price_after_signal, source.price) - source.price) / source.price) * 100 >= 100,
  case when source.finalized_at is null then 'active' else 'complete' end,
  source.finalized_at is not null,
  jsonb_build_object(
    'sourceKind', 'canonical_before_crowd_learning_case',
    'ticker', source.ticker,
    'tradingDate', source.trading_date,
    'graduatedToSpot', source.transition_case_id is not null,
    'firstDecisionSnapshot', source.decision_snapshot,
    'predictionAuthority', false,
    'publicScoreAuthority', false,
    'executionAuthority', false
  ),
  source.finalized_at
from source
on conflict (ticker, trading_date, methodology_version) do update set
  transition_case_id = excluded.transition_case_id,
  graduated_to_spot = excluded.graduated_to_spot,
  spot_first_at = excluded.spot_first_at,
  spot_first_price = excluded.spot_first_price,
  transition_minutes = excluded.transition_minutes,
  highest_price_after_early = excluded.highest_price_after_early,
  highest_price_at = excluded.highest_price_at,
  lowest_price_after_early = excluded.lowest_price_after_early,
  lowest_price_at = excluded.lowest_price_at,
  max_gain_percent = excluded.max_gain_percent,
  max_drawdown_percent = excluded.max_drawdown_percent,
  time_to_peak_minutes = excluded.time_to_peak_minutes,
  outcome_label = excluded.outcome_label,
  missed_explosion = excluded.missed_explosion,
  status = excluded.status,
  calibratable = excluded.calibratable,
  fingerprint = excluded.fingerprint,
  finalized_at = excluded.finalized_at,
  updated_at = now();

alter table public.prox_strategy_learning_cases enable row level security;
alter table public.prox_transition_pattern_calibrations enable row level security;
alter table public.prox_transition_calibration_runs enable row level security;

comment on table public.prox_strategy_learning_cases is
  'Every canonical Before The Crowd case, including non-graduates, for unbiased Pro X transition research.';

comment on table public.prox_transition_pattern_calibrations is
  'Versioned, sample-gated historical cohort evidence. Shadow research only; never an HT score or execution instruction.';

comment on table public.prox_transition_calibration_runs is
  'Coverage receipts proving all mature learning cases were included in each transition calibration cycle.';
