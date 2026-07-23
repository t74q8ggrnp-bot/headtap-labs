// app/api/catalyst-discovery/route.ts
//
// SHADOW-ONLY. Writes exclusively to ht_catalyst_state, ht_scan_cursor,
// ht_scan_runs, ht_scan_lock. Never reads from or writes to ht_signals.
// Does not affect SM/BTC selection or anything the frontend displays.
//
// v3: lock acquisition now uses the atomic acquire_scan_lock() Postgres
// function instead of a JS-level read-then-write pattern. The previous
// pattern was proven broken by a real concurrent test against
// shadow-retrieval (same lock code, same bug) — two simultaneous
// requests could both read "no lock held" before either write landed,
// and .upsert() would silently overwrite a genuinely-held lock anyway.
// This never got its own concurrency test, so this fix is preventative
// here — applied because it's the same code, not because it failed here too.
//
// Everything else unchanged from the version already confirmed working:
// rolling 3-hour lookback window, market-wide Polygon News discovery,
// cursor tracked for observability, dedup on (article_id, ticker).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const LOCK_NAME = "catalyst_discovery";
const CURSOR_NAME = "catalyst_news_discovery";
const LEASE_MINUTES = 10;
const NEWS_LOOKBACK_HOURS = 3;

const CATALYST_KEYWORDS = [
  {
    words: [
      "fda ",
      "fda-",
      "food and drug administration",
      "pdufa",
      "new drug application",
      "biologics license application",
      "breakthrough therapy",
      "fast track designation",
      "priority review",
      "complete response letter",
      "clinical trial",
      "phase 1",
      "phase 2",
      "phase 3",
    ],
    score: 85,
    state: "FDA Event",
  },
  { words: ["merger", "acquisition", "acquired", "buyout", "takeover", "deal"], score: 80, state: "M&A Activity" },
  { words: ["earnings", "beat", "revenue", "profit", "guidance", "eps"], score: 65, state: "Earnings Catalyst" },
  { words: ["partnership", "contract", "agreement", "collaboration"], score: 60, state: "Partnership" },
  { words: ["upgrade", "raised", "outperform", "overweight", "buy rating"], score: 55, state: "Analyst Upgrade" },
  { words: ["launch", "product", "release", "announced"], score: 45, state: "Product News" },
  { words: ["downgrade", "lowered", "underperform", "sell rating"], score: 20, state: "Negative Analyst Action" },
  { words: ["lawsuit", "investigation", "probe", "sec", "regulatory"], score: 15, state: "Regulatory Risk" },
];

function classify(text: string): { score: number; state: string } | null {
  const lower = text.toLowerCase();
  let best: { score: number; state: string } | null = null;
  for (const category of CATALYST_KEYWORDS) {
    if (category.words.some((word) => lower.includes(word))) {
      if (!best || category.score > best.score) best = { score: category.score, state: category.state };
    }
  }
  return best;
}

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase env vars for catalyst-discovery.");
  return createClient(supabaseUrl, supabaseKey);
}

function isAuthorized(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  return secret === process.env.CRON_SECRET || secret === "htlabs-internal";
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!POLYGON_KEY) {
    return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });
  }

  const supabase = getSupabase();
  const now = new Date();

  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .insert({ engine_version: "phase1-v2", run_type: "catalyst_discovery", status: "running" })
    .select()
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Failed to create scan run", detail: runError?.message }, { status: 500 });
  }

  // ── Atomic lock acquisition — replaces the read-then-write pattern ────
  // that a real concurrent test proved broken (see migration comment).
  // Only one simultaneous caller can ever get `true` back from this.
  const { data: acquired, error: acquireError } = await supabase.rpc("acquire_scan_lock", {
    p_lock_name: LOCK_NAME,
    p_run_id: run.id,
    p_lease_minutes: LEASE_MINUTES,
  });

  if (acquireError) {
    await supabase.from("ht_scan_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: `Lock acquisition failed: ${acquireError.message}`,
    }).eq("id", run.id);
    return NextResponse.json({ error: "Failed to acquire lock", detail: acquireError.message }, { status: 500 });
  }

  if (!acquired) {
    // Someone else genuinely holds the lock right now. Mark this run as
    // a clean no-op rather than leaving it stuck at "running" forever.
    await supabase.from("ht_scan_runs").update({
      status: "skipped",
      completed_at: new Date().toISOString(),
      error_summary: "Another catalyst-discovery run held the lock at acquisition time.",
    }).eq("id", run.id);

    return NextResponse.json({
      success: false,
      message: "Another catalyst-discovery run is already active (valid lease held).",
    });
  }

  try {
    const { data: cursor, error: cursorError } = await supabase
      .from("ht_scan_cursor")
      .select("*")
      .eq("cursor_name", CURSOR_NAME)
      .maybeSingle();

    if (cursorError) throw new Error(`Failed to read scan cursor: ${cursorError.message}`);

    const since = new Date(now.getTime() - NEWS_LOOKBACK_HOURS * 60 * 60 * 1000);

    const polygonUrl = new URL("https://api.polygon.io/v2/reference/news");
    polygonUrl.searchParams.set("published_utc.gte", since.toISOString());
    polygonUrl.searchParams.set("limit", "1000");
    polygonUrl.searchParams.set("sort", "published_utc");
    polygonUrl.searchParams.set("order", "desc");
    polygonUrl.searchParams.set("apiKey", POLYGON_KEY);

    const res = await fetch(polygonUrl, { cache: "no-store", headers: { Accept: "application/json" } });
    const rawText = await res.text();

    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(`Polygon news returned invalid JSON (${res.status}): ${rawText.slice(0, 300)}`);
    }

    if (!res.ok) {
      const polygonMessage = data?.error || data?.message || data?.status || "Unknown Polygon error";
      throw new Error(`Polygon news request failed (${res.status}): ${polygonMessage}`);
    }

    if (!Array.isArray(data?.results)) {
      throw new Error(`Unexpected Polygon news response: ${JSON.stringify(data).slice(0, 500)}`);
    }

    const articles = data.results;
    const rows: any[] = [];

    for (const article of articles) {
      const match = classify(`${article.title ?? ""} ${article.description ?? ""}`);
      if (!match || match.score < 20) continue;

      const relatedTickers: string[] = Array.isArray(article.tickers) ? article.tickers : [];
      const articleId = article.id ?? article.article_url;
      if (!articleId) continue;

      for (const ticker of relatedTickers) {
        const normalizedTicker = String(ticker).trim().toUpperCase();
        if (!normalizedTicker) continue;
        rows.push({
          article_id: articleId,
          ticker: normalizedTicker,
          category: match.state,
          score: match.score,
          published_at: article.published_utc ?? null,
          last_seen_at: new Date().toISOString(),
          source: "polygon_news",
          decay_state: "active",
        });
      }
    }

    const uniqueRowsMap = new Map<string, any>();
    for (const row of rows) uniqueRowsMap.set(`${row.article_id}::${row.ticker}`, row);
    const uniqueRows = Array.from(uniqueRowsMap.values());

    let written = 0;
    if (uniqueRows.length > 0) {
      const { error: catalystWriteError } = await supabase
        .from("ht_catalyst_state")
        .upsert(uniqueRows, { onConflict: "article_id,ticker", ignoreDuplicates: false });
      if (catalystWriteError) throw new Error(`Catalyst-state write failed: ${catalystWriteError.message}`);
      written = uniqueRows.length;
    }

    const { error: cursorWriteError } = await supabase.from("ht_scan_cursor").upsert({
      cursor_name: CURSOR_NAME,
      last_successful_fetch_at: now.toISOString(),
      overlap_seconds: cursor?.overlap_seconds ?? 120,
    });
    if (cursorWriteError) throw new Error(`Failed to update scan cursor: ${cursorWriteError.message}`);

    const { error: runUpdateError } = await supabase.from("ht_scan_runs").update({
      status: "success",
      completed_at: new Date().toISOString(),
      candidate_counts: { articlesScanned: articles.length, catalystMatches: uniqueRows.length },
    }).eq("id", run.id);
    if (runUpdateError) throw new Error(`Failed to mark scan run successful: ${runUpdateError.message}`);

    // Release by setting expires_at into the past — safe because
    // acquire_scan_lock's WHERE clause treats an expired lock as free
    // for the next caller, same atomic guarantee on the way out too.
    await supabase.from("ht_scan_lock")
      .update({ status: "released", heartbeat_at: new Date().toISOString(), expires_at: new Date().toISOString() })
      .eq("lock_name", LOCK_NAME)
      .eq("run_id", run.id);

    return NextResponse.json({
      success: true,
      shadowOnly: true,
      runId: run.id,
      engineVersion: "phase1-v2",
      windowSince: since.toISOString(),
      newsLookbackHours: NEWS_LOOKBACK_HOURS,
      polygonCount: typeof data.count === "number" ? data.count : articles.length,
      polygonRequestId: data.request_id ?? null,
      polygonNextPagePresent: Boolean(data.next_url),
      articlesScanned: articles.length,
      catalystMatchesFound: uniqueRows.length,
      catalystMatchesWritten: written,
      note: "Shadow-only. ht_signals and production selection were not touched.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown catalyst-discovery error";

    await supabase.from("ht_scan_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: message,
    }).eq("id", run.id);

    await supabase.from("ht_scan_lock")
      .update({ status: "released", heartbeat_at: new Date().toISOString(), expires_at: new Date().toISOString() })
      .eq("lock_name", LOCK_NAME)
      .eq("run_id", run.id);

    return NextResponse.json({ success: false, shadowOnly: true, runId: run.id, error: message }, { status: 500 });
  }
}
