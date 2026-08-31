import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { buildProxEpisodeScorecard, median } from "./shadow-scorecard.ts";

const baseEpisode = {
  member_id: "member-1",
  ticker: "TEST",
  trading_date: "2026-08-24",
  market_session: "regular" as const,
  decision_at: "2026-08-24T14:00:00.000Z",
  entry_price: 10,
  max_gain_percent: 8,
  max_drawdown_percent: -3,
  sampled_high_at: "2026-08-24T14:20:00.000Z",
  sampled_low_at: "2026-08-24T14:40:00.000Z",
  disposition: "selected" as const,
  role: "hero" as const,
};

test("uses episode representatives instead of repeated five-minute frames", () => {
  const episodes = [
    { ...baseEpisode, member_outcome_id: "outcome-1" },
    {
      ...baseEpisode,
      member_outcome_id: "outcome-2",
      member_id: "member-2",
      ticker: "OTHER",
      max_gain_percent: 2,
      max_drawdown_percent: -6,
      sampled_high_at: "2026-08-24T14:50:00.000Z",
      sampled_low_at: "2026-08-24T14:10:00.000Z",
    },
  ];
  const scorecard = buildProxEpisodeScorecard(
    [
      {
        member_outcome_id: "outcome-1",
        horizon: "15m",
        return_percent: 6,
        resolution_state: "measured" as const,
      },
      {
        member_outcome_id: "outcome-2",
        horizon: "15m",
        return_percent: -4,
        resolution_state: "measured" as const,
      },
    ],
    episodes,
  );

  assert.equal(scorecard.episodeCount, 2);
  assert.equal(scorecard.measuredEpisodeCount, 2);
  assert.deepEqual(scorecard.byDispositionHorizon[0], {
    disposition: "selected",
    horizon: "15m",
    sampleSize: 2,
    averageReturnPercent: 1,
    medianReturnPercent: 1,
    positiveReturnRatePercent: 50,
  });
  assert.equal(
    scorecard.byDisposition[0].plusFiveBeforeMinusFiveHitRatePercent,
    50,
  );
});

test("reports medians so a single explosion cannot own the scorecard", () => {
  assert.equal(median([1, 2, 100]), 2);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([]), null);
});
