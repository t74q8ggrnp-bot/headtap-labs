-- Session Continuity research persistence repair.
--
-- Migration 0063 used a PL/pgSQL variable named model_version while the
-- insert conflict target and episode lookup also referenced a model_version
-- column. PostgreSQL rejected that ambiguity with 42702. This forward-only
-- repair renames the variable and fully qualifies the lookup. It preserves
-- every immutable episode, outcome, run, and failure receipt; adds no provider
-- requests; and changes no Canonical, ProX, Agent, Paper, risk, or execution
-- authority.
begin;

do $$ begin
  if to_regclass('public.ht_session_continuity_episodes') is null or
     to_regclass('public.ht_session_continuity_outcomes') is null or
     to_regclass('public.ht_session_continuity_runs') is null then
    raise exception 'Apply migration 0063 first';
  end if;
end $$;

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
  v_model_version text := p_receipt->>'version';
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
     v_model_version <> 'ht-session-continuity-shadow-v1' or
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
    p_trading_date, normalized_ticker, v_model_version,
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
    from public.ht_session_continuity_episodes as e
    where e.trading_date = p_trading_date
      and e.ticker = normalized_ticker
      and e.model_version = v_model_version;
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

revoke all on function public.ht_record_session_continuity_episode(date,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.ht_record_session_continuity_episode(date,text,uuid,jsonb)
  to service_role;

comment on function public.ht_record_session_continuity_episode(date,text,uuid,jsonb) is
  'Persists immutable Session Continuity shadow receipts with zero live authority or provider requests; repaired by migration 0065.';

commit;
