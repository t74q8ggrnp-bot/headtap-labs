// TEMPORARY — pulls today's full INLF signal history to see how it was
// scored/ranked throughout the day, including its peak. Delete after use.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!,
  );
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: rows, error } = await supabase
    .from("ht_signal_run_rows")
    .select("scan_run_id, ticker, price, change_percent, relative_volume, ht_score, momentum_score, crowd_score, trap_score, pattern, signal_state, scanned_at")
    .eq("ticker", "INLF")
    .gte("scanned_at", todayStart.toISOString())
    .order("scanned_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const runIds = [...new Set((rows ?? []).map((r) => r.scan_run_id))];
  const { data: runs } = await supabase
    .from("ht_scan_runs")
    .select("id, promoted, status")
    .in("id", runIds);
  const promotedSet = new Set((runs ?? []).filter((r) => r.promoted).map((r) => r.id));

  const withPromotion = (rows ?? []).map((r) => ({ ...r, promoted: promotedSet.has(r.scan_run_id) }));
  const peak = withPromotion.reduce((max, r) => (r.change_percent > (max?.change_percent ?? -Infinity) ? r : max), null as any);

  return NextResponse.json({ count: withPromotion.length, peak, rows: withPromotion });
}
