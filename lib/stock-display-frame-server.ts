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
      throw new StockDisplayFrameCoordinationError("rpc_error");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.warn("[stock-display-frame] coordination RPC returned an invalid response");
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
      throw new StockDisplayFrameCoordinationError("invalid_rpc_response");
    }
    return parsed;
  } catch (error) {
    if (error instanceof StockDisplayFrameCoordinationError) throw error;
    console.warn("[stock-display-frame] coordination transport failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
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
