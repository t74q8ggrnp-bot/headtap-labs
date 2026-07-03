// app/api/signals-history/route.ts
// Returns recent HT Labs top picks from ht_scan_log.
// Build-safe: Supabase client is created inside GET(), not at module load.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase env vars. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const polygonKey = process.env.POLYGON_API_KEY;

    const { data: rows, error } = await supabase
      .from("ht_scan_log")
      .select(
        "id, ticker, scanned_at, price, ht_score, ht_confidence, state, " +
          "signal_state, pattern, change_percent, relative_volume, catalyst_score, " +
          "crowd_score, engine, dual_engine, reasoning, upside_min, upside_max, " +
          "risk_zone, rr_ratio, decision"
      )
      .in("engine", ["spot_momentum", "before_the_crowd"])
      .order("scanned_at", { ascending: false })
      .limit(60);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ signals: [] });
    }

    const seen = new Set<string>();

    const deduped = rows.filter((row: any) => {
      const day = row.scanned_at?.split("T")[0] ?? "";
      const key = `${row.ticker}:${row.engine}:${day}`;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });

    const tickers = [...new Set(deduped.map((row: any) => row.ticker).filter(Boolean))];

    let currentPrices: Record<string, number> = {};

    if (polygonKey && tickers.length > 0) {
      try {
        const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(
          ","
        )}&apiKey=${polygonKey}`;

        const res = await fetch(url, { next: { revalidate: 60 } });

        if (res.ok) {
          const data = await res.json();

          for (const tickerData of data.tickers ?? []) {
            const price =
              tickerData.lastTrade?.p ||
              tickerData.day?.c ||
              tickerData.prevDay?.c ||
              0;

            if (price > 0 && tickerData.ticker) {
              currentPrices[tickerData.ticker] = Number(price);
            }
          }
        }
      } catch {
        // Current prices are optional. Signals still load without live % move.
      }
    }

    const signals = deduped.slice(0, 30).map((row: any) => {
      const entryPrice = Number(row.price || 0);
      const currentPrice = currentPrices[row.ticker] ?? 0;

      const pctMove =
        entryPrice > 0 && currentPrice > 0
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : null;

      return {
        id: row.id,
        ticker: row.ticker,
        engine: row.engine,
        scanned_at: row.scanned_at,
        entry_price: entryPrice,
        current_price: currentPrice > 0 ? currentPrice : null,
        pct_move: pctMove !== null ? Number(pctMove.toFixed(2)) : null,
        ht_score: row.ht_score,
        ht_confidence: row.ht_confidence,
        state: row.state,
        signal_state: row.signal_state,
        pattern: row.pattern,
        change_percent: row.change_percent,
        relative_volume: row.relative_volume,
        catalyst_score: row.catalyst_score,
        crowd_score: row.crowd_score,
        dual_engine: row.dual_engine ?? false,
        reasoning: row.reasoning,
        upside_min: row.upside_min,
        upside_max: row.upside_max,
        risk_zone: row.risk_zone,
        rr_ratio: row.rr_ratio,
        decision: row.decision,
      };
    });

    return NextResponse.json({ signals });
  } catch (err: any) {
    console.error("[signals-history]", err?.message || err);

    return NextResponse.json(
      {
        error: err?.message || "Failed to load signals history",
        signals: [],
      },
      { status: 500 }
    );
  }
}
