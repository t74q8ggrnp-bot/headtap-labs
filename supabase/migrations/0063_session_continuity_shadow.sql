-- Previous-close -> premarket/current-session -> Before the Crowd -> Spot
-- Momentum graduation research. This is an immutable, zero-authority shadow
-- ledger. It reuses the existing opportunity collector and adds no provider
-- request, browser poll, schedule, or trading authority.
begin;

create table if not exists public.ht_session_continuity_episodes (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  model_version text not null,
  source_before_crowd_ledger_id uuid not null references public.ht_opportunity_ledger(id) on delete restrict,
  first_seen_at timestamptz not null,
  provider_as_of timestamptz not null,
  first_seen_price numeric not null check (first_seen_price > 0),
  previous_close numeric not null check (previous_close > 0),
  session_open_price numeric,
  session_high_price numeric,
  gap_percent numeric,
  gap_retention_percent numeric,
  change_from_open_percent numeric,
  pullback_from_session_high_percent numeric,
  relative_volume numeric,
  momentum_score numeric,
  prox_state text,
  continuity_state text not null check (continuity_state in ('strong','developing','fading','new_today','unavailable')),
  eligible_for_graduation boolean not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  authority jsonb not null check (
    authority = '{"canonical":false,"prox":false,"agentRisk":false,"paper":false,"execution":false}'::jsonb
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique (trading_date, ticker, model_version)
);

create table if not exists public.ht_session_continuity_outcomes (
  episode_id uuid primary key references public.ht_session_continuity_episodes(id) on delete restrict,
  graduated_at timestamptz,
  graduated_price numeric,
  minutes_to_graduation numeric,
  graduated_within_15m boolean,
  graduated_within_30m boolean,
  graduated_within_45m boolean,
  graduated_within_60m boolean,
  graduated_by_market_open boolean,
  graduated_by_open_plus_30m boolean,
  status text not null default 'pending' check (status in ('pending','partial','complete','unavailable')),
  last_evaluated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ht_session_continuity_runs (
  observation_minute timestamptz primary key,
  trading_date date not null,
  expected_episode_count integer not null check (expected_episode_count >= 0),
  persisted_episode_count integer not null check (persisted_episode_count >= 0),
  failed_episode_count integer not null check (failed_episode_count >= 0),
  reconciled_episode_count integer not null default 0 check (reconciled_episode_count >= 0),
  provider_request_count integer not null default 0 check (provider_request_count = 0),
  error_receipts jsonb not null default '[]'::jsonb check (jsonb_typeof(error_receipts) = 'array'),
  completed_at timestamptz not null default clock_timestamp()
);

create index if not exists ht_session_continuity_episode_date_state_idx
  on public.ht_session_continuity_episodes(trading_date, continuity_state, eligible_for_graduation);
create index if not exists ht_session_continuity_episode_ticker_time_idx
  on public.ht_session_continuity_episodes(ticker, first_seen_at);
create index if not exists ht_session_continuity_outcome_status_idx
  on public.ht_session_continuity_outcomes(status, last_evaluated_at nulls first);

alter table public.ht_session_continuity_episodes enable row level security;
alter table public.ht_session_continuity_outcomes enable row level security;
alter table public.ht_session_continuity_runs enable row level security;

revoke all on public.ht_session_continuity_episodes from public, anon, authenticated;
revoke all on public.ht_session_continuity_outcomes from public, anon, authenticated;
revoke all on public.ht_session_continuity_runs from public, anon, authenticated;
grant select on public.ht_session_continuity_episodes to service_role;
grant select on public.ht_session_continuity_outcomes to service_role;
grant select on public.ht_session_continuity_runs to service_role;

create or replace function public.ht_session_continuity_immutable()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'HT session continuity episodes are immutable';
end $$;

drop trigger if exists ht_session_continuity_episodes_immutable on public.ht_session_continuity_episodes;
create trigger ht_session_continuity_episodes_immutable
before update or delete on public.ht_session_continuity_episodes
for each row execute function public.ht_session_continuity_immutable();

create or replace function public.ht_record_session_continuity_episode(
  p_trading_date date,
  p_ticker text,
  p_source_before_crowd_ledger_id uuid,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='2500ms'
as $$
declare
  normalized_ticker text := upper(trim(p_ticker));
  model_version text := p_receipt->>'version';
  episode_id uuid;
  inserted_episode boolean := false;
  source_row public.ht_opportunity_ledger%rowtype;
  already_spot boolean;
begin
  select l.* into source_row
  from public.ht_opportunity_ledger l
  where l.id = p_source_before_crowd_ledger_id
    and l.trading_date = p_trading_date
    and l.ticker = normalized_ticker
    and l.strategy = 'before_the_crowd';

  if source_row.id is null or
     normalized_ticker !~ '^[A-Z][A-Z0-9.-]{0,9}$' or
     model_version <> 'ht-session-continuity-shadow-v1' or
     p_receipt->>'state' not in ('strong','developing','fading','new_today','unavailable') or
     (p_receipt->>'previousClose')::numeric <= 0 or
     (p_receipt->>'providerAsOf')::timestamptz > clock_timestamp() + interval '2 seconds' or
     (p_receipt->>'providerAsOf')::timestamptz < clock_timestamp() - interval '7 days' or
     p_receipt->'authority' <> '{"canonical":false,"prox":false,"agentRisk":false,"paper":false,"execution":false}'::jsonb then
    raise exception 'Invalid HT session continuity receipt';
  end if;

  select exists(
    select 1
    from public.ht_opportunity_ledger spot
    where spot.trading_date = p_trading_date
      and spot.ticker = normalized_ticker
      and spot.strategy = 'spot_momentum'
      and spot.first_seen_at <= source_row.first_seen_at
  ) into already_spot;

  insert into public.ht_session_continuity_episodes(
    trading_date, ticker, model_version, source_before_crowd_ledger_id,
    first_seen_at, provider_as_of, first_seen_price, previous_close,
    session_open_price, session_high_price, gap_percent,
    gap_retention_percent, change_from_open_percent,
    pullback_from_session_high_percent, relative_volume, momentum_score,
    prox_state, continuity_state, eligible_for_graduation, receipt, authority
  ) values (
    p_trading_date, normalized_ticker, model_version,
    p_source_before_crowd_ledger_id, source_row.first_seen_at,
    (p_receipt->>'providerAsOf')::timestamptz, source_row.first_seen_price,
    (p_receipt->>'previousClose')::numeric,
    nullif(p_receipt->>'sessionOpenPrice','')::numeric,
    nullif(p_receipt->>'sessionHighPrice','')::numeric,
    nullif(p_receipt->>'gapPercent','')::numeric,
    nullif(p_receipt->>'gapRetentionPercent','')::numeric,
    nullif(p_receipt->>'changeFromOpenPercent','')::numeric,
    nullif(p_receipt->>'pullbackFromSessionHighPercent','')::numeric,
    nullif(p_receipt->>'relativeVolume','')::numeric,
    nullif(p_receipt->>'momentumScore','')::numeric,
    nullif(p_receipt->>'proxState',''), p_receipt->>'state', not already_spot,
    p_receipt, p_receipt->'authority'
  )
  on conflict(trading_date, ticker, model_version) do nothing
  returning id into episode_id;

  if episode_id is not null then
    inserted_episode := true;
    insert into public.ht_session_continuity_outcomes(episode_id)
    values (episode_id);
  else
    select e.id into episode_id
    from public.ht_session_continuity_episodes e
    where e.trading_date = p_trading_date
      and e.ticker = normalized_ticker
      and e.model_version = model_version;
  end if;

  return jsonb_build_object(
    'ok', true,
    'episodeId', episode_id,
    'insertedEpisode', inserted_episode,
    'eligibleForGraduation', not already_spot,
    'providerRequestsAdded', 0,
    'authority', 'research_only'
  );
end $$;

create or replace function public.ht_reconcile_session_continuity_outcomes(
  p_trading_date date,
  p_evaluated_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='4000ms'
as $$
declare
  affected integer := 0;
begin
  with episode_facts as (
    select
      e.id,
      e.first_seen_at,
      e.eligible_for_graduation,
      e.receipt->>'scanSession' as scan_session,
      (p_trading_date + time '09:30') at time zone 'America/New_York' as market_open,
      (
        select min(spot.first_seen_at)
        from public.ht_opportunity_ledger spot
        where spot.trading_date = e.trading_date
          and spot.ticker = e.ticker
          and spot.strategy = 'spot_momentum'
          and spot.first_seen_at >= e.first_seen_at
      ) as graduated_at,
      (
        select spot.first_seen_price
        from public.ht_opportunity_ledger spot
        where spot.trading_date = e.trading_date
          and spot.ticker = e.ticker
          and spot.strategy = 'spot_momentum'
          and spot.first_seen_at >= e.first_seen_at
        order by spot.first_seen_at
        limit 1
      ) as graduated_price
    from public.ht_session_continuity_episodes e
    where e.trading_date = p_trading_date
  ), resolved as (
    select
      f.*,
      extract(epoch from (f.graduated_at - f.first_seen_at)) / 60.0 as minutes_to_graduation,
      greatest(
        f.first_seen_at + interval '60 minutes',
        case when f.scan_session = 'pre_market'
          then f.market_open + interval '30 minutes'
          else f.first_seen_at + interval '60 minutes'
        end
      ) as completion_due_at
    from episode_facts f
  )
  update public.ht_session_continuity_outcomes o set
    graduated_at = case when r.eligible_for_graduation then r.graduated_at else null end,
    graduated_price = case when r.eligible_for_graduation then r.graduated_price else null end,
    minutes_to_graduation = case when r.eligible_for_graduation then r.minutes_to_graduation else null end,
    graduated_within_15m = case
      when not r.eligible_for_graduation then null
      when p_evaluated_at < r.first_seen_at + interval '15 minutes' and r.graduated_at is null then null
      else coalesce(r.minutes_to_graduation <= 15, false) end,
    graduated_within_30m = case
      when not r.eligible_for_graduation then null
      when p_evaluated_at < r.first_seen_at + interval '30 minutes' and r.graduated_at is null then null
      else coalesce(r.minutes_to_graduation <= 30, false) end,
    graduated_within_45m = case
      when not r.eligible_for_graduation then null
      when p_evaluated_at < r.first_seen_at + interval '45 minutes' and r.graduated_at is null then null
      else coalesce(r.minutes_to_graduation <= 45, false) end,
    graduated_within_60m = case
      when not r.eligible_for_graduation then null
      when p_evaluated_at < r.first_seen_at + interval '60 minutes' and r.graduated_at is null then null
      else coalesce(r.minutes_to_graduation <= 60, false) end,
    graduated_by_market_open = case
      when not r.eligible_for_graduation or r.scan_session <> 'pre_market' then null
      when p_evaluated_at < r.market_open and r.graduated_at is null then null
      else coalesce(r.graduated_at <= r.market_open, false) end,
    graduated_by_open_plus_30m = case
      when not r.eligible_for_graduation or r.scan_session <> 'pre_market' then null
      when p_evaluated_at < r.market_open + interval '30 minutes' and r.graduated_at is null then null
      else coalesce(r.graduated_at <= r.market_open + interval '30 minutes', false) end,
    status = case
      when not r.eligible_for_graduation then 'unavailable'
      when p_evaluated_at >= r.completion_due_at then 'complete'
      when p_evaluated_at >= r.first_seen_at + interval '15 minutes' or r.graduated_at is not null then 'partial'
      else 'pending' end,
    last_evaluated_at = p_evaluated_at,
    completed_at = case
      when p_evaluated_at >= r.completion_due_at then coalesce(o.completed_at, p_evaluated_at)
      else o.completed_at end,
    updated_at = clock_timestamp()
  from resolved r
  where o.episode_id = r.id;

  get diagnostics affected = row_count;
  return jsonb_build_object(
    'ok', true,
    'tradingDate', p_trading_date,
    'reconciledEpisodes', affected,
    'providerRequestsAdded', 0,
    'authority', 'research_only'
  );
end $$;

create or replace function public.ht_record_session_continuity_run(
  p_observation_minute timestamptz,
  p_trading_date date,
  p_expected integer,
  p_persisted integer,
  p_failed integer,
  p_reconciled integer,
  p_errors jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='1500ms'
as $$
begin
  if p_expected < 0 or p_persisted < 0 or p_failed < 0 or p_reconciled < 0 or
     p_persisted + p_failed <> p_expected or jsonb_typeof(p_errors) <> 'array' then
    raise exception 'Invalid HT session continuity run receipt';
  end if;
  insert into public.ht_session_continuity_runs(
    observation_minute, trading_date, expected_episode_count,
    persisted_episode_count, failed_episode_count, reconciled_episode_count,
    provider_request_count, error_receipts, completed_at
  ) values (
    p_observation_minute, p_trading_date, p_expected, p_persisted, p_failed,
    p_reconciled, 0, p_errors, clock_timestamp()
  ) on conflict(observation_minute) do update set
    expected_episode_count=excluded.expected_episode_count,
    persisted_episode_count=excluded.persisted_episode_count,
    failed_episode_count=excluded.failed_episode_count,
    reconciled_episode_count=excluded.reconciled_episode_count,
    provider_request_count=0,
    error_receipts=excluded.error_receipts,
    completed_at=clock_timestamp();
  return jsonb_build_object('ok',true,'providerRequestsAdded',0,'authority','research_only');
end $$;

create or replace function public.ht_session_continuity_health()
returns jsonb
language sql
stable
security definer
set search_path=''
set statement_timeout='3000ms'
as $$
  with horizon(name, ordinal) as (
    values ('15m'::text,1),('30m'::text,2),('45m'::text,3),('60m'::text,4),('market_open'::text,5),('open_plus_30m'::text,6)
  ), episode_outcomes as (
    select e.*, o.*
    from public.ht_session_continuity_episodes e
    join public.ht_session_continuity_outcomes o on o.episode_id=e.id
    where e.model_version='ht-session-continuity-shadow-v1'
  ), horizon_counts as (
    select h.name, h.ordinal,
      count(*) filter (where h.name not in ('market_open','open_plus_30m') or eo.receipt->>'scanSession'='pre_market')::integer as expected,
      count(*) filter (where
        case h.name
          when '15m' then eo.graduated_within_15m
          when '30m' then eo.graduated_within_30m
          when '45m' then eo.graduated_within_45m
          when '60m' then eo.graduated_within_60m
          when 'market_open' then eo.graduated_by_market_open
          else eo.graduated_by_open_plus_30m end is not null
      )::integer as measured,
      count(*) filter (where
        case h.name
          when '15m' then eo.graduated_within_15m
          when '30m' then eo.graduated_within_30m
          when '45m' then eo.graduated_within_45m
          when '60m' then eo.graduated_within_60m
          when 'market_open' then eo.graduated_by_market_open
          else eo.graduated_by_open_plus_30m end is true
      )::integer as graduated,
      count(*) filter (where eo.status='unavailable' and (h.name not in ('market_open','open_plus_30m') or eo.receipt->>'scanSession'='pre_market'))::integer as unavailable
    from horizon h cross join episode_outcomes eo
    group by h.name,h.ordinal
  ), run_totals as (
    select
      coalesce(sum(expected_episode_count),0)::integer as expected,
      coalesce(sum(persisted_episode_count),0)::integer as persisted,
      coalesce(sum(failed_episode_count),0)::integer as failed,
      max(completed_at) as latest_run_at
    from public.ht_session_continuity_runs
  )
  select jsonb_build_object(
    'version','ht-session-continuity-health-v1',
    'modelVersion','ht-session-continuity-shadow-v1',
    'authority','research_only',
    'primaryProductImpact',false,
    'providerRequestsAdded',0,
    'episodes',(select count(*) from episode_outcomes),
    'eligibleEpisodes',(select count(*) from episode_outcomes where eligible_for_graduation),
    'graduatedEpisodes',(select count(*) from episode_outcomes where eligible_for_graduation and graduated_at is not null),
    'runs',jsonb_build_object(
      'expected',run_totals.expected,
      'persisted',run_totals.persisted,
      'failed',run_totals.failed,
      'latestAt',run_totals.latest_run_at
    ),
    'horizons',coalesce((
      select jsonb_object_agg(name,jsonb_build_object(
        'expected',expected,
        'measured',measured,
        'graduated',graduated,
        'pending',greatest(expected-measured-unavailable,0),
        'unavailable',unavailable
      ) order by ordinal) from horizon_counts
    ),'{}'::jsonb)
  ) from run_totals;
$$;

revoke all on function public.ht_record_session_continuity_episode(date,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.ht_reconcile_session_continuity_outcomes(date,timestamptz) from public, anon, authenticated;
revoke all on function public.ht_record_session_continuity_run(timestamptz,date,integer,integer,integer,integer,jsonb) from public, anon, authenticated;
revoke all on function public.ht_session_continuity_health() from public, anon, authenticated;
grant execute on function public.ht_record_session_continuity_episode(date,text,uuid,jsonb) to service_role;
grant execute on function public.ht_reconcile_session_continuity_outcomes(date,timestamptz) to service_role;
grant execute on function public.ht_record_session_continuity_run(timestamptz,date,integer,integer,integer,integer,jsonb) to service_role;
grant execute on function public.ht_session_continuity_health() to service_role;

comment on table public.ht_session_continuity_episodes is
  'Immutable research receipts for previous-close/current-session continuity and Before the Crowd to Spot Momentum graduation. Zero trading authority.';
comment on table public.ht_session_continuity_outcomes is
  'Deterministic 15m/30m/45m/60m and premarket-open graduation outcomes. Reconciled from the existing Canonical ledger with zero provider requests.';

notify pgrst,'reload schema';
commit;
