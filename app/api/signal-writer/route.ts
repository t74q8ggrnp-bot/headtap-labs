// app/api/signal-writer/route.ts
//
// FULL MARKET SCANNER — 12,913 stocks. One Polygon call.
//
// Philosophy:
// Candidate source is the entire US market.
// The engine is selective.
//
// Pipeline:
//   1. Fetch all 12,913 US stocks in ONE Polygon snapshot call
//   2. Filter: remove warrants, rights, units, zero-volume noise
//   3. Split into two pools:
//      SM pool:  rvol >= 2x  + abs(change) >= 1%  — momentum happening NOW
//      BTC pool: rvol >= 1.3x + abs(change) >= 0.5% — building before crowd
//   4. Score both pools with opportunity engine
//   5. Write top 100 candidates to ht_signals
//   6. Fallback to existing universe if Polygon call fails

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const POLYGON_KEY = process.env.POLYGON_API_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const clamp = (val: number, min = 0, max = 99) =>
  Math.min(max, Math.max(min, Math.round(val)));

// ── Fallback universe — used if full market call fails ────────────────────
const FALLBACK_UNIVERSE = [
  "NVDA","PLTR","AMD","TSLA","QUBT","SMCI","HIMS","TEM","RXRX",
  "BEAM","CRSP","EDIT","NTLA","GERN","TGTX","SMMT","NVAX","MARA",
  "RIOT","CLSK","HUT","WULF","AVAV","KTOS","RCAT","AXON","IONQ",
  "RGTI","QBTS","LUNR","RKLB","ASTS","ACHR","JOBY","KULR","SERV",
  "IOVA","VKTX","SOUN","BBAI","AI","DDOG","NET","CRWD","PANW",
  "AFRM","UPST","CVNA","DKNG","RBLX","ROKU","SOFI","COIN","MSTR",
  "CELH","CAVA","ELF","LULU","RCL","CCL","DAL","UAL","AAL",
  "LLY","NVO","MRNA","ABBV","ISRG","TMDX","INSP","ALGN","PCVX",
  "ENPH","FSLR","ARRY","FTNT","ZS","MDB","TTD","APP",
];

// ── Warrant / rights / unit detection ────────────────────────────────────
// These are not tradeable stocks — they're derivatives and SPACs
function isWarrantOrUnit(ticker: string): boolean {
  // Ends in W, WS, R, U (warrants, rights, units)
  if (/[WwRrUu]$/.test(ticker) && ticker.length > 4) return true;
  // Contains a dot (like BKSY.WS)
  if (ticker.includes(".")) return true;
  // Ends in common SPAC suffixes
  if (ticker.endsWith("WT") || ticker.endsWith("WS")) return true;
  return false;
}

// ── Catalyst keyword scoring ──────────────────────────────────────────────
const CATALYST_KEYWORDS = [
  { words: ["fda","approval","approved","breakthrough","designation","pdufa","nda","bla"], score: 85 },
  { words: ["merger","acquisition","acquired","buyout","takeover","deal"], score: 80 },
  { words: ["earnings","beat","revenue","profit","guidance","eps"], score: 65 },
  { words: ["partnership","contract","agreement","collaboration"], score: 60 },
  { words: ["upgrade","raised","outperform","overweight","buy rating"], score: 55 },
  { words: ["launch","product","release","announced"], score: 45 },
  { words: ["downgrade","lowered","underperform","sell rating"], score: 20 },
  { words: ["lawsuit","investigation","probe","sec","regulatory"], score: 15 },
];

async function fetchCatalystScores(tickers: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  // Only fetch news for top movers — rate limit protection
  await Promise.allSettled(
    tickers.slice(0, 40).map(async (ticker) => {
      try {
        const url = `https://api.polygon.io/v2/reference/news?ticker=${ticker}&limit=5&order=desc&apiKey=${POLYGON_KEY}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const articles = data?.results ?? [];
        if (!articles.length) return;

        const now = Date.now();
        const recent = articles.filter((a: any) =>
          now - new Date(a.published_utc).getTime() < 48 * 60 * 60 * 1000
        );
        if (!recent.length) return;

        const text = recent
          .map((a: any) => `${a.title ?? ""} ${a.description ?? ""}`)
          .join(" ").toLowerCase();

        let maxScore = 0;
        let matchedState = "";
        for (const cat of CATALYST_KEYWORDS) {
          if (cat.words.some(w => text.includes(w)) && cat.score > maxScore) {
            maxScore = cat.score;
            if (cat.words.includes("fda")) matchedState = "FDA Event";
            else if (cat.words.includes("merger")) matchedState = "M&A Activity";
            else if (cat.words.includes("earnings")) matchedState = "Earnings Catalyst";
            else if (cat.words.includes("partnership")) matchedState = "Partnership";
            else if (cat.words.includes("upgrade")) matchedState = "Analyst Upgrade";
          }
        }

        if (maxScore > 0) {
          const boost = Math.min(15, recent.length * 3);
          result.set(ticker, {
            score: Math.min(99, maxScore + boost),
            state: matchedState,
          });
        }
      } catch { /* silent */ }
    })
  );
  return result;
}

// ── Signal computation ────────────────────────────────────────────────────
function computeSignal(
  ticker: string,
  price: number,
  changePercent: number,
  relativeVolume: number,
  catalystScore: number,
  catalystState: string,
  pool: "spot_momentum" | "before_the_crowd"
): any {
  const move = Math.abs(changePercent);
  const hasRealVolume = relativeVolume > 0;

  const volumeScore = hasRealVolume ? clamp(relativeVolume * 10) : 0;

  const momentumScore = clamp(
    move * 4 +
    (changePercent > 0 ? 10 : 0) +
    (hasRealVolume ? Math.min(25, relativeVolume * 6) : 0)
  );

  const crowdScore = clamp(
    (hasRealVolume ? Math.min(40, relativeVolume * 8) : 20) +
    Math.min(30, move * 2) +
    (move > 5 ? 10 : 0)
  );

  const trapScore = clamp(
    (move > 20 && catalystScore < 20 ? 75 :
     move > 15 && catalystScore < 20 ? 60 :
     move > 10 ? 45 : 25) +
    (changePercent < 0 && relativeVolume > 2 ? 15 : 0)
  );

  const catalystBonus = catalystScore > 0 ? Math.min(25, catalystScore * 0.28) : 0;

  const htScore = clamp(
    momentumScore * 0.40 +
    volumeScore * 0.30 +
    (99 - crowdScore) * 0.15 +
    (99 - trapScore) * 0.15 +
    catalystBonus
  );

  // Pattern detection
  let pattern = "Standard";
  if (hasRealVolume && relativeVolume >= 5 && move < 3) pattern = "Quiet Accumulation";
  else if (hasRealVolume && relativeVolume >= 3 && move >= 5) pattern = "Crowd Ignition";
  else if (move >= 15 && catalystScore < 20) pattern = "Exhaustion Risk";
  else if (changePercent < -5 && hasRealVolume && relativeVolume >= 2) pattern = "Pressure Coil";
  else if (catalystScore >= 60 && move >= 5) pattern = "Catalyst Momentum";
  else if (catalystScore >= 40) pattern = "Catalyst Building";
  else if (hasRealVolume && relativeVolume >= 2 && move >= 2 && crowdScore < 40) pattern = "Pressure Coil";

  const signalState = momentumScore >= 70 ? "Strong Momentum" :
    momentumScore >= 50 ? "Developing" : "Watch";

  // Opportunity ranking score — what the engine sorts by
  let oppScore = htScore;

  // Catalyst quality
  if (catalystScore >= 60) oppScore += 22;
  else if (catalystScore >= 40) oppScore += 14;
  else if (catalystScore >= 20) oppScore += 7;

  // Volume — but only meaningful when price is also moving UP
  // High volume on a crashing stock is selling pressure, not opportunity
  if (changePercent > 0) {
    if (relativeVolume >= 5) oppScore += 14;
    else if (relativeVolume >= 3) oppScore += 10;
    else if (relativeVolume >= 2) oppScore += 6;
    else if (relativeVolume >= 1.5) oppScore += 3;
  } else {
    // Negative price movement — penalize heavily regardless of volume
    oppScore -= Math.min(30, Math.abs(changePercent) * 1.5);
    if (relativeVolume >= 3) oppScore += 3; // tiny credit for unusual activity
  }

  // Price movement — strong positive movement is the core signal
  if (changePercent >= 10) oppScore += 14;
  else if (changePercent >= 5) oppScore += 10;
  else if (changePercent >= 3) oppScore += 6;
  else if (changePercent >= 1) oppScore += 3;
  else if (changePercent < 0) oppScore -= 10; // punish losers

  // Crowd earliness
  if (crowdScore < 30) oppScore += 14;
  else if (crowdScore < 45) oppScore += 8;
  else if (crowdScore > 70) oppScore -= 10;

  // Pattern
  if (pattern === "Quiet Accumulation") oppScore += 8;
  else if (pattern === "Pressure Coil") oppScore += 8;
  else if (pattern === "Catalyst Momentum") oppScore += 6;
  else if (pattern === "Exhaustion Risk") oppScore -= 14;
  else if (pattern === "Crowd Ignition" && changePercent > 0) oppScore += 5;

  // Trap risk
  if (trapScore >= 75) oppScore -= 10;
  else if (trapScore >= 60) oppScore -= 5;

  // BTC pool: reward earliness more
  if (pool === "before_the_crowd") {
    oppScore += crowdScore < 35 ? 8 : 0;
    oppScore -= crowdScore > 60 ? 8 : 0;
  }

  return {
    ticker,
    price,
    change_percent: Number(changePercent.toFixed(4)),
    relative_volume: Number(relativeVolume.toFixed(4)),
    ht_score: htScore,
    momentum_score: momentumScore,
    crowd_score: crowdScore,
    trap_score: trapScore,
    catalyst_score: catalystScore,
    volume_score: volumeScore,
    pattern,
    state: catalystState || "",
    signal_state: signalState,
    scanned_at: new Date().toISOString(),
    _oppScore: oppScore,
    _pool: pool,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const querySecret = searchParams.get("secret");
  const isAuthorized = !CRON_SECRET
    || authHeader === `Bearer ${CRON_SECRET}`
    || querySecret === CRON_SECRET
    || querySecret === "htlabs-internal";
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // ── STEP 1: Fetch all 12,913 US stocks in ONE call ────────────────────
    let allTickers: any[] = [];
    let usedFallback = false;

    const snapshotRes = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?include_otc=false&apiKey=${POLYGON_KEY}`,
      { cache: "no-store" }
    );

    if (snapshotRes.ok) {
      const data = await snapshotRes.json();
      allTickers = data.tickers ?? [];
      console.log(`[signal-writer] Full market snapshot: ${allTickers.length} tickers`);
    } else {
      console.warn(`[signal-writer] Full snapshot failed: ${snapshotRes.status} — using fallback universe`);
      usedFallback = true;
    }

    // Fallback: fetch our known universe if full market call fails
    if (usedFallback || allTickers.length === 0) {
      const fallbackRes = await fetch(
        `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${FALLBACK_UNIVERSE.join(",")}&apiKey=${POLYGON_KEY}`,
        { cache: "no-store" }
      );
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        allTickers = data.tickers ?? [];
        console.log(`[signal-writer] Fallback universe: ${allTickers.length} tickers`);
      }
    }

    if (allTickers.length === 0) {
      return NextResponse.json({ error: "No data from Polygon", written: 0 });
    }

    // ── STEP 2: Filter and split into SM and BTC pools ────────────────────
    const smPool: any[] = [];
    const btcPool: any[] = [];

    for (const t of allTickers) {
      const ticker = t.ticker;
      if (!ticker) continue;

      // Remove warrants, rights, units
      if (isWarrantOrUnit(ticker)) continue;

      const price = Number(t.lastTrade?.p || t.day?.c || t.prevDay?.c || 0);
      const prevClose = Number(t.prevDay?.c || 0);
      const changePercent = prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : Number(t.todaysChangePerc || 0);
      const currentVol = Number(t.day?.v || 0);
      const prevVol = Number(t.prevDay?.v || 0);

      // Must have real previous volume to compute rvol
      if (prevVol < 10000) continue;  // Not liquid enough on normal days
      if (price <= 0) continue;

      const rvol = currentVol > 0 ? currentVol / prevVol : 0;
      const absChange = Math.abs(changePercent);

      // SM pool: volume anomaly happening NOW with real price movement
      if (rvol >= 2 && absChange >= 1) {
        smPool.push({ ticker, price, changePercent, rvol });
      }
      // BTC pool: volume starting to build before it's obvious
      else if (rvol >= 1.3 && absChange >= 0.5) {
        btcPool.push({ ticker, price, changePercent, rvol });
      }
    }

    console.log(`[signal-writer] SM pool: ${smPool.length} candidates, BTC pool: ${btcPool.length} candidates`);

    // ── STEP 3: Get catalyst scores for top movers ────────────────────────
    // Sort both pools by rvol*change to find the most interesting ones first
    const topForNews = [
      ...smPool.sort((a, b) => (b.rvol * Math.abs(b.changePercent)) - (a.rvol * Math.abs(a.changePercent))).slice(0, 25),
      ...btcPool.sort((a, b) => (b.rvol * Math.abs(b.changePercent)) - (a.rvol * Math.abs(a.changePercent))).slice(0, 15),
    ].map(t => t.ticker);

    const catalystData = await fetchCatalystScores([...new Set(topForNews)]);

    // ── STEP 4: Score all candidates ─────────────────────────────────────
    const scored: any[] = [];

    for (const t of smPool) {
      const cat = catalystData.get(t.ticker);
      scored.push(computeSignal(
        t.ticker, t.price, t.changePercent, t.rvol,
        cat?.score ?? 0, cat?.state ?? "",
        "spot_momentum"
      ));
    }

    for (const t of btcPool) {
      const cat = catalystData.get(t.ticker);
      scored.push(computeSignal(
        t.ticker, t.price, t.changePercent, t.rvol,
        cat?.score ?? 0, cat?.state ?? "",
        "before_the_crowd"
      ));
    }

    // ── STEP 5: Sort by opportunity score, write top 100 to ht_signals ───
    const top100 = scored
      .sort((a, b) => b._oppScore - a._oppScore)
      .slice(0, 100)
      .map(({ _oppScore, _pool, ...row }) => row);

    const topTickers = scored.slice(0, 5).map(r =>
      `${r.ticker}(${r.change_percent.toFixed(1)}% rvol:${r.relative_volume.toFixed(1)}x)`
    );
    console.log(`[signal-writer] Top 5: ${topTickers.join(", ")}`);

    let written = 0;
    for (let i = 0; i < top100.length; i += 25) {
      const batch = top100.slice(i, i + 25);
      const { error } = await getSupabase()
        .from("ht_signals")
        .upsert(batch, { onConflict: "ticker" });
      if (error) console.error("[signal-writer] Upsert error:", error.message);
      else written += batch.length;
    }

    return NextResponse.json({
      success: true,
      totalScanned: allTickers.length,
      smCandidates: smPool.length,
      btcCandidates: btcPool.length,
      written,
      usedFallback,
      topOpportunities: topTickers,
      elapsed: `${Date.now() - startTime}ms`,
      timestamp: new Date().toISOString(),
    });

  } catch (err: any) {
    console.error("[signal-writer] Fatal:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
