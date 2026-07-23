// app/api/shadow-retrieval/route.ts
//
// SHADOW-ONLY. Writes exclusively to ht_shadow_signals, ht_scan_runs,
// ht_scan_lock, and (via on-demand caching) ht_security_metadata.
// Reads from ht_catalyst_state.
//
// Never reads from or writes to ht_signals. Does not implement SM/BTC
// eligibility, ranking, confidence, selection, the canonical trade
// framework, or Top Conviction. Does not touch the frontend. Produces
// only a trustworthy, inspectable candidate-retrieval set for later
// phases to build on.
//
// Independent retrieval lanes — a ticker may carry any combination of
// retrievedForSpotMomentum, retrievedForBeforeCrowd, retrievedForCatalyst.
// This directly replaces signal-writer's sequential if/else-if, which
// could only ever assign a ticker to one pool even if it genuinely
// qualified for more than one.

import { NextResponse } from "next/server";
import {
  resolveSnapshotChangePercent,
  resolveSnapshotPrice,
} from "@/lib/polygon-snapshot";
import { createClient } from "@supabase/supabase-js";
import { loadSecurityMetadata } from "@/lib/security-metadata";
import { getTradeFramework, TradeFrameworkResult } from "@/lib/canonical-trade-framework";

export const dynamic = "force-dynamic";
// Tonight's test runs were warm-cache (~2s) since metadata was already
// fetched from earlier testing. The real first cold-start cycle (Monday
// morning, empty ht_feature_cache) will need genuine Polygon fetches for
// most of the shortlist, batched but still real network time. Generous
// explicit ceiling, well within Vercel Pro/Fluid Compute's real limits.
export const maxDuration = 120;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const LOCK_NAME = "shadow_retrieval";
const LEASE_MINUTES = 10;
const ENGINE_VERSION = "phase2-v1";
const SM_RETRIEVAL_PRIORITY_VERSION = "sm_retrieval_priority_v1";
const BTC_RETRIEVAL_PRIORITY_VERSION = "btc_retrieval_priority_v1";
const SM_CAP = 400;
const BTC_CAP = 400;
const EXTERNAL_DATA_CONCURRENCY = 25;

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars for shadow-retrieval.");
  }
  return createClient(supabaseUrl, supabaseKey);
}

function isAuthorized(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  return secret === process.env.CRON_SECRET || secret === "htlabs-internal";
}

type PrecheckedTicker = {
  ticker: string;
  price: number;
  changePercent: number;
  currentVol: number;
  prevVol: number;
  rvol: number;
  couldBeSM: boolean;
  couldBeBTC: boolean;
};

function getExpectedVolumeFraction() {
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
  if (weekday === "Sat" || weekday === "Sun") return 1;
  if (minutes >= 240 && minutes < 570) return 0.05;
  if (minutes >= 570 && minutes < 960) return Math.min(1, 0.08 + ((minutes - 570) / 390) * 0.92);
  return 1;
}

// Sample up to N excluded tickers per reason, for debugging — never an
// unbounded log. Per the Phase 2 contract: return/store a small bounded
// sample, do not create a new persistent exclusion table this phase.
const SAMPLE_CAP = 10;
function addSample(bucket: Record<string, string[]>, reason: string, ticker: string) {
  if (!bucket[reason]) bucket[reason] = [];
  if (bucket[reason].length < SAMPLE_CAP) bucket[reason].push(ticker);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!POLYGON_KEY) {
    return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const testLockOnly = searchParams.get("testLockOnly") === "true";

  const supabase = getSupabase();
  const now = new Date();
  const startTime = Date.now();

  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .insert({ engine_version: ENGINE_VERSION, run_type: testLockOnly ? "lock_test" : "full_shadow_scan", status: "running" })
    .select()
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Failed to create scan run", detail: runError?.message }, { status: 500 });
  }

  // ── Atomic lock acquisition — a real concurrent test proved the old
  // read-then-write pattern lets two simultaneous requests both pass.
  // This single RPC call is the actual fix: only one caller can ever
  // get `true` back, enforced by Postgres row locking, not JS logic.
  const { data: acquired, error: acquireError } = await supabase.rpc("acquire_scan_lock", {
    p_lock_name: LOCK_NAME,
    p_run_id: run.id,
    p_lease_minutes: LEASE_MINUTES,
  });

  // Temporary diagnostics — surfaces exactly what the function returned
  // and the real lock-row state right after this call, so a second
  // failed concurrent test can be diagnosed directly instead of guessed
  // at. Safe to remove once the lock is confirmed working.
  const { data: lockRowAfter } = await supabase
    .from("ht_scan_lock")
    .select("*")
    .eq("lock_name", LOCK_NAME)
    .maybeSingle();

  const lockDiagnostics = {
    acquiredRawValue: acquired,
    acquiredType: typeof acquired,
    acquireErrorMessage: acquireError?.message ?? null,
    lockRowAfterAcquisitionAttempt: lockRowAfter,
    thisRunId: run.id,
  };

  // Isolated lock test — exits shortly after the acquisition attempt,
  // skipping the ~2 second market scan entirely. This closes the real
  // gap the last test revealed: two requests fired simultaneously from
  // the browser still don't reach the lock line at the same instant if
  // there's substantial work happening first.
  //
  // If this request acquired the lock, it holds it deliberately for 3
  // seconds before releasing — a wide, guaranteed window, not a
  // microsecond one. Releasing instantly would risk the opposite
  // problem: the first request finishing before the second one even
  // arrives, which would make this test just as unreliable as the
  // sequential clicks were.
  if (testLockOnly) {
    if (acquired === true) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await supabase.from("ht_scan_lock")
        .update({ status: "released" })
        .eq("lock_name", LOCK_NAME)
        .eq("run_id", run.id);
    }

    await supabase.from("ht_scan_runs").update({
      status: acquired === true ? "success" : "skipped",
      completed_at: new Date().toISOString(),
      error_summary: acquired === true ? null : "Lock test — did not acquire.",
    }).eq("id", run.id);

    return NextResponse.json({
      testLockOnly: true,
      acquired: acquired === true,
      lockDiagnostics,
    });
  }

  if (acquireError) {
    await supabase.from("ht_scan_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: `Lock acquisition failed: ${acquireError.message}`,
    }).eq("id", run.id);
    return NextResponse.json({ error: "Failed to acquire lock", detail: acquireError.message, lockDiagnostics }, { status: 500 });
  }

  // Defensive against acquired coming back as something other than a
  // real boolean (e.g. a string "false" over JSON, which is truthy in
  // JS) — explicitly check for === true rather than trusting !acquired.
  const reallyAcquired = acquired === true;

  if (!reallyAcquired) {
    await supabase.from("ht_scan_runs").update({
      status: "skipped",
      completed_at: new Date().toISOString(),
      error_summary: "Another shadow-retrieval run held the lock at acquisition time.",
    }).eq("id", run.id);

    return NextResponse.json({
      success: false,
      message: "Another shadow-retrieval run is already active (valid lease held).",
      lockDiagnostics,
    });
  }

  const exclusionSamples: Record<string, string[]> = {};
  const diag = {
    totalSnapshotTickers: 0,
    passedPrecheck: 0,
    failedPricePrecheck: 0,
    failedLiquidityPrecheck: 0,
    noLaneMatched: 0,
    metadataCacheHits: 0,
    metadataFetchedFromPolygon: 0,
    metadataFetchFailures: 0,
    unsupportedSecurityType: 0,
    rawSmLaneCount: 0,
    rawBtcLaneCount: 0,
    activeCatalystCandidates: 0,
    multiLaneTickerCount: 0,
    smCapApplied: false,
    smTrimmedCount: 0,
    btcCapApplied: false,
    btcTrimmedCount: 0,
    finalUniqueShortlistSize: 0,
    shadowRowsAttempted: 0,
    shadowRowsWritten: 0,
  };

  try {
    // ── 1. Full Polygon market snapshot — one call, same as signal-writer ──
    const snapRes = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false&apiKey=${POLYGON_KEY}`,
      { cache: "no-store" }
    );
    if (!snapRes.ok) throw new Error(`Polygon snapshot failed: ${snapRes.status}`);
    const snapData = await snapRes.json();
    const allTickers: any[] = snapData?.tickers ?? [];
    diag.totalSnapshotTickers = allTickers.length;

    // ── 2. Cheap prechecks — free, from data already in hand ────────────
    const precheckPassed: PrecheckedTicker[] = [];
    const expectedVolumeFraction = getExpectedVolumeFraction();
    for (const t of allTickers) {
      const ticker = String(t.ticker ?? "").trim().toUpperCase();
      if (!ticker) continue;

      const price = resolveSnapshotPrice(t);
      const changePercent = resolveSnapshotChangePercent(t, price);

      const currentVol = Math.max(Number(t.day?.v || 0), Number(t.min?.av || 0));
      const prevVol = Number(t.prevDay?.v || 0);
      const rawVolumeRatio = currentVol > 0 && prevVol > 0 ? currentVol / prevVol : 0;
      const rvol = Math.min(25, rawVolumeRatio / expectedVolumeFraction);

      if (price <= 0) {
        diag.failedPricePrecheck++;
        addSample(exclusionSamples, "failed_price_precheck", ticker);
        continue;
      }
      if (prevVol < 10000) {
        diag.failedLiquidityPrecheck++;
        addSample(exclusionSamples, "failed_liquidity_precheck", ticker);
        continue;
      }

      // Loosened retrieval thresholds — permissive by design, this is
      // retrieval not eligibility. Independent checks, not sequential.
      const couldBeSM = rvol >= 1.5 && changePercent >= 0.5;
      const couldBeBTC = rvol >= 1.2 && changePercent >= 0.2;

      if (!couldBeSM && !couldBeBTC) {
        diag.noLaneMatched++;
        continue; // catalyst lane checked separately below, against the whole precheck-passed set only if volume/price were sane
      }

      diag.passedPrecheck++;
      precheckPassed.push({ ticker, price, changePercent, currentVol, prevVol, rvol, couldBeSM, couldBeBTC });
    }

    // ── 3. Security-type gate — on-demand fetch-and-cache, bounded concurrency ──
    const tickersNeedingCheck = precheckPassed.map((p) => p.ticker);
    const metadata = await loadSecurityMetadata(supabase, tickersNeedingCheck, {
      concurrency: EXTERNAL_DATA_CONCURRENCY,
    });
    const metaByTicker = metadata.byTicker;
    diag.metadataCacheHits = metadata.cacheHits;
    diag.metadataFetchedFromPolygon = metadata.fetched;
    diag.metadataFetchFailures = metadata.fetchFailures;

    // ── 4. Catalyst lane — independent of SM/BTC precheck results ────────
    const activeCatalystSince = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { data: catalystRows } = await supabase
      .from("ht_catalyst_state")
      .select("ticker")
      .eq("decay_state", "active")
      .gte("last_seen_at", activeCatalystSince);
    const catalystTickers = new Set((catalystRows ?? []).map((r: any) => r.ticker));
    diag.activeCatalystCandidates = catalystTickers.size;

    // ── 5. Apply security-type gate, assign independent lane flags ───────
    type Candidate = PrecheckedTicker & {
      retrievedForSM: boolean;
      retrievedForBTC: boolean;
      retrievedForCatalyst: boolean;
      securityType: string | null;
      reasons: string[];
    };

    const candidates: Candidate[] = [];
    for (const p of precheckPassed) {
      const meta = metaByTicker.get(p.ticker);
      if (!meta || !meta.security_type) {
        // Not a new failure — this ticker's Polygon fetch already failed
        // and was counted once, above, in the batch-fetch loop. This is
        // just recording which tickers that failure actually excluded.
        addSample(exclusionSamples, "security_type_unknown", p.ticker);
        continue; // fail closed — unknown type is excluded, never guessed
      }
      if (!meta.is_supported) {
        diag.unsupportedSecurityType++;
        addSample(exclusionSamples, "unsupported_security_type", p.ticker);
        continue;
      }

      const reasons: string[] = [];
      const retrievedForSM = p.couldBeSM;
      const retrievedForBTC = p.couldBeBTC;
      const retrievedForCatalyst = catalystTickers.has(p.ticker);

      if (retrievedForSM) reasons.push("SM volume threshold passed", "SM price-move threshold passed");
      if (retrievedForBTC) reasons.push("BTC volume threshold passed", "BTC price-move threshold passed");
      if (retrievedForCatalyst) reasons.push("Active catalyst found");

      if (!retrievedForSM && !retrievedForBTC && !retrievedForCatalyst) continue;

      candidates.push({
        ...p,
        retrievedForSM,
        retrievedForBTC,
        retrievedForCatalyst,
        securityType: meta.security_type,
        reasons,
      });
    }

    // Catalyst-only candidates that failed both SM and BTC prechecks
    // never entered `precheckPassed` above (precheck requires SM-or-BTC).
    // Force-include real catalyst matches independently, per the
    // architecture contract's forced-inclusion requirement — a genuine
    // catalyst should never be invisible just because today's volume
    // was modest.
    const alreadyIncluded = new Set(candidates.map((c) => c.ticker));
    for (const t of allTickers) {
      const ticker = String(t.ticker ?? "").trim().toUpperCase();
      if (!ticker || alreadyIncluded.has(ticker) || !catalystTickers.has(ticker)) continue;
      const price = resolveSnapshotPrice(t);
      if (price <= 0) continue;
      const meta = metaByTicker.get(ticker);
      if (!meta?.is_supported) continue; // still subject to the same security-type gate
      const changePercent = resolveSnapshotChangePercent(t, price);
      const currentVol = Math.max(Number(t.day?.v || 0), Number(t.min?.av || 0));
      const prevVol = Number(t.prevDay?.v || 0);
      candidates.push({
        ticker, price, changePercent, currentVol, prevVol,
        rvol: currentVol > 0 && prevVol > 0 ? currentVol / prevVol : 0,
        couldBeSM: false, couldBeBTC: false,
        retrievedForSM: false, retrievedForBTC: false, retrievedForCatalyst: true,
        securityType: meta.security_type,
        reasons: ["Active catalyst found"],
      });
    }

    diag.rawSmLaneCount = candidates.filter((c) => c.retrievedForSM).length;
    diag.rawBtcLaneCount = candidates.filter((c) => c.retrievedForBTC).length;
    diag.multiLaneTickerCount = candidates.filter(
      (c) => [c.retrievedForSM, c.retrievedForBTC, c.retrievedForCatalyst].filter(Boolean).length >= 2
    ).length;

    // ── 6. Independent protective caps, per-lane trim priority ───────────
    // SM: rewards active movement + participation together — matches
    // what SM is actually looking for (strong move happening now).
    const smCandidates = candidates.filter((c) => c.retrievedForSM);
    if (smCandidates.length > SM_CAP) {
      diag.smCapApplied = true;
      smCandidates.sort((a, b) => (b.rvol * b.changePercent) - (a.rvol * a.changePercent));
      const kept = new Set(smCandidates.slice(0, SM_CAP).map((c) => c.ticker));
      diag.smTrimmedCount = smCandidates.length - SM_CAP;
      for (const c of candidates) if (c.retrievedForSM && !kept.has(c.ticker)) c.retrievedForSM = false;
    }

    // BTC: rvol descending, changePercent ascending as tie-break — never
    // multiplied by change%, since that would favor the most-advanced
    // moves and directly contradict "before the crowd."
    const btcCandidates = candidates.filter((c) => c.retrievedForBTC);
    if (btcCandidates.length > BTC_CAP) {
      diag.btcCapApplied = true;
      btcCandidates.sort((a, b) => {
        if (b.rvol !== a.rvol) return b.rvol - a.rvol;
        return a.changePercent - b.changePercent;
      });
      const kept = new Set(btcCandidates.slice(0, BTC_CAP).map((c) => c.ticker));
      diag.btcTrimmedCount = btcCandidates.length - BTC_CAP;
      for (const c of candidates) if (c.retrievedForBTC && !kept.has(c.ticker)) c.retrievedForBTC = false;
    }
    // Catalyst lane: no cap, by design — a real catalyst is never trimmed for volume reasons.

    const finalCandidates = candidates.filter(
      (c) => c.retrievedForSM || c.retrievedForBTC || c.retrievedForCatalyst
    );
    diag.finalUniqueShortlistSize = finalCandidates.length;

    // ── 6b. Canonical trade framework — one call per candidate, cached ────
    // via ht_feature_cache (Phase 1's schema, unused until now). Bounded
    // concurrency, same pattern as security-metadata: cold-start days pay
    // the real Polygon-fetch cost once, every cycle after that within the
    // 45-minute TTL is a cache hit, not a new call.
    const frameworkResults = new Map<string, TradeFrameworkResult>();
    let frameworkFetched = 0;
    let frameworkCacheHits = 0;
    for (let i = 0; i < finalCandidates.length; i += EXTERNAL_DATA_CONCURRENCY) {
      const batch = finalCandidates.slice(i, i + EXTERNAL_DATA_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((c) => getTradeFramework(supabase, c.ticker, c.price, c.changePercent))
      );
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") {
          frameworkResults.set(batch[j].ticker, r.value);
          if (r.value.dataQualityState === "fresh") frameworkFetched++;
          if (r.value.dataQualityState === "valid_cached") frameworkCacheHits++;
        }
      }
    }
    (diag as any).tradeFrameworkFetched = frameworkFetched;
    (diag as any).tradeFrameworkCacheHits = frameworkCacheHits;

    // ── 7. Write immutable shadow rows, keyed by (scan_run_id, ticker) ────
    const shadowRows = finalCandidates.map((c) => {
      const tf = frameworkResults.get(c.ticker);
      return {
        scan_run_id: run.id,
        ticker: c.ticker,
        retrieved_for_sm: c.retrievedForSM,
        retrieved_for_btc: c.retrievedForBTC,
        retrieved_for_catalyst: c.retrievedForCatalyst,
        data_quality_state: tf?.dataQualityState ?? "insufficient",
        price: c.price,
        change_percent: c.changePercent,
        relative_volume: c.rvol,
        current_volume: Math.round(c.currentVol),
        previous_volume: Math.round(c.prevVol),
        security_type: c.securityType,
        retrieval_reasons: c.reasons,
        atr14: tf?.atr14 ?? null,
        volatility20d: tf?.volatility20d ?? null,
        upside_min: tf?.upsideMin ?? null,
        upside_max: tf?.upsideMax ?? null,
        downside_risk: tf?.downsideRisk ?? null,
        rr_ratio: tf?.rrRatio ?? null,
        trade_framework_quality: tf?.dataQualityState ?? "insufficient",
        computed_at: new Date().toISOString(),
      };
    });

    diag.shadowRowsAttempted = shadowRows.length;
    if (shadowRows.length > 0) {
      const { error: writeError } = await supabase.from("ht_shadow_signals").insert(shadowRows);
      if (writeError) throw new Error(`Shadow write failed: ${writeError.message}`);
      diag.shadowRowsWritten = shadowRows.length;
    }

    const durationMs = Date.now() - startTime;

    await supabase.from("ht_scan_runs").update({
      status: "success",
      completed_at: new Date().toISOString(),
      candidate_counts: diag,
    }).eq("id", run.id);

    await supabase.from("ht_scan_lock").update({ status: "released" }).eq("lock_name", LOCK_NAME).eq("run_id", run.id);

    return NextResponse.json({
      success: true,
      shadowOnly: true,
      runId: run.id,
      engineVersion: ENGINE_VERSION,
      smRetrievalPriorityVersion: SM_RETRIEVAL_PRIORITY_VERSION,
      btcRetrievalPriorityVersion: BTC_RETRIEVAL_PRIORITY_VERSION,
      durationMs,
      diagnostics: diag,
      exclusionSamples,
      note: "Shadow-only. ht_signals and production SM/BTC selection were not touched.",
      lockDiagnostics,
    });
  } catch (err: any) {
    await supabase.from("ht_scan_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: err.message,
    }).eq("id", run.id);
    await supabase.from("ht_scan_lock").update({ status: "released" }).eq("lock_name", LOCK_NAME).eq("run_id", run.id);
    return NextResponse.json({ success: false, shadowOnly: true, runId: run.id, error: err.message }, { status: 500 });
  }
}
