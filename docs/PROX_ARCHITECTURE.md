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

## Update — Phase 3 and Phase 4, partial

Verified live against the current Polygon plan before building anything:
minute and second aggregate bars return 200, but last-trade and last-quote
return 403 ("not entitled, upgrade required"). That means true tick-by-tick
WebSocket streaming still needs the plan upgrade plus an always-on worker —
neither exists yet — but REST-polled minute bars are usable right now, at
no extra cost.

- **`app/api/prox-market-sensor/route.ts`** (Phase 3, partial): for tickers
  with a Pro X event in the last 48 hours, pulls the last 30 one-minute
  bars from Polygon and computes real features — 1-min velocity, 5-min
  acceleration, volume acceleration, VWAP relationship, dollar volume —
  into `prox_market_features` (one upserted row per ticker, latest
  snapshot only, not a full history yet). Runs every 2 minutes, tighter
  than the 5-minute canonical cron, per the acceptance criteria. This is
  the "event appeared → monitor affected ticker" direction only; "price
  moved → investigate external cause" needs scanning the broad market,
  not just event-linked tickers, and isn't attempted this pass. It also
  does not generate "investigation events" or make any decision — it only
  computes and stores features. That line is deliberate: turning a feature
  into a decision is exactly the boundary Phase 6 owns.
- **Former-name resolution** (Phase 4, partial), added to
  `prox-sec-connector`: SEC's own submissions API
  (`data.sec.gov/submissions/CIK....json`) publishes each company's
  former names with date ranges. Free, deterministic, fetched once per
  entity (new entity, or one whose `former_names` is still empty — former
  names don't change, no reason to refetch). Makes "corporate name changes
  don't break event history" real instead of a schema placeholder.

## The full roadmap (for later, not built yet)

The rest of Phase 3 (true WebSocket streaming, the reverse "price moved"
direction, halt status, float turnover) and all of Phases 4's remaining
scope (subsidiaries, executives, drug names, AI-assisted disambiguation for
ambiguous cases), 5 (contradiction/rumor/recycled-news scoring), 6 (the
canonical decision bridge — still nothing connects Pro X to HT Labs), 7
(Supabase Realtime UI, opportunity-card integration), 8 (outcome memory/
calibration), and 9 (heartbeats, dead-letter queues, kill switch, cost
limits) — none of that exists yet. That's the next deliberate decision
point, not an assumption baked into this pass.
