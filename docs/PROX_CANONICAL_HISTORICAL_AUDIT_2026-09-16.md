# ProX / Canonical historical audit — 2026-09-16

## Scope and authority

This is a read-only research audit. It does not change Canonical scoring,
ranking, eligibility, ProX scoring or cadence, Agent X authority, risk gates,
Paper behavior, worker behavior, provider policy, or execution authority.

The evaluator pairs an independent ProX episode to at most one Canonical
observation when ticker identity matches, provider clocks are within 120
seconds, and decision clocks are within 180 seconds. Missing, unavailable,
misaligned, duplicate, and incomplete outcomes remain excluded rather than
becoming zero returns.

## Execution receipt

- Requested lookback: 89 days, from 2026-06-19 through 2026-09-16 UTC.
- Read strategy: non-overlapping seven-day windows with adaptive subdivision
  only where an existing database statement limit required a smaller window.
- Successful windows: 14.
- Failed windows: 0.
- Provider requests: 0.
- Database writes: 0.
- Automatic authority changes: 0.

The requested lookback is longer than the usable paired history. Canonical
observations begin earlier, while measured paired outcomes are concentrated in
the recent production period beginning August 31. It is not a 30-session
calibration sample.

## Coverage

| Measure | Count |
| --- | ---: |
| Canonical observations read | 99,164 |
| Independent ProX episodes read | 4,935 |
| Timestamp-aligned, non-reused pairs | 897 |
| Complete parent outcomes | 565 |
| Paired outcomes still pending | 332 |
| Pairs with measured 1-hour return | 434 |
| Excluded ProX episodes | 4,038 |

Exclusions were 1,975 missing ProX provider clocks, 1,247 provider-clock
misalignments, 645 tickers without a Canonical counterpart, 167 decision-clock
misalignments, and 4 attempts to reuse an already paired Canonical
observation. These exclusions describe historical compatibility and coverage;
they are not losses.

The research floor remains unmet. Although the paired-episode count exceeds
500, the measured one-hour count is 434 rather than 500 and the evidence does
not span the required 30 distinct trading sessions.

## Outcome summary

| Horizon | Measured | Positive | Positive rate | Median return |
| --- | ---: | ---: | ---: | ---: |
| 5m | 451 | 165 | 36.59% | -0.570% |
| 15m | 439 | 147 | 33.49% | -1.172% |
| 30m | 435 | 156 | 35.86% | -1.373% |
| 1h | 434 | 151 | 34.79% | -1.507% |
| 4h | 393 | 131 | 33.33% | -2.762% |
| Session close | 433 | 135 | 31.18% | -3.694% |
| Next session | 358 | 109 | 30.45% | -4.663% |
| 24h | 319 | 101 | 31.66% | -5.061% |

Across the 565 completed parents, median maximum gain was +11.385% and median
maximum drawdown was -17.506%. The `+5% before -5%` rate was 52.21%; the
`+10% before -5%` rate was 38.41%. This is a heavy-tailed, high-volatility
population. A negative fixed-horizon return does not prove that no tradeable
move occurred, and a large MFE does not prove that the current entry, stop, or
target could capture it.

Using the locked primary miss definition—measured one-hour return less than or
equal to zero—283 of 434 observations were misses (65.21%), with a median miss
return of -4.465%.

## Diagnostic patterns

These comparisons are observational and correlated. They do not establish
that changing a score or rule would have caused a better result.

| Diagnostic group | Measured 1h | Positive rate | Median 1h |
| --- | ---: | ---: | ---: |
| Before the Crowd | 117 | 50.43% | +0.048% |
| Spot Momentum | 317 | 29.02% | -2.751% |
| ProX calibrated | 202 | 38.61% | -0.628% |
| ProX live-only | 155 | 36.13% | -1.460% |
| ProX emerging | 77 | 22.08% | -5.283% |
| ProX blocked | 249 | 38.15% | -0.901% |
| ProX selected | 171 | 29.82% | -2.315% |
| Canonical only selected | 196 | 40.82% | -0.776% |
| Both selected | 129 | 26.36% | -2.612% |
| ProX only selected | 42 | 40.48% | -1.390% |
| Both withheld | 67 | 29.85% | -1.840% |

Canonical score bands were not monotonic in this sample. The 90–100 band had
41 measured one-hour observations, a 29.27% positive rate, and a -8.603%
median. The 80–89 band had 50 observations, a 40.00% positive rate, and a
-0.496% median. This is a warning to inspect extension, entry timing, market
session, and overlapping selection effects; it is not evidence that high
Canonical scores should be penalized.

Likewise, independent ProX selection did not outperform blocked episodes in
this period, and agreement between Canonical and ProX did not produce the best
one-hour group. Because ProX disposition, readiness, time, ticker population,
and Canonical lane are not randomized, these comparisons cannot be read as a
causal ProX failure or as justification for a veto, weight, or rank change.

## Agent X and target calibration

The existing latest bounded Agent cohort read did not contain measured 15m
outcomes for its would-enter groups, and the recent seven-day visual-plan read
contained zero plan lifecycle rows. Therefore this audit cannot yet estimate
whether Agent X target one, target two, or the full Canonical-plus-ProX gate
improves realized outcomes. The absence remains unavailable evidence, not a
zero hit rate.

## Candidate hypotheses for later validation

1. Test whether `emerging` ProX readiness consistently identifies poorer
   one-hour continuation than `live_only` or `calibrated` on later sessions.
2. Test whether the apparent Before the Crowd advantage survives matching on
   session, score band, price/extension, liquidity, and decision time.
3. Test why `both_selected` underperformed `canonical_only` in this sample,
   including selection timing and correlated high-volatility names.
4. Inspect the non-monotonic 90–100 Canonical band for entry extension and
   timing effects without changing the score definition.
5. Evaluate Agent X targets only after immutable plan lifecycle evidence has a
   complete triggered-plan denominator.

Each hypothesis needs a frozen definition, a date-based training/evaluation
split with an embargo, at least the existing 30-session/500-pair/500-measured
floor, and confirmation on later unseen sessions. Any production rule change
requires separate owner approval, a version bump, regression coverage, and an
explicit rollback. No conclusion in this report grants ProX public ranking or
execution authority.

## ProX theory diagnosis and prospective correction

The audit exposed three score-theory risks worth measuring prospectively:

1. `prox-edge-score-v2` adds evidence confidence to its Edge Score even though
   confidence describes trustworthiness rather than bullish direction.
2. An `emerging` comparable-outcome sample can enter continuation scoring at
   its raw observed rate; it is not shrunk toward a neutral prior in proportion
   to sample size.
3. Optional evidence is removed from the weighted-average denominator when it
   is unavailable, while extension receives a fixed penalty against momentum
   components that can saturate. Candidate scores therefore may not be fully
   comparable across evidence coverage, and highly extended impulses may
   retain too much apparent continuation strength.

These are theory and calibration concerns, not proof that any one component
caused the observed losses. The current sample remains short, correlated, and
below the promotion floor.

`prox-edge-theory-challenger-v1` is the approved zero-authority correction for
future measurement. It records a second research opinion at the same decision
time while leaving the frozen v2 score, board selection, Canonical, Agent X,
Paper, and execution unchanged. It removes evidence confidence from bullish
score direction, uses it as a qualification floor, shrinks comparable outcomes
toward 50 according to sample size, holds missing optional evidence at a
neutral prior under a fixed denominator, and replaces the fixed extension
deduction with a continuous extension/exhaustion penalty. It is not a public
or production scoring change. Promotion requires unseen-session evidence and
the normal owner-controlled ladder.
