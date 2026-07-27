-- Trading bot — a separate system from Pro X and from the canonical HT
-- Labs engine. Reads HT Labs' canonical opportunities as a read-only
-- input; has its own independent ranking and execution logic; writes
-- only to this table. Paper trading via Alpaca only — no live-trading
-- capability exists anywhere in this schema or its consumers.

create table if not exists bot_trades (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  status text not null default 'open',   -- 'open' | 'closed' | 'failed'
  entry_order_id text,
  entry_price real,
  entry_at timestamptz,
  position_notional real not null default 1000,
  target_price real,                     -- entry_price * (1 + upsideMax/100) at entry time
  stop_price real,                       -- entry_price * (1 - downsideRisk/100) at entry time
  max_hold_until timestamptz,
  exit_order_id text,
  exit_price real,
  exit_at timestamptz,
  exit_reason text,                      -- 'target' | 'stop' | 'time_limit' | 'manual' | 'order_failed'
  pnl real,
  pnl_percent real,
  bot_score real,                        -- safety-first ranking score at entry time
  entry_snapshot jsonb not null default '{}'::jsonb,  -- full canonical opportunity data at entry, for calibration research
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bot_trades_status_idx on bot_trades (status);
create index if not exists bot_trades_ticker_idx on bot_trades (ticker);
