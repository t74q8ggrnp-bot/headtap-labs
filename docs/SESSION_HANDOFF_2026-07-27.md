# Session handoff — 2026-07-27 (updated 2026-07-28)

## Update 2026-07-28 — trading bot fully wired, one switch away from live

Everything below "What's in progress right now" is now further along.
Read this update section first, it supersedes some of the original text.

**Confirmed done since the original handoff:**
- Alpaca paper keys are in Vercel (`ALPACA_API_KEY`, `ALPACA_SECRET_KEY`),
  verified with a real account check (status ACTIVE, account
  `PA3U5LCNTQLK`, real balance data returned) — not just "env vars
  present," Alpaca itself accepted the credentials.
- `supabase/migrations/0003_trading_bot.sql` confirmed run in the
  correct **HT Labs** project (`htlabs-v1`, not Bettr Vision — verified
  in Table Editor).
- Position sizing changed from a flat $1,000 to **5% of current account
  equity per trade** (fetched live from Alpaca at entry time, not
  hardcoded), max 3 concurrent — both user-confirmed.
- **Exit logic rebuilt as a tiered trailing stop** (replaced the
  original flat "sell at modeled target" logic, which had the exact "oh
  we made 8%, sell" problem the user wanted to avoid):
  - Under 8% gain: no trailing yet, just the original hard stop-loss
    (from canonical `downsideRisk`).
  - 8-25% gain: trail 15% behind the peak price reached since entry.
  - Above 25% gain: trail tightened to **5%** behind the peak (was 8%,
    tightened per explicit user request — "four to five percent...
    lock in some profits").
  - Original stop-loss and 3-day max hold both still apply throughout as
    absolute backstops regardless of trailing state.
  - `target_price` is now informational only (still shows what HT Labs
    originally modeled) — the trailing stop is what actually decides
    the exit.
  - Requires `supabase/migrations/0004_bot_trades_high_water_mark.sql`
    (adds the `high_water_mark` tracking column) —
    **confirm this has been run** before enabling the bot. If it
    hasn't: a buy order could execute successfully through Alpaca but
    fail to save its tracking row (untracked open position). Same
    verify-before-enabling pattern as migration 0003.
- Re-entry after a close already works with no code change — confirmed
  with the user via a worked example (buy JEM $2 → sell $2.50 → rebuy
  $2.05 → sell $2.55, repeat). A closed position just isn't "held"
  anymore, so the ticker is fully eligible again next cycle if it still
  qualifies.

**Not yet done — the actual "go" switch**: `TRADING_BOT_ENABLED` is
still not set to `"true"`. Confirmed via live check as of this update:
`alpacaConfigured: true`, `enabled: false`. Everything is ready; this is
a deliberate, still-open decision point, not an oversight.

**New, well-scoped follow-up requested by the user — not built yet**:
a "fast rate" exit refinement. The user wants a sharp, fast drop (their
words: "drops more than four to five percent at a fast rate") to be
treated differently from a slow drift of the same magnitude — i.e., the
*velocity* of a pullback should matter, not just how far it's pulled
back. This maps directly onto data Pro X's market sensor already
computes (`prox_market_features.velocity_1m` / `acceleration_5m`) but
the trading bot currently does NOT read any Pro X data at all — it's
strategy-independent of Pro X entirely right now, reading only
`/api/opportunities`. Building this properly means:
1. Deciding exactly what "fast" means quantitatively (e.g., a specific
   `velocity_1m` threshold, or "X% pullback within N minutes" using
   `prox_market_features`'s `computed_at` timestamps to measure rate).
2. Having the trading-bot route query `prox_market_features` for each
   held ticker (a genuine, deliberate cross-system read — still fine
   architecturally, since Pro X was always meant to be usable as "a
   tool," per the user's own framing, just not done yet).
3. Deciding what happens on a "fast drop" detection: sell immediately
   regardless of the tiered trail's current threshold? Only fast-track
   the exit if already past the 8% trail-start point? This is a real
   design decision, not just an implementation detail — needs the same
   propose-concrete-numbers-and-confirm treatment as the trailing stop
   was built with.

This is a good next thing to build once picked back up — don't rush it
into a partial implementation; it deserves the same care the trailing
stop got.

Continuing work on HT Labs (headtap-labs repo). This session hit ~83% of
context; picking up in a new chat. Read this whole file before doing
anything — it captures hard-won operational gotchas, not just feature
history.

## Deploy mechanics (important, learned the hard way)

- **`git push` does NOT auto-deploy.** This Vercel project has no GitHub
  integration. Workflow after any change:
  1. Commit on the working branch (`rescue-build-passing`)
  2. `git checkout main && git merge rescue-build-passing --ff-only && git push origin main`
  3. `git checkout rescue-build-passing` (back to working branch)
  4. `vercel --prod --yes` — this is the actual deploy step
- **No direct DB access.** No service-role key value, no Postgres
  connection string. Any schema change (`CREATE TABLE` etc.) has to be
  written as a `.sql` file under `supabase/migrations/` and run manually
  by the user in the Supabase SQL Editor. The route code should fail
  closed with a clear error if the migration hasn't been run yet.
- **Two Supabase projects exist**: "HT Labs" (correct, production) and
  "Bettr Vision" (the user's other project — unrelated). Already mixed up
  once this session. Always confirm which project is selected before
  telling the user to run a migration.
- **Vercel preview URLs are auth-walled** (Vercel's own login), can't be
  screenshotted directly. To visually verify a UI change: deploy to prod
  (`vercel --prod --yes`) and check the real `gethtlabs.com` domain, or use
  `vercel deploy` (no `--prod`) + `vercel inspect` to confirm the build
  succeeded without needing to see it.
- **Next.js App Router ignores underscore-prefixed folders** — a route
  at `app/api/_foo/route.ts` silently 404s. Learned this after a wasted
  round trip; never prefix a route folder with `_`.
- **Temp/one-off diagnostic routes**: fine to create for debugging
  (matches an existing pattern — e.g. `shadow-retrieval`'s
  `exclusionSamples`), but delete them and redeploy once they've served
  their purpose. Don't leave debug routes lying around.
- **`vercel env pull` returns empty strings for sensitive env vars**
  (e.g. `SUPABASE_SERVICE_KEY`) — Vercel deliberately withholds the
  decrypted value even via authenticated CLI. Can't retrieve secrets this
  way; the app itself can still read them fine at runtime.

## What's live and working (verified against real data, not just built)

1. **Canonical scoring fixes** (`app/api/opportunities/route.ts`,
   `lib/canonical-trade-framework.ts`, `lib/breakout-potential.ts`):
   Spot Momentum and Before The Crowd were wrongly excluding genuine big
   movers (real tickers: JEM, AEHL, PN/Skycorp Solar, LABT, INLF, WBUY).
   Fixed: an "Extreme Momentum" bypass for the crowd/trap ceiling
   (≥25% change + ≥3x rvol), a magnitude-anchored `strategyScore` for
   Spot Momentum specifically, per-strategy breakout-score weighting
   (Spot Momentum ≠ Before The Crowd), a `riskTags` taxonomy
   (Parabolic Move / Extended / High Volatility / New Listing), a lower
   bar-count floor in the trade framework (recent IPOs no longer
   auto-rejected), and removed the "reward magnitude negligible" gate
   for Before The Crowd (it was rejecting exactly the "hasn't broken out
   yet" setups BTC exists to find). All verified live against production
   data (e.g. JEM went from ~$4.62 to ~$6+ after the fix let it surface).
2. **Hero card UI**: consolidated Story+ScorePanel into one panel, added
   an "Other Contenders" panel (`app/components/opportunity/MomentumContenders.tsx`),
   fixed an overlapping-numbers bug, removed subjective/unverifiable
   labels ("hero" tier text, "Position: Late", "Crowd" language) in favor
   of concrete data or removed entirely.
3. **Dead code cleanup**: removed `test-polygon` route, `edgarScanner.ts`,
   `lock-test` page, `polygon-scanner` route + `fdaScanner.ts`,
   `security-metadata` route, `fix_scanner_nav.py`. Moved signal-memory
   persistence out of `page.tsx` into `app/api/signal-memory-writer/route.ts`
   (established rule: when page.tsx duplicates a route's logic, the route
   wins, page.tsx defers to it — not the other way around).
4. **In-page Scanner grid migration** (1 of 4 planned local-scoring
   migrations): the "Ranked Attention Spike Feed" section inside
   `app/page.tsx` now reads canonical `/api/opportunities` data via
   `useOpportunityFeed`'s new `fullRankedList`, instead of a local
   ~130-stock raw board scored by `getScannerSelectionScore`.
   **Remaining 3 (not started): Signals tab, command-mode dashboard
   numbers, Watchlist card** — all still use ~20 local scoring functions
   in `page.tsx` (confirmed still live/called, not dead, via a background
   audit — they're just not migrated yet).
5. **Pro X** — a deliberately separate discovery system, does NOT feed
   the canonical engine (no decision bridge exists yet, by design):
   - Phase 1 foundation: `prox_sources`, `prox_entities`, `prox_events`,
     `prox_evidence`, `prox_event_tickers` (migration `0001_prox_foundation.sql`)
   - Phase 2: `app/api/prox-sec-connector/route.ts` — polls SEC EDGAR's
     free feed for 8-K, 6-K, and Form 4 filings every 15 min, dedupes by
     accession number, resolves ticker via SEC's own CIK mapping
     (deterministic, no AI), classifies 8-K catalysts from SEC's own Item
     numbers. Form 4 quirk handled: each filing has two linked feed
     entries (insider person + issuer company, same accession number) —
     only the "(Issuer)" one resolves to a ticker, filtered at parse time.
   - Phase 3 (partial): `app/api/prox-market-sensor/route.ts` — computes
     real velocity/acceleration/volume-acceleration/VWAP features every 2
     min for tickers with a recent Pro X event, using REST-polled minute
     bars (`prox_market_features`, migration `0002_prox_market_features.sql`).
     Verified live: current Polygon plan returns 200 for minute/second
     aggs but 403 ("not entitled") for last-trade/last-quote — true
     WebSocket streaming still needs a plan upgrade + an always-on worker,
     neither exists yet.
   - Phase 4 (partial): former company names auto-populated from SEC's
     free submissions API (`data.sec.gov/submissions/CIK....json`) into
     `prox_entities.former_names`.
   - Viewer: `/prox` page + `/api/prox-events` (read-only, refreshes every
     30s).
   - Full doc: `docs/PROX_ARCHITECTURE.md` — explicitly states what's
     built vs. deliberately deferred (Phases 5-9 don't exist: no
     verification/contradiction scoring, no decision bridge, no Realtime
     UI, no memory/calibration, no heartbeats/dead-letter/kill-switch
     safety layer).

## What's in progress right now (pick up here)

**Building a paper-trading bot** — explicitly a third, separate system
from both Pro X and the canonical HT Labs engine (user was clear on this
architecture). Built and deployed, currently safely inert:

- `app/api/trading-bot/route.ts`: reads canonical top-10 Spot Momentum
  candidates from `/api/opportunities?type=momentum&limit=10` as a
  read-only input. Has its **own independent ranking logic**, deliberately
  the *opposite* emphasis from HT Labs' display ranking: HT Labs now
  favors raw magnitude (right for a headline); the bot instead scores for
  "safest probable trade" — `entryQuality` + R:R bonus − risk-tag penalty,
  with a hard floor that disqualifies anything under 1.5 R:R outright.
  Exits reuse the canonical trade framework's own `upsideMax`/
  `downsideRisk` as take-profit/stop-loss (not invented numbers), or a
  3-day max hold, whichever hits first. $1,000 fixed notional per trade,
  max 3 concurrent positions.
- `lib/trading-bot/alpaca.ts`: hardcodes the **paper** Alpaca base URL
  (`paper-api.alpaca.markets`) — no live-trading code path exists
  anywhere in this system.
- **Two independent safety gates**, both required before it does
  anything: (1) `ALPACA_API_KEY`/`ALPACA_SECRET_KEY` must be set, (2)
  `TRADING_BOT_ENABLED` must be the literal string `"true"`. Verified
  live — currently both gates are closed, bot confirmed inert (zero
  positions checked, zero orders placed).
- `supabase/migrations/0003_trading_bot.sql` (creates `bot_trades`) —
  **needs to be confirmed run** in the correct (HT Labs, not Bettr
  Vision) Supabase project. Not yet confirmed as of this handoff.
- Viewer: `/trading-bot` page + `/api/bot-trades` (win rate, P&L, per-
  trade log).

### Immediate next steps for the new session

1. User is generating Alpaca paper API keys right now.
   **Important**: partway through, the user's screenshot accidentally
   showed the actual Key ID and Secret in plain text in chat. They were
   told to regenerate the key before use as a precaution (paper account,
   so low real-world risk, but treat any credential shown in a screenshot
   as exposed). **Confirm they regenerated it** before proceeding — don't
   assume the key from this session's screenshots is still the one in
   use.
2. Confirm `supabase/migrations/0003_trading_bot.sql` has been run in the
   HT Labs Supabase project (ask them to check Table Editor for
   `bot_trades`, same pattern used to catch the earlier Bettr Vision
   mixup).
3. Once `ALPACA_API_KEY`/`ALPACA_SECRET_KEY` are in Vercel env vars:
   redeploy, verify the bot can actually reach Alpaca (e.g. a quick
   `getAccount()` check — see `lib/trading-bot/alpaca.ts`), confirm with
   the user, **then** set `TRADING_BOT_ENABLED=true` only with their
   explicit go-ahead.
4. After the bot places its first paper trade, verify it end-to-end on
   `/trading-bot` (same "don't trust diagnostics blindly, look at real
   data" standard used throughout this session).

## Deferred / open items (not urgent, for awareness)

- `app/api/ai/route.ts`'s prompt asks for a "buy/watch/avoid/wait"
  directive — flagged as inconsistent with the "not financial advice"
  disclaimers shown elsewhere in the product. User chose to leave this
  alone for now, no action taken.
- `copy file/` and `copy file.zip` in the repo root — gitignored local
  backup artifacts, excluded from `tsconfig.json`'s compile scope (that
  exclusion is real and load-bearing — removing it breaks the build).
  User's call whether to ever delete the actual files; not touched.
- 3 of 4 local-scoring-to-canonical migrations remain (see above).
- Pro X Phases 3 (full WebSocket sensor), 4 (subsidiaries/executives/AI
  disambiguation), 5 (verification/contradiction/rumor scoring), 6 (the
  actual decision bridge into HT Labs — still doesn't exist), 7
  (Supabase Realtime UI / opportunity-card integration), 8 (outcome
  memory/calibration), 9 (heartbeats, dead-letter queue, kill switch,
  cost limits) — none built. Full picture in `docs/PROX_ARCHITECTURE.md`.

## Working style notes for whoever picks this up

- User wants every claim verified against real production data before
  being reported as working — not just "the code should do X."
  Established pattern: deploy → curl the real endpoint / query real data
  → confirm the actual numbers make sense → then report status.
- User explicitly wants router/route/table changes to fail closed with a
  clear error message when a prerequisite (migration, env var) is
  missing, rather than silently doing something wrong.
- Confirm before any deploy-affecting or destructive action; this user
  has consistently wanted a quick heads-up + confirmation before
  `vercel --prod`, schema changes, or deletions — not silent execution.
