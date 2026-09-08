-- Owner-approved one-time live validation: 100 additional REST credits.
-- About $0.53 before tax at the published first-tier rate, from existing balance.
-- Absolute ceiling 1,000, NOT another 100 on each run. No usage/history reset.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '8s';
lock table public.ht_coinapi_pilot_control in access exclusive mode;

do $$
declare c public.ht_coinapi_pilot_control%rowtype;
begin
  select * into strict c from public.ht_coinapi_pilot_control where id = 'global';
  -- Already applied: leave usage, enablement, blocks and leases exactly as found.
  if c.daily_credit_limit = 1000 and c.lifetime_credit_limit = 1000 then
    return;
  end if;
  if (clock_timestamp() at time zone 'UTC')::date <> date '2026-09-03'
    or c.credit_day <> date '2026-09-03'
    or c.daily_credit_limit <> 900 or c.lifetime_credit_limit <> 900
    or c.daily_reserved <> 900 or c.lifetime_reserved <> 900 then
    raise exception 'Allowance not changed: expected the verified September 3 baseline of 900 used / 900 allowed';
  end if;
  if not c.enabled or c.blocked_reason is not null
    or c.lease_until > clock_timestamp()
    or exists (select 1 from public.ht_coinapi_pilot_requests where settled_at is null) then
    raise exception 'Allowance not changed: collector disabled, blocked, busy, or has unresolved usage';
  end if;

  alter table public.ht_coinapi_pilot_control
    drop constraint ht_coinapi_pilot_control_daily_credit_limit_check,
    drop constraint ht_coinapi_pilot_control_lifetime_credit_limit_check;
  alter table public.ht_coinapi_pilot_control
    add constraint ht_coinapi_pilot_control_daily_credit_limit_check
      check (daily_credit_limit between 1 and 1000),
    add constraint ht_coinapi_pilot_control_lifetime_credit_limit_check
      check (lifetime_credit_limit between 1 and 1000);
  update public.ht_coinapi_pilot_control
    set daily_credit_limit = 1000, lifetime_credit_limit = 1000, updated_at = now()
    where id = 'global';
end $$;

commit;

select enabled, daily_credit_limit, lifetime_credit_limit,
  daily_reserved, lifetime_reserved,
  greatest(0, lifetime_credit_limit - lifetime_reserved) as remaining_test_requests,
  blocked_reason
from public.ht_coinapi_pilot_control where id = 'global';
