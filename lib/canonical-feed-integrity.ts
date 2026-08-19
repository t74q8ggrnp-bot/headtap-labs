type Eligibility = { eligible?: unknown } | null | undefined;

export type CanonicalFeedRecord = {
  ticker?: unknown;
  price?: unknown;
  change?: unknown;
  displayPrice?: unknown;
  displayChange?: unknown;
  displayEligibility?: Eligibility;
  momentumRadarEligible?: unknown;
  visibilityState?: unknown;
  tradeFramework?: { hardFailures?: unknown } | null;
  explosionAssessment?: {
    state?: unknown;
    scenarioBands?: { expansionRr?: unknown } | null;
  } | null;
  scoreContext?: { peakFailureConfirmed?: unknown } | null;
};

export type CanonicalSpotMomentumFeed = {
  opportunities?: CanonicalFeedRecord[];
  momentumContenders?: CanonicalFeedRecord[];
  momentumRadar?: CanonicalFeedRecord[];
};

export type CanonicalFeedIntegrityIssue = {
  ticker: string;
  role: "qualified" | "contender" | "radar" | "feed";
  code: string;
};

const numberValue = (value: unknown) => Number(value);
const tickerValue = (value: unknown) => String(value ?? "").trim().toUpperCase();
const nearlyEqual = (left: number, right: number) =>
  Number.isFinite(left) &&
  Number.isFinite(right) &&
  Math.abs(left - right) <= Math.max(0.0001, Math.abs(left) * 0.00001);

export function auditCanonicalSpotMomentumFeed(
  feed: CanonicalSpotMomentumFeed,
) {
  const opportunities = feed.opportunities ?? [];
  const contenders = feed.momentumContenders ?? [];
  const radar = feed.momentumRadar ?? [];
  const issues: CanonicalFeedIntegrityIssue[] = [];

  const auditQualified = (
    record: CanonicalFeedRecord,
    role: "qualified" | "contender",
  ) => {
    const ticker = tickerValue(record.ticker);
    const price = numberValue(record.price);
    const displayPrice = numberValue(record.displayPrice ?? record.price);
    const change = numberValue(record.change);
    const displayChange = numberValue(record.displayChange ?? record.change);
    const hardFailures = Array.isArray(record.tradeFramework?.hardFailures)
      ? record.tradeFramework.hardFailures.map(String)
      : [];
    if (!ticker) issues.push({ ticker: "UNKNOWN", role, code: "missing_ticker" });
    if (!(price > 0) || !nearlyEqual(price, displayPrice)) {
      issues.push({ ticker, role, code: "decision_display_price_mismatch" });
    }
    if (!(change > 0)) {
      issues.push({ ticker, role, code: "non_positive_full_day_change" });
    }
    if (!nearlyEqual(change, displayChange)) {
      issues.push({ ticker, role, code: "decision_display_change_mismatch" });
    }
    const isEntryWithheldContender =
      role === "contender" &&
      record.displayEligibility?.eligible !== true &&
      record.momentumRadarEligible === true &&
      record.visibilityState === "momentum_radar";
    // Number(null) is 0, not NaN — coercing straight through would make a
    // genuinely unmeasurable ratio (the new, intentional null case) look
    // like a real, computed 0, which then incorrectly satisfies "finite and
    // below 1" below. Check for null/undefined before coercing.
    const rawExpansionRr = record.explosionAssessment?.scenarioBands?.expansionRr;
    const scenarioRr =
      rawExpansionRr === null || rawExpansionRr === undefined
        ? null
        : Number(rawExpansionRr);
    if (
      record.displayEligibility?.eligible !== true &&
      !isEntryWithheldContender
    ) {
      issues.push({ ticker, role, code: "invalid_contender_authority" });
    }
    if (record.scoreContext?.peakFailureConfirmed === true) {
      issues.push({ ticker, role, code: "confirmed_peak_failure_visible" });
    }
    if (
      record.displayEligibility?.eligible === true &&
      record.explosionAssessment?.state === "price_discovery" &&
      scenarioRr !== null &&
      Number.isFinite(scenarioRr) &&
      scenarioRr < 1
    ) {
      // A missing ratio (scenarioRr not finite) is no longer a violation on
      // its own — getPriceDiscoveryEntryRejection (spot-momentum-authority.ts)
      // stopped blocking entry on an unmeasurable ratio, only on a real,
      // computed one below the floor. This check needs to agree with that
      // rule, not the old one, or every legitimately-passing unmeasurable-
      // ratio candidate would trip a fresh false alarm here.
      issues.push({
        ticker,
        role,
        code: "price_discovery_entry_floor_violation",
      });
    }
    if (
      hardFailures.length > 0 &&
      !isEntryWithheldContender &&
      record.visibilityState !== "verified_price_discovery"
    ) {
      issues.push({ ticker, role, code: "hard_failure_visible" });
    }
    if (
      record.visibilityState === "verified_price_discovery" &&
      (hardFailures.length !== 1 ||
        !hardFailures[0].startsWith(
          "Live price is inconsistent with recent adjusted history",
        ))
    ) {
      issues.push({ ticker, role, code: "invalid_price_discovery_override" });
    }
  };

  opportunities.forEach((record) => auditQualified(record, "qualified"));
  contenders.forEach((record) => auditQualified(record, "contender"));

  const actualContenders = contenders.map((record) => tickerValue(record.ticker));
  if (new Set(actualContenders).size !== actualContenders.length) {
    issues.push({
      ticker: actualContenders.join(",") || "NONE",
      role: "feed",
      code: "duplicate_overall_contenders",
    });
  }

  const qualifiedTickers = new Set(
    [...opportunities, ...contenders].map((record) => tickerValue(record.ticker)),
  );
  radar.forEach((record) => {
    const ticker = tickerValue(record.ticker);
    const change = numberValue(record.change);
    const displayChange = numberValue(record.displayChange ?? record.change);
    if (qualifiedTickers.has(ticker)) {
      issues.push({ ticker, role: "radar", code: "radar_duplicates_qualified" });
    }
    if (!(change > 0) || !nearlyEqual(change, displayChange)) {
      issues.push({ ticker, role: "radar", code: "radar_quote_inconsistent" });
    }
    if (
      record.displayEligibility?.eligible === true ||
      record.momentumRadarEligible !== true ||
      record.visibilityState !== "momentum_radar"
    ) {
      issues.push({ ticker, role: "radar", code: "invalid_radar_authority" });
    }
    if (record.scoreContext?.peakFailureConfirmed === true) {
      issues.push({ ticker, role: "radar", code: "confirmed_peak_failure_on_radar" });
    }
  });

  return {
    ok: issues.length === 0,
    qualifiedCount: opportunities.length,
    contenderCount: contenders.length,
    radarCount: radar.length,
    issues,
  };
}
