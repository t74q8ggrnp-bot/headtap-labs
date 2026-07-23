# HT Labs cleanup audit

Date: 2026-07-20

## Confirmed and completed

- Removed the permanently disabled Social Momentum JSX block.
- Removed the old marketing `#home` section, which was hidden by both its own
  class and global `!important` CSS and therefore could never render.
- Removed the obsolete CSS selectors that existed only to hide `#home`.
- Confirmed there are no remaining zero-consumer scoring helpers in
  `app/page.tsx` after the ownership sweep.
- Removed the permanently hidden Premium Terminal, its three private scoring
  blocks, its obsolete CSS selectors, and ticker search's stale scroll target.
- Added an active-session freshness gate: signals older than 20 minutes cannot
  rank as opportunities during pre-market, regular trading, or after-hours.
- Aligned system health with that same active-session freshness limit.
- Centralized security-metadata caching/enrichment for production and shadow
  retrieval. Production now fails closed on unknown or unsupported instrument
  types before promotion, and eligibility applies the same defensive gate.
- Migrated the selected-ticker detail experience on desktop and mobile to one
  normalized `/api/opportunity-ticker` evaluation. Local detail-modal score,
  confidence, crowd, risk, bias, and trade-plan derivations were removed.
- Migrated bell notifications from the raw quote board to canonical eligible
  feature/hero opportunities. Rejected, stale, unsupported, and local recovery
  candidates cannot produce alerts, and source-run refreshes do not spam repeats.
- Migrated Watchtower leader, rotation, chase-risk, and summary cards to the
  canonical eligible opportunity feed. It no longer promotes raw-board leaders,
  local recovery candidates, or weak-tape noise as a competing stock opinion.
- Removed the retired browser-side recovery engine, recovery cards, recovery
  ranking, reversal radar entry, and null compatibility state. The secondary
  opportunity list now renders only canonical backend-approved records.
- Rebuilt Signal Replay from persisted canonical opportunity facts. Removed
  fabricated historical timestamps, estimated detection prices, synthetic
  expansion claims, raw-board sector rankings, and raw-board replay alerts.
- Migrated Market Narrative, narrative rotation, change summaries, and Live
  Desk commentary to canonical eligible opportunities. Broad market pulse stays
  contextual, but it can no longer promote or score an unapproved ticker.

## Next safe migration

Audit the remaining command-mode allocation, narrative-memory, and catalyst
panels before retiring their raw-board score and interpretation helper chains.

## Live legacy consumers requiring migration first

- Several command-mode dashboard sections still consume local market narrative,
  signal-memory, portfolio, and trader-profile helpers.
- The local board is still sorted by `getScannerSelectionScore` before it feeds
  secondary legacy surfaces. It no longer selects the canonical homepage hero.

These areas must be replaced or intentionally retired one complete consumer at
a time before their helper chains are deleted.

## Routes requiring external-use confirmation

The repository contains no confirmed in-app caller for:

- `/api/polygon-scanner`
- `/api/security-metadata`
- `/api/signal-memory-writer`
- `/api/system-health`
- `/api/test-polygon`

They may be manual diagnostics, Vercel jobs, or externally called endpoints.
Do not delete them until Vercel configuration, scheduled jobs, and operational
usage are checked. `/api/social-intel` is used by the QA page, and
`/api/scanner_expansion` and `/api/trade-framework` are used by the home page.

## Repository clutter requiring explicit cleanup checkpoint

- `copy file/`
- `copy file.zip`
- `app/lock-test/`
- `app/api/test-polygon/`

These are excluded from automatic deletion because backups and diagnostics may
still be intentionally retained by the owner. They should be archived outside
the application repository or removed in a dedicated cleanup checkpoint.

## Verification policy

Every cleanup group must pass:

1. `npx tsc --noEmit`
2. `git diff --check`
3. `npx next build --webpack`
4. route inventory review
5. desktop/mobile canonical-data comparison for any changed product surface
