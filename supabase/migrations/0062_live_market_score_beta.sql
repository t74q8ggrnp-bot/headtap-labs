-- Live, visible, research-only HT Market Score Beta receipts.
-- This score is not the Canonical opportunity score and has no ProX, Agent
-- risk, Paper, or execution authority. Provider evidence is supplied only by
-- the existing server-side market-chart feed; this migration adds no provider
-- request or schedule.
begin;

create table if not exists public.ht_market_score_states (
  symbol text primary key check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  asset_kind text not null check (asset_kind in ('stock','etf','unknown')),
  model_version text not null,
  provider_as_of timestamptz not null,
  bars jsonb not null check (jsonb_typeof(bars) = 'array' and jsonb_array_length(bars) between 20 and 1000),
  quote jsonb not null check (jsonb_typeof(quote) = 'object'),
  score_receipt jsonb not null check (jsonb_typeof(score_receipt) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ht_market_score_observations (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  asset_kind text not null check (asset_kind in ('stock','etf','unknown')),
  model_version text not null,
  observed_bucket timestamptz not null,
  provider_as_of timestamptz not null,
  observed_price numeric not null check (observed_price > 0),
  market_score integer not null check (market_score between 0 and 100),
  score_state text not null check (score_state in ('strong','constructive','mixed','weakening','weak')),
  components jsonb not null check (jsonb_typeof(components) = 'object'),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  authority jsonb not null check (
    authority = '{"canonical":false,"prox":false,"agentRisk":false,"paper":false,"execution":false}'::jsonb
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (symbol, model_version, observed_bucket)
);

create table if not exists public.ht_market_score_outcomes (
  observation_id uuid primary key references public.ht_market_score_observations(id) on delete restrict,
  return_5m_percent numeric,
  return_15m_percent numeric,
  return_60m_percent numeric,
  max_favorable_percent numeric,
  max_adverse_percent numeric,
  status text not null default 'pending' check (status in ('pending','partial','complete','unavailable')),
  last_evaluated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists ht_market_score_observations_symbol_time_idx
  on public.ht_market_score_observations(symbol, provider_as_of desc);
create index if not exists ht_market_score_observations_cohort_idx
  on public.ht_market_score_observations(model_version, asset_kind, provider_as_of desc);
create index if not exists ht_market_score_outcomes_status_idx
  on public.ht_market_score_outcomes(status, last_evaluated_at nulls first);

alter table public.ht_market_score_states enable row level security;
alter table public.ht_market_score_observations enable row level security;
alter table public.ht_market_score_outcomes enable row level security;

revoke all on public.ht_market_score_states from public, anon, authenticated;
revoke all on public.ht_market_score_observations from public, anon, authenticated;
revoke all on public.ht_market_score_outcomes from public, anon, authenticated;
grant select on public.ht_market_score_states to service_role;
grant select on public.ht_market_score_observations to service_role;
grant select on public.ht_market_score_outcomes to service_role;

create or replace function public.ht_record_market_score_frame(
  p_symbol text,
  p_asset_kind text,
  p_provider_as_of timestamptz,
  p_bars jsonb,
  p_quote jsonb,
  p_score_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='2500ms'
as $$
declare
  normalized_symbol text := upper(trim(p_symbol));
  observation_bucket timestamptz := date_trunc('minute', p_provider_as_of);
  observation_id uuid;
  inserted_observation boolean := false;
begin
  if normalized_symbol !~ '^[A-Z][A-Z0-9.-]{0,9}$' or
     p_asset_kind not in ('stock','etf','unknown') or
     p_provider_as_of > clock_timestamp() + interval '2 seconds' or
     p_provider_as_of < clock_timestamp() - interval '7 days' or
     jsonb_typeof(p_bars) <> 'array' or jsonb_array_length(p_bars) not between 20 and 1000 or
     jsonb_typeof(p_quote) <> 'object' or jsonb_typeof(p_score_receipt) <> 'object' or
     p_score_receipt->>'version' <> 'ht-market-score-beta-v1' or
     p_score_receipt->>'receiptState' <> 'persisted' or
     (p_score_receipt->>'providerAsOf')::timestamptz <> p_provider_as_of or
     coalesce((p_score_receipt->>'score')::integer, -1) not between 0 and 100 or
     p_score_receipt->'authority' <> '{"canonical":false,"prox":false,"agentRisk":false,"paper":false,"execution":false}'::jsonb then
    raise exception 'Invalid HT Market Score Beta frame';
  end if;

  insert into public.ht_market_score_states(
    symbol, asset_kind, model_version, provider_as_of, bars, quote, score_receipt, updated_at
  ) values (
    normalized_symbol, p_asset_kind, p_score_receipt->>'version', p_provider_as_of,
    p_bars, p_quote, p_score_receipt, clock_timestamp()
  )
  on conflict(symbol) do update set
    asset_kind=excluded.asset_kind,
    model_version=excluded.model_version,
    provider_as_of=excluded.provider_as_of,
    bars=excluded.bars,
    quote=excluded.quote,
    score_receipt=excluded.score_receipt,
    updated_at=clock_timestamp()
  where excluded.provider_as_of >= public.ht_market_score_states.provider_as_of;

  insert into public.ht_market_score_observations(
    symbol, asset_kind, model_version, observed_bucket, provider_as_of,
    observed_price, market_score, score_state, components, inputs, authority
  ) values (
    normalized_symbol, p_asset_kind, p_score_receipt->>'version', observation_bucket,
    p_provider_as_of, (p_score_receipt->>'observedPrice')::numeric,
    (p_score_receipt->>'score')::integer, p_score_receipt->>'state',
    p_score_receipt->'components', p_score_receipt->'inputs', p_score_receipt->'authority'
  )
  on conflict(symbol, model_version, observed_bucket) do nothing
  returning id into observation_id;

  if observation_id is not null then
    inserted_observation := true;
    insert into public.ht_market_score_outcomes(observation_id) values (observation_id);
  else
    select o.id into observation_id
    from public.ht_market_score_observations o
    where o.symbol=normalized_symbol
      and o.model_version=p_score_receipt->>'version'
      and o.observed_bucket=observation_bucket;
  end if;

  return jsonb_build_object(
    'ok', true,
    'observationId', observation_id,
    'insertedObservation', inserted_observation,
    'providerAsOf', p_provider_as_of,
    'providerRequestsAdded', 0,
    'authority', 'research_only'
  );
end $$;

create or replace function public.ht_update_market_score_outcome(
  p_observation_id uuid,
  p_return_5m_percent numeric,
  p_return_15m_percent numeric,
  p_return_60m_percent numeric,
  p_max_favorable_percent numeric,
  p_max_adverse_percent numeric,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='1500ms'
as $$
begin
  if p_status not in ('pending','partial','complete','unavailable') then
    raise exception 'Invalid HT Market Score outcome status';
  end if;
  update public.ht_market_score_outcomes set
    return_5m_percent=coalesce(return_5m_percent, p_return_5m_percent),
    return_15m_percent=coalesce(return_15m_percent, p_return_15m_percent),
    return_60m_percent=coalesce(return_60m_percent, p_return_60m_percent),
    max_favorable_percent=p_max_favorable_percent,
    max_adverse_percent=p_max_adverse_percent,
    status=p_status,
    last_evaluated_at=clock_timestamp(),
    completed_at=case when p_status='complete' then coalesce(completed_at,clock_timestamp()) else completed_at end,
    updated_at=clock_timestamp()
  where observation_id=p_observation_id;
  if not found then raise exception 'Unknown HT Market Score observation'; end if;
  return jsonb_build_object('ok',true,'observationId',p_observation_id,'status',p_status,'providerRequestsAdded',0);
end $$;

create or replace function public.ht_market_score_beta_health()
returns jsonb
language sql
stable
security definer
set search_path=''
set statement_timeout='3000ms'
as $$
  with cohorts(asset_kind) as (
    values ('stock'::text), ('etf'::text), ('unknown'::text)
  ), aggregate_counts as (
    select
      o.asset_kind,
      count(*)::integer as observation_count,
      max(o.provider_as_of) as latest_provider_as_of,
      count(*) filter (where x.return_5m_percent is not null)::integer as measured_5m,
      count(*) filter (where x.return_5m_percent is null and x.status <> 'unavailable')::integer as pending_5m,
      count(*) filter (where x.return_5m_percent is null and x.status = 'unavailable')::integer as unavailable_5m,
      count(*) filter (where x.return_15m_percent is not null)::integer as measured_15m,
      count(*) filter (where x.return_15m_percent is null and x.status <> 'unavailable')::integer as pending_15m,
      count(*) filter (where x.return_15m_percent is null and x.status = 'unavailable')::integer as unavailable_15m,
      count(*) filter (where x.return_60m_percent is not null)::integer as measured_60m,
      count(*) filter (where x.return_60m_percent is null and x.status <> 'unavailable')::integer as pending_60m,
      count(*) filter (where x.return_60m_percent is null and x.status = 'unavailable')::integer as unavailable_60m
    from public.ht_market_score_observations o
    join public.ht_market_score_outcomes x on x.observation_id = o.id
    where o.model_version = 'ht-market-score-beta-v1'
    group by o.asset_kind
  ), cohort_receipts as (
    select jsonb_object_agg(
      c.asset_kind,
      jsonb_build_object(
        'observations', coalesce(a.observation_count, 0),
        'latestProviderAsOf', a.latest_provider_as_of,
        'horizons', jsonb_build_object(
          '5m', jsonb_build_object(
            'measured', coalesce(a.measured_5m, 0),
            'pending', coalesce(a.pending_5m, 0),
            'unavailable', coalesce(a.unavailable_5m, 0)
          ),
          '15m', jsonb_build_object(
            'measured', coalesce(a.measured_15m, 0),
            'pending', coalesce(a.pending_15m, 0),
            'unavailable', coalesce(a.unavailable_15m, 0)
          ),
          '60m', jsonb_build_object(
            'measured', coalesce(a.measured_60m, 0),
            'pending', coalesce(a.pending_60m, 0),
            'unavailable', coalesce(a.unavailable_60m, 0)
          )
        )
      )
    ) as cohorts
    from cohorts c
    left join aggregate_counts a on a.asset_kind = c.asset_kind
  )
  select jsonb_build_object(
    'version', 'ht-market-score-beta-health-v1',
    'modelVersion', 'ht-market-score-beta-v1',
    'authority', 'research_only',
    'primaryProductImpact', false,
    'providerRequestsAdded', 0,
    'observations', coalesce((select sum(observation_count) from aggregate_counts), 0),
    'latestProviderAsOf', (select max(latest_provider_as_of) from aggregate_counts),
    'cohorts', cohort_receipts.cohorts
  )
  from cohort_receipts;
$$;

revoke all on function public.ht_record_market_score_frame(text,text,timestamptz,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.ht_update_market_score_outcome(uuid,numeric,numeric,numeric,numeric,numeric,text) from public, anon, authenticated;
revoke all on function public.ht_market_score_beta_health() from public, anon, authenticated;
grant execute on function public.ht_record_market_score_frame(text,text,timestamptz,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.ht_update_market_score_outcome(uuid,numeric,numeric,numeric,numeric,numeric,text) to service_role;
grant execute on function public.ht_market_score_beta_health() to service_role;

comment on table public.ht_market_score_observations is
  'Immutable minute-bucket receipts for the live HT Market Score Beta. Not a Canonical opportunity score and no trading authority.';
comment on table public.ht_market_score_outcomes is
  'Forward 5m/15m/60m measurements for Market Score Beta calibration, populated only from already-fetched provider bars.';

notify pgrst,'reload schema';
commit;
