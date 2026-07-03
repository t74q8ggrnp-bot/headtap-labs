// ─────────────────────────────────────────────────────────────
//  app/api/bull-bear/route.ts
//  Generates Bull Case / Bear Case for a ticker using:
//  - Polygon News API (real articles, no Yahoo)
//  - ht_signals (catalyst context)
//  - OpenAI GPT-4o-mini (synthesis)
//
//  Only called when top conviction ticker changes.
//  Response cached for 30 min in Vercel edge cache.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const revalidate = 1800; // 30 min cache

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  try {
    // ── 1. Fetch Polygon news for ticker ─────────────────────
    const newsUrl = `https://api.polygon.io/v2/reference/news?ticker=${ticker}&limit=8&order=desc&apiKey=${POLYGON_KEY}`;
    const newsRes = await fetch(newsUrl, { cache: "no-store" });
    let articles: { title: string; description?: string; published_utc: string; author?: string }[] = [];

    if (newsRes.ok) {
      const newsData = await newsRes.json();
      articles = (newsData.results ?? []).slice(0, 8);
    }

    // ── 2. Fetch signal context from ht_signals ───────────────
    const { data: signalRow } = await getSupabase()
      .from("ht_signals")
      .select("catalyst_score, state, pattern, crowd_score, ht_score, change_percent, relative_volume")
      .eq("ticker", ticker)
      .single();

    // ── 3. Build OpenAI prompt ────────────────────────────────
    const newsContext = articles.length > 0
      ? articles.map((a, i) => `${i + 1}. "${a.title}"${a.description ? ` — ${a.description.slice(0, 120)}` : ""}`).join("\n")
      : "No recent news available — use general market knowledge about this ticker.";

    const signalContext = signalRow
      ? `Signal data: HT Score ${signalRow.ht_score}, Catalyst Score ${signalRow.catalyst_score}, State: ${signalRow.state}, Change: ${signalRow.change_percent?.toFixed(1)}%, Relative Volume: ${signalRow.relative_volume?.toFixed(1)}x, Crowd Score: ${signalRow.crowd_score}`
      : "";

    const prompt = `You are HT Labs' market intelligence engine. A stock called ${ticker} is currently the top "Before The Crowd" signal.

RECENT NEWS:
${newsContext}

${signalContext}

Your job is to give traders an objective, two-sided view of this ticker. Be concise, specific, and factual. Do NOT tell users to buy or sell.

Respond ONLY with valid JSON in this exact format:
{
  "onRadar": "One sentence explaining exactly why ${ticker} is on HT Labs radar right now. Be specific about the catalyst or movement.",
  "bullCase": [
    "Bull point 1 — specific and factual",
    "Bull point 2 — specific and factual",
    "Bull point 3 — specific and factual"
  ],
  "bearCase": [
    "Bear point 1 — specific and factual",
    "Bear point 2 — specific and factual",
    "Bear point 3 — specific and factual"
  ],
  "crowdFocus": "One sentence summarizing the main topic traders are debating right now for ${ticker}.",
  "htRead": "One objective sentence summarizing what the market is currently pricing in vs the actual risk. Do not recommend buying or selling."
}`;

    // ── 4. Call OpenAI ────────────────────────────────────────
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 600,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      throw new Error(`OpenAI failed: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content ?? "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json({
      ticker,
      ...parsed,
      newsCount: articles.length,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error(`[Bull-Bear] Error for ${ticker}:`, err);

    return NextResponse.json({
      ticker,
      onRadar: `${ticker} is showing unusual activity — HT Labs detected momentum before the crowd.`,
      bullCase: ["Momentum building with above-average volume", "Crowd saturation still low — early window open", "HT signal score elevated"],
      bearCase: ["Move may be extended — risk of reversal", "Limited news catalyst confirmed", "Monitor closely before adding exposure"],
      crowdFocus: "Traders are watching for volume confirmation and catalyst follow-through.",
      htRead: "HT Labs is tracking this setup for early positioning — no directional recommendation.",
      newsCount: 0,
      timestamp: new Date().toISOString(),
    });
  }
}
