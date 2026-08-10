-- Trading bot analytics: closes the biggest blind spot in bot_trades — it
-- only ever recorded the trade that was taken, never the candidate pool it
-- was chosen from, never a cycle that considered candidates but bought
-- nothing, and never what the price did after a trade closed. None of this
-- changes scoring, sizing, or order placement — it's purely additive
-- logging so past decisions can be reviewed, not just past trades.

-- Which generation of the bot's scoring logic produced a given trade —
-- without this, trades from different formula eras blur together with no
-- way to separate them once the logic changes again.
alter table bot_trades add column if not exists bot_logic_version text;

-- Pulled out of entry_snapshot's JSON into its own column so it can be
-- joined directly against prox_bot_shadow_observations (source_run_id,
-- ticker) without a JSON path query — lets "would ProX have kept us out of
-- this loser?" be answered with a plain join.
alter table bot_trades add column if not exists source_run_id text;

-- What the stock did after we closed the position — tells us whether an
-- exit (stop, trailing stop, time limit) was well-timed or left money on
-- the table / cut a loss right before a reversal. Backfilled by a later
-- cycle once enough time has passed since exit_at, not known at exit time.
alter table bot_trades add column if not exists post_exit_price real;
alter table bot_trades add column if not exists post_exit_checked_at timestamptz;
alter table bot_trades add column if not exists post_exit_change_percent real;

-- One row per trading-bot cron invocation — records that a cycle ran even
-- when it bought nothing, and why, so "the bot correctly found nothing"
-- stays distinguishable from "the bot silently failed."
create table if not exists bot_cycles (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  bot_logic_version text,
  source_run_id text,
  entry_window_open boolean,
  open_positions_count int,
  candidates_considered int,
  picked_ticker text,
  picked_is_continuation boolean,
  skip_reason text,  -- 'max_positions' | 'outside_session' | 'no_eligible_candidate' | 'buy_unfilled' | null (something was bought)
  error text
);
create index if not exists bot_cycles_started_at_idx on bot_cycles (started_at desc);

-- The full candidate pool considered each cycle, not just the winner —
-- without this we can only ever look at the one thing the bot did, never
-- the field it chose from, so we can never ask "was that actually the best
-- pick available?"
create table if not exists bot_cycle_candidates (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references bot_cycles(id) on delete cascade,
  ticker text not null,
  is_continuation boolean not null default false,
  score real,
  entry_quality real,
  rr_ratio real,
  downside_percent real,
  picked boolean not null default false
);
create index if not exists bot_cycle_candidates_cycle_id_idx on bot_cycle_candidates (cycle_id);
