// app/api/signal-memory-writer/route.ts
//
// Per-user "save this conviction to memory" writer. Previously this route
// wrote a different, never-called shape (system-level catalyst batches) while
// app/page.tsx wrote directly to ht_signal_memory via the Supabase client —
// two implementations of the same table, only one of them actually live.
// This route now owns the real, live shape; page.tsx only builds the payload
// (still using its local scoring engine) and posts it here instead of
// touching the database directly.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type SignalMemoryPayload = {
  user_id: string;
  symbol: string;
  picked_at: string;
  entry_price: number;
  change_percent: number;
  ht_score: number;
  final_score: number;
  discovery_score: number;
  acceleration_score: number;
  fingerprint_score: number;
  crowd_saturation_score: number;
  opportunity_window: string;
  opportunity_window_open: boolean;
  pattern: string;
  contender_status: string;
  quality_gate: string;
  trap_risk: number;
  entry_quality: number;
  participation: number;
  continuation: number;
  consumer_label: string;
  discovery_read: string;
  internal_reason: string;
  status: string;
};

const DEDUP_WINDOW_MS = 1000 * 60 * 60 * 4;

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as Partial<SignalMemoryPayload>;
    if (!payload.user_id || !payload.symbol) {
      return NextResponse.json({ error: "Missing user_id or symbol" }, { status: 400 });
    }

    const supabase = getSupabase();
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

    const { data: recentExisting, error: lookupError } = await supabase
      .from("ht_signal_memory")
      .select("id")
      .eq("user_id", payload.user_id)
      .eq("symbol", payload.symbol)
      .gte("picked_at", since)
      .limit(1);

    if (lookupError) {
      console.error("[signal-memory-writer] lookup error:", lookupError.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    if (recentExisting && recentExisting.length > 0) {
      return NextResponse.json({ written: false, skipped: true, reason: "Recent entry already exists" });
    }

    const { error: insertError } = await supabase.from("ht_signal_memory").insert(payload);
    if (insertError) {
      console.error("[signal-memory-writer] insert error:", insertError.message);
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    return NextResponse.json({ written: true, skipped: false });
  } catch (err) {
    console.error("[signal-memory-writer] route error:", err);
    return NextResponse.json({ error: "Signal memory writer failed" }, { status: 500 });
  }
}
