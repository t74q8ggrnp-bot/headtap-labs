-- Additive crypto research repair. Never enables collection or changes stock/public ranks.
-- Preserve old evidence verbatim; prohibit further processing-time outcome writes.
begin;

create table if not exists public.ht_crypto_outcome_source_policy (
  source_table text primary key check (source_table in ('ht_crypto_prox_observations','ht_crypto_discovery_observations')),
  evaluation_allowed boolean not null default false check (evaluation_allowed = false),
  reason text not null default 'legacy_entry_and_horizon_provider_times_unverified',
  policy_version text not null default 'crypto-outcome-integrity-v2',
  quarantined_at timestamptz not null default now()
);
insert into public.ht_crypto_outcome_source_policy(source_table)
values ('ht_crypto_prox_observations'), ('ht_crypto_discovery_observations') on conflict do nothing;
alter table public.ht_crypto_outcome_source_policy enable row level security;
revoke all on public.ht_crypto_outcome_source_policy from public, anon, authenticated, service_role;
grant select on public.ht_crypto_outcome_source_policy to service_role;

create or replace function public.ht_crypto_guard_legacy_outcomes()
returns trigger language plpgsql set search_path = '' as $$
declare key text; before_row jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
begin
  for key in select jsonb_object_keys(to_jsonb(NEW)) loop
    if key ~ '^(price|return)_(15m|1h|4h|24h)(_usd|_percent)?$' and
       (to_jsonb(NEW)->key) is distinct from coalesce(before_row->key, 'null'::jsonb) then
      raise exception 'Legacy crypto outcomes are quarantined; use exact provider-time research evidence';
    end if;
  end loop;
  return NEW;
end $$;
drop trigger if exists ht_crypto_legacy_outcome_guard on public.ht_crypto_prox_observations;
create trigger ht_crypto_legacy_outcome_guard before insert or update on public.ht_crypto_prox_observations
  for each row execute function public.ht_crypto_guard_legacy_outcomes();
drop trigger if exists ht_crypto_legacy_outcome_guard on public.ht_crypto_discovery_observations;
create trigger ht_crypto_legacy_outcome_guard before insert or update on public.ht_crypto_discovery_observations
  for each row execute function public.ht_crypto_guard_legacy_outcomes();

create or replace view public.ht_crypto_legacy_outcome_quarantine with (security_invoker = true) as
select 'ht_crypto_prox_observations'::text as source_table, id as observation_id, observed_at,
  false as evaluation_eligible, 'legacy_entry_and_horizon_provider_times_unverified'::text as reason
from public.ht_crypto_prox_observations
union all
select 'ht_crypto_discovery_observations', id, observed_at, false,
  'legacy_entry_and_horizon_provider_times_unverified'
from public.ht_crypto_discovery_observations;
revoke all on public.ht_crypto_legacy_outcome_quarantine from public, anon, authenticated;
grant select on public.ht_crypto_legacy_outcome_quarantine to service_role;

create table if not exists public.ht_crypto_research_books (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.ht_coinapi_pilot_cycles(id),
  market_id text not null check (market_id ~ '^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]+_USD$'),
  provider_at timestamptz not null,
  received_at timestamptz not null,
  bid numeric not null check (bid > 0 and bid < 'Infinity'::numeric),
  ask numeric not null check (ask > 0 and ask < 'Infinity'::numeric and ask >= bid),
  bid_size numeric check (bid_size >= 0 and bid_size < 'Infinity'::numeric),
  ask_size numeric check (ask_size >= 0 and ask_size < 'Infinity'::numeric),
  source_version text not null default 'coinapi-provider-book-ledger-v1',
  unique(cycle_id,market_id),
  check (provider_at <= received_at)
);
create index if not exists ht_crypto_research_books_horizon on public.ht_crypto_research_books(market_id,provider_at desc);

create table if not exists public.ht_crypto_research_episodes (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.ht_coinapi_pilot_cycles(id),
  market_id text not null,
  episode_hour timestamptz not null,
  decision_at timestamptz not null,
  input_evidence jsonb,
  research_decision jsonb,
  policy_version text not null,
  entry_book_id uuid references public.ht_crypto_research_books(id),
  entry_status text not null check (entry_status in ('verified','unavailable')),
  entry_reason text,
  unique(market_id,episode_hour),
  check ((entry_status = 'verified') = (entry_book_id is not null))
);

create table if not exists public.ht_crypto_research_outcomes (
  episode_id uuid not null references public.ht_crypto_research_episodes(id),
  horizon_seconds integer not null check (horizon_seconds in (300,900,1800,3600)),
  target_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','observed','unavailable')),
  reason text,
  exit_book_id uuid references public.ht_crypto_research_books(id),
  resolved_at timestamptz,
  gross_quote_return_percent numeric,
  primary key(episode_id,horizon_seconds),
  check ((status = 'observed') = (exit_book_id is not null and gross_quote_return_percent is not null)),
  check (status <> 'unavailable' or (exit_book_id is null and gross_quote_return_percent is null)),
  check (status = 'pending' or resolved_at is not null)
);
create index if not exists ht_crypto_research_outcomes_pending on public.ht_crypto_research_outcomes(target_at) where status = 'pending';
alter table public.ht_crypto_research_books enable row level security;
alter table public.ht_crypto_research_episodes enable row level security;
alter table public.ht_crypto_research_outcomes enable row level security;
revoke all on public.ht_crypto_research_books, public.ht_crypto_research_episodes,
  public.ht_crypto_research_outcomes from public, anon, authenticated, service_role;
grant select on public.ht_crypto_research_books, public.ht_crypto_research_episodes,
  public.ht_crypto_research_outcomes to service_role;

-- Resolve only saved exact-market books at or up to five seconds BEFORE target.
-- Wait 90 seconds for delayed receipts; current-price substitution is impossible.
create or replace function public.ht_coinapi_resolve_saved_outcomes(p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; b public.ht_crypto_research_books%rowtype; n integer := 0; conflicting boolean;
begin
  for r in select o.*, e.market_id, e.entry_book_id, entry.ask as entry_ask
    from public.ht_crypto_research_outcomes o
    join public.ht_crypto_research_episodes e on e.id = o.episode_id
    left join public.ht_crypto_research_books entry on entry.id = e.entry_book_id
    where o.status = 'pending' and o.target_at <= p_now - interval '90 seconds'
    order by o.target_at limit 2000 for update of o skip locked
  loop
    select * into b from public.ht_crypto_research_books
      where market_id = r.market_id and provider_at between r.target_at - interval '5 seconds' and r.target_at
        and received_at <= p_now
      order by provider_at desc, received_at asc, id limit 1;
    if b.id is null or r.entry_book_id is null then
      update public.ht_crypto_research_outcomes set status = 'unavailable',
        reason = case when r.entry_book_id is null then 'unverified_entry_book' else 'no_book_at_exact_horizon' end,
        resolved_at = p_now where episode_id = r.episode_id and horizon_seconds = r.horizon_seconds;
    else
      select exists(select 1 from public.ht_crypto_research_books x where x.market_id = r.market_id and
        x.provider_at = b.provider_at and x.received_at <= p_now and
        (x.bid <> b.bid or x.ask <> b.ask or x.bid_size is distinct from b.bid_size or x.ask_size is distinct from b.ask_size)) into conflicting;
      update public.ht_crypto_research_outcomes set status = case when conflicting then 'unavailable' else 'observed' end,
        reason = case when conflicting then 'conflicting_horizon_books' else null end,
        exit_book_id = case when conflicting then null else b.id end,
        gross_quote_return_percent = case when conflicting then null else (b.bid / r.entry_ask - 1) * 100 end,
        resolved_at = p_now where episode_id = r.episode_id and horizon_seconds = r.horizon_seconds;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Capture inside the existing atomic publication transaction. No extra provider
-- request, scheduler, entitlement, budget, or order permissions are introduced.
create or replace function public.ht_coinapi_capture_research_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare q jsonb; mid text; t timestamptz; book_time timestamptz; evidence jsonb; decision jsonb;
  entry_id uuid; episode_id uuid; verified boolean; h integer; entry_book public.ht_crypto_research_books%rowtype;
begin
  if NEW.status <> 'complete' or OLD.status = 'complete' then return NEW; end if;
  -- Old pilot frames lack this evidence contract; never retroactively bless them.
  if NEW.frame->>'dataContractVersion' is distinct from 'coinapi-research-data-v2' then return NEW; end if;
  t := (NEW.frame->>'decisionAt')::timestamptz;
  if t is null or t > clock_timestamp() + interval '2 seconds' or NEW.frame->>'provider' is distinct from 'coinapi' then
    raise exception 'Invalid research evidence clock/provider';
  end if;
  for q in select value from jsonb_array_elements(NEW.frame->'quotes') loop
    mid := q->>'marketId';
    -- Full broad quote coverage already lives in the immutable publication.
    -- Index only selected/recent episode markets here to avoid duplicating the
    -- entire exchange universe into per-book rows every minute.
    if not coalesce((NEW.frame->'selectedMarkets') ? mid,false) and not exists (
      select 1 from public.ht_crypto_research_episodes e where e.market_id = mid
        and e.decision_at between t - interval '62 minutes' and t
    ) then continue; end if;
    if q->'book' is null or q->'book' = 'null'::jsonb then continue; end if;
    if q->'book'->>'symbolId' is distinct from mid then raise exception 'Research book market identity mismatch'; end if;
    book_time := (q->'book'->>'asOf')::timestamptz;
    if book_time is null or book_time > t or (q->'failures') ? 'conflicting_quote_versions' then continue; end if;
    insert into public.ht_crypto_research_books(cycle_id,market_id,provider_at,received_at,bid,ask,bid_size,ask_size)
    values(NEW.id,mid,book_time,t,(q->'book'->>'bid')::numeric,(q->'book'->>'ask')::numeric,
      (q->'book'->>'bidSize')::numeric,(q->'book'->>'askSize')::numeric);
  end loop;
  for mid in select value from jsonb_array_elements_text(NEW.frame->'selectedMarkets') loop
    select value into evidence from jsonb_array_elements(NEW.frame->'evidence') where value->'identity'->>'marketId' = mid;
    select value into decision from jsonb_array_elements(NEW.frame->'research'->'decisions') where value->'identity'->>'marketId' = mid;
    select * into entry_book from public.ht_crypto_research_books where cycle_id = NEW.id and market_id = mid
      and provider_at between t - interval '15 seconds' and t;
    entry_id := entry_book.id;
    verified := entry_id is not null and evidence is not null and evidence->'identity'->>'provider' = 'coinapi'
      and evidence->'identity'->>'quote' = 'USD' and evidence->'identity'->>'base' = split_part(mid,'_',3)
      and (evidence->'book'->>'asOf')::timestamptz = entry_book.provider_at
      and (evidence->'book'->>'bid')::numeric = entry_book.bid and (evidence->'book'->>'ask')::numeric = entry_book.ask and
      (evidence->'trade'->>'asOf')::timestamptz between t - interval '30 seconds' and t and
      abs(extract(epoch from ((evidence->'trade'->>'asOf')::timestamptz - (evidence->'book'->>'asOf')::timestamptz))) <= 15;
    if not coalesce(verified,false) then entry_id := null; end if;
    episode_id := null;
    insert into public.ht_crypto_research_episodes(cycle_id,market_id,episode_hour,decision_at,input_evidence,
      research_decision,policy_version,entry_book_id,entry_status,entry_reason)
    values(NEW.id,mid,date_trunc('hour',t at time zone 'UTC') at time zone 'UTC',t,evidence,decision,
      coalesce(decision->>'policyVersion','crypto-live-research-v1'),entry_id,
      case when entry_id is null then 'unavailable' else 'verified' end,
      case when entry_id is null then 'unverified_entry_book' else null end)
    on conflict(market_id,episode_hour) do nothing returning id into episode_id;
    if episode_id is not null then
      foreach h in array ARRAY[300,900,1800,3600] loop
        insert into public.ht_crypto_research_outcomes(episode_id,horizon_seconds,target_at,status,reason,resolved_at)
        values(episode_id,h,t + make_interval(secs => h),
          case when entry_id is null then 'unavailable' else 'pending' end,
          case when entry_id is null then 'unverified_entry_book' else null end,
          case when entry_id is null then t else null end);
      end loop;
    end if;
  end loop;
  perform public.ht_coinapi_resolve_saved_outcomes(t);
  return NEW;
end $$;
drop trigger if exists ht_coinapi_capture_evidence on public.ht_coinapi_pilot_cycles;
create trigger ht_coinapi_capture_evidence after update of status on public.ht_coinapi_pilot_cycles
  for each row execute function public.ht_coinapi_capture_research_evidence();

-- Unbilled maintenance still drains saved evidence when the credit cap pauses
-- collection. Callers cannot supply a future clock to manufacture due outcomes.
create or replace function public.ht_coinapi_research_maintenance()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return jsonb_build_object('resolved',public.ht_coinapi_resolve_saved_outcomes(clock_timestamp()),
    'providerRequests',0,'executionAuthorized',false);
end $$;
revoke all on function public.ht_coinapi_research_maintenance() from public, anon, authenticated;
grant execute on function public.ht_coinapi_research_maintenance() to service_role;

-- A conflicting provider revision can arrive AFTER a horizon is resolved.
-- Preserve the original ledger row, but never expose it as verified evidence.
create or replace view public.ht_crypto_verified_research_outcomes with (security_invoker = true) as
with checked as (
  select o.*, exists (
    select 1 from public.ht_crypto_research_books selected
    join public.ht_crypto_research_books other on other.market_id = selected.market_id and other.provider_at = selected.provider_at
    where selected.id in (o.exit_book_id,e.entry_book_id) and
      (other.bid <> selected.bid or other.ask <> selected.ask or
       other.bid_size is distinct from selected.bid_size or other.ask_size is distinct from selected.ask_size)
  ) as conflict
  from public.ht_crypto_research_outcomes o
  join public.ht_crypto_research_episodes e on e.id = o.episode_id
)
select episode_id,horizon_seconds,target_at,
  case when conflict then 'unavailable' else status end as status,
  case when conflict then 'conflicting_entry_or_horizon_evidence' else reason end as reason,
  case when conflict then null else exit_book_id end as exit_book_id,resolved_at,
  case when conflict then null else gross_quote_return_percent end as gross_quote_return_percent,
  status as recorded_status, conflict as quarantined, status = 'observed' and not conflict as evaluation_eligible
from checked;
revoke all on public.ht_crypto_verified_research_outcomes from public, anon, authenticated;
grant select on public.ht_crypto_verified_research_outcomes to service_role;

-- Explicit read-only summary: gross quote returns are NOT net/filled profits.
create or replace view public.ht_crypto_research_readiness with (security_invoker = true) as
select 'coinapi-provider-book-ledger-v1'::text as source_version,
  (select count(*) from public.ht_crypto_research_books) as saved_books,
  (select count(*) from public.ht_crypto_research_episodes) as episodes,
  (select count(*) from public.ht_crypto_verified_research_outcomes where evaluation_eligible) as observed_horizons,
  (select count(*) from public.ht_crypto_verified_research_outcomes where status = 'unavailable') as unavailable_horizons,
  (select count(*) from public.ht_crypto_research_outcomes where status = 'pending') as pending_horizons,
  (select count(*) from public.ht_crypto_research_outcomes where status = 'pending' and target_at < now() - interval '90 seconds') as overdue_horizons,
  false as execution_authorized, false as profitability_established,
  (select count(*) from public.ht_crypto_verified_research_outcomes where quarantined) as quarantined_horizons;
revoke all on public.ht_crypto_research_readiness from public, anon, authenticated;
grant select on public.ht_crypto_research_readiness to service_role;
revoke all on function public.ht_crypto_guard_legacy_outcomes(),
  public.ht_coinapi_capture_research_evidence(), public.ht_coinapi_resolve_saved_outcomes(timestamptz)
  from public, anon, authenticated, service_role;

comment on table public.ht_crypto_research_outcomes is
  'Exact-market historical quote observations, not fills or net profits. Unavailable is never a zero return.';
comment on table public.ht_crypto_research_books is
  'Indexed selected/recent episode books; full broad quote snapshots remain in immutable pilot publications.';
commit;
