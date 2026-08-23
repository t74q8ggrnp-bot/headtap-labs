# HT Labs paper trading bot contract

## Authority

There is one trading bot. It is paper-only and uses Alpaca's hardcoded paper
API. No live-trading URL or second bot exists.

`TRADING_BOT_ENABLED=true` authorizes position management. New entries require
the separate `TRADING_BOT_ENTRY_ENABLED=true` switch. Turning entries off must
never disable management of existing paper positions.

Independent ProX Edge remains research-only. Its observations may be recorded
and compared with outcomes, but they cannot rank, veto, size, open, or close a
bot position without a separate measured promotion and explicit owner approval.

## Bot v3 entry contract

`lib/trading-bot/decision.ts` owns the single versioned 0-100 entry score for
standard, continuation, and verified price-discovery candidates. The browser
does not calculate it.

An entry must clear all of the following before ranking:

- canonical entry eligibility, or the narrowly documented verified
  price-discovery visibility exception;
- positive full-session movement;
- non-negative movement from the current session open;
- at least 2x relative volume;
- canonical opportunity score of at least 55;
- Strong Momentum or confirmed continuation;
- entry quality of at least 20;
- measurable structural downside and continuation capacity;
- effective reward/risk of at least 1.5:1; and
- unified bot score of at least 70.

The score contract is:

```text
40% observed canonical opportunity
+ 20% continuation evidence
+ 20% raw entry quality
+ 20% effective reward/risk quality
- distinct execution-risk penalties
```

The result is clamped to 0-100. Extension is not added back and is not
double-counted because raw entry quality already contains it.

## Entry pacing and integrity

Six positions are maximum capacity, not a target. New entries are limited to
three per rolling 24 hours and separated by at least 30 minutes. A normal
candidate must qualify in two nearby cycles; only a score of at least 85 may
use the immediate fast path.

Every v3 entry requires a successful candidate decision receipt. Missing
analytics schema, failed receipt writes, orphaned Alpaca positions, stale or
missing decision evidence, and position-count disagreement fail closed for new
entries while existing-position management continues.

## Measurement

Entry performance must be reported separately by bot logic version, entry
path, score bucket, and exit reason. Operational closures with missing realized
P&L are not flat trades. Orphan reconciliations remain visible in account P&L
but are excluded from entry-logic expectancy because their original decision
snapshot is not recoverable. Always report P&L both with and without the
largest winner.

Any future score or gate change requires a version bump, deterministic tests,
measured historical replay, and explicit owner approval before enabling new
paper entries.
