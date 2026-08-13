import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PROX_INTELLIGENCE_VERSION,
  loadProxIntelligencePackets,
  persistProxIntelligencePackets,
} from "@/lib/prox/intelligence";
import { PROX_PUBLIC_AUTHORITY_CONTRACT } from "@/lib/prox/public-authority";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const MATERIALIZE_LIMIT = 300;
const MATERIALIZE_LANE_LIMIT = 150;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing server-side Supabase service credentials.");
  }
  return createClient(url, key);
}

function isAuthorized(req: Request) {
  if (!CRON_SECRET) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${CRON_SECRET}`;
}

function validTicker(value: string | null) {
  const ticker = value?.toUpperCase().trim() ?? "";
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
}

async function getRecentProxTickers(
  supabase: ReturnType<typeof getSupabase>,
) {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const directSince = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const [eventResult, directResult] = await Promise.all([
    supabase
      .from("prox_event_tickers")
      .select("ticker,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MATERIALIZE_LANE_LIMIT),
    supabase
      .from("prox_research_queue")
      .select("ticker,last_detected_at,research_priority,status")
      .in("status", ["queued", "observing"])
      .gte("last_detected_at", directSince)
      .order("research_priority", { ascending: false })
      .limit(MATERIALIZE_LANE_LIMIT),
  ]);
  if (eventResult.error) throw eventResult.error;
  // Migration 0013 is additive. Until it is applied, the established SEC
  // intelligence materializer continues operating from event tickers.
  const rows = [
    ...(eventResult.data ?? []),
    ...(directResult.error ? [] : directResult.data ?? []),
  ];
  return [
    ...new Set(
      rows
        .map((row) =>
          typeof row.ticker === "string"
            ? row.ticker.toUpperCase().trim()
            : "",
        )
        .filter(Boolean),
    ),
  ].slice(0, MATERIALIZE_LIMIT);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedTicker = url.searchParams.get("ticker");
  const ticker = validTicker(requestedTicker);
  if (requestedTicker && !ticker) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    if (ticker) {
      const packets = await loadProxIntelligencePackets(supabase, [ticker]);
      return NextResponse.json({
        ticker,
        packet: packets.get(ticker) ?? null,
        packetVersion: PROX_INTELLIGENCE_VERSION,
        authority: PROX_PUBLIC_AUTHORITY_CONTRACT,
        timestamp: new Date().toISOString(),
      });
    }

    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tickers = await getRecentProxTickers(supabase);
    const packetMap = await loadProxIntelligencePackets(supabase, tickers);
    const packets = [...packetMap.values()];
    const persistence = await persistProxIntelligencePackets(
      supabase,
      packets,
    );
    return NextResponse.json({
      success: persistence.unavailableReason === null,
      packetVersion: PROX_INTELLIGENCE_VERSION,
      authority: PROX_PUBLIC_AUTHORITY_CONTRACT,
      diagnostics: {
        tickersConsidered: tickers.length,
        active: packets.filter((packet) => packet.status === "active").length,
        evidenceOnly: packets.filter(
          (packet) => packet.status === "evidence_only",
        ).length,
        stalePulse: packets.filter(
          (packet) => packet.status === "stale_pulse",
        ).length,
        wouldVeto: packets.filter(
          (packet) => packet.botPolicy.wouldVeto,
        ).length,
        wouldReduceSize: packets.filter(
          (packet) => packet.botPolicy.wouldReduceSize,
        ).length,
        persisted: persistence.persisted,
        persistenceUnavailable: persistence.unavailableReason,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Pro X intelligence materialization failed.",
        packetVersion: PROX_INTELLIGENCE_VERSION,
        authority: PROX_PUBLIC_AUTHORITY_CONTRACT,
      },
      { status: 500 },
    );
  }
}
