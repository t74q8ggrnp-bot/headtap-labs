-- Persistent heartbeat for the scheduled manual-paper order matcher.
-- This records scheduler health even when there are no open orders to fill.

create table if not exists public.paper_match_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  market_session text not null
    check (market_session in ('regular', 'premarket', 'after_hours', 'closed')),
  examined_count integer not null default 0 check (examined_count >= 0),
  filled_count integer not null default 0 check (filled_count >= 0),
  expired_count integer not null default 0 check (expired_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  diagnostics jsonb not null default '{}'::jsonb
);

create index if not exists paper_match_runs_completed_idx
  on public.paper_match_runs(completed_at desc);

alter table public.paper_match_runs enable row level security;

-- No browser policy is intentional. The service-role matcher and system
-- health route are the only readers/writers for this operational receipt.
