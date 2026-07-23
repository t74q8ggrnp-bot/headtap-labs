// TEMPORARY — one-off cleanup for two test rows inserted while verifying
// app/api/signal-memory-writer/route.ts on production. Hardcoded to these
// exact identifiers only, no arbitrary deletion capability. Delete this
// route entirely once used.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const TEST_USER_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
const TEST_SYMBOLS = ["TESTX", "TESTY"];

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await getSupabase()
    .from("ht_signal_memory")
    .delete()
    .in("user_id", TEST_USER_IDS)
    .in("symbol", TEST_SYMBOLS)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: data?.length ?? 0, rows: data });
}
