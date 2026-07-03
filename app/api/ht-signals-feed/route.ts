// app/api/ht-signals-feed/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from("ht_signals")
      .select(
        "ticker, price, change_percent, relative_volume, ht_score, catalyst_score, momentum_score, crowd_score, trap_score, pattern, state, scanned_at"
      )
      .order("scanned_at", { ascending: false })
      .limit(300);

    if (error) {
      console.error("[ht-signals-feed] Supabase error:", error.message);
      return NextResponse.json({ signals: [] });
    }

    const seen = new Set<string>();
    const signals = (data ?? []).filter((row) => {
      if (seen.has(row.ticker)) return false;
      seen.add(row.ticker);
      return true;
    });

    return NextResponse.json({
      signals,
      count: signals.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[ht-signals-feed] Error:", err);
    return NextResponse.json({ signals: [] });
  }
}
