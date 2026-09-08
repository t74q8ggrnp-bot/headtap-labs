export type HtAgentHealthProfile = {
  id: string;
};

export type HtAgentHealthRun = {
  id: string;
  profile_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
};

export const HT_AGENT_RUNNING_GRACE_MS = 5 * 60_000;

function timestampAge(value: string | null, now: number) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return now - timestamp;
}

/**
 * A newly running cycle must not hide the last completed success. Conversely,
 * an overdue running row remains a hard failure even if an older success is
 * still fresh. Runs are expected newest-first, matching the health query.
 */
export function assessHtAgentRunHealth(
  profiles: HtAgentHealthProfile[],
  runs: HtAgentHealthRun[],
  options: {
    now?: number;
    maximumSuccessAgeMs: number;
    maximumRunningAgeMs?: number;
  },
) {
  const now = options.now ?? Date.now();
  const maximumRunningAgeMs = options.maximumRunningAgeMs ?? HT_AGENT_RUNNING_GRACE_MS;
  const latestRuns = new Map<string, HtAgentHealthRun>();
  const latestSuccessfulRuns = new Map<string, HtAgentHealthRun>();
  const runningRuns = new Map<string, HtAgentHealthRun>();

  for (const run of runs) {
    if (!latestRuns.has(run.profile_id)) latestRuns.set(run.profile_id, run);
    if (run.status === "success" && !latestSuccessfulRuns.has(run.profile_id)) {
      latestSuccessfulRuns.set(run.profile_id, run);
    }
    if (run.status === "running" && !runningRuns.has(run.profile_id)) {
      runningRuns.set(run.profile_id, run);
    }
  }

  const profileStates = profiles.map((profile) => {
    const latestRun = latestRuns.get(profile.id) ?? null;
    const latestSuccess = latestSuccessfulRuns.get(profile.id) ?? null;
    const runningRun = runningRuns.get(profile.id) ?? null;
    const successAgeMs = timestampAge(latestSuccess?.completed_at ?? null, now);
    const runningAgeMs = timestampAge(runningRun?.started_at ?? null, now);
    const successFresh = successAgeMs !== null && successAgeMs >= -2_000 &&
      successAgeMs <= options.maximumSuccessAgeMs;
    const runningCurrent = runningAgeMs !== null && runningAgeMs >= -2_000 &&
      runningAgeMs <= maximumRunningAgeMs;
    const runningOverdue = runningRun !== null && !runningCurrent;
    return {
      profileId: profile.id,
      ok: successFresh && !runningOverdue,
      successFresh,
      runningCurrent,
      runningOverdue,
      successAgeSeconds: successAgeMs === null ? null : Number((successAgeMs / 1_000).toFixed(1)),
      runningAgeSeconds: runningAgeMs === null ? null : Number((runningAgeMs / 1_000).toFixed(1)),
      latestRun,
      latestSuccess,
      runningRun,
    };
  });

  return {
    ok: profileStates.every((state) => state.ok),
    profileStates,
    overdueRunningCount: profileStates.filter((state) => state.runningOverdue).length,
    missingFreshSuccessCount: profileStates.filter((state) => !state.successFresh).length,
  };
}
