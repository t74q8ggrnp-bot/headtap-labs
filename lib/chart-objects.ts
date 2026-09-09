export const HT_CHART_OBJECT_VERSION = "ht-chart-object-v1" as const;

export type HtChartObjectAuthority = "prox" | "agent";
export type HtChartObjectStatus =
  | "active"
  | "reached"
  | "invalidated"
  | "expired"
  | "historical"
  | "needs_review_ambiguous";

export type HtChartObjectFreshness =
  | "fresh"
  | "aging"
  | "stale"
  | "closed_session";

export type HtChartObjectSourceKind =
  | "canonical_decision_frame"
  | "independent_prox_edge"
  | "agent_x_visual_plan"
  | "plan_lifecycle_event";

export type HtChartObjectBase = {
  id: string;
  schemaVersion: typeof HT_CHART_OBJECT_VERSION;
  authority: HtChartObjectAuthority;
  symbol: string;
  status: HtChartObjectStatus;
  label: string;
  source: {
    kind: HtChartObjectSourceKind;
    id: string;
    version: string;
  };
  timing: {
    marketEvidenceAt: string;
    sourceComputedAt: string | null;
    session: "regular" | "premarket" | "after_hours";
    evidenceInterval: "1m";
    freshness: HtChartObjectFreshness;
  };
  confidence: {
    value: number | null;
    authority: "prox" | null;
  };
};

export type HtChartPriceLine = HtChartObjectBase & {
  type: "price_line";
  role:
    | "entry_trigger"
    | "stop_invalidation"
    | "target_1"
    | "target_2"
    | "support"
    | "resistance";
  price: number;
};

export type HtChartPriceZone = HtChartObjectBase & {
  type: "price_zone";
  role: "entry_zone" | "support_zone" | "resistance_zone";
  low: number;
  high: number;
  validFrom: string;
  validUntil: string;
};

export type HtChartEventMarker = HtChartObjectBase & {
  type: "event_marker";
  role:
    | "plan_created"
    | "triggered"
    | "target_reached"
    | "invalidated"
    | "expired"
    | "needs_review";
  providerTimestamp: string;
  price: number | null;
};

export type HtChartObject =
  | HtChartPriceLine
  | HtChartPriceZone
  | HtChartEventMarker;

const UUIDISH = /^[0-9a-z][0-9a-z_-]{2,127}$/i;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,9}$/;

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function finitePositive(value: unknown) {
  return Number.isFinite(value) && Number(value) > 0;
}

function validBase(value: Partial<HtChartObjectBase>) {
  return typeof value.id === "string" && UUIDISH.test(value.id) &&
    value.schemaVersion === HT_CHART_OBJECT_VERSION &&
    (value.authority === "prox" || value.authority === "agent") &&
    ["active", "reached", "invalidated", "expired", "historical", "needs_review_ambiguous"].includes(String(value.status)) &&
    typeof value.symbol === "string" && SYMBOL.test(value.symbol) &&
    typeof value.label === "string" && value.label.trim().length > 0 &&
    Boolean(value.source) && typeof value.source?.id === "string" &&
    value.source.id.length > 0 && typeof value.source.version === "string" &&
    ["canonical_decision_frame", "independent_prox_edge", "agent_x_visual_plan", "plan_lifecycle_event"].includes(String(value.source.kind)) &&
    value.source.version.length > 0 && Boolean(value.timing) &&
    validTimestamp(value.timing?.marketEvidenceAt) &&
    (value.timing?.sourceComputedAt === null ||
      validTimestamp(value.timing?.sourceComputedAt)) &&
    value.timing?.evidenceInterval === "1m" &&
    ["regular", "premarket", "after_hours"].includes(String(value.timing?.session)) &&
    ["fresh", "aging", "stale", "closed_session"].includes(String(value.timing?.freshness)) &&
    Boolean(value.confidence) &&
    (value.confidence?.authority === null || value.confidence?.authority === "prox") &&
    (value.authority !== "prox" || value.confidence?.authority === "prox") &&
    (value.authority !== "agent" || value.confidence?.authority === null) &&
    (value.confidence?.value === null ||
      (Number.isFinite(value.confidence?.value) &&
        Number(value.confidence?.value) >= 0 &&
        Number(value.confidence?.value) <= 100));
}

export function isHtChartObject(value: unknown): value is HtChartObject {
  if (!value || typeof value !== "object") return false;
  const object = value as Partial<HtChartObject>;
  if (!validBase(object)) return false;
  if (object.type === "price_line") {
    return [
      "entry_trigger", "stop_invalidation", "target_1", "target_2",
      "support", "resistance",
    ].includes(String(object.role)) && finitePositive(object.price);
  }
  if (object.type === "price_zone") {
    return ["entry_zone", "support_zone", "resistance_zone"].includes(String(object.role)) &&
      finitePositive(object.low) && finitePositive(object.high) &&
      Number(object.low) <= Number(object.high) &&
      validTimestamp(object.validFrom) && validTimestamp(object.validUntil) &&
      Date.parse(String(object.validUntil)) > Date.parse(String(object.validFrom));
  }
  if (object.type === "event_marker") {
    return [
      "plan_created", "triggered", "target_reached", "invalidated",
      "expired", "needs_review",
    ].includes(String(object.role)) && validTimestamp(object.providerTimestamp) &&
      (object.price === null || finitePositive(object.price));
  }
  return false;
}

export function projectProviderTimestampToDisplayBucket(
  providerTimestamp: string,
  intervalSeconds: 60 | 300 | 900,
  timestampRole: "observation" | "interval_close" = "observation",
) {
  const timestampMs = Date.parse(providerTimestamp);
  if (!Number.isFinite(timestampMs)) return null;
  const projectedMs = timestampRole === "interval_close"
    ? timestampMs - 1
    : timestampMs;
  const seconds = Math.floor(projectedMs / 1_000);
  return Math.floor(seconds / intervalSeconds) * intervalSeconds;
}
