-- Pro X Phase 1 foundation — event/evidence/entity schema only.
-- Deliberately excludes prox_market_features, prox_decisions,
-- prox_decision_versions, prox_worker_heartbeats, prox_dead_letters:
-- those belong to the market-sensor and decision-bridge phases, which
-- require an always-on worker this pass does not introduce. Nothing
-- here reads from or writes to any existing ht_* table.

create table if not exists prox_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text unique not null,        -- e.g. 'sec_edgar_8k'
  display_name text not null,             -- 'SEC EDGAR — Form 8-K'
  tier text not null default 'primary',   -- 'primary' | 'secondary' | 'unverified'
  base_credibility int not null default 90,
  created_at timestamptz not null default now()
);

create table if not exists prox_entities (
  id uuid primary key default gen_random_uuid(),
  cik text unique,
  company_name text not null,
  ticker text,
  former_names jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prox_entities_ticker_idx on prox_entities (ticker);

create table if not exists prox_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references prox_sources(id),
  external_id text not null,              -- dedupe key, e.g. SEC accession number
  form_type text,                         -- '8-K', '6-K', etc.
  headline text,
  raw_document_url text,
  filed_at timestamptz,
  catalyst_category text not null default 'unclassified',
  verification_state text not null default 'unverified', -- unverified | verified | contradicted
  confidence int,
  material_facts jsonb not null default '{}'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index if not exists prox_events_filed_at_idx on prox_events (filed_at desc);

create table if not exists prox_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references prox_events(id) on delete cascade,
  evidence_type text not null default 'primary_filing',
  url text not null,
  excerpt text,
  created_at timestamptz not null default now()
);

create table if not exists prox_event_tickers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references prox_events(id) on delete cascade,
  entity_id uuid references prox_entities(id),
  ticker text not null,
  match_confidence int not null,
  match_method text not null,             -- 'cik_lookup' | 'ambiguous_unresolved'
  created_at timestamptz not null default now(),
  unique (event_id, ticker)
);
create index if not exists prox_event_tickers_ticker_idx on prox_event_tickers (ticker);

insert into prox_sources (source_key, display_name, tier, base_credibility)
values
  ('sec_edgar_8k', 'SEC EDGAR — Form 8-K', 'primary', 95),
  ('sec_edgar_6k', 'SEC EDGAR — Form 6-K', 'primary', 95)
on conflict (source_key) do nothing;
