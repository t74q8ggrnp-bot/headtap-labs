import { createClient } from "@supabase/supabase-js";
import type { StockDisplayPrice } from "./stock-display-price";

export const STOCK_DISPLAY_FRAME_VERSION = "stock-display-frame-v1";
export const STOCK_DISPLAY_FRAME_INTERVAL_MS = 5_000;

export type StockDisplayFrame = StockDisplayPrice & {
  symbol: string;
  frameBucket: number;
  frameId: string;
  frameVersion: typeof STOCK_DISPLAY_FRAME_VERSION;
  coordination: "database" | "instance_fallback";
  coordinationIssue?: "not_configured" | "rpc_error" | "invalid_rpc_response" | "transport_error";
};

export type StockDisplayFrameCoordinationIssue = NonNullable<
  StockDisplayFrame["coordinationIssue"]
>;

export class StockDisplayFrameCoordinationError extends Error {
  readonly issue: StockDisplayFrameCoordinationIssue;

  constructor(issue: StockDisplayFrameCoordinationIssue) {
    super(`Shared stock display-frame coordination failed: ${issue}.`);
    this.name = "StockDisplayFrameCoordinationError";
    this.issue = issue;
  }
}

type Candidate = StockDisplayPrice & { symbol: string; frameBucket: number };

type CoordinationGuardOptions = {
  probe: () => Promise<void>;
  now?: () => number;
  readyTtlMs?: number;
  failureTtlMs?: number;
};

export type StockDisplayFrameCoordinationGuard = {
  preflight: () => Promise<void>;
  markReady: () => void;
  markFailed: (issue: StockDisplayFrameCoordinationIssue) => void;
};

export function stockDisplayFrameRpcProbeConfirmsContract(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "P0001" &&
    typeof candidate.message === "string" &&
    candidate.message.includes("Expected 1-250 stock display candidates");
}

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;
const localFrames = new Map<string, StockDisplayFrame>();

export function stockDisplayFrameBucket(at: Date | number) {
  const timestamp = at instanceof Date ? at.getTime() : at;
  return Math.floor(timestamp / STOCK_DISPLAY_FRAME_INTERVAL_MS) * STOCK_DISPLAY_FRAME_INTERVAL_MS;
}

function validCandidate(value: Candidate, now = Date.now()) {
  const providerAt = Date.parse(value.asOf);
  return SYMBOL_PATTERN.test(value.symbol) && Number.isFinite(value.price) && value.price > 0 &&
    Number.isFinite(providerAt) && providerAt > 0 && providerAt <= now + 2_000 &&
    Number.isSafeInteger(value.frameBucket) && value.frameBucket > 0 &&
    ["massive_polygon_last_trade", "massive_polygon_snapshot"].includes(value.source) &&
    ["trade", "minute_aggregate"].includes(value.priceKind);
}

function framed(
  value: Candidate,
  coordination: StockDisplayFrame["coordination"] = "instance_fallback",
): StockDisplayFrame {
  return {
    ...value,
    frameId: `${STOCK_DISPLAY_FRAME_VERSION}:${value.symbol}:${value.frameBucket}`,
    frameVersion: STOCK_DISPLAY_FRAME_VERSION,
    coordination,
  };
}

/**
 * Same-instance fallback and deterministic contract test seam. A newer request
 * bucket can never regress provider time; the first valid observation wins a
 * bucket so chart/list/header clients share one display event.
 */
export function selectLocalStockDisplayFrame(
  candidate: Candidate,
  coordination: StockDisplayFrame["coordination"] = "instance_fallback",
) {
  if (!validCandidate(candidate)) return null;
  const prior = localFrames.get(candidate.symbol);
  if (!prior) {
    const next = framed(candidate, coordination);
    localFrames.set(candidate.symbol, next);
    return next;
  }
  // A valid database response is the cross-instance winner for its bucket.
  // Replace the provisional instance candidate even when both share the same
  // bucket; otherwise each Vercel instance keeps its own first observation.
  if (coordination === "database" && candidate.frameBucket >= prior.frameBucket) {
    const next = framed(candidate, "database");
    localFrames.set(candidate.symbol, next);
    return next;
  }
  if (candidate.frameBucket <= prior.frameBucket) return prior;
  const next = Date.parse(candidate.asOf) >= Date.parse(prior.asOf)
    ? framed(candidate, coordination)
    : framed({
        symbol: prior.symbol,
        price: prior.price,
        asOf: prior.asOf,
        source: prior.source,
        priceKind: prior.priceKind,
        size: prior.size,
        frameBucket: candidate.frameBucket,
      }, prior.coordination);
  localFrames.set(candidate.symbol, next);
  return next;
}

export function parseStockDisplayFrame(value: unknown): StockDisplayFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const rawAsOf = String(row.asOf ?? "");
  const providerAt = Date.parse(rawAsOf);
  const candidate: Candidate = {
    symbol: String(row.symbol ?? ""),
    price: Number(row.price),
    // Postgres jsonb_build_object serializes timestamptz values with a numeric
    // offset. Emit one canonical ISO clock so downstream frame equality never
    // mistakes two spellings of the same provider instant for a mismatch.
    asOf: Number.isFinite(providerAt)
      ? new Date(providerAt).toISOString()
      : rawAsOf,
    source: row.source as Candidate["source"],
    priceKind: row.priceKind as Candidate["priceKind"],
    size: row.size === null || row.size === undefined ? null : Number(row.size),
    frameBucket: Number(row.frameBucket),
  };
  if (!validCandidate(candidate)) return null;
  const frame = framed(candidate, "database");
  return row.frameId === frame.frameId && row.frameVersion === frame.frameVersion
    ? frame
    : null;
}

function displayFrameClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(4_000)])
          : AbortSignal.timeout(4_000),
      }),
    },
  });
}

export function createStockDisplayFrameCoordinationGuard(
  options: CoordinationGuardOptions,
): StockDisplayFrameCoordinationGuard {
  const now = options.now ?? (() => Date.now());
  const readyTtlMs = Math.max(1_000, options.readyTtlMs ?? 30_000);
  const failureTtlMs = Math.max(1_000, options.failureTtlMs ?? 30_000);
  let readyUntil = 0;
  let blockedUntil = 0;
  let blockedIssue: StockDisplayFrameCoordinationIssue = "transport_error";
  let inFlight: Promise<void> | null = null;

  const markReady = () => {
    readyUntil = now() + readyTtlMs;
    blockedUntil = 0;
  };
  const markFailed = (issue: StockDisplayFrameCoordinationIssue) => {
    readyUntil = 0;
    blockedIssue = issue;
    blockedUntil = now() + failureTtlMs;
  };
  const preflight = async () => {
    const at = now();
    if (at < readyUntil) return;
    if (at < blockedUntil) {
      throw new StockDisplayFrameCoordinationError(blockedIssue);
    }
    if (inFlight) return inFlight;
    inFlight = options.probe()
      .then(() => {
        markReady();
      })
      .catch((error: unknown) => {
        const issue = error instanceof StockDisplayFrameCoordinationError
          ? error.issue
          : "transport_error";
        markFailed(issue);
        throw new StockDisplayFrameCoordinationError(issue);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  return { preflight, markReady, markFailed };
}

const coordinationGuard = createStockDisplayFrameCoordinationGuard({
  probe: async () => {
    const db = displayFrameClient();
    if (!db) throw new StockDisplayFrameCoordinationError("not_configured");
    try {
      // This service-role read is deliberately performed before any Massive
      // request. It validates config, network, PostgREST, the 0048 table and
      // service-role access without mutating a presentation frame.
      const [tableProbe, rpcProbe] = await Promise.all([
        db
          .from("ht_stock_display_frames")
          .select("symbol")
          .limit(1),
        // An empty candidate list intentionally trips the function's first
        // validation branch before any table write. Receiving that exact
        // error proves the 0048 RPC exists, is in PostgREST's schema cache,
        // and remains executable by the configured service role.
        db.rpc("ht_publish_stock_display_frames", { p_candidates: [] }),
      ]);
      if (tableProbe.error) {
        console.warn("[stock-display-frame] coordination preflight failed", {
          code: tableProbe.error.code ?? "unknown",
        });
        throw new StockDisplayFrameCoordinationError("rpc_error");
      }
      if (!stockDisplayFrameRpcProbeConfirmsContract(rpcProbe.error)) {
        console.warn("[stock-display-frame] coordination RPC preflight failed", {
          code: rpcProbe.error?.code ?? "missing_expected_validation_error",
        });
        throw new StockDisplayFrameCoordinationError("rpc_error");
      }
    } catch (error) {
      if (error instanceof StockDisplayFrameCoordinationError) throw error;
      throw new StockDisplayFrameCoordinationError("transport_error");
    }
  },
});

/**
 * Fail-closed provider-cost preflight. Call this before any Massive request so
 * a missing or unavailable shared-frame coordinator cannot multiply spend.
 */
export async function preflightStockDisplayFrameCoordination() {
  return coordinationGuard.preflight();
}

/** Presentation transport only. Never use the returned frame for scoring,
 * eligibility, Agent risk, paper fills, or order validation. */
export async function publishStockDisplayFrames(
  inputs: Array<{ symbol: string; display: StockDisplayPrice }>,
  requestStartedAt: Date | number,
): Promise<Record<string, StockDisplayFrame>> {
  const frameBucket = stockDisplayFrameBucket(requestStartedAt);
  const candidates = inputs.map(({ symbol, display }) => ({
    symbol: symbol.trim().toUpperCase(),
    ...display,
    frameBucket,
  })).filter((candidate) => validCandidate(candidate));
  if (!candidates.length) return {};

  const db = displayFrameClient();
  if (!db) {
    coordinationGuard.markFailed("not_configured");
    throw new StockDisplayFrameCoordinationError("not_configured");
  }
  try {
    const { data, error } = await db.rpc("ht_publish_stock_display_frames", {
      p_candidates: candidates.map((candidate) => ({
        symbol: candidate.symbol,
        price: candidate.price,
        asOf: candidate.asOf,
        source: candidate.source,
        priceKind: candidate.priceKind,
        size: candidate.size,
        frameBucket: candidate.frameBucket,
      })),
    });
    if (error) {
      console.warn("[stock-display-frame] coordination RPC failed", { code: error.code ?? "unknown" });
      coordinationGuard.markFailed("rpc_error");
      throw new StockDisplayFrameCoordinationError("rpc_error");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.warn("[stock-display-frame] coordination RPC returned an invalid response");
      coordinationGuard.markFailed("invalid_rpc_response");
      throw new StockDisplayFrameCoordinationError("invalid_rpc_response");
    }
    const parsed = Object.fromEntries(Object.entries(data).flatMap(([symbol, value]) => {
      const frame = parseStockDisplayFrame(value);
      if (!frame || frame.symbol !== symbol) return [];
      // Seed the local fallback with the database-selected cross-instance frame.
      // If this process has already seen newer provider evidence, retain it
      // instead of allowing a late database response to regress the display.
      selectLocalStockDisplayFrame({
        symbol: frame.symbol,
        price: frame.price,
        asOf: frame.asOf,
        source: frame.source,
        priceKind: frame.priceKind,
        size: frame.size,
        frameBucket: frame.frameBucket,
      }, "database");
      return [[symbol, frame]];
    }));
    const expectedSymbols = new Set(candidates.map((candidate) => candidate.symbol));
    if (
      Object.keys(parsed).length !== expectedSymbols.size ||
      [...expectedSymbols].some((symbol) => !parsed[symbol])
    ) {
      console.warn("[stock-display-frame] coordination RPC omitted a requested symbol");
      coordinationGuard.markFailed("invalid_rpc_response");
      throw new StockDisplayFrameCoordinationError("invalid_rpc_response");
    }
    coordinationGuard.markReady();
    return parsed;
  } catch (error) {
    if (error instanceof StockDisplayFrameCoordinationError) throw error;
    console.warn("[stock-display-frame] coordination transport failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    coordinationGuard.markFailed("transport_error");
    throw new StockDisplayFrameCoordinationError("transport_error");
  }
}

export async function publishStockDisplayFrame(
  symbol: string,
  display: StockDisplayPrice,
  requestStartedAt: Date | number,
) {
  const frames = await publishStockDisplayFrames([{ symbol, display }], requestStartedAt);
  return frames[symbol.trim().toUpperCase()] ?? null;
}
