import type { SupabaseClient } from "@supabase/supabase-js";

// Owner approved 2026-09-03: distinguish the existing 90s evidence wait from
// one 60s scheduler cycle. This never changes a provider-price or fill window.
export const CRYPTO_OUTCOME_PROCESSING_POLICY = "coinapi-outcome-processing-v1";
export const CRYPTO_OUTCOME_EVIDENCE_WAIT_MS = 90_000;
export const CRYPTO_OUTCOME_SCHEDULER_GRACE_MS = 60_000;

export async function readCryptoOutcomeProcessingEvidence(db: SupabaseClient) {
  const checkedAt = new Date().toISOString();
  try {
    // Indexed oldest pending target proves whether ANY pending outcome missed
    // the deadline. No bounded sample, mutation, provider call or count guessing.
    const {data,error} = await db.from("ht_crypto_research_outcomes")
      .select("target_at").eq("status","pending")
      .order("target_at",{ascending:true}).limit(1)
      .abortSignal(AbortSignal.timeout(8_000)).maybeSingle();
    if (error) throw error;
    return {version:CRYPTO_OUTCOME_PROCESSING_POLICY,available:true,checkedAt,
      oldestPendingTargetAt:data === null ? null : data.target_at};
  } catch {
    return {version:CRYPTO_OUTCOME_PROCESSING_POLICY,available:false,checkedAt};
  }
}

export function assessCryptoOutcomeProcessing(value: unknown, now = Date.now()) {
  const evidence = value && typeof value === "object" ? value as Record<string,unknown> : {};
  const checkedAt = typeof evidence.checkedAt === "string" ? Date.parse(evidence.checkedAt) : NaN;
  const empty = evidence.oldestPendingTargetAt === null;
  const targetAt = typeof evidence.oldestPendingTargetAt === "string" ? Date.parse(evidence.oldestPendingTargetAt) : NaN;
  const available = evidence.version === CRYPTO_OUTCOME_PROCESSING_POLICY && evidence.available === true &&
    Number.isFinite(checkedAt) && checkedAt <= now && now-checkedAt <= 10_000 && (empty || Number.isFinite(targetAt));
  const pendingAgeMs = available && !empty ? now-targetAt : null;
  const due = pendingAgeMs !== null && pendingAgeMs > CRYPTO_OUTCOME_EVIDENCE_WAIT_MS;
  const overdue = pendingAgeMs !== null && pendingAgeMs > CRYPTO_OUTCOME_EVIDENCE_WAIT_MS+CRYPTO_OUTCOME_SCHEDULER_GRACE_MS;
  return {policyVersion:CRYPTO_OUTCOME_PROCESSING_POLICY,available,
    evidenceWaitSeconds:90,schedulerGraceSeconds:60,
    checkedAt:available ? evidence.checkedAt : null,
    oldestPendingTargetAt:available ? evidence.oldestPendingTargetAt : null,
    oldestPendingAgeSeconds:pendingAgeMs === null ? null : Math.max(0,pendingAgeMs/1000),
    due,overdue,providerRequests:0};
}
