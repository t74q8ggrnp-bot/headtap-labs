export type ProxOutcomeMemoryHealthRun = {
  id: string;
  observed_at: string;
  completed_at: string | null;
  status: string;
  complete: boolean;
};

export const PROX_OUTCOME_MEMORY_RUNNING_GRACE_MS = 5 * 60_000;

function timestampAge(value: string | null, now: number) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return now - timestamp;
}

/**
 * Outcome Memory writes a lifecycle row before doing its provider and database
 * work. A current `running` row must not replace the last immutable success in
 * health reads. Failed or abandoned cycles remain hard failures.
 *
 * Runs must be newest-first, matching the system-health query.
 */
export function assessProxOutcomeMemoryRunHealth<
  T extends ProxOutcomeMemoryHealthRun,
>(
  runs: T[],
  options: {
    now?: number;
    maximumSuccessAgeMs: number;
    maximumRunningAgeMs?: number;
  },
) {
  const now = options.now ?? Date.now();
  const maximumRunningAgeMs =
    options.maximumRunningAgeMs ?? PROX_OUTCOME_MEMORY_RUNNING_GRACE_MS;
  const latestAttempt = runs[0] ?? null;
  const latestTerminal =
    runs.find((run) => run.status !== "running") ?? null;
  const latestSuccess =
    runs.find(
      (run) =>
        run.status === "success" &&
        run.complete === true &&
        typeof run.completed_at === "string",
    ) ?? null;
  const runningRun = runs.find((run) => run.status === "running") ?? null;

  const successAgeMs = timestampAge(latestSuccess?.completed_at ?? null, now);
  const runningAgeMs = timestampAge(runningRun?.observed_at ?? null, now);
  const successFresh =
    successAgeMs !== null &&
    successAgeMs >= -2_000 &&
    successAgeMs <= options.maximumSuccessAgeMs;
  const runningCurrent =
    runningAgeMs !== null &&
    runningAgeMs >= -2_000 &&
    runningAgeMs <= maximumRunningAgeMs;
  const runningOverdue = runningRun !== null && !runningCurrent;
  const latestTerminalFailed =
    latestTerminal !== null &&
    (latestTerminal.status !== "success" || latestTerminal.complete !== true);

  return {
    ok: successFresh && !runningOverdue && !latestTerminalFailed,
    successFresh,
    runningCurrent,
    runningOverdue,
    latestTerminalFailed,
    successAgeSeconds:
      successAgeMs === null ? null : Number((successAgeMs / 1_000).toFixed(1)),
    runningAgeSeconds:
      runningAgeMs === null ? null : Number((runningAgeMs / 1_000).toFixed(1)),
    latestAttempt,
    latestTerminal,
    latestSuccess,
    runningRun,
  };
}
