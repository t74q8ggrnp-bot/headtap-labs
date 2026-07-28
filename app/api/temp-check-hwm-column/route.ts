// TEMPORARY — confirms bot_trades.high_water_mark exists before enabling the bot. Delete after use.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!,
  );
  const { data, error } = await supabase.from("bot_trades").select("id, high_water_mark").limit(1);
  return NextResponse.json({ columnExists: !error, error: error?.message ?? null, sample: data });
}
