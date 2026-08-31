-- HT Labs manual paper trading v1.
--
-- This is a user-directed simulation ledger. It is intentionally isolated
-- from the single Alpaca paper bot and has no broker or live-order authority.
-- Fills, cash changes, and position changes are applied together by the
-- paper_apply_fill transaction below; browsers never calculate account state.

create table if not exists public.paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'HT Paper',
  base_currency text not null default 'USD'
    check (base_currency = 'USD'),
  starting_cash numeric(20, 6) not null default 100000
    check (starting_cash > 0),
  cash_balance numeric(20, 6) not null default 100000,
  realized_pnl numeric(20, 6) not null default 0,
  short_margin_held numeric(20, 6) not null default 0
    check (short_margin_held >= 0),
  status text not null default 'active'
    check (status in ('active', 'frozen')),
  margin_enabled boolean not null default true,
  data_mode text not null default 'delayed'
    check (data_mode in ('delayed', 'real_time')),
  reset_generation integer not null default 0 check (reset_generation >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  asset_type text not null default 'stock'
    check (asset_type in ('stock', 'etf')),
  quantity numeric(20, 8) not null default 0,
  average_entry_price numeric(20, 8) not null default 0
    check (average_entry_price >= 0),
  realized_pnl numeric(20, 6) not null default 0,
  short_margin_held numeric(20, 6) not null default 0
    check (short_margin_held >= 0),
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (account_id, symbol)
);

create table if not exists public.paper_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_order_id uuid not null default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  asset_type text not null default 'stock'
    check (asset_type in ('stock', 'etf')),
  side text not null
    check (side in ('buy', 'sell', 'sell_short', 'buy_to_cover')),
  order_type text not null
    check (order_type in ('market', 'limit', 'stop', 'stop_limit')),
  time_in_force text not null default 'day'
    check (time_in_force in ('day', 'gtc')),
  quantity numeric(20, 8) not null check (quantity > 0),
  filled_quantity numeric(20, 8) not null default 0
    check (filled_quantity >= 0 and filled_quantity <= quantity),
  limit_price numeric(20, 8),
  stop_price numeric(20, 8),
  allow_extended_hours boolean not null default false,
  status text not null default 'accepted'
    check (status in (
      'accepted', 'open', 'partially_filled', 'filled', 'cancelled',
      'rejected', 'expired'
    )),
  order_class text not null default 'simple'
    check (order_class in ('simple', 'bracket_parent', 'bracket_child')),
  parent_order_id uuid references public.paper_orders(id) on delete cascade,
  oco_group_id uuid,
  reduce_only boolean not null default false,
  bracket_take_profit_price numeric(20, 8),
  bracket_stop_loss_price numeric(20, 8),
  strategy_source text not null default 'manual'
    check (strategy_source in (
      'manual', 'spot_momentum', 'before_crowd', 'scanner', 'ticker_detail'
    )),
  context_snapshot jsonb not null default '{}'::jsonb,
  quote_price_at_submit numeric(20, 8),
  quote_source_at_submit text,
  quote_timestamp_at_submit timestamptz,
  data_mode text not null default 'delayed'
    check (data_mode in ('delayed', 'real_time')),
  reject_reason text,
  submitted_at timestamptz not null default now(),
  filled_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (account_id, client_order_id),
  check (
    (order_type in ('limit', 'stop_limit') and limit_price > 0)
    or (order_type in ('market', 'stop'))
  ),
  check (
    (order_type in ('stop', 'stop_limit') and stop_price > 0)
    or (order_type in ('market', 'limit'))
  ),
  check (
    (order_class = 'bracket_parent'
      and bracket_take_profit_price > 0
      and bracket_stop_loss_price > 0)
    or (order_class <> 'bracket_parent')
  )
);

create table if not exists public.paper_fills (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.paper_orders(id) on delete cascade,
  symbol text not null,
  side text not null,
  quantity numeric(20, 8) not null check (quantity > 0),
  price numeric(20, 8) not null check (price > 0),
  notional numeric(20, 6) not null check (notional > 0),
  commission numeric(20, 6) not null default 0 check (commission >= 0),
  slippage_bps numeric(12, 4) not null default 0,
  quote_source text not null,
  quote_timestamp timestamptz not null,
  data_mode text not null default 'delayed'
    check (data_mode in ('delayed', 'real_time')),
  filled_at timestamptz not null default now(),
  unique (order_id)
);

create table if not exists public.paper_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.paper_orders(id) on delete set null,
  fill_id uuid references public.paper_fills(id) on delete set null,
  entry_type text not null
    check (entry_type in (
      'account_open', 'buy', 'sell', 'short_sale', 'buy_to_cover',
      'borrow_fee', 'cash_adjustment', 'account_reset'
    )),
  symbol text,
  quantity_delta numeric(20, 8) not null default 0,
  cash_delta numeric(20, 6) not null default 0,
  realized_pnl_delta numeric(20, 6) not null default 0,
  cash_balance_after numeric(20, 6) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_order_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.paper_orders(id) on delete cascade,
  event_type text not null
    check (event_type in ('accepted', 'opened', 'filled', 'cancelled', 'rejected', 'expired')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.paper_equity_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.paper_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cash_balance numeric(20, 6) not null,
  long_market_value numeric(20, 6) not null default 0,
  short_unrealized_pnl numeric(20, 6) not null default 0,
  equity numeric(20, 6) not null,
  buying_power numeric(20, 6) not null,
  data_mode text not null default 'delayed',
  captured_at timestamptz not null default now()
);

create index if not exists paper_orders_account_status_idx
  on public.paper_orders(account_id, status, submitted_at desc);
create index if not exists paper_positions_account_idx
  on public.paper_positions(account_id, updated_at desc);
create index if not exists paper_fills_account_time_idx
  on public.paper_fills(account_id, filled_at desc);
create index if not exists paper_ledger_account_time_idx
  on public.paper_ledger_entries(account_id, created_at desc);
create index if not exists paper_equity_account_time_idx
  on public.paper_equity_snapshots(account_id, captured_at desc);

alter table public.paper_accounts enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_orders enable row level security;
alter table public.paper_fills enable row level security;
alter table public.paper_ledger_entries enable row level security;
alter table public.paper_order_events enable row level security;
alter table public.paper_equity_snapshots enable row level security;

drop policy if exists paper_accounts_owner_read on public.paper_accounts;
create policy paper_accounts_owner_read on public.paper_accounts
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists paper_positions_owner_read on public.paper_positions;
create policy paper_positions_owner_read on public.paper_positions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists paper_orders_owner_read on public.paper_orders;
create policy paper_orders_owner_read on public.paper_orders
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists paper_fills_owner_read on public.paper_fills;
create policy paper_fills_owner_read on public.paper_fills
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists paper_ledger_owner_read on public.paper_ledger_entries;
create policy paper_ledger_owner_read on public.paper_ledger_entries
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists paper_order_events_owner_read on public.paper_order_events;
create policy paper_order_events_owner_read on public.paper_order_events
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists paper_equity_owner_read on public.paper_equity_snapshots;
create policy paper_equity_owner_read on public.paper_equity_snapshots
  for select to authenticated using (auth.uid() = user_id);

-- Atomic full-fill application. The API validates order intent and provider
-- data first; this function rechecks all account/position invariants while
-- holding row locks so concurrent browser requests cannot overspend or cross
-- a position through zero.
create or replace function public.paper_apply_fill(
  p_order_id uuid,
  p_fill_price numeric,
  p_quote_source text,
  p_quote_timestamp timestamptz,
  p_slippage_bps numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.paper_orders%rowtype;
  v_account public.paper_accounts%rowtype;
  v_position public.paper_positions%rowtype;
  v_position_exists boolean := false;
  v_fill_quantity numeric(20, 8);
  v_notional numeric(20, 6);
  v_old_quantity numeric(20, 8) := 0;
  v_new_quantity numeric(20, 8) := 0;
  v_old_average numeric(20, 8) := 0;
  v_new_average numeric(20, 8) := 0;
  v_cash_delta numeric(20, 6) := 0;
  v_realized_delta numeric(20, 6) := 0;
  v_margin_delta numeric(20, 6) := 0;
  v_position_margin numeric(20, 6) := 0;
  v_fill_id uuid;
begin
  if p_fill_price is null or p_fill_price <= 0 then
    raise exception 'invalid_fill_price';
  end if;

  select * into v_order
  from public.paper_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'paper_order_not_found'; end if;
  if v_order.status not in ('accepted', 'open', 'partially_filled') then
    raise exception 'paper_order_not_fillable:%', v_order.status;
  end if;

  select * into v_account
  from public.paper_accounts
  where id = v_order.account_id
  for update;

  if not found or v_account.status <> 'active' then
    raise exception 'paper_account_not_active';
  end if;

  select * into v_position
  from public.paper_positions
  where account_id = v_order.account_id and symbol = v_order.symbol
  for update;
  v_position_exists := found;

  if v_position_exists then
    v_old_quantity := v_position.quantity;
    v_old_average := v_position.average_entry_price;
    v_position_margin := v_position.short_margin_held;
  end if;

  v_fill_quantity := v_order.quantity - v_order.filled_quantity;
  v_notional := round(v_fill_quantity * p_fill_price, 6);

  if v_order.side = 'buy' then
    if v_old_quantity < 0 then raise exception 'use_buy_to_cover'; end if;
    if v_account.cash_balance - v_account.short_margin_held < v_notional then
      raise exception 'insufficient_buying_power';
    end if;
    v_new_quantity := v_old_quantity + v_fill_quantity;
    v_new_average := case
      when v_new_quantity = 0 then 0
      else ((v_old_quantity * v_old_average) + v_notional) / v_new_quantity
    end;
    v_cash_delta := -v_notional;
  elsif v_order.side = 'sell' then
    if v_old_quantity <= 0 or v_old_quantity < v_fill_quantity then
      raise exception 'insufficient_long_position';
    end if;
    v_new_quantity := v_old_quantity - v_fill_quantity;
    v_new_average := case when v_new_quantity = 0 then 0 else v_old_average end;
    v_realized_delta := round((p_fill_price - v_old_average) * v_fill_quantity, 6);
    v_cash_delta := v_notional;
  elsif v_order.side = 'sell_short' then
    if not v_account.margin_enabled then raise exception 'margin_disabled'; end if;
    if v_old_quantity > 0 then raise exception 'sell_long_position_first'; end if;
    if trunc(v_fill_quantity) <> v_fill_quantity then
      raise exception 'short_quantity_must_be_whole';
    end if;
    v_margin_delta := round(v_notional * 0.50, 6);
    if v_account.cash_balance - v_account.short_margin_held < v_margin_delta then
      raise exception 'insufficient_short_margin';
    end if;
    v_new_quantity := v_old_quantity - v_fill_quantity;
    v_new_average := case
      when abs(v_new_quantity) = 0 then 0
      else ((abs(v_old_quantity) * v_old_average) + v_notional) / abs(v_new_quantity)
    end;
    v_cash_delta := 0;
  elsif v_order.side = 'buy_to_cover' then
    if v_old_quantity >= 0 or abs(v_old_quantity) < v_fill_quantity then
      raise exception 'insufficient_short_position';
    end if;
    v_new_quantity := v_old_quantity + v_fill_quantity;
    v_new_average := case when v_new_quantity = 0 then 0 else v_old_average end;
    v_realized_delta := round((v_old_average - p_fill_price) * v_fill_quantity, 6);
    v_cash_delta := v_realized_delta;
    v_margin_delta := -round(
      v_position_margin * (v_fill_quantity / abs(v_old_quantity)), 6
    );
  else
    raise exception 'unsupported_paper_side';
  end if;

  if v_position_exists then
    update public.paper_positions
    set quantity = v_new_quantity,
        average_entry_price = round(v_new_average, 8),
        realized_pnl = realized_pnl + v_realized_delta,
        short_margin_held = greatest(0, short_margin_held + v_margin_delta),
        opened_at = case
          when v_old_quantity = 0 and v_new_quantity <> 0 then now()
          when v_new_quantity = 0 then null
          else opened_at
        end,
        updated_at = now()
    where id = v_position.id;
  else
    insert into public.paper_positions (
      account_id, user_id, symbol, asset_type, quantity,
      average_entry_price, realized_pnl, short_margin_held, opened_at
    ) values (
      v_order.account_id, v_order.user_id, v_order.symbol, v_order.asset_type,
      v_new_quantity, round(v_new_average, 8), v_realized_delta,
      greatest(0, v_margin_delta), case when v_new_quantity <> 0 then now() end
    );
  end if;

  update public.paper_accounts
  set cash_balance = cash_balance + v_cash_delta,
      realized_pnl = realized_pnl + v_realized_delta,
      short_margin_held = greatest(0, short_margin_held + v_margin_delta),
      updated_at = now()
  where id = v_order.account_id
  returning * into v_account;

  insert into public.paper_fills (
    account_id, user_id, order_id, symbol, side, quantity, price,
    notional, slippage_bps, quote_source, quote_timestamp, data_mode
  ) values (
    v_order.account_id, v_order.user_id, v_order.id, v_order.symbol,
    v_order.side, v_fill_quantity, p_fill_price, v_notional,
    coalesce(p_slippage_bps, 0), p_quote_source, p_quote_timestamp,
    v_order.data_mode
  ) returning id into v_fill_id;

  update public.paper_orders
  set filled_quantity = quantity,
      status = 'filled',
      filled_at = now(),
      updated_at = now()
  where id = v_order.id;

  if v_order.oco_group_id is not null then
    update public.paper_orders
    set status = 'cancelled',
        cancelled_at = now(),
        updated_at = now(),
        reject_reason = 'OCO sibling filled'
    where account_id = v_order.account_id
      and oco_group_id = v_order.oco_group_id
      and id <> v_order.id
      and status in ('accepted', 'open', 'partially_filled');
  end if;

  insert into public.paper_ledger_entries (
    account_id, user_id, order_id, fill_id, entry_type, symbol,
    quantity_delta, cash_delta, realized_pnl_delta, cash_balance_after,
    metadata
  ) values (
    v_order.account_id, v_order.user_id, v_order.id, v_fill_id,
    case v_order.side
      when 'buy' then 'buy'
      when 'sell' then 'sell'
      when 'sell_short' then 'short_sale'
      else 'buy_to_cover'
    end,
    v_order.symbol, v_new_quantity - v_old_quantity, v_cash_delta,
    v_realized_delta, v_account.cash_balance,
    jsonb_build_object(
      'fill_price', p_fill_price,
      'position_quantity_after', v_new_quantity,
      'average_entry_price_after', v_new_average,
      'short_margin_held_after', v_account.short_margin_held,
      'quote_source', p_quote_source,
      'quote_timestamp', p_quote_timestamp
    )
  );

  insert into public.paper_order_events (
    account_id, user_id, order_id, event_type, detail
  ) values (
    v_order.account_id, v_order.user_id, v_order.id, 'filled',
    jsonb_build_object('fill_id', v_fill_id, 'price', p_fill_price)
  );

  return jsonb_build_object(
    'ok', true,
    'fill_id', v_fill_id,
    'order_id', v_order.id,
    'symbol', v_order.symbol,
    'quantity', v_fill_quantity,
    'fill_price', p_fill_price,
    'cash_balance', v_account.cash_balance,
    'position_quantity', v_new_quantity,
    'average_entry_price', v_new_average,
    'realized_pnl_delta', v_realized_delta
  );
end;
$$;

revoke all on function public.paper_apply_fill(uuid, numeric, text, timestamptz, numeric)
  from public, anon, authenticated;
grant execute on function public.paper_apply_fill(uuid, numeric, text, timestamptz, numeric)
  to service_role;

comment on table public.paper_accounts is
  'One user-owned manual simulation account. Never connected to a broker.';
comment on table public.paper_ledger_entries is
  'Append-only source-of-truth cash and position movement ledger for manual paper trading.';
comment on function public.paper_apply_fill(uuid, numeric, text, timestamptz, numeric) is
  'Service-only atomic paper fill. It has no broker or live trading authority.';
