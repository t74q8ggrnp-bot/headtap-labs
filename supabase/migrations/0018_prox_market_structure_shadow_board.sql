-- Independent ProX Market Structure Brain and atomic shadow board.
--
-- Every score and disposition below is produced from ProX discovery, raw
-- Polygon market facts, verified ProX events, and ProX's own outcome memory.
-- Canonical HT scores, ranks, roles, eligibility, targets, and R/R outputs are
-- forbidden inputs. The board is append-only shadow research with no public
-- score, ranking, display, position, order, or execution authority.

create table if not exists public.prox_shadow_board_runs (
  id uuid primary key default gen_random_uuid(),
  decision_at timestamptz not null,
  decision_minute timestamptz not null,
  trading_date date not null,
  engine_version text not null,
  structure_version text not null,
  edge_score_version text not null,
  security_routing_version text not null,
  source_discovery_run_id uuid not null references public.prox_market_discovery_runs(id) on delete restrict,
  authority text not null default 'shadow_research_only',
  status text not null default 'running',
  complete boolean not null default false,
  candidate_count int not null default 0,
  expected_member_count int not null default 0,
  persisted_member_count int not null default 0,
  selected_count int not null default 0,
  blocked_count int not null default 0,
  rejected_count int not null default 0,
  hero_ticker text,
  diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (decision_minute, engine_version),
  check (authority = 'shadow_research_only'),
  check (status in ('running', 'success', 'failed')),
  check (candidate_count >= 0),
  check (expected_member_count >= 0),
  check (persisted_member_count >= 0),
  check (selected_count >= 0 and selected_count <= 6),
  check (blocked_count >= 0),
  check (rejected_count >= 0)
);

create index if not exists prox_shadow_board_runs_time_idx
  on public.prox_shadow_board_runs (decision_at desc);

create table if not exists public.prox_shadow_board_members (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prox_shadow_board_runs(id) on delete restrict,
  decision_at timestamptz not null,
  ticker text not null,
  source_observation_id uuid not null references public.prox_market_discovery_observations(id) on delete restrict,
  source_observed_at timestamptz not null,
  discovered_at timestamptz not null,
  market_session text not null,
  discovery_pattern text not null,
  decision_price numeric not null,
  security_type text not null,
  edge_score numeric not null,
  continuation_probability numeric not null,
  reward_risk_asymmetry numeric not null,
  evidence_confidence numeric not null,
  risk_penalty numeric not null,
  readiness text not null,
  entry_qualified boolean not null,
  role text not null,
  disposition text not null,
  rank int,
  disposition_reason text not null,
  structure_assessment jsonb not null,
  edge_assessment jsonb not null,
  event_evidence jsonb,
  hard_failures jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  input_provenance jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, ticker),
  unique (run_id, rank),
  check (decision_price > 0),
  check (market_session in ('pre_market', 'regular', 'after_hours', 'closed')),
  check (length(trim(discovery_pattern)) > 0),
  check (security_type in ('CS', 'ADRC')),
  check (edge_score >= 0 and edge_score <= 100),
  check (continuation_probability >= 0 and continuation_probability <= 100),
  check (reward_risk_asymmetry >= 0 and reward_risk_asymmetry <= 100),
  check (evidence_confidence >= 0 and evidence_confidence <= 100),
  check (risk_penalty >= 0),
  check (readiness in ('insufficient', 'live_only', 'emerging', 'calibrated')),
  check (role in ('hero', 'contender', 'radar', 'none')),
  check (disposition in ('selected', 'blocked', 'rejected')),
  check (
    (disposition = 'selected' and entry_qualified = true and role in ('hero', 'contender') and rank between 1 and 6)
    or
    (disposition = 'blocked' and entry_qualified = false and role = 'radar' and rank is null)
    or
    (disposition = 'rejected' and entry_qualified = true and role = 'none' and rank is null)
  )
);

create index if not exists prox_shadow_board_members_run_rank_idx
  on public.prox_shadow_board_members (run_id, rank);

create index if not exists prox_shadow_board_members_ticker_time_idx
  on public.prox_shadow_board_members (ticker, decision_at desc);

create index if not exists prox_shadow_board_members_disposition_idx
  on public.prox_shadow_board_members (disposition, edge_score desc, decision_at desc);

alter table public.prox_shadow_board_runs enable row level security;
alter table public.prox_shadow_board_members enable row level security;

comment on table public.prox_shadow_board_runs is
  'Atomic coverage receipt for the independent ProX shadow board. No public or execution authority.';

comment on table public.prox_shadow_board_members is
  'Append-only independent ProX Edge Scores, structure, roles, blocks, and explicit non-selection dispositions.';

comment on column public.prox_shadow_board_members.input_provenance is
  'Raw-fact provenance proving no canonical score, rank, role, eligibility, target, or R/R input entered ProX scoring.';
