export const SESSION_CONTINUITY_VERSION =
  "ht-session-continuity-shadow-v1" as const;

export type SessionContinuityState =
  | "strong"
  | "developing"
  | "fading"
  | "new_today"
  | "unavailable";

export type SessionContinuityAuthority = {
  canonical: false;
  prox: false;
  agentRisk: false;
  paper: false;
  execution: false;
};

export type SessionContinuityReceipt = {
  version: typeof SESSION_CONTINUITY_VERSION;
  authority: SessionContinuityAuthority;
  state: SessionContinuityState;
  label: string;
  summary: string;
  previousClose: number | null;
  gapPercent: number | null;
  gapRetentionPercent: number | null;
  changeFromOpenPercent: number | null;
  pullbackFromSessionHighPercent: number | null;
  relativeVolume: number | null;
  scanSession: string;
  providerAsOf: string | null;
};

export type SessionContinuityInput = {
  price: number;
  previousCloseChangePercent: number;
  sessionOpenPrice: number | null;
  changeFromOpenPercent: number | null;
  sessionHighPrice: number | null;
  pullbackFromSessionHighPercent: number | null;
  relativeVolume: number;
  momentumScore: number;
  scanSession: string;
  providerAsOf: string | null;
  proxState?: string | null;
};

const NO_AUTHORITY: SessionContinuityAuthority = {
  canonical: false,
  prox: false,
  agentRisk: false,
  paper: false,
  execution: false,
};

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const round = (value: number, digits = 2) =>
  Number(value.toFixed(digits));

export function derivePreviousClose(
  price: number,
  previousCloseChangePercent: number,
) {
  if (!finitePositive(price) || !Number.isFinite(previousCloseChangePercent)) {
    return null;
  }
  const denominator = 1 + previousCloseChangePercent / 100;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const previousClose = price / denominator;
  return finitePositive(previousClose) ? round(previousClose, 6) : null;
}

function unavailableReceipt(input: SessionContinuityInput): SessionContinuityReceipt {
  return {
    version: SESSION_CONTINUITY_VERSION,
    authority: { ...NO_AUTHORITY },
    state: "unavailable",
    label: "Evidence forming",
    summary: "The previous-close and current-session references are not yet aligned.",
    previousClose: null,
    gapPercent: null,
    gapRetentionPercent: null,
    changeFromOpenPercent: input.changeFromOpenPercent,
    pullbackFromSessionHighPercent: input.pullbackFromSessionHighPercent,
    relativeVolume: Number.isFinite(input.relativeVolume)
      ? round(input.relativeVolume)
      : null,
    scanSession: input.scanSession || "unknown",
    providerAsOf: input.providerAsOf,
  };
}

/**
 * Research-only continuity read. It describes whether a move anchored at the
 * previous close is persisting into today's tape. It cannot change Canonical,
 * Pro X, Agent, Paper, or execution behavior.
 */
export function evaluateSessionContinuity(
  input: SessionContinuityInput,
): SessionContinuityReceipt {
  const previousClose = derivePreviousClose(
    input.price,
    input.previousCloseChangePercent,
  );
  if (
    previousClose === null ||
    !input.providerAsOf ||
    !["pre_market", "regular", "after_hours"].includes(input.scanSession)
  ) {
    return unavailableReceipt(input);
  }

  const open = finitePositive(input.sessionOpenPrice)
    ? input.sessionOpenPrice
    : null;
  const high = finitePositive(input.sessionHighPrice)
    ? input.sessionHighPrice
    : null;
  const gapPercent = open === null
    ? null
    : round(((open - previousClose) / previousClose) * 100);
  const gapRange = high === null ? null : high - previousClose;
  const gapRetentionPercent =
    gapRange !== null && gapRange > 0
      ? round(((input.price - previousClose) / gapRange) * 100, 1)
      : null;
  const pullback = input.pullbackFromSessionHighPercent;
  const changeFromOpen = input.changeFromOpenPercent;
  const proxDefensive = ["weakening", "defensive", "failed"].includes(
    String(input.proxState ?? "").toLowerCase(),
  );
  const fading =
    (gapRetentionPercent !== null && gapRetentionPercent < 40) ||
    (pullback !== null && pullback >= 15) ||
    (changeFromOpen !== null && changeFromOpen <= -3) ||
    proxDefensive;
  const strong =
    !fading &&
    gapPercent !== null &&
    gapPercent >= 3 &&
    gapRetentionPercent !== null &&
    gapRetentionPercent >= 70 &&
    input.relativeVolume >= 2 &&
    input.momentumScore >= 60;
  const newToday =
    !fading &&
    (gapPercent === null || Math.abs(gapPercent) < 1) &&
    changeFromOpen !== null &&
    changeFromOpen >= 3;

  const state: SessionContinuityState = fading
    ? "fading"
    : strong
      ? "strong"
      : newToday
        ? "new_today"
        : "developing";
  const copy = {
    strong: {
      label: "Strong carry",
      summary: "The prior-close move is retaining strength with active participation.",
    },
    developing: {
      label: "Developing",
      summary: "The prior-close move is positive, but confirmation is still developing.",
    },
    fading: {
      label: "Fading",
      summary: "The move has lost material ground from its current-session evidence.",
    },
    new_today: {
      label: "New today",
      summary: "Momentum is emerging from today's session rather than an overnight gap.",
    },
    unavailable: {
      label: "Evidence forming",
      summary: "The previous-close and current-session references are not yet aligned.",
    },
  }[state];

  return {
    version: SESSION_CONTINUITY_VERSION,
    authority: { ...NO_AUTHORITY },
    state,
    label: copy.label,
    summary: copy.summary,
    previousClose,
    gapPercent,
    gapRetentionPercent,
    changeFromOpenPercent: changeFromOpen,
    pullbackFromSessionHighPercent: pullback,
    relativeVolume: Number.isFinite(input.relativeVolume)
      ? round(input.relativeVolume)
      : null,
    scanSession: input.scanSession,
    providerAsOf: input.providerAsOf,
  };
}
