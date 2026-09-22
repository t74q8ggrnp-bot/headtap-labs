export type HtAgentTargetResearchSeedFailureReceipt = {
  error_code?: unknown;
  error_message?: unknown;
  failed_at?: unknown;
  horizon?: unknown;
};

export type HtAgentTargetResearchFailureCategory =
  | "deduplication"
  | "eligibility_or_evidence"
  | "persistence_or_schema"
  | "scheduling_or_reference"
  | "unclassified";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function sanitizeHtAgentTargetResearchFailureMessage(value: unknown) {
  return text(value)
    .replace(UUID_PATTERN, "[id]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export function classifyHtAgentTargetResearchFailure(
  receipt: HtAgentTargetResearchSeedFailureReceipt,
): HtAgentTargetResearchFailureCategory {
  const code = text(receipt.error_code).toUpperCase();
  const message = text(receipt.error_message).toLowerCase();

  if (code === "23505" || message.includes("duplicate key")) {
    return "deduplication";
  }
  if (
    code === "22P02" ||
    code === "22003" ||
    code === "23502" ||
    code === "23514" ||
    message.includes("invalid input syntax") ||
    message.includes("violates check constraint") ||
    message.includes("null value")
  ) {
    return "eligibility_or_evidence";
  }
  if (
    code === "23503" ||
    code === "P0002" ||
    message.includes("no rows") ||
    message.includes("foreign key")
  ) {
    return "scheduling_or_reference";
  }
  if (
    code === "42501" ||
    code === "42P01" ||
    code === "42703" ||
    code === "42804" ||
    message.includes("permission denied") ||
    message.includes("does not exist")
  ) {
    return "persistence_or_schema";
  }
  return "unclassified";
}

function countBy(
  values: string[],
) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

export function summarizeHtAgentTargetResearchSeedFailures(
  receipts: HtAgentTargetResearchSeedFailureReceipt[],
  reportedTotal: number,
) {
  const rows = receipts.map((receipt) => ({
    category: classifyHtAgentTargetResearchFailure(receipt),
    errorCode: text(receipt.error_code) || "unknown",
    horizon: text(receipt.horizon) || "unknown",
    message: sanitizeHtAgentTargetResearchFailureMessage(receipt.error_message) || "No error message recorded.",
    failedAt: text(receipt.failed_at) || null,
  }));
  const messageCounts = countBy(rows.map((row) => `${row.errorCode}: ${row.message}`));
  const representativeMessages = Object.entries(messageCounts)
    .slice(0, 8)
    .map(([message, count]) => ({ message, count }));

  return {
    authority: "research_only",
    primaryProductImpact: false,
    executionAuthority: "none",
    providerRequestsAdded: 0,
    reportedTotal: Number.isFinite(reportedTotal) ? Math.max(0, reportedTotal) : 0,
    receiptsInspected: rows.length,
    receiptCoverageComplete:
      Number.isFinite(reportedTotal) && reportedTotal >= 0 && rows.length >= reportedTotal,
    latestFailureAt: rows
      .map((row) => row.failedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
    byCategory: countBy(rows.map((row) => row.category)),
    byErrorCode: countBy(rows.map((row) => row.errorCode)),
    byHorizon: countBy(rows.map((row) => row.horizon)),
    representativeMessages,
  };
}
