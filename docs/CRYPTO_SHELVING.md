# Crypto product shelving contract

Status: intentionally shelved from the public HT Labs product as of September 8, 2026.

This is a reversible product boundary, not a deletion. Crypto source, tests, UI
components, migrations, historical decision frames, observations, CoinAPI
research evidence, and manual paper accounts/orders/fills/positions remain in
the repository and database. The preservation checkpoint immediately before
this boundary is commit `11662536b9c20cd5b0124325c6ebd987646d1b9e`.

## Authoritative switch

`lib/crypto/product-capabilities.ts` is the sole product capability contract.
Public UI, public API, provider collection, paper order entry, paper matching,
CoinAPI research collection, and CoinAPI evidence maintenance default to
`false`. Reactivation requires a reviewed code change. Environment variables,
database settings, direct HTTP requests, and old cron configuration cannot
override the contract.

While shelved:

- `/crypto`, `/crypto/research`, and `/paper/crypto` return a pre-render 404.
- Crypto public, research, diagnostic, collection, and paper APIs return the
  same sanitized unavailable response before authentication, database, or
  provider work begins.
- The crypto branch of `/api/market-chart` is unavailable; its stock branch is
  unchanged.
- `vercel.json` contains no `/api/crypto/*` schedule.
- New crypto paper accounts, previews, submissions, and cancellations are
  unavailable. Automatic matching returns a zero-work `shelved` receipt and
  cannot fill an existing order.
- System health reports one green `crypto_product_status` check with state
  `intentionally_disabled`. That check inspects the deployed Vercel schedule
  list and includes bounded, read-only timestamps for the last recorded public
  collection and CoinAPI request, plus the dormant database toggle. Historical
  crypto warnings are preserved in code but excluded from overall product
  health until reactivation. The retained timestamps are audit evidence, not a
  freshness requirement and not permission to collect.

No production data should be deleted, backfilled, expired, cancelled, filled,
or otherwise mutated as part of shelving. Any preexisting open crypto paper
orders must be reconciled and explicitly cancelled or accepted by the owner
before matching is restored.

## Findings preserved for the rebuild

The September 8 audit remains authoritative. Its developing-leader history
gap (C6) was fixed at the preservation checkpoint. The remaining findings are
deliberately not repaired by this task:

- C1–C5: quote-time validation, atomic persistence, reader-triggered provider
  fan-out, expensive paper reads, and paper-matcher/collector coupling.
- C7–C14: timestamp consistency, decision/display reconciliation, research UI
  read coupling, distributed rate limiting and caching, deep frame validation,
  broad CoinAPI frames, single-venue explanation, and identity/price venue
  provenance.

See `ht-labs-crypto-system-audit-2026-09-08.md` in the archived audit output for
the evidence, severity, and proposed architecture.

## Reactivation gate and order

Reactivation must proceed in separate reviewed changes and in this order:

1. Re-run the full crypto audit and resolve or explicitly accept C1–C5 and
   C7–C14. Verify provider entitlements and measured cost per cycle.
2. Reconcile every preexisting open paper order and reservation without
   fabricating fills, prices, cancellations, or expirations.
3. Restore provider collection in shadow mode only. Add its schedule only
   after proving provider timestamps, atomic writes, deduplication, rate
   limits, budget enforcement, and zero reader-triggered fan-out.
4. Restore internal/operator UI and validate coverage, freshness, and evidence
   integrity without affecting public health or stock behavior.
5. Restore CoinAPI research collection only with explicit owner approval of
   the paid budget and an enforced hard cap. Restore evidence maintenance as a
   separate capability.
6. Restore crypto paper reads, then order entry, and finally matching after an
   observable order lifecycle test. Keep real execution and Agent X disabled.
7. Restore public API and public UI last, including web/iOS capability
   declarations, route metadata, navigation, charts, and responsive testing.

Each stage requires focused tests, the full suite, TypeScript, changed-file
lint, an optimized production build, clean diff validation, and a green system
health result. Deployment and provider calls require explicit owner approval.
