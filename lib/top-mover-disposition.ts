export type TopMoverDisposition = {
  ticker: string;
  changePercent: number;
  status: "pending" | "canonical_candidate" | "excluded";
  reason: string;
  retrievedForSm?: boolean;
  securityType?: string | null;
};

export function normalizeTopMoverDispositions(
  value: unknown,
): TopMoverDisposition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row): TopMoverDisposition | null => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const ticker = String(record.ticker ?? "").trim().toUpperCase();
      const changePercent = Number(record.changePercent);
      const status = String(record.status ?? "");
      if (
        !ticker ||
        !Number.isFinite(changePercent) ||
        !["pending", "canonical_candidate", "excluded"].includes(status)
      ) {
        return null;
      }
      return {
        ticker,
        changePercent,
        status: status as TopMoverDisposition["status"],
        reason: String(record.reason ?? "").trim(),
        retrievedForSm:
          typeof record.retrievedForSm === "boolean"
            ? record.retrievedForSm
            : undefined,
        securityType:
          typeof record.securityType === "string" ||
          record.securityType === null
            ? record.securityType
            : undefined,
      };
    })
    .filter((row): row is TopMoverDisposition => row !== null);
}

export function findTopMoverDisposition(value: unknown, ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();
  return normalizeTopMoverDispositions(value).find(
    (row) => row.ticker === normalizedTicker,
  ) ?? null;
}

export function describeTopMoverDisposition(
  disposition: TopMoverDisposition,
) {
  const reason = disposition.reason;
  if (reason === "prior_day_liquidity_below_floor") {
    return "The ticker was seen in the market snapshot but did not clear the liquidity gate.";
  }
  if (reason === "retrieval_volume_participation_below_threshold") {
    return "The ticker was seen, but its volume participation did not clear the canonical retrieval threshold.";
  }
  if (reason === "security_metadata_unavailable") {
    return "The ticker was seen, but security type could not be verified, so production eligibility failed closed.";
  }
  if (reason.startsWith("unsupported_security_type:")) {
    return `The ticker was seen but excluded because ${reason.split(":")[1] || "its instrument type"} is not supported by Spot Momentum.`;
  }
  if (disposition.status === "canonical_candidate") {
    return "The ticker cleared retrieval and entered canonical evaluation, but no matching row was found in the promoted run.";
  }
  return reason
    ? `The ticker was excluded before canonical evaluation: ${reason.replaceAll("_", " ")}.`
    : "The ticker has no resolved canonical disposition.";
}

export function auditTopMoverDispositions(value: unknown) {
  const sourceCount = Array.isArray(value) ? value.length : 0;
  const normalized = normalizeTopMoverDispositions(value);
  const complete =
    normalized.length > 0 &&
    normalized.length === sourceCount &&
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
