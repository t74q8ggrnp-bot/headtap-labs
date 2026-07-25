# Pro X — architecture and scope (Phase 1 foundation)

## What Pro X is

Pro X discovers and investigates. It observes external events (SEC filings
first, more sources later) and market activity, verifies evidence, and
eventually hands a candidate package to the canonical HT Labs engine. **Pro X
never decides eligibility, scoring, or tier — that authority stays entirely
with `app/api/opportunities/route.ts` and the rest of the canonical pipeline.**
This is the same non-negotiable rule the rest of the product already
follows (see `docs/ARCHITECTURE.md`), applied to a new subsystem.

## What's built in this pass, and what isn't

This is Phase 1 (foundation) plus the first half of Phase 2 (one real
connector) from the full roadmap. Deliberately excluded from this pass:

- **No always-on worker.** The full Pro X vision (see below) calls for a
  persistent process on Railway/Render/Fly.io, mainly to hold a live Polygon
  WebSocket connection open. That's real, recurring infrastructure cost and
  a second deployable to operate — a decision for a dedicated session, not
  bundled into this one. Everything built here runs as a Vercel cron route,
  the same pattern already used by `signal-writer`, `shadow-retrieval`, and
  `catalyst-discovery`.
- **No decision bridge.** Pro X events are stored for later use. Nothing here
  reads from or writes to `ht_signal_run_rows`, `ht_signals`, or any other
  canonical table. The existing engine cannot be destabilized by this pass
  because it cannot see this pass.
- **No AI entity resolution yet.** Ticker matching is 100% deterministic —
  SEC's own CIK-to-ticker mapping (`company_tickers.json`), no inference.
  Ambiguous matches are simply left unresolved rather than guessed.
- **No UI.** Nothing in `app/page.tsx` reads from any `prox_*` table yet.

## What's real in this pass

- **Database foundation**: `prox_sources`, `prox_entities`, `prox_events`,
  `prox_evidence`, `prox_event_tickers` — see
  `supabase/migrations/0001_prox_foundation.sql`. Excludes
  `prox_market_features`, `prox_decisions`, `prox_decision_versions`,
  `prox_worker_heartbeats`, `prox_dead_letters`, which belong to the
  market-sensor, decision-bridge, and always-on-worker phases.
- **The universal event contract** (`lib/prox/types.ts`) — the normalized
  shape every future connector (FDA, IR feeds, halts, licensed news) will
  produce, so adding a second source is repeatable connector work, not a
  redesign.
- **One real connector**: `app/api/prox-sec-connector/route.ts`. Polls SEC
  EDGAR's public "latest filings" feed for Form 8-K and 6-K, deduplicates by
  accession number, resolves company → ticker via SEC's own CIK mapping, and
  classifies 8-K catalysts deterministically from the Item numbers SEC
  itself publishes (Item 2.01 = acquisition completed, Item 3.02 =
  unregistered equity sale/dilution, Item 3.01 = delisting notice — no AI,
  no guessing). Every event stores a direct link to the primary filing as
  evidence.

## Setup required (one-time, manual)

Claude does not have direct database DDL access (no service-role key value,
no Postgres connection string) — schema changes have to be applied by
whoever holds the Supabase project. Run
`supabase/migrations/0001_prox_foundation.sql` once, in the Supabase SQL
editor, before the connector will do anything useful (it fails closed with a
clear error if the tables/seed rows aren't there yet).

## The full roadmap (for later, not built yet)

Phases 3–9 from the original spec — live market sensor (Polygon WebSocket),
entity resolver (subsidiaries, name changes, AI-assisted disambiguation),
evidence/verification scoring, the canonical decision bridge, real-time
Supabase Realtime UI, outcome memory/calibration, and operational safety
(heartbeats, dead-letter queues, kill switch) — all assume an always-on
worker exists. That's the next deliberate decision point, not an assumption
baked into this pass.
