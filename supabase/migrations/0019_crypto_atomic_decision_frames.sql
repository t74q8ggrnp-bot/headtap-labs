-- Atomic public crypto decisions.
--
-- The scheduled crypto sensor computes one complete backend-authoritative
-- frame, persists it, and only then makes it available to Home, Crypto, and
-- mobile clients. Partial provider work can never become a hybrid UI frame.

create table if not exists public.ht_crypto_decision_frames (
  id uuid primary key default gen_random_uuid(),
  decision_at timestamptz not null,
  decision_minute timestamptz not null unique,
  fresh_until timestamptz not null,
  methodology_version text not null,
  expected_opportunity_count int not null default 0,
  complete boolean not null default false,
  feed jsonb not null,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_opportunity_count >= 0),
  check (fresh_until > decision_at)
);

create index if not exists ht_crypto_decision_frames_time_idx
  on public.ht_crypto_decision_frames (decision_at desc);

alter table public.ht_crypto_decision_frames enable row level security;

comment on table public.ht_crypto_decision_frames is
  'Complete immutable HT Crypto hero, contender, and radar decisions produced by the scheduled backend sensor.';
