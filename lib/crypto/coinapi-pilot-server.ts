import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createCoinApiClient } from "./coinapi-client";
import { budgetedCoinApiFetch } from "./coinapi-pilot-budget";
import { COINAPI_PILOT, collectCoinApiPilot, pilotFreshness } from "./coinapi-pilot";
import type { PilotFrame, PilotState } from "./coinapi-pilot";
import { canonicalCryptoJson, presentCoinApiPublication } from "./coinapi-publication";
import { CryptoStorageError, cryptoStorageDiagnostic } from "./storage-diagnostics";

export function coinApiPilotService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("CoinAPI pilot storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const endpoint = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      // Only exhaustive read-only archive verification gets the longer deadline.
      // Reservations, receipts, live maintenance and provider calls stay bounded.
      const timeout = endpoint.pathname === "/rest/v1/rpc/ht_crypto_evidence_health_snapshot" ? 35_000 : 8_000;
      const signal = AbortSignal.timeout(timeout);
      return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
    } } });
}

export function coinApiPilotCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const received = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  return Boolean(secret) && Buffer.byteLength(received) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function coinApiPilotReaderAuthorized(request: Request) {
  if (coinApiPilotCronAuthorized(request)) return true;
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return false;
  const { data, error } = await coinApiPilotService().auth.getUser(token);
  return !error && Boolean(data.user);
}

export async function runCoinApiPilot() {
  const startedAt = Date.now();
  // Deploying code alone cannot start provider spending. No preview deployment collectors.
  if (process.env.COINAPI_PILOT_ENABLED !== "true" || process.env.VERCEL_ENV !== "production") {
    return { status: "disabled", provider: "coinapi", executionAuthorized: false };
  }
  const apiKey = process.env.COINAPI_API_KEY;
  if (!apiKey) throw new Error("CoinAPI pilot credential unavailable.");
  const db = coinApiPilotService();
  // Saved-book maintenance uses no CoinAPI requests and continues when budget
  // reservations pause. Missing integrity schema fails BEFORE paid collection.
  const { error: integrityError } = await db.rpc("ht_coinapi_research_maintenance");
  if (integrityError) throw new CryptoStorageError("maintenance", integrityError);
  // Old transport timeouts keep their unknown receipt AND full credit hold.
  // Only documented bounded requests may recover; access/overage/DB ambiguity
  // remains blocked. This RPC makes no provider request and never resets usage.
  const { error: recoveryError } = await db.rpc("ht_coinapi_recover_bounded_timeouts");
  if (recoveryError) throw new CryptoStorageError("usage_recovery", recoveryError);
  const cycle = randomUUID();
  const { data: claim, error: claimError } = await db.rpc("ht_coinapi_pilot_begin", { p_cycle: cycle });
  if (claimError || !claim) throw new CryptoStorageError("claim", claimError);
  if (!claim.allowed) return { status: "paused", reason: claim.reason, executionAuthorized: false };
  try {
    const client = createCoinApiClient({ apiKey, maxRequests: COINAPI_PILOT.maxRequestsPerCycle,
      fetcher: budgetedCoinApiFetch({
        reserve: async (id, path) => {
          const { data, error } = await db.rpc("ht_coinapi_pilot_reserve", { p_cycle: cycle, p_request: id, p_path: path });
          if (error || !data) throw new CryptoStorageError("reservation", error);
          return data.allowed === true;
        },
        settle: async (id, cost, status) => {
          const { data, error } = await db.rpc("ht_coinapi_pilot_settle", { p_request: id, p_cost: cost, p_status: status });
          if (error || !data) throw new CryptoStorageError("receipt", error);
          return data.allowed === true;
        },
      }),
    });
    const { frame, state } = await collectCoinApiPilot(client, claim.state as PilotState | null);
    const hash = createHash("sha256").update(canonicalCryptoJson(frame)).digest("hex");
    const publicationStartedAt = Date.now();
    const { error } = await db.rpc("ht_coinapi_pilot_finish", {
      p_cycle: cycle, p_state: state, p_frame: frame, p_hash: hash, p_error: null,
    });
    if (error) throw new CryptoStorageError("publication", error);
    return { status: "collected", cycleId: cycle, ...frame.summary, usage: frame.usage, history: frame.history,
      timings:{ publicationMs:Date.now()-publicationStartedAt, totalMs:Date.now()-startedAt },
      executionAuthorized: false, profitabilityEstablished: false };
  } catch (error) {
    // If this write fails or the process is killed, the lease expires; unresolved
    // request reservations block new spending instead of silently retrying.
    await db.rpc("ht_coinapi_pilot_finish", {
      p_cycle: cycle, p_state: null, p_frame: null, p_hash: null, p_error: "collection_or_accounting_failed",
    });
    if (error instanceof CryptoStorageError) throw error;
    throw new Error("CoinAPI pilot failed; inspect stored cycle and usage receipts.");
  }
}

/** Separate transaction: archive failures cannot roll back live publication or
 * exact-time outcome resolution. A failed audit remains visible in health. */
export async function auditLegacyCryptoBatch() {
  const startedAt = Date.now();
  const batchSize = 500;
  const maxBatches = 40;
  const workBudgetMs = 20_000;
  let confirmedAudited = 0;
  let committedBatches = 0;
  try {
    const db = coinApiPilotService();
    // The single 20,000-row production call failed; bound individual commits.
    // Commit small independent batches so one slow call cannot undo earlier work.
    // This now runs in its own 30s route, not inside the live collector.
    // Stop starting calls after 20s; the last RPC retains its 8s deadline,
    // leaving response headroom. Never enlarge or parallelize SQL transactions.
    // These are unbilled database calls, not additional CoinAPI collection cycles.
    for (let attempt = 0; attempt < maxBatches; attempt++) {
      if (Date.now() - startedAt >= workBudgetMs) break;
      const { data, error } = await db.rpc("ht_crypto_audit_legacy_evidence", { p_limit: batchSize });
      if (error) throw error;
      if (data === -1) return { ok:true, audited:confirmedAudited, committedBatches,
        batchSize, stopReason:"another_worker_active", elapsedMs:Date.now()-startedAt, providerRequests:0 };
      if (!Number.isSafeInteger(data) || data < 0 || data > batchSize) throw new Error("Invalid audit count");
      confirmedAudited += data as number;
      committedBatches++;
      if (data < batchSize) return { ok:true, audited:confirmedAudited, committedBatches,
        batchSize, stopReason:"drained", elapsedMs:Date.now() - startedAt, providerRequests:0 };
    }
    return { ok:true, audited:confirmedAudited, committedBatches, batchSize,
      stopReason:committedBatches === maxBatches ? "batch_limit" : "time_budget",
      elapsedMs:Date.now() - startedAt, providerRequests:0 };
  } catch (error) {
    // The failed call may have committed without a received response. Do not
    // invent its count or retry it here; the next scheduled idempotent pass and
    // exhaustive health snapshot determine what remains.
    return { ok:false, audited:null, confirmedAudited, committedBatches, batchSize,
      elapsedMs:Date.now() - startedAt, providerRequests:0, diagnostic:cryptoStorageDiagnostic(error) };
  }
}

/** Stored research only: no reader can cause a billable provider request. */
export async function readCoinApiPilot(onlyMarket?: string) {
  const db = coinApiPilotService();
  const { data: control, error } = await db.from("ht_coinapi_pilot_control")
    .select("enabled,daily_auto_renew,daily_credit_limit,lifetime_credit_limit,credit_day,daily_reserved,lifetime_reserved,blocked_reason,latest_cycle_id")
    .eq("id", "global").single();
  if (error || !control) throw new Error("CoinAPI pilot migration/storage unavailable.");
  let frame: PilotFrame | null = null;
  let evidenceHash: string | null = null;
  if (control.latest_cycle_id) {
    const { data, error: frameError } = await db.from("ht_coinapi_pilot_cycles").select("frame,evidence_sha256")
      .eq("id", control.latest_cycle_id).eq("status", "complete").single();
    if (frameError || !data) throw new Error("CoinAPI pilot publication unavailable.");
    frame = data.frame as PilotFrame;
    evidenceHash = data.evidence_sha256;
    if (frame.dataContractVersion !== "coinapi-research-data-v2" ||
        createHash("sha256").update(canonicalCryptoJson(frame)).digest("hex") !== evidenceHash) {
      throw new Error("CoinAPI publication evidence is unverified; no provider fallback was used.");
    }
  }
  const { data: lastCycle, error: cycleError } = await db.from("ht_coinapi_pilot_cycles")
    .select("id,status,started_at,completed_at,error_code").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (cycleError) throw new Error("CoinAPI pilot cycle status unavailable.");
  const now = Date.now();
  const freshness = pilotFreshness(frame, now);
  const creditDay = new Date(now).toISOString().slice(0, 10);
  const spentToday = String(control.credit_day) === creditDay ? Number(control.daily_reserved) : 0;
  const configured = process.env.COINAPI_PILOT_ENABLED === "true" && process.env.VERCEL_ENV === "production";
  const credentialConfigured = Boolean(process.env.COINAPI_API_KEY?.trim());
  const rolloverPending = control.daily_auto_renew === true && String(control.credit_day) !== creditDay;
  const budgetPaused = spentToday >= control.daily_credit_limit ||
    (!rolloverPending && Number(control.lifetime_reserved) >= control.lifetime_credit_limit);
  const status = !configured || !control.enabled ? "disabled" : !credentialConfigured ? "credential_missing" : control.blocked_reason ? "blocked"
    : budgetPaused ? "budget_paused"
      : lastCycle?.status === "failed" ? "collection_failed" : !frame ? "warming_up" : !freshness.fresh ? "stale" : "collecting";
  return { status, provider: "coinapi", authority: "research_only", providerRequests: 0, ...freshness,
    configuration: { production: process.env.VERCEL_ENV === "production",
      environmentEnabled: process.env.COINAPI_PILOT_ENABLED === "true", credentialConfigured,
      databaseEnabled: control.enabled === true },
    usage: { creditDay, reservedToday: spentToday, lifetimeReserved: Number(control.lifetime_reserved),
      budgetMode: control.daily_auto_renew === true ? "recurring_daily_utc" : "lifetime_capped", rolloverPending },
    latestCycle: lastCycle, budget: control, frame, executionAuthorized: false,
    publicationId: control.latest_cycle_id, evidenceHash,
    publication: frame ? presentCoinApiPublication(frame, now, onlyMarket) : null,
    publicRankingChanged: false, profitabilityEstablished: false };
}
