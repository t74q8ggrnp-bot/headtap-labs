-- Independent ProX scorecard episodes.
--
-- The shadow board intentionally preserves a decision frame every five
-- minutes. Those frames are valuable audit records, but they are correlated
-- observations rather than independent strategy samples. This view chooses
-- the first decision for each ticker + trading date + market session +
-- disposition so scorecards cannot turn one persistent ticker into dozens of
-- apparent wins or losses.

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

comment on view public.prox_shadow_board_episode_representatives is
  'First independent ProX decision per ticker/date/session/disposition. Prevents repeated five-minute frames from inflating shadow scorecard sample sizes.';
