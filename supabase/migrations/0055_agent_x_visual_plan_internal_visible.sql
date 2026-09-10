-- Run only after 0054 has collected a successful shadow worker receipt and
-- ht_agent_phase2_visual_plan_release_health() reports shadowReady=true.
-- This exposes SPY/QQQ plans internally while Paper handoff remains disabled.
begin;

do $$
declare v_result jsonb;
begin
  select public.ht_agent_promote_visual_plan_internal_visible() into v_result;
  if coalesce((v_result->>'promoted')::boolean,false) is not true or
     v_result->>'mode'<>'visible' or
     coalesce((v_result->>'paperHandoffEnabled')::boolean,true) is not false then
    raise exception 'phase2_internal_visible_promotion_failed';
  end if;
end $$;

commit;
