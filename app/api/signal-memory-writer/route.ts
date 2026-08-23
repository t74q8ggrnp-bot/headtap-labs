// app/api/signal-memory-writer/route.ts
//
// Per-user "save this conviction to memory" writer. Previously this route
// wrote a different, never-called shape (system-level catalyst batches) while
// app/page.tsx wrote directly to ht_signal_memory via the Supabase client —
// two implementations of the same table, only one of them actually live.
// The automatic client writer is now disabled; this retained API is secured
// and user-scoped for any explicit save flow that is added later.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/error-message";

function getServerCredentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing Supabase credentials for signal memory.");
  }
  return { url, anonKey, serviceKey };
}

async function authenticate(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const { url, anonKey } = getServerCredentials();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  return error ? null : data.user;
}

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
    const user = await authenticate(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const payload = (await req.json()) as Partial<SignalMemoryPayload>;
    const symbol = String(payload.symbol ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
    }

    const { url, serviceKey } = getServerCredentials();
    const supabase = createClient(url, serviceKey);
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

    const { data: recentExisting, error: lookupError } = await supabase
      .from("ht_signal_memory")
      .select("id")
      .eq("user_id", user.id)
      .eq("symbol", symbol)
      .gte("picked_at", since)
      .limit(1);

    if (lookupError) {
      console.error("[signal-memory-writer] lookup error:", lookupError.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    if (recentExisting && recentExisting.length > 0) {
      return NextResponse.json({ written: false, skipped: true, reason: "Recent entry already exists" });
    }

    const memoryRow: SignalMemoryPayload = {
      user_id: user.id,
      symbol,
      picked_at: payload.picked_at ?? new Date().toISOString(),
      entry_price: Number(payload.entry_price ?? 0),
      change_percent: Number(payload.change_percent ?? 0),
      ht_score: Number(payload.ht_score ?? 0),
      final_score: Number(payload.final_score ?? 0),
      discovery_score: Number(payload.discovery_score ?? 0),
      acceleration_score: Number(payload.acceleration_score ?? 0),
      fingerprint_score: Number(payload.fingerprint_score ?? 0),
      crowd_saturation_score: Number(payload.crowd_saturation_score ?? 0),
      opportunity_window: String(payload.opportunity_window ?? ""),
      opportunity_window_open: payload.opportunity_window_open === true,
      pattern: String(payload.pattern ?? ""),
      contender_status: String(payload.contender_status ?? ""),
      quality_gate: String(payload.quality_gate ?? ""),
      trap_risk: Number(payload.trap_risk ?? 0),
      entry_quality: Number(payload.entry_quality ?? 0),
      participation: Number(payload.participation ?? 0),
      continuation: Number(payload.continuation ?? 0),
      consumer_label: String(payload.consumer_label ?? ""),
      discovery_read: String(payload.discovery_read ?? ""),
      internal_reason: String(payload.internal_reason ?? ""),
      status: String(payload.status ?? "saved"),
    };
    const numericValues = [
      memoryRow.entry_price,
      memoryRow.change_percent,
      memoryRow.ht_score,
      memoryRow.final_score,
      memoryRow.discovery_score,
      memoryRow.acceleration_score,
      memoryRow.fingerprint_score,
      memoryRow.crowd_saturation_score,
      memoryRow.trap_risk,
      memoryRow.entry_quality,
      memoryRow.participation,
      memoryRow.continuation,
    ];
    if (
      numericValues.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(new Date(memoryRow.picked_at).getTime())
    ) {
      return NextResponse.json({ error: "Invalid signal memory payload" }, { status: 400 });
    }

    const { error: insertError } = await supabase
      .from("ht_signal_memory")
      .insert(memoryRow);
    if (insertError) {
      console.error("[signal-memory-writer] insert error:", insertError.message);
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    return NextResponse.json({ written: true, skipped: false });
  } catch (err) {
    console.error("[signal-memory-writer] route error:", err);
    return NextResponse.json(
      { error: getErrorMessage(err, "Signal memory writer failed") },
      { status: 500 },
    );
  }
}
