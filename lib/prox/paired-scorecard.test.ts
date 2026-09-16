import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { buildProxCanonicalPairedScorecard, type CanonicalPairCandidate, type ProxPairCandidate } from "./paired-scorecard.ts";

const canonical = (overrides: Partial<CanonicalPairCandidate> = {}): CanonicalPairCandidate => ({
  id: "canonical-1",
  ticker: "SPY",
  strategy: "spot_momentum",
  decisionAt: "2026-09-16T14:30:30.000Z",
  providerAt: "2026-09-16T14:30:25.000Z",
  price: 500,
  score: 80,
  role: "hero",
  rank: 1,
  sourceRunId: "canonical-run",
  engineVersion: "canonical-v1",
  ...overrides,
});

const prox = (overrides: Partial<ProxPairCandidate> = {}): ProxPairCandidate => ({
  episodeId: "episode-1",
  memberId: "member-1",
  ticker: "SPY",
  tradingDate: "2026-09-16",
  marketSession: "regular",
  decisionAt: "2026-09-16T14:30:45.000Z",
  providerAt: "2026-09-16T14:30:40.000Z",
  price: 500.1,
  edgeScore: 75,
  continuationProbability: 70,
  evidenceConfidence: 80,
  readiness: "calibrated",
  disposition: "selected",
  role: "hero",
  rank: 1,
  engineVersion: "prox-board-v1",
  edgeScoreVersion: "prox-edge-v1",
  maxGainPercent: 8,
  maxDrawdownPercent: -2,
  sampledHighAt: "2026-09-16T14:45:00.000Z",
  sampledLowAt: "2026-09-16T14:50:00.000Z",
  horizons: { "5m": 1, "15m": 3, "1h": 6 },
  ...overrides,
});

test("pairs only the same ticker with aligned provider and decision clocks", () => {
  const report = buildProxCanonicalPairedScorecard([canonical()], [prox()]);
  assert.equal(report.coverage.pairedEpisodeCount, 1);
  assert.equal(report.pairs[0].alignment.providerSkewSeconds, 15);
  assert.equal(report.pairs[0].alignment.decisionSkewSeconds, 15);
  assert.equal(report.pairs[0].selection.agreement, "both_selected");
  assert.equal(report.comparisons.byAgreement.bothSelected.pairCount, 1);
});

test("missing and misaligned evidence is excluded instead of scored as zero", () => {
  const report = buildProxCanonicalPairedScorecard(
    [canonical()],
    [
      prox({ episodeId: "missing-clock", memberId: "missing-clock", providerAt: null }),
      prox({
        episodeId: "misaligned",
        memberId: "misaligned",
        decisionAt: "2026-09-16T15:00:00.000Z",
        providerAt: "2026-09-16T15:00:00.000Z",
      }),
      prox({ episodeId: "other", memberId: "other", ticker: "QQQ" }),
    ],
  );
  assert.equal(report.coverage.pairedEpisodeCount, 0);
  assert.deepEqual(
    report.coverage.exclusionsByReason,
    [
      { reason: "missing_prox_provider_time", count: 1 },
      { reason: "no_canonical_ticker", count: 1 },
      { reason: "provider_time_misaligned", count: 1 },
    ],
  );
  assert.equal(report.comparisons.allPairs.medianMaxGainPercent, null);
});

test("one canonical observation cannot inflate multiple ProX episodes", () => {
  const report = buildProxCanonicalPairedScorecard(
    [canonical()],
    [prox(), prox({ episodeId: "episode-2", memberId: "member-2" })],
  );
  assert.equal(report.coverage.pairedEpisodeCount, 1);
  assert.equal(report.coverage.exclusionsByReason.find(
    (item) => item.reason === "canonical_observation_already_paired",
  )?.count, 1);
});

test("reports disagreements and measured outcomes without changing authority", () => {
  const report = buildProxCanonicalPairedScorecard(
    [canonical({ role: "radar" })],
    [prox({ disposition: "selected" })],
  );
  assert.equal(report.pairs[0].selection.agreement, "prox_only");
  assert.equal(report.pairs[0].outcomes.plusFiveBeforeMinusFive, true);
  assert.equal(report.comparisons.byAgreement.proxOnly.byHorizon.find(
    (row) => row.horizon === "1h",
  )?.medianReturnPercent, 6);
  assert.equal(report.authority, "read_only_research");
  assert.equal(report.automaticAuthorityChange, false);
  assert.equal(report.promotionReview.status, "insufficient_evidence");
});

test("segments misses without treating missing outcomes as losses or changing scores", () => {
  const report = buildProxCanonicalPairedScorecard(
    [
      canonical(),
      canonical({
        id: "canonical-2",
        decisionAt: "2026-09-16T14:35:30.000Z",
        providerAt: "2026-09-16T14:35:25.000Z",
        score: 72,
        role: "contender",
      }),
      canonical({
        id: "canonical-3",
        decisionAt: "2026-09-16T14:40:30.000Z",
        providerAt: "2026-09-16T14:40:25.000Z",
        score: 65,
        role: "radar",
      }),
    ],
    [
      prox(),
      prox({
        episodeId: "episode-2",
        memberId: "member-2",
        decisionAt: "2026-09-16T14:35:45.000Z",
        providerAt: "2026-09-16T14:35:40.000Z",
        edgeScore: 72,
        maxGainPercent: 1,
        maxDrawdownPercent: -6,
        horizons: { "1h": -3 },
      }),
      prox({
        episodeId: "episode-3",
        memberId: "member-3",
        decisionAt: "2026-09-16T14:40:45.000Z",
        providerAt: "2026-09-16T14:40:40.000Z",
        edgeScore: 62,
        horizons: {},
      }),
    ],
  );
  assert.equal(report.missAnalysis.measuredOneHourPairCount, 2);
  assert.equal(report.missAnalysis.missPairCount, 1);
  assert.equal(report.missAnalysis.missRatePercent, 50);
  assert.equal(report.missAnalysis.missSeverity.fivePercentDrawdownMissCount, 1);
  assert.equal(
    report.missAnalysis.allPairPatternComparisons.canonicalScoreBand.find(
      (group) => group.label === "70-79",
    )?.nonPositiveOneHourRatePercent,
    100,
  );
  assert.equal(
    report.missAnalysis.allPairPatternComparisons.canonicalScoreBand.find(
      (group) => group.label === "60-69",
    )?.measuredOneHourCount,
    0,
  );
  assert.equal(report.pairs[1].canonical.score, 72);
});
