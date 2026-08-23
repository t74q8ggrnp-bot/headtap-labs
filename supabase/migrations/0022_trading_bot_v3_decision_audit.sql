-- Bot v3 decision audit. This migration is analytics-only: it does not place
-- orders, enable entries, alter positions, or grant ProX execution authority.
-- It preserves the exact normalized inputs and rejection reasons used by the
-- single paper bot so every future decision can be reproduced honestly.

alter table bot_cycle_candidates
  add column if not exists decision_version text,
  add column if not exists entry_path text,
  add column if not exists entry_qualified boolean not null default false,
  add column if not exists fast_entry_eligible boolean not null default false,
  add column if not exists rejection_reasons jsonb not null default '[]'::jsonb,
  add column if not exists component_scores jsonb not null default '{}'::jsonb,
  add column if not exists effective_rr_ratio real,
  add column if not exists effective_downside_percent real,
  add column if not exists continuation_capacity_percent real,
  add column if not exists opportunity_score real,
  add column if not exists relative_volume real,
  add column if not exists change_from_open_percent real,
  add column if not exists signal_state text;

alter table bot_cycles
  add column if not exists entries_enabled boolean,
  add column if not exists entry_opened boolean not null default false;

create index if not exists bot_cycle_candidates_v3_persistence_idx
  on bot_cycle_candidates (ticker, entry_qualified, cycle_id);

create index if not exists bot_trades_logic_entry_idx
  on bot_trades (bot_logic_version, entry_at desc);
