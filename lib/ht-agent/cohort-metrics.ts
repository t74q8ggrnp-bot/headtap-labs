// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { HT_AGENT_COHORT_VERSION } from "./contracts.ts";
// @ts-expect-error Node's strip-types test runner resolves the TypeScript source.
import { nullableAgentNumber } from "./evidence.ts";

export const HT_AGENT_METRIC_HORIZON = "15m" as const;
export const HT_AGENT_METRIC_DECISION_LIMIT = 100;
export function htAgentMetricWindowEnd(now = new Date()): string {
  // A busy scanner can generate 100 decisions in less than 15 minutes. Select
  // by horizon maturity, not outcome completion (which would bias the sample).
  return new Date(now.getTime() - 15 * 60_000).toISOString();
}
const COHORTS = ["canonical_only", "canonical_prox", "ht_agent_full"] as const;

type Observation = {
  id: string;
  decision_id: string;
  cohort: string;
  cohort_version: string;
  would_enter: boolean;
};
type Outcome = {
  cohort_observation_id: string;
  horizon: string;
  complete: boolean;
  return_percent: unknown;
};

// A bounded, versioned research diagnostic, not a trade win rate. Only complete
// three-way decision groups count; one common horizon prevents mixed samples.
export function buildHtAgentCohortMetrics(observations: Observation[], outcomes: Outcome[]) {
  const current = observations.filter((row) => row.cohort_version === HT_AGENT_COHORT_VERSION);
  const matchedDecisions = new Set(current.map((row) => row.decision_id).filter((id) =>
    COHORTS.every((cohort) => current.filter((row) => row.decision_id === id && row.cohort === cohort).length === 1),
  ));
  const returnsByObservation = new Map<string, number>();
  for (const outcome of outcomes) {
    if (!outcome.complete || outcome.horizon !== HT_AGENT_METRIC_HORIZON) continue;
    const value = nullableAgentNumber(outcome.return_percent);
    if (value !== null) returnsByObservation.set(outcome.cohort_observation_id, value);
  }
  return COHORTS.map((cohort) => {
    const rows = current.filter((row) => row.cohort === cohort && matchedDecisions.has(row.decision_id));
    const qualified = rows.filter((row) => row.would_enter);
    const measured = qualified.flatMap((row) => {
      const value = returnsByObservation.get(row.id);
      return value === undefined ? [] : [value];
    });
    return {
      cohort,
      cohortVersion: HT_AGENT_COHORT_VERSION,
      horizon: HT_AGENT_METRIC_HORIZON,
      observations: rows.length,
      wouldEnter: qualified.length,
      measuredOutcomes: measured.length,
      unmeasuredQualified: qualified.length - measured.length,
      averageReturnPercent: measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null,
      positiveRatePercent: measured.length ? measured.filter((value) => value > 0).length / measured.length * 100 : null,
    };
  });
}
