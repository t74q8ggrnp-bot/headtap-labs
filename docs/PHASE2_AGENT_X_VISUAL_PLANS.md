# Phase 2 — Agent X visual paper plans

## Authority and safety

- Canonical remains the only detection, eligibility, ranking, and promotion authority.
- Independent ProX may support, warn, veto, or abstain. It does not rescore Canonical and cannot execute.
- Agent X visual plans are paper-only explanatory objects. `executionAuthority` is always `none`.
- A visual plan never reads `ht_stock_display_frames`; those frames remain presentation-only.
- Paper handoff is an explicit user review through the existing Paper Trading validator. No live brokerage path is introduced.
- Missing evidence produces `No current plan`. Production never receives fixture or synthetic levels.

## Time contract

The V1 policy is `agent-x-visual-plan-expiry-v1-15-provider-minutes`.

- Plan evidence begins on the first complete one-minute provider candle after the source observation.
- A plan expires after 15 complete provider minutes or at the applicable premarket, regular, or after-hours session boundary, whichever comes first.
- Plans never carry overnight.
- Lifecycle evaluation always uses completed Massive one-minute bars, regardless of whether the user displays 1m, 5m, or 15m candles.
- A candle that proves both sides of an otherwise unknowable stop/target sequence enters `needs_review_ambiguous`. Ordering is never guessed.

## Rollout gates

Migrations `0052` and `0053` install all Phase 2 infrastructure with these safe defaults:

- `visual_plan_mode = off`
- `visual_plan_lifecycle_enabled = false`
- `visual_plan_paper_handoff_enabled = false`
- symbol scope limited to SPY and QQQ

After migrations, verify:

```sql
select public.ht_agent_phase2_visual_plan_infrastructure_health();
```

The returned `verified` value must be true before changing any gate.

1. Shadow: set `visual_plan_mode = 'shadow'` and lifecycle enabled. Keep paper handoff disabled. Confirm idempotency, completed-minute evidence, worker freshness, no ambiguous auto-resolution, and provider-request telemetry.
2. Visible: set `visual_plan_mode = 'visible'` only after the shadow checks pass. Keep the initial symbol scope at SPY/QQQ.
3. Paper review: enable `visual_plan_paper_handoff_enabled` only after the existing Paper Trading validator passes plan provenance, duplicate, lifecycle, freshness, and kill-switch checks.
4. Universal tickers: expand the symbol scope only after SPY/QQQ production evidence is clean.

No rollout step changes scoring, ProX authority, HT Agent risk rules, or paper execution behavior.

## Rollback

Rollback is non-destructive and immediate: set `visual_plan_mode` to `off`, then set lifecycle and paper handoff to false. Historical plans, evidence, lifecycle events, and worker receipts remain immutable for audit. Do not drop tables or rewrite past plan versions.

## Telemetry

`ht_agent_visual_plan_worker_runs` records plan count, unique symbols, incremental provider requests, accepted completed-minute evidence, and transition counts. The lifecycle work shares the existing one-minute HT Agent outcomes worker, so one symbol is fetched at most once per worker cycle and can reuse an outcome request for the same symbol.
