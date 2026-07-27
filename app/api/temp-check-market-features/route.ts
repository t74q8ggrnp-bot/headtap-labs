// TEMPORARY — sanity-check real prox_market_features rows. Delete after use.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!,
  );
  const { data, error } = await supabase
    .from("prox_market_features")
    .select("*")
    .order("computed_at", { ascending: false })
    .limit(8);
  return NextResponse.json({ data, error: error?.message ?? null });
}
