-- Owner-approved activation of the existing capped CoinAPI research collector.
-- Run in Supabase SQL Editor. Requires 0035/0036; does not require 0037.
-- Never resets usage, clears a block, raises limits, or enables trade execution.
begin;
do $$
declare c public.ht_coinapi_pilot_control%rowtype;
begin
  select * into strict c from public.ht_coinapi_pilot_control where id = 'global' for update;
  if to_regprocedure('public.ht_coinapi_research_maintenance()') is null then
    raise exception 'Apply migration 0036 first';
  end if;
  if c.daily_credit_limit > 300 or c.lifetime_credit_limit > 900 then
    raise exception 'Existing limits exceed this activation approval';
  end if;
  if c.blocked_reason is not null then
    raise exception 'Collector is blocked (%); inspect usage receipts before resuming', c.blocked_reason;
  end if;
  if c.lifetime_reserved >= c.lifetime_credit_limit then
    raise exception 'Lifetime allowance exhausted; no allowance reset is authorized';
  end if;
  update public.ht_coinapi_pilot_control set enabled = true, updated_at = now() where id = 'global';
end $$;
commit;

select enabled, daily_credit_limit, lifetime_credit_limit, daily_reserved,
  lifetime_reserved, blocked_reason, latest_cycle_id
from public.ht_coinapi_pilot_control where id = 'global';
