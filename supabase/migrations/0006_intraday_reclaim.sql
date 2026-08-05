-- Preserve both reference frames for honest intraday-reclaim detection.
-- change_percent remains the move versus the previous close.

alter table public.ht_signal_run_rows
  add column if not exists session_open_price numeric,
  add column if not exists change_from_open_percent numeric,
  add column if not exists scan_session text,
  add column if not exists retrieved_for_reclaim boolean not null default false;

create index if not exists ht_signal_run_rows_reclaim_run_idx
  on public.ht_signal_run_rows (scan_run_id, retrieved_for_reclaim)
  where retrieved_for_reclaim = true;

comment on column public.ht_signal_run_rows.session_open_price is
  'Current-day open supplied by the canonical market snapshot.';
comment on column public.ht_signal_run_rows.change_from_open_percent is
  'Observed move from the current-day snapshot open; does not replace change_percent versus prior close.';
comment on column public.ht_signal_run_rows.retrieved_for_reclaim is
  'Internal flag for a verified pre-market or regular-session reclaim setup.';
comment on column public.ht_signal_run_rows.scan_session is
  'Eastern market session in which the immutable signal row was observed.';
