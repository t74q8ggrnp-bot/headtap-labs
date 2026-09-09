export type WorkspaceReadFreshnessState =
  | "fresh"
  | "aging"
  | "stale"
  | "last_session"
  | "unavailable"
  | "misaligned";

export type WorkspaceReadFreshness = {
  state: WorkspaceReadFreshnessState;
  ageSeconds: number | null;
  label: string;
};

export type WorkspaceCanonicalDecisionFrameStatus =
  | "live"
  | "last_session"
  | "stale"
  | "unavailable";

export type WorkspaceCanonicalDecisionFrame = {
  version: string | null;
  decisionAsOf: string | null;
  presentedAt: string | null;
  freshUntil: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number | null;
  fresh: boolean;
  status: WorkspaceCanonicalDecisionFrameStatus;
  currentSession: string | null;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const optionalTimestamp = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;

export function normalizeWorkspaceCanonicalDecisionFrame(
  raw: unknown,
): WorkspaceCanonicalDecisionFrame | null {
  const source = objectValue(raw);
  const status = source.status;
  if (
    status !== "live" &&
    status !== "last_session" &&
    status !== "stale" &&
    status !== "unavailable"
  ) {
    return null;
  }
  const ageSeconds = Number(source.ageSeconds);
  const maxAgeSeconds = Number(source.maxAgeSeconds);
  return {
    version: typeof source.version === "string" ? source.version : null,
    decisionAsOf: optionalTimestamp(source.decisionAsOf),
    presentedAt: optionalTimestamp(source.presentedAt),
    freshUntil: optionalTimestamp(source.freshUntil),
    ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
    maxAgeSeconds: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : null,
    fresh: source.fresh === true,
    status,
    currentSession: typeof source.currentSession === "string"
      ? source.currentSession
      : null,
  };
}

function compactAge(ageSeconds: number) {
  if (ageSeconds < 60) return `${Math.max(0, Math.round(ageSeconds))}s old`;
  if (ageSeconds < 3_600) return `${Math.round(ageSeconds / 60)}m old`;
  if (ageSeconds < 86_400) return `${Math.round(ageSeconds / 3_600)}h old`;
  return `${Math.round(ageSeconds / 86_400)}d old`;
}

export function canonicalLaneLabel(strategy: string | null | undefined) {
  if (strategy === "spot_momentum") return "Spot Momentum Canonical";
  if (strategy === "before_the_crowd") return "Before the Crowd Canonical";
  return "Canonical lane unavailable";
}

export function describeWorkspaceReadFreshness({
  timestamp,
  nowMs,
  marketActive,
  providerFresh,
  providerAligned,
  freshMaxAgeSeconds = 90,
  staleAfterSeconds = freshMaxAgeSeconds,
}: {
  timestamp: string | null | undefined;
  nowMs: number;
  marketActive: boolean;
  providerFresh?: boolean | null;
  providerAligned?: boolean | null;
  freshMaxAgeSeconds?: number;
  staleAfterSeconds?: number;
}): WorkspaceReadFreshness {
  const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(timestampMs)) {
    return { state: "unavailable", ageSeconds: null, label: "Time unavailable" };
  }

  const ageSeconds = (nowMs - timestampMs) / 1_000;
  if (ageSeconds < -120) {
    return { state: "misaligned", ageSeconds, label: "Timestamp misaligned" };
  }
  const boundedAge = Math.max(0, ageSeconds);
  if (providerAligned === false) {
    return {
      state: "misaligned",
      ageSeconds: boundedAge,
      label: "Provider evidence misaligned",
    };
  }
  // An explicit provider rejection remains stale even after the close. Only
  // server-verified retained evidence may be presented as Last verified.
  if (providerFresh === false) {
    return {
      state: "stale",
      ageSeconds: boundedAge,
      label: `Stale · ${compactAge(boundedAge)}`,
    };
  }
  if (!marketActive) {
    return {
      state: "last_session",
      ageSeconds: boundedAge,
      label: `Last verified · ${compactAge(boundedAge)}`,
    };
  }
  if (boundedAge > staleAfterSeconds) {
    return {
      state: "stale",
      ageSeconds: boundedAge,
      label: `Stale · ${compactAge(boundedAge)}`,
    };
  }
  if (boundedAge > freshMaxAgeSeconds) {
    return {
      state: "aging",
      ageSeconds: boundedAge,
      label: `Aging · ${compactAge(boundedAge)}`,
    };
  }
  return {
    state: "fresh",
    ageSeconds: boundedAge,
    label: `Fresh · ${compactAge(boundedAge)}`,
  };
}

/**
 * Canonical freshness comes from the server-built decision-frame contract.
 * A recent database processing timestamp is never used as a substitute.
 */
export function describeCanonicalDecisionFrameFreshness({
  frame,
  nowMs,
  marketActive,
}: {
  frame: WorkspaceCanonicalDecisionFrame | null;
  nowMs: number;
  marketActive: boolean;
}): WorkspaceReadFreshness {
  if (!frame || frame.status === "unavailable") {
    return {
      state: "unavailable",
      ageSeconds: null,
      label: "Decision frame unavailable",
    };
  }

  const timestampMs = frame.decisionAsOf
    ? Date.parse(frame.decisionAsOf)
    : Number.NaN;
  if (!Number.isFinite(timestampMs)) {
    return {
      state: "unavailable",
      ageSeconds: null,
      label: "Decision time unavailable",
    };
  }

  const ageSeconds = (nowMs - timestampMs) / 1_000;
  if (ageSeconds < -120) {
    return {
      state: "misaligned",
      ageSeconds,
      label: "Timestamp misaligned",
    };
  }
  const boundedAge = Math.max(0, ageSeconds);

  // Explicit server rejection wins over a convenient closed-session label.
  if (frame.status === "stale" || (frame.status === "live" && !frame.fresh)) {
    return {
      state: "stale",
      ageSeconds: boundedAge,
      label: `Stale · ${compactAge(boundedAge)}`,
    };
  }

  if (frame.status === "last_session" || !marketActive) {
    return {
      state: "last_session",
      ageSeconds: boundedAge,
      label: `Last verified · ${compactAge(boundedAge)}`,
    };
  }

  const freshUntilMs = frame.freshUntil
    ? Date.parse(frame.freshUntil)
    : Number.NaN;
  if (
    frame.status !== "live" ||
    !frame.fresh ||
    !Number.isFinite(freshUntilMs) ||
    nowMs > freshUntilMs
  ) {
    return {
      state: "stale",
      ageSeconds: boundedAge,
      label: `Stale · ${compactAge(boundedAge)}`,
    };
  }

  return {
    state: "fresh",
    ageSeconds: boundedAge,
    label: `Fresh · ${compactAge(boundedAge)}`,
  };
}

/** The visible Canonical badge must validate both the decision frame and the
 * selected record. This closes the radar-row gap where another record could
 * keep a frame fresh while this ticker's provider evidence was old/missing. */
export function describeCanonicalOpportunityFreshness(input: {
  frame: WorkspaceCanonicalDecisionFrame | null;
  decisionQuoteAsOf: string | null | undefined;
  nowMs: number;
  marketActive: boolean;
}) {
  const frameFreshness = describeCanonicalDecisionFrameFreshness(input);
  const recordFreshness = describeWorkspaceReadFreshness({
    timestamp: input.decisionQuoteAsOf,
    nowMs: input.nowMs,
    marketActive: input.marketActive,
    freshMaxAgeSeconds: 90,
    staleAfterSeconds: 90,
  });
  const priority: Record<WorkspaceReadFreshnessState, number> = {
    fresh: 0,
    aging: 1,
    last_session: 2,
    stale: 3,
    misaligned: 4,
    unavailable: 5,
  };
  return priority[recordFreshness.state] > priority[frameFreshness.state]
    ? recordFreshness
    : frameFreshness;
}
