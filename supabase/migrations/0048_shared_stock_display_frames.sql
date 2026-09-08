-- Presentation-only stock price synchronization. Canonical, ProX, Agent risk,
-- paper fills and order validation must not consume this five-second frame.
begin;

create table if not exists public.ht_stock_display_frames (
  symbol text primary key check(symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  frame_bucket bigint not null check(frame_bucket > 0),
  price numeric not null check(price > 0),
  provider_as_of timestamptz not null,
  source text not null check(source in ('massive_polygon_last_trade','massive_polygon_snapshot')),
  price_kind text not null check(price_kind in ('trade','minute_aggregate')),
  trade_size numeric check(trade_size is null or trade_size >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.ht_stock_display_frames enable row level security;
revoke all on public.ht_stock_display_frames from public,anon,authenticated;
grant select on public.ht_stock_display_frames to service_role;

create or replace function public.ht_publish_stock_display_frames(p_candidates jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='1500ms'
set lock_timeout='500ms'
as $$
declare
  item jsonb;
  candidate_symbol text;
  candidate_price numeric;
  candidate_as_of timestamptz;
  candidate_source text;
  candidate_kind text;
  candidate_size numeric;
  candidate_bucket bigint;
  selected public.ht_stock_display_frames%rowtype;
  result jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) not between 1 and 250 then
    raise exception 'Expected 1-250 stock display candidates';
  end if;

  for item in select value from jsonb_array_elements(p_candidates) loop
    candidate_symbol := upper(trim(item->>'symbol'));
    candidate_price := (item->>'price')::numeric;
    candidate_as_of := (item->>'asOf')::timestamptz;
    candidate_source := item->>'source';
    candidate_kind := item->>'priceKind';
    candidate_size := nullif(item->>'size','')::numeric;
    candidate_bucket := (item->>'frameBucket')::bigint;

    if candidate_symbol !~ '^[A-Z][A-Z0-9.-]{0,9}$' or candidate_price <= 0 or
       candidate_as_of > clock_timestamp()+interval '2 seconds' or
       candidate_source not in ('massive_polygon_last_trade','massive_polygon_snapshot') or
       candidate_kind not in ('trade','minute_aggregate') or candidate_bucket <= 0 then
      raise exception 'Invalid stock display candidate';
    end if;

    insert into public.ht_stock_display_frames(
      symbol,frame_bucket,price,provider_as_of,source,price_kind,trade_size,updated_at
    ) values(
      candidate_symbol,candidate_bucket,candidate_price,candidate_as_of,
      candidate_source,candidate_kind,candidate_size,clock_timestamp()
    )
    on conflict(symbol) do update set
      frame_bucket=excluded.frame_bucket,
      price=case when excluded.provider_as_of >= ht_stock_display_frames.provider_as_of
        then excluded.price else ht_stock_display_frames.price end,
      provider_as_of=greatest(excluded.provider_as_of,ht_stock_display_frames.provider_as_of),
      source=case when excluded.provider_as_of >= ht_stock_display_frames.provider_as_of
        then excluded.source else ht_stock_display_frames.source end,
      price_kind=case when excluded.provider_as_of >= ht_stock_display_frames.provider_as_of
        then excluded.price_kind else ht_stock_display_frames.price_kind end,
      trade_size=case when excluded.provider_as_of >= ht_stock_display_frames.provider_as_of
        then excluded.trade_size else ht_stock_display_frames.trade_size end,
      updated_at=clock_timestamp()
    where excluded.frame_bucket > ht_stock_display_frames.frame_bucket;

    select * into strict selected
    from public.ht_stock_display_frames
    where symbol=candidate_symbol;

    result := result || jsonb_build_object(candidate_symbol,jsonb_build_object(
      'symbol',selected.symbol,
      'price',selected.price,
      'asOf',selected.provider_as_of,
      'source',selected.source,
      'priceKind',selected.price_kind,
      'size',selected.trade_size,
      'frameBucket',selected.frame_bucket,
      'frameId','stock-display-frame-v1:'||selected.symbol||':'||selected.frame_bucket,
      'frameVersion','stock-display-frame-v1',
      'coordination','database'
    ));
  end loop;
  return result;
end $$;

revoke all on function public.ht_publish_stock_display_frames(jsonb) from public,anon,authenticated;
grant execute on function public.ht_publish_stock_display_frames(jsonb) to service_role;

comment on table public.ht_stock_display_frames is
  'Five-second cross-client presentation frames only; forbidden as scoring, risk, fill or execution evidence.';
notify pgrst,'reload schema';
commit;
