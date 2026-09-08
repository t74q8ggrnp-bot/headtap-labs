import { createHash } from "node:crypto";
// @ts-expect-error Node source tests.
import { canonicalCryptoJson } from "./coinapi-publication.ts";
// @ts-expect-error Node source tests.
import { cryptoStorageDiagnostic } from "./storage-diagnostics.ts";
// @ts-expect-error Node source tests.
import { assessCryptoOutcomeProcessing } from "./outcome-processing-health.ts";

type Row = Record<string, unknown>;
export type CryptoEvidenceCheck = { name: string; ok: boolean; message: string; detail: Row };
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
const number = (value: unknown) => (typeof value === "number" || typeof value === "string") && String(value).trim() ? Number(value) : NaN;
const time = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const SOURCES = ["ht_crypto_prox_observations", "ht_crypto_discovery_observations"];

export function assessPausedCryptoEvidenceHealth(configuration: {
  production: boolean; environmentEnabled: boolean; credentialConfigured: boolean;
}, reason: string) {
  const detail = {
    state: "intentionally_paused",
    reason,
    configuration,
    databaseAuditRequests: 0,
    providerRequests: 0,
    executionAuthorized: false,
    profitabilityEstablished: false,
  };
  const checks: CryptoEvidenceCheck[] = [
    "crypto_legacy_evidence_audit",
    "crypto_coinapi_collection",
    "crypto_coinapi_outcomes",
  ].map((name) => ({
    name,
    ok: false,
    message: "CoinAPI research and its expensive legacy evidence audit are intentionally paused; no provider or archive-maintenance request was made.",
    detail,
  }));
  return {
    checks,
    archiveBySource: Object.fromEntries(SOURCES.map((source) => [source, { ok: false, paused: true }])),
    warnings: [{
      name: "crypto_research_intentionally_paused",
      message: "Crypto research remains isolated from stock systems while provider cost and archive-query behavior are audited.",
      evaluationEligible: false,
      providerRequests: 0,
    }],
  };
}

export function assessCryptoEvidenceHealth(snapshot: unknown, configuration: {
  production: boolean; environmentEnabled: boolean; credentialConfigured: boolean;
}, now = Date.now(), readError: unknown = null) {
  const data = record(snapshot), archive = rows(data.archive), control = record(data.control);
  const publication = record(data.publication), attempt = record(data.latestAttempt);
  const receipts = record(data.receipts), ledger = record(data.ledger), integrity = record(data.ledgerIntegrity);
  const schemaReady = data.version === "crypto-evidence-health-v1";
  if (!schemaReady) {
    // A failed read proves nothing about the switch, balances or saved history.
    // Keep all dependent checks red, but do not invent independent failures.
    const diagnostic = { stage:"evidence_snapshot", ...cryptoStorageDiagnostic(readError) };
    const unavailable: CryptoEvidenceCheck[] = ["crypto_legacy_evidence_audit", "crypto_coinapi_collection", "crypto_coinapi_outcomes"].map(name => ({
      name, ok:false, message:"Crypto database evidence could not be read; audit, collection and outcome state are unknown.",
      detail:{ schemaReady:false, issues:["evidence_snapshot_unavailable"], diagnostic, configuration,
        databaseEnabled:null, providerRequests:0, executionAuthorized:false, profitabilityEstablished:false },
    }));
    return { checks:unavailable, archiveBySource:Object.fromEntries(SOURCES.map(source => [source, { ok:false }])),
      warnings:[{ name:"legacy_crypto_history_unverified", message:"Legacy crypto history remains excluded; audit counts could not be read.",
        originalOverdue15m:null, evaluationEligible:false, historicalReconstructionAttempted:false }] };
  }
  const archiveBySource = Object.fromEntries(SOURCES.map(source => {
    const matches = archive.filter(r => r.source_table === source), a = matches[0] ?? {};
    const ok = schemaReady && archive.length === 2 && matches.length === 1 &&
      a.tracking_version === "crypto-legacy-observation-only-v1" && a.evaluation_allowed === false &&
      a.guards_enabled === true && a.deletion_protected === true &&
      number(a.preserved_legacy_observations) >= 0 && number(a.audited_records) === number(a.preserved_legacy_observations) &&
      number(a.missing_audits) === 0 && number(a.evidence_mismatches) === 0 &&
      number(a.reviews_required) === 0 && number(a.invalid_new_deadlines) === 0;
    return [source, { ...a, ok }];
  }));
  const archiveOk = SOURCES.every(source => archiveBySource[source].ok);
  const warnings: Row[] = archive.filter(a => number(a.preserved_legacy_observations) > 0).map(a => ({
    name: `legacy_crypto_history:${a.source_table}`,
    message: "Preserved historical results lack verified provider provenance and remain excluded from training and performance claims. Audit completion is not outcome verification.",
    source: a.source_table, records: a.preserved_legacy_observations,
    audited: a.audited_records, reviewRequired: a.reviews_required,
    originalOverdue15m: a.legacy_overdue_15m, unverifiedStoredHorizons: a.unverified_recorded_horizons,
    evaluationEligible: false, historicalReconstructionAttempted: false,
  }));
  const frame = record(publication.frame), quotes = rows(frame.quotes), selected = frame.selectedMarkets;
  const decisionAt = time(frame.decisionAt), completedAt = time(publication.completed_at);
  const publicationAgeSeconds = Number.isFinite(decisionAt) ? (now-decisionAt)/1000 : null;
  let hashValid = false;
  try { hashValid = Boolean(publication.evidence_sha256) &&
    createHash("sha256").update(canonicalCryptoJson(frame)).digest("hex") === publication.evidence_sha256; } catch { /* invalid evidence fails */ }
  const identities = quotes.map(q => q.marketId);
  const envelopeValid = publication.status === "complete" && publication.id === control.latest_cycle_id &&
    hashValid && frame.version === "coinapi-vercel-pilot-v1" && frame.dataContractVersion === "coinapi-research-data-v2" &&
    frame.provider === "coinapi" && frame.authority === "research_only" && frame.executionAuthorized === false &&
    frame.publicRankingChanged === false && frame.profitabilityEstablished === false && frame.intervalSeconds === 60 &&
    quotes.length > 0 && new Set(identities).size === quotes.length &&
    identities.every(id => typeof id === "string" && /^(COINBASE|KRAKEN|CRYPTOCOM)_SPOT_[A-Z0-9.-]+_USD$/.test(id)) &&
    Array.isArray(selected) && selected.length > 0 && selected.length <= 2 && new Set(selected).size === selected.length &&
    selected.every(id => identities.includes(id)) && number(record(frame.summary).nativeUsdMarkets) === quotes.length &&
    time(publication.started_at) <= decisionAt && decisionAt <= completedAt && completedAt <= now+2000;
  // Research cadence and execution freshness are different clocks. Validate the
  // strict provider-time rules AT collection, and expose current execution-age
  // coverage separately. Never stretch 15-second books to look live for a minute.
  const alignedAt = (q: Row, at: number) => {
    const trade = record(q.trade), book = record(q.book), tt = time(trade.asOf), bt = time(book.asOf);
    return Array.isArray(q.failures) && q.failures.length === 0 &&
      trade.symbolId === q.marketId && book.symbolId === q.marketId &&
      number(trade.price) > 0 && Number.isFinite(number(trade.price)) && number(book.bid) > 0 &&
      Number.isFinite(number(book.ask)) && number(book.ask) >= number(book.bid) &&
      tt <= at && bt <= at && at-tt <= 30_000 && at-bt <= 15_000 && Math.abs(tt-bt) <= 15_000;
  };
  const alignedAtCollection = quotes.filter(q => alignedAt(q,decisionAt)).length;
  const executionFreshQuotesNow = quotes.filter(q => alignedAt(q,now)).length;
  const collectionIssues: string[] = [];
  if (!schemaReady) collectionIssues.push("evidence_health_schema_missing_0038");
  if (!configuration.production || !configuration.environmentEnabled || !configuration.credentialConfigured || control.enabled !== true)
    collectionIssues.push("collector_not_enabled_or_configured");
  if (control.blocked_reason != null) collectionIssues.push(`collector_blocked:${control.blocked_reason}`);
  const usedToday = control.credit_day === new Date(now).toISOString().slice(0,10) ? number(control.daily_reserved) : 0;
  const dailyLimit = number(control.daily_credit_limit), lifetimeLimit = number(control.lifetime_credit_limit);
  const dailyAutoRenew = control.daily_auto_renew === true;
  const rolloverPending = dailyAutoRenew && control.credit_day !== new Date(now).toISOString().slice(0,10);
  if (!(dailyLimit > 0) || !(lifetimeLimit > 0) || !Number.isFinite(number(control.lifetime_reserved))) collectionIssues.push("invalid_budget_state");
  else if (usedToday >= dailyLimit || (!rolloverPending && number(control.lifetime_reserved) >= lifetimeLimit)) collectionIssues.push("credit_budget_paused");
  if (!envelopeValid) collectionIssues.push("no_verified_complete_publication");
  if (publicationAgeSeconds === null || publicationAgeSeconds < -2 || publicationAgeSeconds > 90) collectionIssues.push("research_collection_stale");
  if (!alignedAtCollection || alignedAtCollection !== number(record(frame.summary).freshAlignedQuotes)) collectionIssues.push("provider_time_coverage_invalid");
  const currentAttemptAgeMs = now-time(attempt.started_at);
  const currentAttemptRunning = attempt.status === "running" && currentAttemptAgeMs >= -2_000 && currentAttemptAgeMs <= 90_000;
  if (attempt.status === "failed" || (attempt.status === "running" && !currentAttemptRunning)) collectionIssues.push("latest_cycle_failed_or_expired");
  const accounting = record(data.accounting);
  const boundedSettledHolds = accounting.version === "coinapi-bounded-timeout-v1"
    && accounting.reservationCovered === true && accounting.receiptNotFabricated === true
    && Number.isSafeInteger(number(accounting.heldUnknownRequests)) && number(accounting.heldUnknownRequests) >= 0
    && number(accounting.heldMaximumCredits) === number(accounting.heldUnknownRequests)
    && number(accounting.heldUnknownRequests) === number(receipts.unknownCosts)
    && number(accounting.unboundedUnknownRequests) === 0 && number(accounting.invalidHolds) === 0;
  const heldSettled = number(accounting.heldSettledUnknownRequests);
  const heldUnsettled = number(accounting.heldUnsettledRequests);
  const heldTotal = number(accounting.heldUnknownRequests);
  const activeUnsettled = number(accounting.activeUnsettledRequests);
  const boundedAllHolds = accounting.version === "coinapi-accounting-holds-v2"
    && accounting.reservationCovered === true && accounting.receiptNotFabricated === true
    && [heldSettled, heldUnsettled, heldTotal, activeUnsettled,
      number(accounting.rawUnsettledRequests), number(accounting.unaccountedRequests),
      number(accounting.unboundedUnknownRequests), number(accounting.invalidHolds)]
      .every(value => Number.isSafeInteger(value) && value >= 0)
    && heldTotal === heldSettled + heldUnsettled
    && number(accounting.heldMaximumCredits) === heldTotal
    && heldSettled === number(receipts.unknownCosts)
    && number(accounting.rawUnsettledRequests) === number(receipts.unsettled)
    && heldUnsettled + activeUnsettled === number(receipts.unsettled)
    && number(accounting.unaccountedRequests) === activeUnsettled
    && number(accounting.unboundedUnknownRequests) === activeUnsettled
    && number(accounting.invalidHolds) === 0
    && (activeUnsettled === 0 || currentAttemptRunning);
  const noAccountingExtensionNeeded = Object.keys(accounting).length === 0
    && number(receipts.unknownCosts) === 0
    && (number(receipts.unsettled) === 0 || currentAttemptRunning);
  const providerUsageAccounted = accounting.version === "coinapi-bounded-timeout-v1"
    ? boundedSettledHolds && (number(receipts.unsettled) === 0 || currentAttemptRunning)
    : accounting.version === "coinapi-accounting-holds-v2"
      ? boundedAllHolds
      : noAccountingExtensionNeeded;
  const heldUnconfirmedRequests = accounting.version === "coinapi-accounting-holds-v2"
    ? heldTotal
    : number(accounting.heldUnknownRequests);
  if (heldUnconfirmedRequests > 0 && providerUsageAccounted) warnings.push({
    name:"coinapi_unconfirmed_charges_fully_reserved",
    message:"A failed request has no confirmed provider receipt. Its documented maximum remains fully reserved; it is not reported as confirmed spend or reused as market evidence.",
    requests:heldUnconfirmedRequests, maximumReservedCredits:number(accounting.heldMaximumCredits),
    policyVersion:accounting.version, actualChargesConfirmed:false, providerRequests:0,
  });
  if (!providerUsageAccounted || number(receipts.publicationErrors) !== 0 ||
      !(number(receipts.publicationRequests) > 0) || number(receipts.publicationRequests) !== number(record(frame.usage).requests) ||
      number(receipts.publicationCredits) !== number(record(frame.usage).reportedCredits))
    collectionIssues.push("provider_usage_unverified");
  const outcomeIssues: string[] = [];
  if (!schemaReady || ledger.source_version !== "coinapi-provider-book-ledger-v1") outcomeIssues.push("verified_ledger_schema_missing");
  if (!(number(ledger.saved_books)>0) || !(number(ledger.episodes)>0) || !(number(integrity.verifiedEntries)>0)) outcomeIssues.push("no_verified_entry_evidence");
  const processing = Object.hasOwn(data,"outcomeProcessing") ? assessCryptoOutcomeProcessing(data.outcomeProcessing,now) : null;
  if (!Number.isInteger(number(ledger.overdue_horizons)) || number(ledger.overdue_horizons) < 0) outcomeIssues.push("invalid_pending_horizon_count");
  if (processing) {
    if (!processing.available) outcomeIssues.push("outcome_processing_state_unavailable");
    else if (processing.overdue) outcomeIssues.push("overdue_provider_time_horizons");
  } else if (number(ledger.overdue_horizons)!==0) outcomeIssues.push("overdue_provider_time_horizons");
  if (number(integrity.missingHorizons)!==0 || number(integrity.invalidOutcomes)!==0) outcomeIssues.push("outcome_coverage_or_math_invalid");
  if (ledger.execution_authorized!==false || ledger.profitability_established!==false) outcomeIssues.push("unauthorized_outcome_claim");
  if (!(number(integrity.maturedHorizons)>=0) || !(number(ledger.observed_horizons)>=0)) outcomeIssues.push("outcome_counts_missing");
  else if (number(integrity.maturedHorizons)>0 && number(ledger.observed_horizons)===0) outcomeIssues.push("no_measured_mature_horizon");
  const checks: CryptoEvidenceCheck[] = [
    { name:"crypto_legacy_evidence_audit",ok:archiveOk,
      message:archiveOk ? "Every legacy record has a matching saved-evidence audit; excluded history and original values remain preserved."
        : "Legacy evidence audit incomplete or integrity protections failed; inspect missing audits, review cases and migration 0038.",
      detail:{ schemaReady, sources:archiveBySource, evaluationEligible:false, providerRequests:0 } },
    { name:"crypto_coinapi_collection",ok:collectionIssues.length===0,
      message:collectionIssues.length ? `CoinAPI collection is not verified: ${collectionIssues.join(", ")}.`
        : "CoinAPI has a fresh immutable research publication, aligned provider evidence and verified current receipts; any old unconfirmed charges remain fully reserved and disclosed.",
      detail:{ issues:collectionIssues, configuration, databaseEnabled:control.enabled===true,
        blockedReason:control.blocked_reason??null, latestCycleId:control.latest_cycle_id??null,
        latestAttemptStatus:attempt.status??null, latestError:attempt.error_code??null,
        decisionAt:frame.decisionAt??null, publicationAgeSeconds, maxResearchAgeSeconds:90,
        markets:quotes.length, alignedAtCollection, executionFreshQuotesNow,
        selectedMarkets:Array.isArray(selected)?selected.length:0, deeplyScored:record(frame.summary).scored??0,
        usage:receipts, accounting, dailyLimit:Number.isFinite(dailyLimit)?dailyLimit:null, lifetimeLimit:Number.isFinite(lifetimeLimit)?lifetimeLimit:null,
        reservedToday:usedToday, lifetimeReserved:control.lifetime_reserved??null,
        budgetMode:dailyAutoRenew ? "recurring_daily_utc" : "lifetime_capped", rolloverPending,
        providerRequests:0, executionAuthorized:false, publicFeedConverted:false } },
    { name:"crypto_coinapi_outcomes",ok:outcomeIssues.length===0,
      message:outcomeIssues.length ? `CoinAPI outcome evidence is not ready: ${outcomeIssues.join(", ")}.`
        : "CoinAPI outcome ledger has verified entry evidence, complete horizons and no missed processing deadlines or invalid measurements.",
      detail:{ issues:outcomeIssues, coverage:ledger, integrity, processing,
        dueAtEvidenceSnapshot:number(ledger.overdue_horizons),
        interpretation:"Gross exact-market quote returns, not fills or net profits.",
        executionAuthorized:false, profitabilityEstablished:false, providerRequests:0 } },
  ];
  return { checks, archiveBySource, warnings };
}

export function isObservationOnlyRow(value: unknown) {
  const row=record(value);
  return row.outcome_tracking_status === "not_scheduled" &&
    ["target_15m_at","target_1h_at","target_4h_at","target_24h_at"].every(key => row[key] === null);
}
