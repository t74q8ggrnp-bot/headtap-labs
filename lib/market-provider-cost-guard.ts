export const MARKET_PROVIDER_COALESCE_BUCKET_MS = 5_000;
export const MARKET_PROVIDER_CACHE_TTL_MS = 4_500;
export const MARKET_PROVIDER_CACHE_MAX_ENTRIES = 256;

export type MarketProviderEvidenceDelivery =
  | "provider"
  | "single_flight"
  | "ttl_cache";

export type MarketProviderEvidence<T> = {
  value: T;
  delivery: MarketProviderEvidenceDelivery;
  providerRequestAttempted: boolean;
  evidenceCompletedAt: number;
  evidenceAgeMs: number;
};

/** Cache admission uses provider time, never server receipt time as market time. */
export function providerTimestampCanEnterShortCache(input: {
  providerTimestamp: string | null | undefined;
  completedAt: number;
  activeSession: boolean;
  maxAgeMs: number;
  futureToleranceMs?: number;
}) {
  const providerAt = input.providerTimestamp
    ? Date.parse(input.providerTimestamp)
    : Number.NaN;
  if (
    !Number.isFinite(providerAt) ||
    providerAt > input.completedAt + (input.futureToleranceMs ?? 2_000)
  ) {
    return false;
  }
  return !input.activeSession ||
    input.completedAt - providerAt <= input.maxAgeMs;
}

type SettledEvidence<T> = {
  value: T;
  completedAt: number;
};

type CachedEntry = {
  kind: "cached";
  value: unknown;
  completedAt: number;
  expiresAt: number;
  sequence: number;
};

type InFlightEntry = {
  kind: "in_flight";
  promise: Promise<SettledEvidence<unknown>>;
  sequence: number;
};

type GuardEntry = CachedEntry | InFlightEntry;

/**
 * A deliberately tiny provider-evidence cache. It coalesces identical work in
 * one server process and reuses only explicitly admitted evidence for less
 * than one five-second presentation interval. It never stores errors.
 *
 * This is not a durable or cross-region rate limiter. Serverless instances do
 * not share memory, so a future cross-instance guard requires shared
 * infrastructure and must not be inferred from this class.
 */
export class MarketProviderCostGuard {
  private readonly entries = new Map<string, GuardEntry>();
  private sequence = 0;
  private readonly options: {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
  };

  constructor(
    options: {
      ttlMs?: number;
      maxEntries?: number;
      now?: () => number;
    } = {},
  ) {
    this.options = options;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private ttlMs() {
    return Math.max(1, Math.floor(
      this.options.ttlMs ?? MARKET_PROVIDER_CACHE_TTL_MS,
    ));
  }

  private maxEntries() {
    return Math.max(1, Math.floor(
      this.options.maxEntries ?? MARKET_PROVIDER_CACHE_MAX_ENTRIES,
    ));
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.kind === "cached" && entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private evictOldestCachedEntry() {
    let oldest: { key: string; sequence: number } | null = null;
    for (const [key, entry] of this.entries) {
      if (
        entry.kind === "cached" &&
        (!oldest || entry.sequence < oldest.sequence)
      ) {
        oldest = { key, sequence: entry.sequence };
      }
    }
    if (!oldest) return false;
    this.entries.delete(oldest.key);
    return true;
  }

  private makeEvidence<T>(
    settled: SettledEvidence<T>,
    delivery: MarketProviderEvidenceDelivery,
  ): MarketProviderEvidence<T> {
    return {
      value: settled.value,
      delivery,
      providerRequestAttempted: delivery === "provider",
      evidenceCompletedAt: settled.completedAt,
      evidenceAgeMs: Math.max(0, this.now() - settled.completedAt),
    };
  }

  async run<T>(input: {
    key: string;
    load: () => Promise<T>;
    cacheIf: (value: T, completedAt: number) => boolean;
  }): Promise<MarketProviderEvidence<T>> {
    const lookupAt = this.now();
    this.pruneExpired(lookupAt);
    const existing = this.entries.get(input.key);
    if (existing?.kind === "cached") {
      return this.makeEvidence({
        value: existing.value as T,
        completedAt: existing.completedAt,
      }, "ttl_cache");
    }
    if (existing?.kind === "in_flight") {
      const settled = await existing.promise as SettledEvidence<T>;
      return this.makeEvidence(settled, "single_flight");
    }

    while (this.entries.size >= this.maxEntries()) {
      if (!this.evictOldestCachedEntry()) {
        // Bound memory even during a flood of distinct in-flight keys. This
        // request still works, but it is intentionally not retained.
        const value = await input.load();
        return this.makeEvidence({ value, completedAt: this.now() }, "provider");
      }
    }

    const entry: InFlightEntry = {
      kind: "in_flight",
      promise: Promise.resolve(null as never),
      sequence: ++this.sequence,
    };
    entry.promise = Promise.resolve()
      .then(input.load)
      .then((value) => {
        const completedAt = this.now();
        if (input.cacheIf(value, completedAt)) {
          this.entries.set(input.key, {
            kind: "cached",
            value,
            completedAt,
            expiresAt: completedAt + this.ttlMs(),
            sequence: ++this.sequence,
          });
        } else if (this.entries.get(input.key) === entry) {
          this.entries.delete(input.key);
        }
        return { value, completedAt };
      })
      .catch((error: unknown) => {
        if (this.entries.get(input.key) === entry) {
          this.entries.delete(input.key);
        }
        throw error;
      });
    this.entries.set(input.key, entry);

    const settled = await entry.promise as SettledEvidence<T>;
    return this.makeEvidence(settled, "provider");
  }

  clear() {
    this.entries.clear();
  }

  size() {
    return this.entries.size;
  }
}

export function marketProviderCoalescingKey(input: {
  operation: string;
  symbol: string;
  timestampMs: number;
  variant?: string;
}) {
  const bucket = Math.floor(
    input.timestampMs / MARKET_PROVIDER_COALESCE_BUCKET_MS,
  );
  return [
    input.operation.trim().toLowerCase(),
    input.symbol.trim().toUpperCase(),
    input.variant?.trim().toLowerCase() ?? "default",
    bucket,
  ].join(":");
}

const globalState = globalThis as typeof globalThis & {
  __htMarketProviderCostGuard?: MarketProviderCostGuard;
};

export const marketProviderCostGuard =
  globalState.__htMarketProviderCostGuard ?? new MarketProviderCostGuard();
globalState.__htMarketProviderCostGuard = marketProviderCostGuard;
