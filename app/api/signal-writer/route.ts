// app/api/signal-writer/route.ts
// Run-scoped writer. Keeps ht_signals updated temporarily for rollback compatibility.

import { NextResponse } from "next/server";
import {
  resolveSnapshotChangeFromOpenPercent,
  resolveSnapshotChangePercent,
  resolveSnapshotPullbackFromSessionHighPercent,
  resolveSnapshotPrice,
  resolveSnapshotSessionHigh,
  resolveSnapshotSessionOpen,
  type PolygonSnapshotRow,
} from "@/lib/polygon-snapshot";
import { getErrorMessage } from "@/lib/error-message";
import { hydrateSnapshotLeaders } from "@/lib/intraday-snapshot-hydration";
import { loadSecurityMetadata } from "@/lib/security-metadata";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ENGINE_VERSION = "signal-writer-v9-minute-hydration";

const RECLAIM_MIN_CHANGE_FROM_OPEN = 5;
const RECLAIM_MIN_RVOL = 2;
const RECLAIM_MIN_DOLLAR_VOLUME = 500_000;
const MIN_PRIOR_DAY_VOLUME = 10_000;
const LIVE_LIQUIDITY_OVERRIDE_VOLUME = 100_000;
const LIVE_LIQUIDITY_OVERRIDE_DOLLARS = 1_000_000;

type Candidate = {
  ticker: string; price: number; changePercent: number; rvol: number; prevVol: number;
  sessionOpenPrice: number | null; changeFromOpenPercent: number | null;
  sessionHighPrice: number | null; pullbackFromSessionHighPercent: number | null;
  scanSession: string;
  securityType: string | null; retrievedForSm: boolean; retrievedForBtc: boolean;
  retrievedForReclaim: boolean;
  retrievedForCatalyst: boolean; catalystScore: number; catalystState: string;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${CRON_SECRET}`;
}

const clamp = (value: number, min = 0, max = 99) => Math.min(max, Math.max(min, Math.round(value)));

function getFusedMomentumMove(candidate: Candidate) {
  const fullDayCore = clamp(Math.max(0, candidate.changePercent) * 3);
  const hasCurrentSessionReference =
    (candidate.scanSession === "pre_market" ||
      candidate.scanSession === "regular") &&
    candidate.changeFromOpenPercent !== null;
  if (!hasCurrentSessionReference) return fullDayCore / 3;

  const activeSessionCore = clamp(
    Math.max(0, candidate.changeFromOpenPercent ?? 0) * 3,
  );
  const fusedCore = candidate.retrievedForReclaim
    ? activeSessionCore
    : Math.round(fullDayCore * 0.45 + activeSessionCore * 0.55);

  // Existing writer formulas consume a percentage-like move. Converting the
  // shared 0-99 momentum core back to that scale keeps their thresholds stable
  // while ensuring pre-market gaps and live follow-through both contribute.
  return fusedCore / 3;
}

function getEasternSession(): {
  name: "pre_market" | "regular" | "after_hours" | "closed";
  expectedVolumeFraction: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  if (weekday === "Sat" || weekday === "Sun") return { name: "closed", expectedVolumeFraction: 1 };
  if (minutes >= 240 && minutes < 570) return { name: "pre_market", expectedVolumeFraction: 0.05 };
  if (minutes >= 570 && minutes < 960) {
    const elapsedFraction = (minutes - 570) / 390;
    return { name: "regular", expectedVolumeFraction: Math.min(1, 0.08 + elapsedFraction * 0.92) };
  }
  if (minutes >= 960 && minutes < 1200) return { name: "after_hours", expectedVolumeFraction: 1 };
  return { name: "closed", expectedVolumeFraction: 1 };
}

function computeSignal(
  candidate: Candidate,
  pool: "spot_momentum" | "before_the_crowd",
  includeReclaimColumns: boolean,
  includePeakRetentionColumns: boolean,
) {
  const move = getFusedMomentumMove(candidate);
  const volumeScore = candidate.rvol > 0 ? clamp(candidate.rvol * 10) : 0;
  const momentumScore = clamp(move * 4 + (move > 0 ? 10 : 0) + Math.min(25, candidate.rvol * 6));
  const crowdScore = clamp(Math.min(40, candidate.rvol * 8) + Math.min(30, move * 2) + (move > 5 ? 10 : 0));
  const baseRisk = Math.min(99, move * 3.5);
  const trapScore = clamp(candidate.catalystScore >= 20 ? baseRisk * 0.85 : baseRisk);
  const catalystBonus = candidate.catalystScore > 0 ? Math.min(25, candidate.catalystScore * 0.28) : 0;
  const htScore = clamp(momentumScore * 0.4 + volumeScore * 0.3 + (99 - crowdScore) * 0.15 + (99 - trapScore) * 0.15 + catalystBonus);

  let pattern = "Standard";
  if (candidate.retrievedForReclaim) {
    pattern =
      candidate.scanSession === "pre_market"
        ? "Pre-Market Reclaim"
        : "Intraday Reclaim";
  }
  else if (candidate.rvol >= 5 && move < 3) pattern = "Quiet Accumulation";
  else if (candidate.rvol >= 3 && move >= 5) pattern = "Crowd Ignition";
  else if (move >= 15 && candidate.catalystScore < 20) pattern = "Exhaustion Risk";
  else if (candidate.catalystScore >= 60 && move >= 5) pattern = "Catalyst Momentum";
  else if (candidate.catalystScore >= 40) pattern = "Catalyst Building";
  else if (candidate.rvol >= 2 && move >= 2 && crowdScore < 40) pattern = "Pressure Coil";

  const signalState = momentumScore >= 70 ? "Strong Momentum" : momentumScore >= 50 ? "Developing" : "Watch";
  let oppScore = htScore;
  if (candidate.catalystScore >= 60) oppScore += 22;
  else if (candidate.catalystScore >= 40) oppScore += 14;
  else if (candidate.catalystScore >= 20) oppScore += 7;
  if (candidate.rvol >= 5) oppScore += 14;
  else if (candidate.rvol >= 3) oppScore += 10;
  else if (candidate.rvol >= 2) oppScore += 6;
  else if (candidate.rvol >= 1.5) oppScore += 3;
  if (move >= 10) oppScore += 14;
  else if (move >= 5) oppScore += 10;
  else if (move >= 3) oppScore += 6;
  else if (move >= 1) oppScore += 3;
  if (crowdScore < 30) oppScore += 14;
  else if (crowdScore < 45) oppScore += 8;
  else if (crowdScore > 70) oppScore -= 10;
  if (pattern === "Quiet Accumulation" || pattern === "Pressure Coil") oppScore += 8;
  else if (pattern === "Catalyst Momentum") oppScore += 6;
  else if (pattern === "Exhaustion Risk") oppScore -= 14;
  else if (pattern === "Crowd Ignition") oppScore += 5;
  if (trapScore >= 75) oppScore -= 10;
  else if (trapScore >= 60) oppScore -= 5;
  if (pool === "before_the_crowd") {
    if (crowdScore < 35) oppScore += 8;
    if (crowdScore > 60) oppScore -= 8;
  }

  return {
    ticker: candidate.ticker, price: candidate.price,
    change_percent: Number(candidate.changePercent.toFixed(4)),
    relative_volume: Number(candidate.rvol.toFixed(4)), avg_volume: Math.round(candidate.prevVol),
    ht_score: htScore, momentum_score: momentumScore, crowd_score: crowdScore,
    trap_score: trapScore, catalyst_score: candidate.catalystScore, volume_score: volumeScore,
    pattern, state: candidate.catalystState, signal_state: signalState,
    security_type: candidate.securityType,
    retrieved_for_sm: candidate.retrievedForSm,
    retrieved_for_btc: candidate.retrievedForBtc,
    retrieved_for_catalyst: candidate.retrievedForCatalyst,
    ...(includeReclaimColumns
      ? {
          session_open_price: candidate.sessionOpenPrice,
          change_from_open_percent: candidate.changeFromOpenPercent,
          scan_session: candidate.scanSession,
          retrieved_for_reclaim: candidate.retrievedForReclaim,
      }
      : {}),
    ...(includePeakRetentionColumns
      ? {
          session_high_price: candidate.sessionHighPrice,
          pullback_from_session_high_percent:
            candidate.pullbackFromSessionHighPercent,
        }
      : {}),
    scanned_at: new Date().toISOString(), _oppScore: oppScore, _pool: pool,
  };
}

async function supportsPeakRetentionColumns(
  supabase: ReturnType<typeof getSupabase>,
) {
  const { error } = await supabase
    .from("ht_signal_run_rows")
    .select("session_high_price,pullback_from_session_high_percent")
    .limit(1);
  if (error) {
    console.warn(
      "[signal-writer] peak-retention migration is not active; continuing without the new context:",
      error.message,
    );
    return false;
  }
  return true;
}

async function supportsIntradayReclaimColumns(
  supabase: ReturnType<typeof getSupabase>,
) {
  const { error } = await supabase
    .from("ht_signal_run_rows")
    .select(
      "session_open_price,change_from_open_percent,scan_session,retrieved_for_reclaim",
    )
    .limit(1);
  if (error) {
    console.warn(
      "[signal-writer] intraday-reclaim migration is not active; preserving the existing scan lane:",
      error.message,
    );
    return false;
  }
  return true;
}

async function readActiveCatalysts(supabase: ReturnType<typeof getSupabase>) {
  const map = new Map<string, { score: number; state: string }>();
  const activeSince = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("ht_catalyst_state")
    .select("ticker,score,category,last_seen_at")
    .eq("decay_state", "active")
    .gte("last_seen_at", activeSince);
  if (error) { console.warn("[signal-writer] catalyst state unavailable:", error.message); return map; }
  for (const row of data ?? []) {
    const ticker = String(row?.ticker ?? "").toUpperCase();
    const score = Number(row?.score ?? 0);
    if (!ticker || !Number.isFinite(score)) continue;
    const existing = map.get(ticker);
    if (!existing || score > existing.score) map.set(ticker, { score, state: String(row?.category ?? "Verified Catalyst") });
  }
  return map;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!POLYGON_KEY) return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });

  const supabase = getSupabase();
  const startedMs = Date.now();
  const { data: run, error: runError } = await supabase.from("ht_scan_runs")
    .insert({ engine_version: ENGINE_VERSION, run_type: "signal_writer_v3", status: "running" })
    .select("id").single();
  if (runError || !run) return NextResponse.json({ error: "Failed to create scan run", detail: runError?.message }, { status: 500 });

  try {
    const catalystMap = await readActiveCatalysts(supabase);
    const reclaimSchemaReady = await supportsIntradayReclaimColumns(supabase);
    const peakRetentionSchemaReady = await supportsPeakRetentionColumns(supabase);
    const marketSession = getEasternSession();
    const response = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false&apiKey=${POLYGON_KEY}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Polygon snapshot failed: ${response.status}`);
    const payload = (await response.json()) as { tickers?: PolygonSnapshotRow[] };
    const tickers = payload.tickers ?? [];
    if (!tickers.length) throw new Error("Polygon returned an empty market snapshot.");

    const hydratedLeaders = await hydrateSnapshotLeaders(
      tickers,
      POLYGON_KEY,
      marketSession.name,
    );

    const candidates = new Map<string, Candidate>();
    let liveLiquidityOverrides = 0;
    let hydratedCandidates = 0;
    for (const row of tickers) {
      const ticker = String(row?.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      const hydrated = hydratedLeaders.get(ticker);
      const price = hydrated?.price ?? resolveSnapshotPrice(row);
      const changePercent = resolveSnapshotChangePercent(row, price);
      const sessionOpenPrice =
        hydrated?.sessionOpenPrice ?? resolveSnapshotSessionOpen(row);
      const sessionHighPrice =
        hydrated?.sessionHighPrice ?? resolveSnapshotSessionHigh(row, price);
      const changeFromOpenPercent =
        hydrated?.changeFromOpenPercent ??
        resolveSnapshotChangeFromOpenPercent(row, price);
      const pullbackFromSessionHighPercent =
        sessionHighPrice !== null && sessionHighPrice > 0
          ? Math.max(0, ((sessionHighPrice - price) / sessionHighPrice) * 100)
          : resolveSnapshotPullbackFromSessionHighPercent(row, price);
      const currentVolume = Math.max(
        Number(row?.day?.v || 0),
        Number(row?.min?.av || 0),
        hydrated?.currentVolume ?? 0,
      );
      const previousVolume = Number(row?.prevDay?.v || 0);
      if (price <= 0) continue;
      const liveLiquidityOverride =
        previousVolume < MIN_PRIOR_DAY_VOLUME &&
        currentVolume >= LIVE_LIQUIDITY_OVERRIDE_VOLUME &&
        price * currentVolume >= LIVE_LIQUIDITY_OVERRIDE_DOLLARS;
      if (
        previousVolume < MIN_PRIOR_DAY_VOLUME &&
        !liveLiquidityOverride
      ) {
        continue;
      }
      if (liveLiquidityOverride) liveLiquidityOverrides += 1;
      if (hydrated) hydratedCandidates += 1;
      const rawVolumeRatio =
        currentVolume > 0 && previousVolume > 0
          ? currentVolume / previousVolume
          : 0;
      const rvol = Math.min(25, rawVolumeRatio / marketSession.expectedVolumeFraction);
      const catalyst = catalystMap.get(ticker);
      const retrievedForReclaim = Boolean(
        reclaimSchemaReady &&
          (marketSession.name === "pre_market" ||
            marketSession.name === "regular") &&
          changePercent <= 0 &&
          changeFromOpenPercent !== null &&
          changeFromOpenPercent >= RECLAIM_MIN_CHANGE_FROM_OPEN &&
          rvol >= RECLAIM_MIN_RVOL &&
          price * currentVolume >= RECLAIM_MIN_DOLLAR_VOLUME,
      );
      const retrievedForSm =
        (changePercent > 0 && rvol >= 1.5 && changePercent >= 0.5) ||
        retrievedForReclaim;
      const retrievedForBtc =
        (changePercent > 0 && rvol >= 1.2 && changePercent >= 0.2) ||
        Boolean(
          reclaimSchemaReady &&
            (marketSession.name === "pre_market" ||
              marketSession.name === "regular") &&
            changePercent > -3 &&
            changePercent <= 0 &&
            changeFromOpenPercent !== null &&
            changeFromOpenPercent >= 0.5 &&
            rvol >= 1.2,
        );
      const retrievedForCatalyst = Boolean(catalyst && catalyst.score >= 20);
      if (!retrievedForSm && !retrievedForBtc && !retrievedForCatalyst) continue;
      candidates.set(ticker, {
        ticker, price, changePercent, rvol, prevVol: previousVolume,
        sessionOpenPrice: sessionOpenPrice > 0 ? sessionOpenPrice : null,
        sessionHighPrice,
        pullbackFromSessionHighPercent,
        changeFromOpenPercent, scanSession: marketSession.name,
        securityType: null,
        retrievedForSm, retrievedForBtc, retrievedForReclaim,
        retrievedForCatalyst,
        catalystScore: catalyst?.score ?? 0, catalystState: catalyst?.state ?? "",
      });
    }

    // Production fails closed on security type. Cache misses are enriched on
    // demand through Polygon, so a cron race with shadow retrieval cannot let
    // ETFs, warrants, units, or unknown instruments enter a promoted run.
    const metadata = await loadSecurityMetadata(supabase, [...candidates.keys()]);
    let unsupportedSecurityTypes = 0;
    let unknownSecurityTypes = 0;
    for (const [ticker, candidate] of candidates) {
      const security = metadata.byTicker.get(ticker);
      if (!security?.security_type) {
        unknownSecurityTypes += 1;
        candidates.delete(ticker);
        continue;
      }
      if (!security.is_supported) {
        unsupportedSecurityTypes += 1;
        candidates.delete(ticker);
        continue;
      }
      candidate.securityType = security.security_type;
    }

    const rows = [...candidates.values()].map((candidate) => ({
      ...computeSignal(
        candidate,
        candidate.retrievedForSm ? "spot_momentum" : "before_the_crowd",
        reclaimSchemaReady,
        peakRetentionSchemaReady,
      ),
      scan_run_id: run.id,
    }));
    if (rows.length < 3) {
      await supabase.from("ht_scan_runs").update({
        status: "success", completed_at: new Date().toISOString(), promoted: false,
        candidate_counts: { totalSnapshotTickers: tickers.length, runRows: rows.length, note: "Quiet market. No promotion." },
      }).eq("id", run.id);
      return NextResponse.json({ success: true, runId: run.id, marketState: "quiet_or_weak", written: 0, candidates: rows.length });
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100).map(({ _oppScore, _pool, ...row }) => {
        void _oppScore;
        void _pool;
        return row;
      });
      const { error } = await supabase.from("ht_signal_run_rows").insert(batch);
      if (error) throw new Error(`Run-row insert failed: ${error.message}`);
      written += batch.length;
    }

    const compatibility = [...rows].sort((a, b) => b._oppScore - a._oppScore).slice(0, 100)
      .map(({ scan_run_id, security_type, retrieved_for_sm, retrieved_for_btc, retrieved_for_catalyst, session_open_price, change_from_open_percent, scan_session, retrieved_for_reclaim, session_high_price, pullback_from_session_high_percent, _oppScore, _pool, ...row }) => {
        void scan_run_id;
        void security_type;
        void retrieved_for_sm;
        void retrieved_for_btc;
        void retrieved_for_catalyst;
        void session_open_price;
        void change_from_open_percent;
        void scan_session;
        void retrieved_for_reclaim;
        void session_high_price;
        void pullback_from_session_high_percent;
        void _oppScore;
        void _pool;
        return row;
      });
    for (let i = 0; i < compatibility.length; i += 25) {
      const { error } = await supabase.from("ht_signals").upsert(compatibility.slice(i, i + 25), { onConflict: "ticker" });
      if (error) console.error("[signal-writer] compatibility write failed:", error.message);
    }

    await supabase.from("ht_scan_runs").update({
      status: "success", completed_at: new Date().toISOString(), promoted: true, promoted_at: new Date().toISOString(),
      candidate_counts: {
        totalSnapshotTickers: tickers.length, runRows: rows.length, marketSession: marketSession.name,
        retrievedForSm: rows.filter((r) => r.retrieved_for_sm).length,
        retrievedForBtc: rows.filter((r) => r.retrieved_for_btc).length,
        retrievedForReclaim: rows.filter((r) => r.retrieved_for_reclaim).length,
        retrievedForCatalyst: rows.filter((r) => r.retrieved_for_catalyst).length,
        reclaimSchemaReady,
        peakRetentionSchemaReady,
        securityMetadataCacheHits: metadata.cacheHits,
        securityMetadataFetched: metadata.fetched,
        securityMetadataFetchFailures: metadata.fetchFailures,
        unsupportedSecurityTypes,
        unknownSecurityTypes,
        liveLiquidityOverrides,
        hydratedCandidates,
        hydrationCandidatesRequested: hydratedLeaders.size,
      },
    }).eq("id", run.id);

    return NextResponse.json({ success: true, runId: run.id, engineVersion: ENGINE_VERSION, runRowsWritten: written, elapsedMs: Date.now() - startedMs });
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Signal writer failed");
    await supabase.from("ht_scan_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: message }).eq("id", run.id);
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
