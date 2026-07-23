# HT Labs scoring ownership

## Product rule

The browser is a presentation client. It must not select, promote, reject, or
re-score a market opportunity. Canonical opportunity decisions come from the
server pipeline and are transported through `lib/opportunity-model.ts`.

## Canonical owners

- `app/api/opportunities/route.ts`: eligibility, strategy ranking, tiers, and
  the promoted Spot Momentum / Before the Crowd records.
- `app/api/opportunity-ticker/route.ts`: canonical single-ticker evaluation.
- `lib/canonical-trade-framework.ts`: adjusted-history opportunity window,
  downside risk, risk/reward, extension risk, and hard framework failures.
- `lib/breakout-potential.ts`: observed breakout fuel from volume, momentum,
  catalyst, crowd timing, trap safety, move stage, and technical room. It does
  not claim float intelligence until a verified float source is connected.
- `lib/security-type-policy.ts`: security-type eligibility.
- `lib/polygon-snapshot.ts`: current snapshot price and change normalization.
- `lib/opportunity-model.ts`: transport normalization and display-only labels.

## Canonical consumers

- Desktop Spot Momentum and Before the Crowd cards.
- Mobile Spot Momentum, Before the Crowd, swipe detail, and Top Convictions.
- Scanner opportunity records.
- Mobile watchlist when a ticker has a current canonical evaluation.
- Watchtower, Signal Replay, Market Narrative, and Live Desk opportunity reads.

An unevaluated watchlist ticker is labeled `Not ranked`; the browser must not
manufacture a score for it.

## Legacy local intelligence still in `app/page.tsx`

The remaining local helpers support secondary legacy surfaces such as older
dashboard panels, market narrative, signal memory, and portfolio context. They
are not authorized to choose or overwrite the canonical homepage opportunities.
These consumers should be migrated or retired incrementally before their helper
chains are deleted.

## Audit result — 2026-07-20

- Removed the local Spot Momentum selector and hysteresis system.
- Removed the local Before the Crowd selector and thesis scoring system.
- Removed duplicate desktop/mobile opportunity scoring.
- Removed 40 proven orphaned scoring or interpretation helpers in the first
  ownership sweep.
- Preserved every helper with a live consumer.
- TypeScript, diff checks, and the full production build are required after
  every removal group.

## Regression rule

Any new primary opportunity field must be added to the backend response and the
shared opportunity contract first. A component may format a canonical value,
but it may not derive a replacement score, winner, risk classification, or
eligibility decision.
