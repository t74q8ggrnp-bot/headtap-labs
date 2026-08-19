export type TopMoverDisposition = {
  ticker: string;
  changePercent: number;
  status: "pending" | "canonical_candidate" | "excluded";
  reason: string;
  retrievedForSm?: boolean;
  securityType?: string | null;
};

export function auditTopMoverDispositions(value: unknown) {
  const rows = Array.isArray(value)
    ? value as Partial<TopMoverDisposition>[]
    : [];
  const normalized = rows.map((row) => ({
    ticker: String(row.ticker ?? "").trim().toUpperCase(),
    changePercent: Number(row.changePercent),
    status: String(row.status ?? ""),
    reason: String(row.reason ?? "").trim(),
  }));
  const complete =
    normalized.length > 0 &&
    normalized.every(
      (row) =>
        row.ticker.length > 0 &&
        Number.isFinite(row.changePercent) &&
        row.changePercent > 0 &&
        ["canonical_candidate", "excluded"].includes(row.status) &&
        row.reason.length > 0,
    ) &&
    new Set(normalized.map((row) => row.ticker)).size === normalized.length;
  return {
    complete,
    count: normalized.length,
    canonicalCount: normalized.filter(
      (row) => row.status === "canonical_candidate",
    ).length,
    excludedCount: normalized.filter((row) => row.status === "excluded").length,
    unresolved: normalized
      .filter(
        (row) =>
          !["canonical_candidate", "excluded"].includes(row.status) ||
          !row.reason,
      )
      .map((row) => row.ticker),
  };
}
