-- Private-view health probe for the de-correlated ProX shadow scorecard.
--
-- The representative view intentionally remains unreadable to public roles.
-- Production health only needs to prove that the view exists and can produce
-- the independent-episode denominator, so expose that single aggregate through
-- a tightly scoped security-definer function instead of granting view access.

create or replace function public.prox_shadow_episode_count(
  p_window_start timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from public.prox_shadow_board_episode_representatives
  where decision_at >= p_window_start;
$$;

revoke all on function public.prox_shadow_episode_count(timestamptz) from public;
grant execute on function public.prox_shadow_episode_count(timestamptz)
  to anon, authenticated, service_role;

comment on function public.prox_shadow_episode_count(timestamptz) is
  'Returns only the de-correlated ProX episode count for health verification. The private episode rows remain inaccessible.';
