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

## Crypto display authority

`lib/crypto/decision-authority.ts` owns the backend-ranked crypto hero,
developing leader, contenders, and radar order. When no asset is qualified,
the backend may publish its highest-ranked radar observation as
`developingLeader`; that record remains entry-withheld and cannot be relabeled
as a confirmed hero by the browser. Crypto clients may format these roles but
may not select a replacement, sort them again, or change eligibility.

## Independent ProX shadow owner

`app/api/prox-shadow-board/route.ts` owns the separate, research-only ProX
shadow frame. Its score and rank are produced by `lib/prox/edge-score.ts`,
`lib/prox/market-structure.ts`, and `lib/prox/shadow-board.ts` from independent
ProX discovery and shared raw facts. It cannot read canonical conclusions as
inputs and it is not a canonical producer.

No desktop, mobile, scanner, watchlist, bot, or live-execution surface is a
consumer of the ProX shadow board. Comparing it with the canonical board is
permitted only after both atomic frames are complete. The owner-approved HT
Agent Phase 1 is the sole additional consumer: it may translate the completed
independent opinion into support, warning, veto, or abstention inside a
paper-only decision. It cannot promote a Canonical-ineligible ticker, alter
either upstream score, size on ProX authority, or route anywhere except the HT
Labs paper ledger.

## Bounded ProX Market Pulse consumer

`lib/prox/public-authority.ts` owns the separate, established ProX Market Pulse
contract. The canonical evaluator may consume that fresh raw-tape assessment
for its documented bounded rank adjustment, confirmed peak-failure block, and
deep-session-recovery withholding. This pulse is not the independent ProX Edge
board, cannot consume or publish the independent Edge Score, and cannot create
a second public score. `lib/canonical-opportunity.ts` remains the final owner of
the single public HT Labs decision.

Freshness is owned by provider market time, not server processing time.
`market_data_as_of` and `market_as_of` must be present, usable, and aligned
before the bounded pulse can support or hard-block a canonical decision.
`scanned_at` and `computed_at` remain processing/audit timestamps only. Severe
full-session peak damage may apply the versioned ordinary rank penalty; it does
not become a hard rejection without confirmed deterioration.

Verified Massive Advanced transport supplies real-time stock snapshots, last
trades, NBBO quotes, and second aggregates. Transport freshness may determine
whether an existing decision contract can act, but it does not grant the data
provider, browser, chart, or UI any scoring or eligibility authority.

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
