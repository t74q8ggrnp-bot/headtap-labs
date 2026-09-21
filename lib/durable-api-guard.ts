import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { checkApiRateLimit, type ApiRateLimitResult } from "@/lib/api-rate-limit";

type GuardOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  failureMode?: "local_fallback" | "fail_closed";
};

type GlobalRateLimitReceipt = {
  allowed?: unknown;
  limit?: unknown;
  remaining?: unknown;
  resetAt?: unknown;
  scope?: unknown;
  contractVersion?: unknown;
};

export type DurableApiRateLimitResult = ApiRateLimitResult & {
  scope: "global" | "local_fallback" | "fail_closed";
  durable: boolean;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

function requestIdentity(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 160) ?? "unknown";
  const salt = process.env.RATE_LIMIT_HASH_SALT ?? process.env.VERCEL_PROJECT_ID ?? "ht-labs-public-api";
  return createHash("sha256").update(`${salt}:${address}:${userAgent}`).digest("hex");
}

function boundedNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function headersFor(limit: number, remaining: number, resetAtSeconds: number, allowed: boolean) {
  const retryAfterSeconds = Math.max(1, Math.ceil(resetAtSeconds - Date.now() / 1_000));
  return {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(Math.ceil(resetAtSeconds)),
    "X-HT-RateLimit-Scope": "global",
    ...(allowed ? {} : { "Retry-After": String(retryAfterSeconds) }),
  };
}

export async function checkDurableApiRateLimit(
  request: Request,
  options: GuardOptions,
): Promise<DurableApiRateLimitResult> {
  const local = checkApiRateLimit(request, options);
  if (!local.allowed) return { ...local, scope: "local_fallback", durable: false };

  const client = serviceClient();
  if (!client) {
    if (options.failureMode === "fail_closed") {
      return {
        ...local,
        allowed: false,
        remaining: 0,
        headers: {
          ...local.headers,
          "X-HT-RateLimit-Scope": "fail-closed",
          "Retry-After": "60",
        },
        scope: "fail_closed",
        durable: false,
      };
    }
    return {
      ...local,
      headers: { ...local.headers, "X-HT-RateLimit-Scope": "local-fallback" },
      scope: "local_fallback",
      durable: false,
    };
  }

  try {
    const { data, error } = await client.rpc("ht_consume_public_api_rate_limit", {
      p_namespace: options.namespace,
      p_identity_hash: requestIdentity(request),
      p_limit: Math.max(1, Math.floor(options.limit)),
      p_window_seconds: Math.max(1, Math.ceil(options.windowMs / 1_000)),
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("guard unavailable");
    const receipt = data as GlobalRateLimitReceipt;
    if (receipt.contractVersion !== "ht-public-api-rate-limit-v1" || receipt.scope !== "global") {
      throw new Error("guard contract mismatch");
    }
    const allowed = receipt.allowed === true;
    const limit = boundedNumber(receipt.limit, local.limit);
    const remaining = boundedNumber(receipt.remaining, 0);
    const resetAtSeconds = boundedNumber(receipt.resetAt, Math.ceil(local.resetAt / 1_000));
    const retryAfterSeconds = Math.max(1, Math.ceil(resetAtSeconds - Date.now() / 1_000));
    return {
      allowed,
      limit,
      remaining,
      resetAt: resetAtSeconds * 1_000,
      retryAfterSeconds,
      headers: headersFor(limit, remaining, resetAtSeconds, allowed),
      scope: "global",
      durable: true,
    };
  } catch {
    if (options.failureMode === "fail_closed") {
      return {
        ...local,
        allowed: false,
        remaining: 0,
        headers: {
          ...local.headers,
          "X-HT-RateLimit-Scope": "fail-closed",
          "Retry-After": "60",
        },
        scope: "fail_closed",
        durable: false,
      };
    }
    return {
      ...local,
      headers: { ...local.headers, "X-HT-RateLimit-Scope": "local-fallback" },
      scope: "local_fallback",
      durable: false,
    };
  }
}

export async function recordExternalRequestTelemetry(input: {
  endpoint: string;
  provider: string;
  operation: string;
  requestCount: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  outcome: "success" | "unavailable" | "rate_limited" | "error";
  sourceTimestamp?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const client = serviceClient();
  if (!client) return { recorded: false, reason: "not_configured" as const };
  try {
    const { error } = await client.from("ht_external_request_telemetry").insert({
      endpoint: input.endpoint.slice(0, 100),
      provider: input.provider.slice(0, 60),
      operation: input.operation.slice(0, 100),
      request_count: Math.max(0, Math.floor(input.requestCount)),
      input_tokens: input.inputTokens == null ? null : Math.max(0, Math.floor(input.inputTokens)),
      output_tokens: input.outputTokens == null ? null : Math.max(0, Math.floor(input.outputTokens)),
      outcome: input.outcome,
      source_timestamp: input.sourceTimestamp ?? null,
      metadata: input.metadata ?? {},
    });
    return error
      ? { recorded: false, reason: "write_failed" as const }
      : { recorded: true as const };
  } catch {
    return { recorded: false, reason: "write_failed" as const };
  }
}
