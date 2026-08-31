type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export type ApiRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  headers: Record<string, string>;
};

const globalState = globalThis as typeof globalThis & {
  __htApiRateLimitBuckets?: Map<string, RateLimitBucket>;
};

const buckets = globalState.__htApiRateLimitBuckets ?? new Map<string, RateLimitBucket>();
globalState.__htApiRateLimitBuckets = buckets;

function requestIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function checkApiRateLimit(
  request: Request,
  options: RateLimitOptions,
): ApiRateLimitResult {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1_000, Math.floor(options.windowMs));
  const key = `${options.namespace}:${requestIdentity(request)}`;
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, limit - bucket.count);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt - now) / 1_000),
  );
  const allowed = bucket.count <= limit;

  return {
    allowed,
    limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds,
    headers: {
      "RateLimit-Limit": String(limit),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1_000)),
      ...(allowed ? {} : { "Retry-After": String(retryAfterSeconds) }),
    },
  };
}

export function clearApiRateLimitBucketsForTests() {
  buckets.clear();
}
