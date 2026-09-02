// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { isUsExtendedMarketTimestamp, PROX_OUTCOME_BAR_TOLERANCE_MS } from "../prox/shadow-outcome-resolution.ts";

// Massive gets the full verified-bar tolerance, plus two scheduled-worker
// cycles, before health treats an Agent outcome as overdue.
export const HT_AGENT_OUTCOME_HEALTH_GRACE_MS =
  PROX_OUTCOME_BAR_TOLERANCE_MS + 2 * 60_000;

export function getHtAgentMissingOutcomeReason({
  targetAt,
  observedAt,
}: {
  targetAt: string;
  observedAt: Date;
}) {
  const targetMs = Date.parse(targetAt);
  if (!Number.isFinite(targetMs) || targetMs > observedAt.getTime()) {
    return null;
  }
  if (observedAt.getTime() - targetMs < PROX_OUTCOME_BAR_TOLERANCE_MS) {
    return null;
  }
  if (!isUsExtendedMarketTimestamp(targetAt)) {
    return "The U.S. equity market was closed at the target timestamp.";
  }
  return "No verified Massive market bar exists within the Agent measurement window; the outcome is excluded rather than fabricated.";
}
