-- HT Trade Plan v1: one backend-owned, paper-only decision presentation.
-- Canonical remains ranking authority; ProX remains independent research.

alter table public.ht_agent_decisions
  add column if not exists trade_plan jsonb not null default '{}'::jsonb;

alter table public.ht_agent_profiles
  alter column policy_version set default 'ht-agent-risk-v2-tradeability';

alter table public.ht_agent_decisions
  drop constraint if exists ht_agent_decisions_trade_plan_object_check;
alter table public.ht_agent_decisions
  add constraint ht_agent_decisions_trade_plan_object_check
  check (jsonb_typeof(trade_plan) = 'object');

comment on column public.ht_agent_decisions.trade_plan is
  'Versioned HT Trade Plan derived on the server from the immutable decision frame and deterministic paper-risk result. It is never a live-broker instruction.';

update public.ht_agent_global_control
set policy_version = 'ht-agent-risk-v2-tradeability',
    updated_at = now()
where id = 'global';

update public.ht_agent_profiles
set policy_version = 'ht-agent-risk-v2-tradeability',
    updated_at = now()
where policy_version <> 'ht-agent-risk-v2-tradeability';
