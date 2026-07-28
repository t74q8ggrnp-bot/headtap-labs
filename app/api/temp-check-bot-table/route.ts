// TEMPORARY — confirms bot_trades exists before enabling the bot. Delete after use.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!,
  );
  const { data, error, count } = await supabase.from("bot_trades").select("id", { count: "exact" }).limit(1);
  return NextResponse.json({ tableExists: !error, error: error?.message ?? null, rowCount: count, sample: data });
}
