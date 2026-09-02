-- Restore the de-correlated ProX shadow scorecard view required by production
-- health. This is intentionally read-only and carries no ranking, scoring, or
-- execution authority.

create or replace view public.prox_shadow_board_episode_representatives
with (security_invoker = true)
as
select distinct on (
  outcome.ticker,
  outcome.trading_date,
  outcome.market_session,
  member.disposition
)
  outcome.id as member_outcome_id,
  outcome.member_id,
  outcome.ticker,
  outcome.trading_date,
  outcome.market_session,
  outcome.decision_at,
  outcome.entry_price,
  outcome.max_gain_percent,
  outcome.max_drawdown_percent,
  outcome.sampled_high_at,
  outcome.sampled_low_at,
  member.disposition,
  member.role
from public.prox_shadow_board_member_outcomes as outcome
join public.prox_shadow_board_members as member
  on member.id = outcome.member_id
order by
  outcome.ticker,
  outcome.trading_date,
  outcome.market_session,
  member.disposition,
  outcome.decision_at asc,
  outcome.id asc;

revoke all on public.prox_shadow_board_episode_representatives from anon, authenticated;
grant select on public.prox_shadow_board_episode_representatives to service_role;

comment on view public.prox_shadow_board_episode_representatives is
  'First independent ProX decision per ticker/date/session/disposition. Prevents repeated frames from inflating shadow scorecard sample sizes.';
