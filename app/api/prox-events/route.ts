// app/api/prox-events/route.ts
//
// Read-only view into what Pro X has collected. Discovery-side only —
// does not touch any ht_* table and has no bearing on canonical
// eligibility/scoring. Exists purely so a human can look at what's
// actually landed instead of trusting connector diagnostics blindly.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase service credentials.");
  return createClient(url, key);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50));
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("prox_events")
      .select(
        `id, form_type, headline, raw_document_url, filed_at, catalyst_category,
         verification_state, confidence, material_facts, created_at,
         prox_event_tickers(ticker, match_confidence, match_method)`,
      )
      .order("filed_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;

    const { count: totalCount } = await supabase
      .from("prox_events")
      .select("id", { count: "exact", head: true });

    return NextResponse.json({
      events: data ?? [],
      totalCount: totalCount ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load Pro X events"), events: [] }, { status: 500 });
  }
}
