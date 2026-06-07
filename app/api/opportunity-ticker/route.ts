import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreOpportunity } from "../opportunities/route";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/opportunity-ticker?ticker=GME
// GET /api/opportunity-ticker?ticker=GME&mode=explain
// GET /api/opportunity-ticker?ticker=GME&mode=history
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase().trim();
  const mode = searchParams.get("mode") ?? "full";

  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker param" }, { status: 400 });
  }

  try {
    const { data: scanRows } = await supabase
      .from("ht_scan_log")
      .select("*")
      .eq("ticker", ticker)
      .order("scanned_at", { ascending: false })
      .limit(1);

    const latest = scanRows?.[0];

    if (!latest) {
      return NextResponse.json({
        ticker,
        message: "No data available for this ticker yet.",
        opportunityScore: 0,
      });
    }

    const raw = {
      ticker,
      price: latest.price ?? 0,
      change: 0,
      relativeVolume: (latest.volume_score ?? 10) / 10,
      attentionScore: latest.crowd_score ?? 50,
      trapRisk: latest.trap_score ?? 50,
      htScore: latest.ht_confidence ?? 50,
      pattern: latest.state ?? "Standard",
      crowdSaturation: latest.crowd_score ?? 50,
    };

    const opportunity = scoreOpportunity(raw);

    if (mode === "explain") {
      return NextResponse.json({
        ticker,
        explanation: {
          summary: opportunity.whyItMatters,
          whatChanged: opportunity.whatChanged,
          riskNote: opportunity.riskNote,
          stage: `${opportunity.stageEmoji} ${opportunity.stage}`,
          confidence: `${opportunity.confidence}% confidence`,
          signals: opportunity.signals,
          verdict: opportunity.opportunityType === "recovery"
            ? "HT is watching for a recovery setup in this ticker."
            : opportunity.opportunityType === "momentum"
            ? "HT sees active momentum with favorable conditions."
            : "HT is monitoring this ticker for a developing setup.",
        },
      });
    }

    if (mode === "history") {
      const { data: history } = await supabase
        .from("ht_market_behavior")
        .select("signaled_at, ht_score, signal_state, pattern, price_at_signal, gain_1d, gain_3d, gain_5d, outcome")
        .eq("ticker", ticker)
        .order("signaled_at", { ascending: false })
        .limit(10);

      return NextResponse.json({
        ticker,
        history: history ?? [],
        totalSignals: history?.length ?? 0,
        winRate: history?.length
          ? Math.round((history.filter(h => h.outcome === "winner").length / history.length) * 100)
          : null,
      });
    }

    return NextResponse.json({
      ticker,
      opportunity,
      scannedAt: latest.scanned_at,
      lastDecision: latest.decision,
    });

  } catch (error) {
    console.error(`Opportunity ticker error for ${ticker}:`, error);
    return NextResponse.json({ error: "Failed to fetch opportunity" }, { status: 500 });
  }
}
