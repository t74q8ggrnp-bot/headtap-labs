-- HT Agent measurement/evidence correction. Thresholds, modes, account state
-- and kill switches are deliberately unchanged. No historical decisions,
-- immutable frames, cohorts or outcomes are rewritten.
begin;

alter table public.ht_agent_profiles
  alter column policy_version set default 'ht-agent-risk-v3-evidence';
alter table public.ht_agent_global_control
  alter column policy_version set default 'ht-agent-risk-v3-evidence';
alter table public.ht_agent_cohort_observations
  alter column cohort_version set default 'ht-agent-cohorts-v2-mode-independent';

update public.ht_agent_global_control
set policy_version = 'ht-agent-risk-v3-evidence', updated_at = now()
where id = 'global' and policy_version <> 'ht-agent-risk-v3-evidence';

update public.ht_agent_profiles
set policy_version = 'ht-agent-risk-v3-evidence', updated_at = now()
where policy_version <> 'ht-agent-risk-v3-evidence';

commit;
