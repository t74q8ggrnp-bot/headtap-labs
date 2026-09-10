-- Forward-only repair for the visual-plan shadow claim path. The original
-- function returned before this query while lifecycle was disabled, so the
-- invalid version-row symbol reference was dormant until migration 0054.
-- This migration changes no rollout or execution gates.
begin;

create or replace function public.ht_agent_claim_visual_plan_batch(
  p_limit integer default 50
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare v_limit integer:=least(100,greatest(1,coalesce(p_limit,50)));
declare v_enabled boolean;
declare v_scope jsonb;
declare v_rows jsonb;
begin
  select visual_plan_lifecycle_enabled,visual_plan_symbol_scope
  into strict v_enabled,v_scope
  from public.ht_agent_global_control where id='global';
  if not v_enabled then
    return jsonb_build_object('allowed',false,'reason','lifecycle_disabled','plans','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_rows from (
    select v.id as "planVersionId",v.plan_id as "planId",v.profile_id as "profileId",
      v.user_id as "userId",p.symbol,v.definition,s.lifecycle_state as "state",
      s.state_version as "stateVersion",s.last_evaluated_candle_at as "lastEvaluatedCandleAt"
    from public.ht_agent_visual_plans p
    join public.ht_agent_visual_plan_versions v on v.id=p.active_version_id
    join public.ht_agent_visual_plan_states s on s.plan_version_id=v.id
    where s.lifecycle_state in ('watching','triggered') and
      (
        v_scope @> '{"symbols":["*"]}'::jsonb or
        exists(
          select 1 from jsonb_array_elements_text(v_scope->'symbols') scoped(symbol)
          where scoped.symbol=p.symbol
        )
      )
    order by s.updated_at asc
    limit v_limit
  ) q;
  return jsonb_build_object('allowed',true,'plans',v_rows);
end $$;

revoke all on function public.ht_agent_claim_visual_plan_batch(integer)
  from public,anon,authenticated;
grant execute on function public.ht_agent_claim_visual_plan_batch(integer)
  to service_role;

comment on function public.ht_agent_claim_visual_plan_batch(integer) is
  'Service-only scoped lifecycle claim. Symbol authority comes from the immutable plan root.';

commit;
