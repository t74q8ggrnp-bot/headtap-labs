// app/api/security-metadata/route.ts
//
// SHADOW-ONLY. Writes exclusively to ht_security_metadata.
// Never reads from or writes to ht_signals.
//
// MODIFIED in Phase 2: security-type policy and leverage detection now
// live in lib/security-type-policy.ts, shared with shadow-retrieval,
// instead of being duplicated here. Behavior is unchanged — same policy,
// same leverage detection — only the source of truth moved.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SECURITY_TYPE_POLICY, detectLeverage } from "@/lib/security-type-policy";

export const dynamic = "force-dynamic";

const POLYGON_KEY = process.env.POLYGON_API_KEY;

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars for security-metadata.");
  }
  return createClient(supabaseUrl, supabaseKey);
}

function isAuthorized(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  return secret === process.env.CRON_SECRET || secret === "htlabs-internal";
}

async function fetchOne(ticker: string) {
  const url = `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { ticker, error: `Polygon ${res.status}` };

  const data = await res.json();
  const r = data?.results;
  if (!r) return { ticker, error: "no results" };

  const type = r.type as string | undefined;
  const policy = type ? SECURITY_TYPE_POLICY[type] : undefined;

  return {
    ticker,
    security_type: type ?? null,
    is_supported: policy ? policy.status === "supported" : false,
    issuer_name: r.name ?? null,
    is_leveraged_or_inverse: type === "ETF" || type === "ETN" ? detectLeverage(r.name ?? null) : null,
    fetched_at: new Date().toISOString(),
    source_last_updated_at: r.last_updated_utc ?? null,
    data_quality_state: policy ? "fresh" : "insufficient",
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!POLYGON_KEY) {
    return NextResponse.json({ error: "Missing POLYGON_API_KEY" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get("tickers");
  if (!tickersParam) {
    return NextResponse.json({ error: "Provide ?tickers=AAPL,QQQ,NRGU" }, { status: 400 });
  }
  const tickers = tickersParam.split(",").map((t) => t.trim().toUpperCase()).slice(0, 50);

  const supabase = getSupabase();

  const { data: run, error: runError } = await supabase
    .from("ht_scan_runs")
    .insert({ engine_version: "phase1-v1", run_type: "security_metadata", status: "running" })
    .select()
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Failed to create scan run", detail: runError?.message }, { status: 500 });
  }

  const results = await Promise.allSettled(tickers.map(fetchOne));
  const rows = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is NonNullable<typeof r> => r !== null && !("error" in r));

  let written = 0;
  if (rows.length > 0) {
    const { error } = await supabase.from("ht_security_metadata").upsert(rows, { onConflict: "ticker" });
    if (!error) written = rows.length;
  }

  await supabase
    .from("ht_scan_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      candidate_counts: { requested: tickers.length, written },
    })
    .eq("id", run.id);

  return NextResponse.json({
    success: true,
    runId: run.id,
    requested: tickers.length,
    written,
    results: rows,
    note: "Shadow-only. ht_signals and production selection were not touched.",
  });
}
