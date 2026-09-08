-- HT Labs manual crypto paper ledger. Additive: no stock, Agent or budget changes.
-- Data-only CoinAPI publications do not gain order authority. Only authenticated
-- user requests create orders. No brokerage credentials or provider calls exist.
begin;

create table if not exists public.ht_crypto_paper_control (
  id text primary key check(id='global'),
  enabled boolean not null default true,
  policy_version text not null default 'crypto-manual-paper-v1' check(policy_version='crypto-manual-paper-v1'),
  fee_bps numeric not null default 60 check(fee_bps=60),
  slippage_bps numeric not null default 10 check(slippage_bps=10)
);
insert into public.ht_crypto_paper_control(id) values('global') on conflict do nothing;
create table if not exists public.ht_crypto_paper_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  starting_cash numeric not null default 100000 check(starting_cash=100000),
  cash numeric not null default 100000 check(cash>=0 and cash<'Infinity'::numeric),
  realized_pnl numeric not null default 0 check(abs(realized_pnl)<'Infinity'::numeric),
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.ht_crypto_paper_positions (
  user_id uuid not null references public.ht_crypto_paper_accounts(user_id) on delete cascade,
  market_id text not null check(market_id ~ '^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD$'),
  quantity numeric not null default 0 check(quantity>=0 and quantity<'Infinity'::numeric),
  cost_basis numeric not null default 0 check(cost_basis>=0 and cost_basis<'Infinity'::numeric),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,market_id),
  check(quantity<>0 or cost_basis=0)
);
create table if not exists public.ht_crypto_paper_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ht_crypto_paper_accounts(user_id) on delete cascade,
  client_id uuid not null,
  market_id text not null check(market_id ~ '^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD$'),
  side text not null check(side in ('buy','sell')),
  quantity numeric not null check(quantity>0 and quantity<=1000000000000 and scale(quantity)<=12),
  limit_price numeric not null check(limit_price>0 and limit_price<1000000000 and scale(limit_price)<=12),
  filled_quantity numeric not null default 0 check(filled_quantity>=0 and filled_quantity<=quantity),
  status text not null default 'open' check(status in ('open','partially_filled','filled','cancelled','expired')),
  policy_version text not null default 'crypto-manual-paper-v1' check(policy_version='crypto-manual-paper-v1'),
  preview_cycle_id uuid not null references public.ht_coinapi_pilot_cycles(id),
  submitted_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes'),
  updated_at timestamptz not null default clock_timestamp(),
  unique(user_id,client_id)
);
create index if not exists ht_crypto_paper_orders_open on public.ht_crypto_paper_orders(submitted_at)
  where status in ('open','partially_filled');
create index if not exists ht_crypto_paper_orders_user on public.ht_crypto_paper_orders(user_id,submitted_at desc);
create table if not exists public.ht_crypto_paper_fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ht_crypto_paper_orders(id) on delete cascade,
  user_id uuid not null references public.ht_crypto_paper_accounts(user_id) on delete cascade,
  cycle_id uuid not null references public.ht_coinapi_pilot_cycles(id),
  market_id text not null,
  side text not null check(side in ('buy','sell')),
  provider_at timestamptz not null,
  quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
  price numeric not null check(price>0 and price<'Infinity'::numeric),
  fee numeric not null check(fee>=0 and fee<'Infinity'::numeric),
  cash_delta numeric not null check(abs(cash_delta)<'Infinity'::numeric),
  cost_basis_released numeric not null check(cost_basis_released>=0 and cost_basis_released<'Infinity'::numeric),
  realized_pnl numeric not null check(abs(realized_pnl)<'Infinity'::numeric),
  evidence jsonb not null,
  filled_at timestamptz not null default clock_timestamp(),
  unique(order_id,provider_at)
);
create index if not exists ht_crypto_paper_fills_liquidity on public.ht_crypto_paper_fills(market_id,provider_at,side);
create index if not exists ht_crypto_paper_fills_user on public.ht_crypto_paper_fills(user_id,filled_at desc);
create table if not exists public.ht_crypto_paper_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.ht_crypto_paper_accounts(user_id) on delete cascade,
  order_id uuid references public.ht_crypto_paper_orders(id) on delete cascade,
  event_type text not null check(event_type in ('account_open','submitted','fill','cancelled','expired')),
  detail jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists ht_crypto_paper_events_order on public.ht_crypto_paper_events(order_id,user_id,event_type);

-- One lock order for every mutation. Concurrent tabs/cycles cannot overspend,
-- oversell, reuse top-of-book liquidity or apply the same fill twice.
create or replace function public.ht_crypto_paper_open(p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare created integer;
begin
  perform pg_advisory_xact_lock(90400040);
  if p_user is null then raise exception 'User required'; end if;
  insert into public.ht_crypto_paper_accounts(user_id) values(p_user) on conflict do nothing;
  get diagnostics created=row_count;
  if created=1 then insert into public.ht_crypto_paper_events(user_id,event_type,detail)
    values(p_user,'account_open','{"startingCash":100000,"currency":"USD","authority":"manual_paper_only"}'); end if;
  return jsonb_build_object('ok',true,'created',created=1);
end $$;

-- Only the latest accounted, immutable publication is accepted. This function
-- returns saved evidence; it cannot fetch CoinAPI or create market information.
create or replace function public.ht_crypto_paper_quote(p_market text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.ht_coinapi_pilot_control%rowtype; f public.ht_coinapi_pilot_cycles%rowtype; q jsonb;
begin
  select * into c from public.ht_coinapi_pilot_control where id='global';
  if not coalesce(c.enabled,false) or c.blocked_reason is not null then
    return jsonb_build_object('ok',false,'reason','collector_paused'); end if;
  select * into f from public.ht_coinapi_pilot_cycles where id=c.latest_cycle_id and status='complete';
  if f.id is null or f.frame->>'provider' is distinct from 'coinapi' or
     f.frame->>'dataContractVersion' is distinct from 'coinapi-research-data-v2' or
     f.frame->>'authority' is distinct from 'research_only' or
     f.frame->>'executionAuthorized' is distinct from 'false' or
     f.evidence_sha256 !~ '^[a-f0-9]{64}$' or
     exists(select 1 from public.ht_coinapi_pilot_requests r where
       r.settled_at is null or r.reported_credits is null) then
    return jsonb_build_object('ok',false,'reason','publication_unverified'); end if;
  if (f.frame->>'decisionAt')::timestamptz is null or
     (f.frame->>'decisionAt')::timestamptz < clock_timestamp()-interval '90 seconds' or
     (f.frame->>'decisionAt')::timestamptz > clock_timestamp() then
    return jsonb_build_object('ok',false,'reason','collection_stale'); end if;
  select value into q from jsonb_array_elements(f.frame->'quotes') where value->>'marketId'=p_market;
  if q is null or p_market !~ '^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]{1,20}_USD$' or
     (select count(*) from jsonb_array_elements(f.frame->'quotes') where value->>'marketId'=p_market)<>1 or
     not exists(select 1 from jsonb_array_elements(f.frame->'coverage') x where x->>'marketId'=p_market
       and x->>'status' in ('evaluated','quote_only_not_deep_scored')) or
     exists(select 1 from jsonb_array_elements(f.frame->'coverage') x where x->>'marketId'=p_market and x->>'status'='asset_policy_excluded') then
    return jsonb_build_object('ok',false,'reason','market_unavailable'); end if;
  if q->'book'->>'symbolId' is distinct from p_market or q->'trade'->>'symbolId' is distinct from p_market or
     coalesce(jsonb_array_length(q->'failures'),1)<>0 or
     not coalesce((q->'book'->>'bid')::numeric>0 and (q->'book'->>'ask')::numeric>=(q->'book'->>'bid')::numeric
       and (q->'book'->>'ask')::numeric<'Infinity'::numeric and (q->'trade'->>'price')::numeric>0
       and (q->'trade'->>'price')::numeric<'Infinity'::numeric,false) then
    return jsonb_build_object('ok',false,'reason','market_evidence_invalid'); end if;
  -- Explicit null guards: SQL three-valued logic must not admit missing prices.
  if q->'book'->>'bid' is null or q->'book'->>'ask' is null or q->'trade'->>'price' is null or
     q->'book'->>'asOf' is null or q->'trade'->>'asOf' is null then
    return jsonb_build_object('ok',false,'reason','market_evidence_missing'); end if;
  return jsonb_build_object('ok',true,'cycleId',f.id,'evidenceHash',f.evidence_sha256,
    'decisionAt',f.frame->'decisionAt','quote',q);
end $$;

create or replace function public.ht_crypto_paper_submit(p_user uuid,p_client uuid,p_market text,p_side text,
  p_quantity numeric,p_limit numeric,p_preview_cycle uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.ht_crypto_paper_accounts%rowtype; o public.ht_crypto_paper_orders%rowtype;
  reserved numeric; available numeric; q jsonb;
begin
  perform pg_advisory_xact_lock(90400040);
  select * into o from public.ht_crypto_paper_orders where user_id=p_user and client_id=p_client;
  if o.id is not null then
    if o.market_id is distinct from p_market or o.side is distinct from p_side or
       o.quantity is distinct from p_quantity or o.limit_price is distinct from p_limit then raise exception 'Idempotency key reused with different order'; end if;
    return jsonb_build_object('ok',true,'orderId',o.id,'status',o.status,'duplicate',true);
  end if;
  if not coalesce((select enabled from public.ht_crypto_paper_control where id='global'),false) then raise exception 'Crypto paper trading paused'; end if;
  if p_user is null or p_client is null or p_preview_cycle is null or p_side not in ('buy','sell') or p_side is null or
     p_quantity is null or p_quantity<=0 or p_quantity>1000000000000 or scale(p_quantity)>12 or
     p_limit is null or p_limit<=0 or p_limit>=1000000000 or scale(p_limit)>12 then raise exception 'Invalid crypto paper order'; end if;
  select * into a from public.ht_crypto_paper_accounts where user_id=p_user for update;
  if a.user_id is null then raise exception 'Open a crypto paper account first'; end if;
  if (select count(*) from public.ht_crypto_paper_orders where user_id=p_user and status in ('open','partially_filled'))>=50 then
    raise exception 'Cancel an open order before adding another (50 open orders maximum)'; end if;
  q:=public.ht_crypto_paper_quote(p_market);
  if q->>'ok' is distinct from 'true' then raise exception 'Shared CoinAPI feed unavailable: %',q->>'reason'; end if;
  if not exists(select 1 from public.ht_coinapi_pilot_cycles x where x.id=p_preview_cycle and x.status='complete'
      and (x.frame->>'decisionAt')::timestamptz>=clock_timestamp()-interval '90 seconds'
      and exists(select 1 from jsonb_array_elements(x.frame->'quotes') y where y->>'marketId'=p_market)) then
    raise exception 'Preview expired; review the current order cost again'; end if;
  if p_side='buy' then
    select coalesce(sum((quantity-filled_quantity)*limit_price*1.006),0) into reserved
      from public.ht_crypto_paper_orders where user_id=p_user and side='buy' and status in ('open','partially_filled');
    if a.cash-reserved < p_quantity*p_limit*1.006 then raise exception 'Insufficient crypto paper buying power including fees'; end if;
  else
    select coalesce(sum(quantity),0) into available from public.ht_crypto_paper_positions where user_id=p_user and market_id=p_market;
    select coalesce(sum(quantity-filled_quantity),0) into reserved from public.ht_crypto_paper_orders
      where user_id=p_user and market_id=p_market and side='sell' and status in ('open','partially_filled');
    if available-reserved < p_quantity then raise exception 'Sell quantity exceeds available crypto position'; end if;
  end if;
  insert into public.ht_crypto_paper_orders(user_id,client_id,market_id,side,quantity,limit_price,preview_cycle_id)
    values(p_user,p_client,p_market,p_side,p_quantity,p_limit,p_preview_cycle) returning * into o;
  insert into public.ht_crypto_paper_events(user_id,order_id,event_type,detail) values(p_user,o.id,'submitted',
    jsonb_build_object('authority','manual_paper_only','previewCycle',p_preview_cycle,'quantity',p_quantity,
      'limitPrice',p_limit,'feeBps',60,'slippageBps',10,'expiry',o.expires_at));
  return jsonb_build_object('ok',true,'orderId',o.id,'status',o.status,'duplicate',false);
end $$;

create or replace function public.ht_crypto_paper_cancel(p_user uuid,p_order uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.ht_crypto_paper_orders%rowtype;
begin
  perform pg_advisory_xact_lock(90400040);
  select * into o from public.ht_crypto_paper_orders where id=p_order and user_id=p_user for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status in ('open','partially_filled') then
    update public.ht_crypto_paper_orders set status='cancelled',updated_at=clock_timestamp() where id=o.id;
    insert into public.ht_crypto_paper_events(user_id,order_id,event_type,detail)
      values(p_user,o.id,'cancelled',jsonb_build_object('unfilledQuantity',o.quantity-o.filled_quantity));
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.ht_crypto_paper_match(p_order uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.ht_crypto_paper_orders%rowtype; a public.ht_crypto_paper_accounts%rowtype;
  p public.ht_crypto_paper_positions%rowtype; e jsonb; q jsonb; b jsonb; t timestamptz; trade_time timestamptz;
  px numeric; size_available numeric; consumed numeric; amount numeric; fee numeric; basis numeric:=0;
  pnl numeric:=0; cash_change numeric; n timestamptz:=clock_timestamp(); fill_id uuid;
begin
  perform pg_advisory_xact_lock(90400040);
  select * into o from public.ht_crypto_paper_orders where id=p_order for update;
  n:=clock_timestamp();
  if o.id is null or o.status not in ('open','partially_filled') then return jsonb_build_object('status','unchanged'); end if;
  if o.expires_at<=n then
    update public.ht_crypto_paper_orders set status='expired',updated_at=n where id=o.id;
    insert into public.ht_crypto_paper_events(user_id,order_id,event_type,detail) values(o.user_id,o.id,'expired','{"reason":"ten_minute_limit_order_expiry"}');
    return jsonb_build_object('status','expired');
  end if;
  if not coalesce((select enabled from public.ht_crypto_paper_control where id='global'),false) then
    return jsonb_build_object('status','waiting','reason','paper_paused'); end if;
  e:=public.ht_crypto_paper_quote(o.market_id);
  if e->>'ok' is distinct from 'true' then return jsonb_build_object('status','waiting','reason',e->>'reason'); end if;
  q:=e->'quote'; b:=q->'book'; t:=(b->>'asOf')::timestamptz; trade_time:=(q->'trade'->>'asOf')::timestamptz;
  -- No retroactive fills: require a provider book AT/AFTER the user submitted.
  if t<o.submitted_at or t<n-interval '15 seconds' or t>n or trade_time<n-interval '30 seconds' or trade_time>n
    or abs(extract(epoch from(t-trade_time)))>15 then return jsonb_build_object('status','waiting','reason','fresh_post_order_quote_required'); end if;
  if exists(select 1 from public.ht_crypto_paper_fills where order_id=o.id and provider_at=t) then
    return jsonb_build_object('status','waiting','reason','quote_already_used'); end if;
  px:=(case when o.side='buy' then (b->>'ask')::numeric*1.001 else (b->>'bid')::numeric*0.999 end);
  if (o.side='buy' and px>o.limit_price) or (o.side='sell' and px<o.limit_price) then
    return jsonb_build_object('status','waiting','reason','limit_not_reached'); end if;
  size_available:=(case when o.side='buy' then b->>'askSize' else b->>'bidSize' end)::numeric;
  if size_available is null or size_available<=0 or size_available>='Infinity'::numeric then
    return jsonb_build_object('status','waiting','reason','displayed_liquidity_unavailable'); end if;
  select coalesce(sum(quantity),0) into consumed from public.ht_crypto_paper_fills
    where market_id=o.market_id and provider_at=t and side=o.side;
  amount:=trunc(least(o.quantity-o.filled_quantity,greatest(0,size_available-consumed)),12);
  if amount<=0 then return jsonb_build_object('status','waiting','reason','displayed_liquidity_consumed'); end if;
  select * into a from public.ht_crypto_paper_accounts where user_id=o.user_id for update;
  insert into public.ht_crypto_paper_positions(user_id,market_id) values(o.user_id,o.market_id) on conflict do nothing;
  select * into p from public.ht_crypto_paper_positions where user_id=o.user_id and market_id=o.market_id for update;
  fee:=px*amount*0.006;
  if o.side='buy' then
    cash_change:=-(px*amount+fee);
    if a.cash+cash_change<0 then raise exception 'Ledger buying power invariant failed'; end if;
    update public.ht_crypto_paper_positions set quantity=quantity+amount,cost_basis=cost_basis-cash_change,updated_at=n
      where user_id=o.user_id and market_id=o.market_id;
  else
    if p.quantity<amount then raise exception 'Ledger quantity invariant failed'; end if;
    cash_change:=px*amount-fee;
    basis:=case when amount=p.quantity then p.cost_basis else p.cost_basis*amount/p.quantity end;
    pnl:=cash_change-basis;
    update public.ht_crypto_paper_positions set quantity=quantity-amount,cost_basis=cost_basis-basis,updated_at=n
      where user_id=o.user_id and market_id=o.market_id;
  end if;
  update public.ht_crypto_paper_accounts set cash=cash+cash_change,realized_pnl=realized_pnl+pnl where user_id=o.user_id;
  insert into public.ht_crypto_paper_fills(order_id,user_id,cycle_id,market_id,side,provider_at,quantity,price,fee,cash_delta,cost_basis_released,realized_pnl,evidence)
    values(o.id,o.user_id,(e->>'cycleId')::uuid,o.market_id,o.side,t,amount,px,fee,cash_change,basis,pnl,
      jsonb_build_object('provider','coinapi','book',b,'trade',q->'trade','publicationHash',e->'evidenceHash',
        'policyVersion',o.policy_version,'feeBps',60,'slippageBps',10,'authority','manual_paper_only')) returning id into fill_id;
  update public.ht_crypto_paper_orders set filled_quantity=filled_quantity+amount,
    status=case when filled_quantity+amount=quantity then 'filled' else 'partially_filled' end,updated_at=n where id=o.id;
  insert into public.ht_crypto_paper_events(user_id,order_id,event_type,detail)
    values(o.user_id,o.id,'fill',jsonb_build_object('fillId',fill_id,'quantity',amount,'price',px,'fee',fee,'providerAt',t,'realizedPnl',pnl));
  return jsonb_build_object('status',case when o.filled_quantity+amount=o.quantity then 'filled' else 'partially_filled' end,'fillId',fill_id);
end $$;

-- Server-owned quote preview. UI totals are never the ledger's authority.
create or replace function public.ht_crypto_paper_preview(p_user uuid,p_market text,p_side text,p_quantity numeric,p_limit numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.ht_crypto_paper_accounts%rowtype; e jsonb; reserved numeric; qty numeric; held numeric;
begin
  if p_side is null or p_side not in ('buy','sell') or p_quantity is null or p_quantity<=0 or p_quantity>1000000000000 or scale(p_quantity)>12 or
    p_limit is null or p_limit<=0 or p_limit>=1000000000 or scale(p_limit)>12 then raise exception 'Enter a valid quantity and price limit'; end if;
  select * into a from public.ht_crypto_paper_accounts where user_id=p_user;
  if a.user_id is null then raise exception 'Open a crypto paper account first'; end if;
  e:=public.ht_crypto_paper_quote(p_market);
  if e->>'ok' is distinct from 'true' then raise exception 'Shared CoinAPI feed unavailable: %',e->>'reason'; end if;
  select coalesce(sum((quantity-filled_quantity)*limit_price*1.006),0) into reserved from public.ht_crypto_paper_orders
    where user_id=p_user and side='buy' and status in ('open','partially_filled');
  select coalesce(sum(quantity),0) into qty from public.ht_crypto_paper_positions where user_id=p_user and market_id=p_market;
  select coalesce(sum(quantity-filled_quantity),0) into held from public.ht_crypto_paper_orders
    where user_id=p_user and market_id=p_market and side='sell' and status in ('open','partially_filled');
  if p_side='buy' and p_quantity*p_limit*1.006>a.cash-reserved then raise exception 'Insufficient crypto paper buying power including fees'; end if;
  if p_side='sell' and p_quantity>qty-held then raise exception 'Sell quantity exceeds available crypto position'; end if;
  return jsonb_build_object('marketId',p_market,'side',p_side,'quantity',p_quantity::text,'limitPrice',p_limit::text,
    'cycleId',e->'cycleId','book',e->'quote'->'book','notional',p_quantity*p_limit,'estimatedFee',p_quantity*p_limit*0.006,
    'total',p_quantity*p_limit*(case when p_side='buy' then 1.006 else 0.994 end),
    'buyingPowerBefore',a.cash-reserved,'buyingPowerAfter',a.cash-reserved+(case when p_side='buy' then -p_quantity*p_limit*1.006 else p_quantity*p_limit*0.994 end),
    'availableQuantity',(qty-held)::text,'feeBps',60,'slippageBps',10,'policyVersion','crypto-manual-paper-v1',
    'expiresAt',clock_timestamp()+interval '60 seconds');
end $$;

-- A complete per-user portfolio; decimal quantities travel as strings so native
-- and browser clients do not round away fractional dust when selling all.
create or replace function public.ht_crypto_paper_dashboard(p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'account',(select to_jsonb(a) from public.ht_crypto_paper_accounts a where a.user_id=p_user),
    'enabled',(select enabled from public.ht_crypto_paper_control where id='global'),
    'reservedCash',(select coalesce(sum((quantity-filled_quantity)*limit_price*1.006),0) from public.ht_crypto_paper_orders
      where user_id=p_user and side='buy' and status in ('open','partially_filled')),
    'positions',(select coalesce(jsonb_agg(to_jsonb(p)), '[]') from (
      select x.market_id, x.quantity::text as quantity, x.cost_basis, x.updated_at,
        (x.quantity-coalesce((select sum(o.quantity-o.filled_quantity) from public.ht_crypto_paper_orders o
          where o.user_id=p_user and o.market_id=x.market_id and o.side='sell' and o.status in ('open','partially_filled')),0))::text as available_quantity
      from public.ht_crypto_paper_positions x where x.user_id=p_user and x.quantity>0 order by x.market_id
    ) p),
    'orders',(select coalesce(jsonb_agg(to_jsonb(o) order by o.submitted_at desc), '[]') from (
      select id,market_id,side,quantity::text,filled_quantity::text,limit_price::text,status,submitted_at,expires_at,client_id
      from public.ht_crypto_paper_orders where user_id=p_user
      order by (status in ('open','partially_filled')) desc,submitted_at desc limit 100
    ) o),
    'fills',(select coalesce(jsonb_agg(to_jsonb(f) order by f.filled_at desc), '[]') from (
      select id,order_id,market_id,side,quantity::text,price,fee,cash_delta,realized_pnl,provider_at,filled_at
      from public.ht_crypto_paper_fills where user_id=p_user order by filled_at desc limit 50
    ) f)
  );
$$;

create or replace function public.ht_crypto_paper_preview_budget(p_user uuid,p_market text,p_amount numeric,p_limit numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare qty numeric;
begin
  if p_amount is null or p_amount<=0 or p_amount>1000000 or p_limit is null or p_limit<=0 or p_limit>=1000000000 then
    raise exception 'Enter a valid dollar amount and price limit'; end if;
  qty:=trunc(p_amount/(p_limit*1.006),12);
  return public.ht_crypto_paper_preview(p_user,p_market,'buy',qty,p_limit);
end $$;

-- Aggregate accounting check; no user identities or positions leave this RPC.
create or replace function public.ht_crypto_paper_health()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('schemaReady',true,'policyVersion','crypto-manual-paper-v1',
    'manualPaperEnabled',(select enabled from public.ht_crypto_paper_control where id='global'),
    'realExecution',false,'agentAutopilot',false,
    'accounts',(select count(*) from public.ht_crypto_paper_accounts),
    'fills',(select count(*) from public.ht_crypto_paper_fills),
    'openOrders',(select count(*) from public.ht_crypto_paper_orders where status in ('open','partially_filled')),
    'overdueOrders',(select count(*) from public.ht_crypto_paper_orders where status in ('open','partially_filled') and expires_at<clock_timestamp()-interval '2 minutes'),
    'orderMismatches',(select count(*) from public.ht_crypto_paper_orders o where o.filled_quantity<>
      coalesce((select sum(f.quantity) from public.ht_crypto_paper_fills f where f.order_id=o.id),0) or
      not exists(select 1 from public.ht_crypto_paper_events e where e.order_id=o.id and e.event_type='submitted') or
      (o.status='filled' and o.filled_quantity<>o.quantity)),
    'auditMismatches',(select count(*) from public.ht_crypto_paper_fills f where not exists(
      select 1 from public.ht_crypto_paper_events e where e.order_id=f.order_id and e.user_id=f.user_id
        and e.event_type='fill' and e.detail->>'fillId'=f.id::text)),
    'accountMismatches',(select count(*) from public.ht_crypto_paper_accounts a where
      abs(a.cash-a.starting_cash-coalesce((select sum(cash_delta) from public.ht_crypto_paper_fills f where f.user_id=a.user_id),0))>0.00000001 or
      abs(a.realized_pnl-coalesce((select sum(realized_pnl) from public.ht_crypto_paper_fills f where f.user_id=a.user_id),0))>0.00000001),
    'positionMismatches',(select count(*) from public.ht_crypto_paper_positions p where
      abs(p.quantity-coalesce((select sum(case when f.side='buy' then f.quantity else -f.quantity end) from public.ht_crypto_paper_fills f where f.user_id=p.user_id and f.market_id=p.market_id),0))>0.000000000001 or
      abs(p.cost_basis-coalesce((select sum(case when f.side='buy' then -f.cash_delta else -f.cost_basis_released end) from public.ht_crypto_paper_fills f where f.user_id=p.user_id and f.market_id=p.market_id),0))>0.00000001));
$$;

alter table public.ht_crypto_paper_control enable row level security;
alter table public.ht_crypto_paper_accounts enable row level security;
alter table public.ht_crypto_paper_positions enable row level security;
alter table public.ht_crypto_paper_orders enable row level security;
alter table public.ht_crypto_paper_fills enable row level security;
alter table public.ht_crypto_paper_events enable row level security;
revoke all on public.ht_crypto_paper_control,public.ht_crypto_paper_accounts,public.ht_crypto_paper_positions,
  public.ht_crypto_paper_orders,public.ht_crypto_paper_fills,public.ht_crypto_paper_events from public,anon,authenticated,service_role;
grant select on public.ht_crypto_paper_control,public.ht_crypto_paper_accounts,public.ht_crypto_paper_positions,
  public.ht_crypto_paper_orders,public.ht_crypto_paper_fills,public.ht_crypto_paper_events to service_role;
revoke all on function public.ht_crypto_paper_open(uuid),public.ht_crypto_paper_quote(text),
  public.ht_crypto_paper_submit(uuid,uuid,text,text,numeric,numeric,uuid),public.ht_crypto_paper_cancel(uuid,uuid),
  public.ht_crypto_paper_match(uuid),public.ht_crypto_paper_preview(uuid,text,text,numeric,numeric),public.ht_crypto_paper_preview_budget(uuid,text,numeric,numeric),public.ht_crypto_paper_health(),public.ht_crypto_paper_dashboard(uuid)
  from public,anon,authenticated;
grant execute on function public.ht_crypto_paper_open(uuid),public.ht_crypto_paper_quote(text),
  public.ht_crypto_paper_submit(uuid,uuid,text,text,numeric,numeric,uuid),public.ht_crypto_paper_cancel(uuid,uuid),
  public.ht_crypto_paper_match(uuid),public.ht_crypto_paper_preview(uuid,text,text,numeric,numeric),public.ht_crypto_paper_preview_budget(uuid,text,numeric,numeric),public.ht_crypto_paper_health(),public.ht_crypto_paper_dashboard(uuid)
  to service_role;
notify pgrst,'reload schema';
commit;
