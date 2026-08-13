-- Pro X canonical transition-case memory.
--
-- This is a provenance-preserving learning bridge between HT Labs' existing
-- Before The Crowd and Spot Momentum systems. It records cases where the same
-- ticker was first displayed by Before The Crowd and later graduated to Spot
-- Momentum. It does not claim that Pro X independently discovered the ticker,
-- does not create a second public score, and has no trading authority.

create table if not exists public.prox_strategy_transition_cases (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  trading_date date not null,
  methodology_version text not null,
  source_kind text not null default 'canonical_transition_case',

  before_crowd_observation_id uuid not null references public.ht_opportunity_observations(id) on delete restrict,
  before_crowd_ledger_id uuid not null references public.ht_opportunity_ledger(id) on delete restrict,
  before_crowd_first_at timestamptz not null,
  before_crowd_first_price numeric not null,
  before_crowd_first_role text not null,
  before_crowd_first_rank int not null,
  before_crowd_first_score numeric not null,
  before_crowd_source_run_id text,
  before_crowd_engine_version text,
  before_crowd_decision_snapshot jsonb not null default '{}'::jsonb,

  spot_observation_id uuid not null references public.ht_opportunity_observations(id) on delete restrict,
  spot_ledger_id uuid not null references public.ht_opportunity_ledger(id) on delete restrict,
  spot_first_at timestamptz not null,
  spot_first_price numeric not null,
  spot_first_role text not null,
  spot_first_rank int not null,
  spot_first_score numeric not null,
  spot_source_run_id text,
  spot_engine_version text,
  spot_decision_snapshot jsonb not null default '{}'::jsonb,

  transition_minutes numeric not null,
  transition_return_percent numeric not null,
  session_open_price numeric,
  highest_price_after_early numeric not null,
  highest_price_at timestamptz not null,
  lowest_price_after_early numeric not null,
  lowest_price_at timestamptz not null,
  max_gain_from_early_percent numeric not null,
  max_drawdown_from_early_percent numeric not null,
  max_gain_from_spot_percent numeric not null,
  time_from_early_to_peak_minutes numeric not null,
  case_label text not null,
  status text not null default 'active',
  calibratable boolean not null default false,
  case_fingerprint jsonb not null default '{}'::jsonb,
  source_provenance jsonb not null default '{}'::jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (ticker, trading_date, methodology_version),
  unique (before_crowd_observation_id, spot_observation_id, methodology_version),
  check (source_kind = 'canonical_transition_case'),
  check (before_crowd_first_price > 0),
  check (spot_first_price > 0),
  check (spot_first_at > before_crowd_first_at),
  check (transition_minutes > 0),
  check (session_open_price is null or session_open_price > 0),
  check (highest_price_after_early >= before_crowd_first_price),
  check (lowest_price_after_early > 0 and lowest_price_after_early <= before_crowd_first_price),
  check (time_from_early_to_peak_minutes >= 0),
  check (status in ('active', 'complete', 'quarantined')),
  check (case_label in (
    'before_crowd_to_spot_explosion',
    'before_crowd_to_spot_continuation',
    'before_crowd_to_spot_failure',
    'before_crowd_to_spot_transition'
  ))
);

create index if not exists prox_strategy_transition_cases_date_idx
  on public.prox_strategy_transition_cases
  (trading_date desc, before_crowd_first_at asc);

create index if not exists prox_strategy_transition_cases_label_idx
  on public.prox_strategy_transition_cases
  (case_label, trading_date desc, max_gain_from_early_percent desc);

create table if not exists public.prox_strategy_transition_runs (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  observation_minute timestamptz not null,
  trading_date date not null,
  methodology_version text not null,
  source_pair_count int not null default 0,
  persisted_case_count int not null default 0,
  complete boolean not null default false,
  case_tickers jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (observation_minute, methodology_version),
  check (source_pair_count >= 0),
  check (persisted_case_count >= 0)
);

create index if not exists prox_strategy_transition_runs_time_idx
  on public.prox_strategy_transition_runs (observed_at desc);

-- Backfill every historical same-day Before The Crowd -> Spot Momentum
-- graduation from the immutable canonical observation history. Earliest
-- observations and prices are retained; later reruns only refresh outcomes.
with before_crowd_first as (
  select distinct on (observation.trading_date, observation.ticker)
    observation.*
  from public.ht_opportunity_observations observation
  where observation.strategy = 'before_the_crowd'
  order by observation.trading_date, observation.ticker, observation.observed_at asc
),
spot_first as (
  select distinct on (observation.trading_date, observation.ticker)
    observation.*
  from public.ht_opportunity_observations observation
  where observation.strategy = 'spot_momentum'
  order by observation.trading_date, observation.ticker, observation.observed_at asc
),
transition_source as (
  select
    before_observation.*,
    spot_observation.id as spot_observation_id,
    spot_observation.ledger_id as spot_ledger_id,
    spot_observation.observed_at as spot_observed_at,
    spot_observation.price as spot_price,
    spot_observation.role as spot_role,
    spot_observation.rank as spot_rank,
    spot_observation.score as spot_score,
    spot_observation.source_run_id as spot_source_run_id,
    spot_observation.engine_version as spot_engine_version,
    spot_observation.decision_snapshot as spot_decision_snapshot,
    greatest(
      before_ledger.highest_price_after_signal,
      spot_observation.price,
      before_observation.price
    ) as early_high,
    case
      when spot_observation.price > before_ledger.highest_price_after_signal
        then spot_observation.observed_at
      else before_ledger.highest_price_at
    end as early_high_at,
    least(
      before_ledger.lowest_price_after_signal,
      before_observation.price
    ) as early_low,
    case
      when before_observation.price < before_ledger.lowest_price_after_signal
        then before_observation.observed_at
      else before_ledger.lowest_price_at
    end as early_low_at,
    before_ledger.finalized_at as early_finalized_at
  from before_crowd_first before_observation
  join spot_first spot_observation
    on spot_observation.trading_date = before_observation.trading_date
    and spot_observation.ticker = before_observation.ticker
    and spot_observation.observed_at > before_observation.observed_at
  join public.ht_opportunity_ledger before_ledger
    on before_ledger.id = before_observation.ledger_id
)
insert into public.prox_strategy_transition_cases (
  ticker,
  trading_date,
  methodology_version,
  before_crowd_observation_id,
  before_crowd_ledger_id,
  before_crowd_first_at,
  before_crowd_first_price,
  before_crowd_first_role,
  before_crowd_first_rank,
  before_crowd_first_score,
  before_crowd_source_run_id,
  before_crowd_engine_version,
  before_crowd_decision_snapshot,
  spot_observation_id,
  spot_ledger_id,
  spot_first_at,
  spot_first_price,
  spot_first_role,
  spot_first_rank,
  spot_first_score,
  spot_source_run_id,
  spot_engine_version,
  spot_decision_snapshot,
  transition_minutes,
  transition_return_percent,
  session_open_price,
  highest_price_after_early,
  highest_price_at,
  lowest_price_after_early,
  lowest_price_at,
  max_gain_from_early_percent,
  max_drawdown_from_early_percent,
  max_gain_from_spot_percent,
  time_from_early_to_peak_minutes,
  case_label,
  status,
  calibratable,
  case_fingerprint,
  source_provenance,
  finalized_at
)
select
  source.ticker,
  source.trading_date,
  'prox-canonical-transition-v1',
  source.id,
  source.ledger_id,
  source.observed_at,
  source.price,
  source.role,
  source.rank,
  source.score,
  source.source_run_id,
  source.engine_version,
  source.decision_snapshot,
  source.spot_observation_id,
  source.spot_ledger_id,
  source.spot_observed_at,
  source.spot_price,
  source.spot_role,
  source.spot_rank,
  source.spot_score,
  source.spot_source_run_id,
  source.spot_engine_version,
  source.spot_decision_snapshot,
  round((extract(epoch from (source.spot_observed_at - source.observed_at)) / 60.0)::numeric, 1),
  round((((source.spot_price - source.price) / source.price) * 100)::numeric, 3),
  coalesce(
    case
      when jsonb_typeof(source.decision_snapshot -> 'sessionOpenPrice') = 'number'
        and (source.decision_snapshot ->> 'sessionOpenPrice')::numeric > 0
        then (source.decision_snapshot ->> 'sessionOpenPrice')::numeric
      else null
    end,
    case
      when jsonb_typeof(source.spot_decision_snapshot -> 'sessionOpenPrice') = 'number'
        and (source.spot_decision_snapshot ->> 'sessionOpenPrice')::numeric > 0
        then (source.spot_decision_snapshot ->> 'sessionOpenPrice')::numeric
      else null
    end
  ),
  source.early_high,
  source.early_high_at,
  source.early_low,
  source.early_low_at,
  round((((source.early_high - source.price) / source.price) * 100)::numeric, 3),
  round((((source.early_low - source.price) / source.price) * 100)::numeric, 3),
  round((((source.early_high - source.spot_price) / source.spot_price) * 100)::numeric, 3),
  greatest(
    0,
    round((extract(epoch from (source.early_high_at - source.observed_at)) / 60.0)::numeric, 1)
  ),
  case
    when ((source.early_high - source.price) / source.price) * 100 >= 100
      then 'before_crowd_to_spot_explosion'
    when ((source.early_high - source.price) / source.price) * 100 >= 20
      then 'before_crowd_to_spot_continuation'
    when ((source.early_high - source.price) / source.price) * 100 < 10
      and ((source.early_low - source.price) / source.price) * 100 <= -10
      then 'before_crowd_to_spot_failure'
    else 'before_crowd_to_spot_transition'
  end,
  case when source.early_finalized_at is null then 'active' else 'complete' end,
  false,
  jsonb_build_object(
    'sourceKind', 'canonical_transition_case',
    'ticker', source.ticker,
    'tradingDate', source.trading_date,
    'beforeCrowd', jsonb_build_object(
      'observedAt', source.observed_at,
      'price', source.price,
      'role', source.role,
      'rank', source.rank,
      'score', source.score,
      'decisionSnapshot', source.decision_snapshot
    ),
    'spotMomentum', jsonb_build_object(
      'observedAt', source.spot_observed_at,
      'price', source.spot_price,
      'role', source.spot_role,
      'rank', source.spot_rank,
      'score', source.spot_score,
      'decisionSnapshot', source.spot_decision_snapshot
    ),
    'transition', jsonb_build_object(
      'minutes', round((extract(epoch from (source.spot_observed_at - source.observed_at)) / 60.0)::numeric, 1),
      'returnPercent', round((((source.spot_price - source.price) / source.price) * 100)::numeric, 3)
    ),
    'observedOutcome', jsonb_build_object(
      'highestPrice', source.early_high,
      'highestAt', source.early_high_at,
      'lowestPrice', source.early_low,
      'lowestAt', source.early_low_at,
      'maxGainFromEarlyPercent', round((((source.early_high - source.price) / source.price) * 100)::numeric, 3),
      'maxDrawdownFromEarlyPercent', round((((source.early_low - source.price) / source.price) * 100)::numeric, 3),
      'maxGainFromSpotPercent', round((((source.early_high - source.spot_price) / source.spot_price) * 100)::numeric, 3)
    ),
    'caseLabel', case
      when ((source.early_high - source.price) / source.price) * 100 >= 100
        then 'before_crowd_to_spot_explosion'
      when ((source.early_high - source.price) / source.price) * 100 >= 20
        then 'before_crowd_to_spot_continuation'
      when ((source.early_high - source.price) / source.price) * 100 < 10
        and ((source.early_low - source.price) / source.price) * 100 <= -10
        then 'before_crowd_to_spot_failure'
      else 'before_crowd_to_spot_transition'
    end,
    'predictionAuthority', false,
    'publicScoreAuthority', false,
    'executionAuthority', false
  ),
  jsonb_build_object(
    'beforeCrowdObservationId', source.id,
    'spotObservationId', source.spot_observation_id,
    'beforeCrowdSourceRunId', source.source_run_id,
    'spotSourceRunId', source.spot_source_run_id,
    'beforeCrowdEngineVersion', source.engine_version,
    'spotEngineVersion', source.spot_engine_version,
    'authority', 'canonical_history_only'
  ),
  source.early_finalized_at
from transition_source source
on conflict (ticker, trading_date, methodology_version) do update set
  highest_price_after_early = excluded.highest_price_after_early,
  highest_price_at = excluded.highest_price_at,
  lowest_price_after_early = excluded.lowest_price_after_early,
  lowest_price_at = excluded.lowest_price_at,
  max_gain_from_early_percent = excluded.max_gain_from_early_percent,
  max_drawdown_from_early_percent = excluded.max_drawdown_from_early_percent,
  max_gain_from_spot_percent = excluded.max_gain_from_spot_percent,
  time_from_early_to_peak_minutes = excluded.time_from_early_to_peak_minutes,
  case_label = excluded.case_label,
  status = excluded.status,
  case_fingerprint = excluded.case_fingerprint,
  source_provenance = excluded.source_provenance,
  finalized_at = excluded.finalized_at,
  updated_at = now();

-- Migration receipt. The scheduled Outcome Memory cycle writes a fresh receipt
-- on every later run and keeps all active outcomes current.
with first_before_crowd as (
  select distinct on (observation.trading_date, observation.ticker)
    observation.trading_date,
    observation.ticker,
    observation.observed_at
  from public.ht_opportunity_observations observation
  where observation.strategy = 'before_the_crowd'
  order by observation.trading_date, observation.ticker, observation.observed_at asc
),
first_spot as (
  select distinct on (observation.trading_date, observation.ticker)
    observation.trading_date,
    observation.ticker,
    observation.observed_at
  from public.ht_opportunity_observations observation
  where observation.strategy = 'spot_momentum'
  order by observation.trading_date, observation.ticker, observation.observed_at asc
),
source_pairs as (
  select count(*)::int as source_pair_count
  from first_before_crowd before_observation
  join first_spot spot_observation
    on spot_observation.trading_date = before_observation.trading_date
    and spot_observation.ticker = before_observation.ticker
    and spot_observation.observed_at > before_observation.observed_at
),
persisted as (
  select count(*)::int as persisted_case_count
  from public.prox_strategy_transition_cases
  where methodology_version = 'prox-canonical-transition-v1'
)
insert into public.prox_strategy_transition_runs (
  observed_at,
  observation_minute,
  trading_date,
  methodology_version,
  source_pair_count,
  persisted_case_count,
  complete,
  case_tickers,
  diagnostics
)
select
  now(),
  date_trunc('minute', now()),
  (now() at time zone 'America/New_York')::date,
  'prox-canonical-transition-v1',
  source_pairs.source_pair_count,
  persisted.persisted_case_count,
  source_pairs.source_pair_count = persisted.persisted_case_count,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'ticker', transition.ticker,
      'tradingDate', transition.trading_date,
      'label', transition.case_label
    ) order by transition.trading_date desc, transition.ticker)
    from public.prox_strategy_transition_cases transition
    where transition.methodology_version = 'prox-canonical-transition-v1'
  ), '[]'::jsonb),
  jsonb_build_object(
    'authority', 'shadow_research_only',
    'source', 'canonical_observation_history',
    'historicalBackfill', true,
    'noPublicScore', true,
    'noExecutionAuthority', true
  )
from source_pairs, persisted
on conflict (observation_minute, methodology_version) do update set
  source_pair_count = excluded.source_pair_count,
  persisted_case_count = excluded.persisted_case_count,
  complete = excluded.complete,
  case_tickers = excluded.case_tickers,
  diagnostics = excluded.diagnostics,
  error_message = null,
  updated_at = now();

alter table public.prox_strategy_transition_cases enable row level security;
alter table public.prox_strategy_transition_runs enable row level security;

comment on table public.prox_strategy_transition_cases is
  'Auditable Before The Crowd to Spot Momentum graduation cases for Pro X pattern research; never a public score, direct Pro X discovery claim, or order instruction.';

comment on table public.prox_strategy_transition_runs is
  'Coverage receipts proving canonical transition pairs were materialized without silently dropping cases.';
