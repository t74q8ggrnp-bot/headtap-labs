# HT Labs Architecture

This file is the source-of-truth map for where HT Labs behavior belongs.
New scoring or eligibility logic must not be added to a page or component.

## Canonical pipeline

```text
Polygon/news inputs
  -> catalyst discovery + signal writer
  -> run-scoped Supabase rows
  -> canonical trade framework
  -> opportunities API eligibility/ranking
  -> shared opportunity model
  -> Home / Scanner / mobile display
```

## Ownership rules

| Concern | Owner | Frontend responsibility |
| --- | --- | --- |
| Snapshot price and daily change | `lib/polygon-snapshot.ts` | Display only |
| Security-type eligibility | `lib/security-type-policy.ts` | Display rejection reason only |
| Trade levels and R:R | `lib/canonical-trade-framework.ts` | Format returned values only |
| Catalyst classification | `app/api/catalyst-discovery/route.ts` | Display returned category only |
| Candidate retrieval and scoring writes | `app/api/signal-writer/route.ts` | None |
| Spot Momentum / BTC hard gates and ranking | `app/api/opportunities/route.ts` | Select first returned eligible item |
| Single-ticker canonical evaluation | `app/api/opportunity-ticker/route.ts` | Display response only |
| Opportunity response normalization | `lib/opportunity-model.ts` | Consume normalized model |
| Opportunity fetch lifecycle | `app/hooks/useOpportunityFeed.ts` | Render loading/error/data state |
| Shared market-stock shape | `lib/contracts/market.ts` | Use the shared type |

## Product surfaces

| Surface | Primary data source | Intended role |
| --- | --- | --- |
| Home Top Opportunity | `/api/opportunities?type=momentum` | Display the backend winner |
| Home Before The Crowd | `/api/opportunities?type=before_crowd` | Display the backend BTC winner |
| Full Scanner | `/api/opportunities` | Filter/sort canonical results without rescoring |
| Mobile Scanner | `/api/opportunities` | Mobile presentation of the same results |
| Ticker detail | `/api/opportunity-ticker` | Explain one backend evaluation |

## Background jobs

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/api/catalyst-discovery` | Every 5 minutes during configured market windows | Find and classify fresh news catalysts |
| `/api/signal-writer` | Every 5 minutes during configured market windows | Build and promote canonical signal runs |
| `/api/shadow-retrieval` | Every 5 minutes during configured market windows | Evaluate retrieval changes without controlling production |
| `/api/outcome-tracker` | After the trading session | Record signal outcomes |

## Page cleanup status

`app/page.tsx` still contains legacy local scoring helpers used by secondary and
detail panels. They are migration targets, not approved sources of truth.

Migration order:

1. Top Opportunity and Before The Crowd cards.
2. Mobile conviction/details.
3. Ticker-detail modal.
4. Secondary intelligence panels.
5. Delete local scoring helpers after their final consumer is removed.

## Non-negotiable consistency rules

1. A component cannot calculate eligibility, rank, or a replacement score.
2. Desktop and mobile must consume the same normalized opportunity object.
3. No locally generated ticker may appear when the backend returns an empty list.
4. A price inconsistent with adjusted history must fail closed.
5. Catalyst labels must come from an explicit classified event, not generic UI keywords.
6. R:R and upside values must come from the canonical framework and pass its hard gates.
