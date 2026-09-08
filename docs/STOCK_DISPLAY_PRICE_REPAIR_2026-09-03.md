# Stock display price/clock pairing — September 3, 2026

## Incident and evidence

Owner reported CHPT at 7.555 on mobile versus 7.5369 on desktop. We did not
capture those exact observations and cannot assign their specific cause without
their provider timestamps and the mobile build/page identity.

The concurrent production audit at approximately 09:42:42 Eastern did reproduce
a separate source defect: `/api/bulk-quote` returned 7.58 with provider time
13:42:42.070Z while two chart requests returned 7.6497 at 13:42:42.207Z.
A direct Massive snapshot at 13:42:47 showed day/minute close 7.58,
minute time 13:41:00, and last trade 7.64 at 13:42:47.125Z.

The shared Canonical-era price resolver rejected trade/minute prices more than
35% away from the reference close (CHPT previous close 5.19). Display endpoints
could then pair the retained day close with the separately selected newest
trade timestamp. This made older prices appear current.

## Narrow repair

- Added `resolveStockDisplayPrice`, used only by the three display endpoints.
- Price and timestamp are selected together from one valid provider observation.
- Latest timestamp wins across direct trade, snapshot trade and timestamped
  minute close. Undated day/previous closes cannot borrow a trade clock.
- Missing, invalid, non-positive and future observations are rejected. Retained
  historical observations keep their original timestamp; no freshness reset.
- Minute aggregate fallback is explicit and cannot be labeled a live trade.
- Chart merges the selected display observation into its series; the existing
  client rejects inconsistent quote/last-candle/summary combinations.

The existing Canonical resolver and all scoring, eligibility, Agent risk limits,
paper execution and CoinAPI budget settings remain unchanged.

## Verification and limits

- 361 main tests passed; five real-route regression tests passed.
- TypeScript, focused lint, whitespace check and local production build passed.
- CHPT fixture uses the same provider evidence through bulk, quote and chart
  handlers, then checks two independent browser stores against the result.
- Tests explicitly demonstrate the limit of separate browser polling: one device
  may observe a newer trade before the other polls. That is not fixed by an
  in-memory store shared only within one page.
- Selected charts still poll at five seconds; quote lists at ten seconds.
  This repair is NOT a durable shared backend stream or a promise of identical
  prices across devices at every instant. Provider times must be compared too.
- The local Capacitor configuration loads `https://gethtlabs.com`; the installed
  iPhone binary/version has not been independently verified.
- `tools/check-stock-display.mjs` performs a bounded live endpoint check with
  desktop/mobile User-Agents. That does not replace physical-device UI testing.

## Production checkpoint and remaining blockers

Deployed `dpl_AfCvMAi8NiAJ2k57eAk95WnMWNmw`, aliased to `gethtlabs.com`.
Production's default Turbopack build passed. Before adding this result section,
all 424 deployed source files matched local SHA-1 hashes; no files were missing.
The dirty Git checkout was preserved; no new Git commit was made.

At 09:56:15 Eastern, the bounded live comparison returned:

| Request | Price | Provider timestamp (UTC) | Age on receipt |
| --- | ---: | --- | ---: |
| Desktop chart API | 7.2019 | 13:56:15.435Z | 324 ms |
| Mobile chart API | 7.2199 | 13:56:15.362Z | 259 ms |
| Quote-list API | 7.201 | 13:56:15.170Z | 231 ms |
| Single-quote API | 7.2019 | 13:56:15.435Z | 282 ms |

Each chart's quote, last candle and summary close matched exactly. Same-timestamp
prices matched. Separate requests still observed different genuine trades;
there is **no claim of complete cross-device synchronization**.

Rendered-page verification could not finish: the production homepage remained
on its server loading screen. The system-health request timed out after 50
seconds; opportunities/crypto opportunities timed out after 12 seconds.
Mobile-capabilities returned 200 in 208 ms and the Massive-only display reads
returned promptly.

Production logs on BOTH the prior and repaired deployments show storage-unavailable
collector errors and 60–300 second timeouts across ProX, opportunities and paper
matching. Direct public-role Supabase Auth health and REST reads each timed out
after 10 seconds. This isolates a separate service-connectivity/availability
problem, but not its project-specific root cause. No project restart, database
reset, health-criteria relaxation or credit-limit change was performed.

Supabase's public status page was inspected; it listed an ongoing JWT/401 incident,
but these observed timeouts are not evidence that HT Labs has that particular
incident. Do not claim a confirmed global provider outage.

No new SQL is needed for this stock display repair. The owner has since confirmed
the separate CoinAPI allowance: 1,000 total, 900 reserved, 100 remaining. Its live
validation is blocked by database availability, not by a missing allowance update.
