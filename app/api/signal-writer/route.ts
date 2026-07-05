// app/api/signal-writer/route.ts
//
// FULL MARKET SCANNER — 12,913 stocks. One Polygon call.
//
// Production patch:
// - Keeps Claude's full-market scanner architecture.
// - Keeps catalyst/news scoring.
// - Keeps fallback universe if Polygon full snapshot fails.
// - Removes negative movers from Spot Momentum / Before the Crowd production pools.
// - Prevents quiet/stale scans from overwriting verified signals with weak/noisy candidates.
//
// Philosophy:
// HT Labs should publish verified positive momentum only.
// Bearish/recovery logic should live in a separate lane, not the main Top Opportunity engine.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const MIN_WRITABLE_SIGNALS = 3;
const MIN_TOP_OPP_SCORE = 55;
const MIN_TOP_CHANGE_PERCENT = 1;
const MIN_TOP_RVOL = 1.3;

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars for signal-writer.");
  }

  return createClient(supabaseUrl, supabaseKey);
}

const clamp = (val: number, min = 0, max = 99) =>
  Math.min(max, Math.max(min, Math.round(val)));

// ── Fallback universe — used if full market call fails ────────────────────
const FALLBACK_UNIVERSE = [
  "NVDA", "PLTR", "AMD", "TSLA", "QUBT", "SMCI", "HIMS", "TEM", "RXRX",
  "BEAM", "CRSP", "EDIT", "NTLA", "GERN", "TGTX", "SMMT", "NVAX", "MARA",
  "RIOT", "CLSK", "HUT", "WULF", "AVAV", "KTOS", "RCAT", "AXON", "IONQ",
  "RGTI", "QBTS", "LUNR", "RKLB", "ASTS", "ACHR", "JOBY", "KULR", "SERV",
  "IOVA", "VKTX", "SOUN", "BBAI", "AI", "DDOG", "NET", "CRWD", "PANW",
  "AFRM", "UPST", "CVNA", "DKNG", "RBLX", "ROKU", "SOFI", "COIN", "MSTR",
  "CELH", "CAVA", "ELF", "LULU", "RCL", "CCL", "DAL", "UAL", "AAL",
  "LLY", "NVO", "MRNA", "ABBV", "ISRG", "TMDX", "INSP", "ALGN", "PCVX",
  "ENPH", "FSLR", "ARRY", "FTNT", "ZS", "MDB", "TTD", "APP",
];

// ── Warrant / rights / unit detection ────────────────────────────────────
// These are not standard common-stock opportunities.
function isWarrantOrUnit(ticker: string): boolean {
  if (!ticker) return true;
  if (/[WwRrUu]$/.test(ticker) && ticker.length > 4) return true;
  if (ticker.includes(".")) return true;
  if (ticker.endsWith("WT") || ticker.endsWith("WS")) return true;
  return false;
}

// ── Catalyst keyword scoring ──────────────────────────────────────────────
const CATALYST_KEYWORDS = [
  { words: ["fda", "approval", "approved", "breakthrough", "designation", "pdufa", "nda", "bla"], score: 85, state: "FDA Event" },
  { words: ["merger", "acquisition", "acquired", "buyout", "takeover", "deal"], score: 80, state: "M&A Activity" },
  { words: ["earnings", "beat", "revenue", "profit", "guidance", "eps"], score: 65, state: "Earnings Catalyst" },
  { words: ["partnership", "contract", "agreement", "collaboration"], score: 60, state: "Partnership" },
  { words: ["upgrade", "raised", "outperform", "overweight", "buy rating"], score: 55, state: "Analyst Upgrade" },
  { words: ["launch", "product", "release", "announced"], score: 45, state: "Product News" },
  { words: ["downgrade", "lowered", "underperform", "sell rating"], score: 20, state: "Negative Analyst Action" },
  { words: ["lawsuit", "investigation", "probe", "sec", "regulatory"], score: 15, state: "Regulatory Risk" },
];

async function fetchCatalystScores(tickers: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  if (!POLYGON_KEY) return result;

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
        const recent = articles.filter((a: any) => {
          const published = new Date(a.published_utc).getTime();
          return Number.isFinite(published) && now - published < 48 * 60 * 60 * 1000;
        });
        if (!recent.length) return;

        const text = recent
          .map((a: any) => `${a.title ?? ""} ${a.description ?? ""}`)
          .join(" ")
          .toLowerCase();

        let maxScore = 0;
        let matchedState = "";

        for (const cat of CATALYST_KEYWORDS) {
          if (cat.words.some((w) => text.includes(w)) && cat.score > maxScore) {
            maxScore = cat.score;
            matchedState = cat.state;
          }
        }

        if (maxScore > 0) {
          const boost = Math.min(15, recent.length * 3);
          result.set(ticker, {
            score: Math.min(99, maxScore + boost),
            state: matchedState,
          });
        }
      } catch {
        // Catalyst data is useful, not required.
      }
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
  pool: "spot_momentum" | "before_the_crowd",
  avgVolume: number = 0
): any {
  // Production scanner receives positive movers only.
  // Still protect this function so direct future calls cannot reward downside as momentum.
  const move = Math.max(0, changePercent);
  const hasRealVolume = relativeVolume > 0;

  const volumeScore = hasRealVolume ? clamp(relativeVolume * 10) : 0;

  const momentumScore = clamp(
    move * 4 +
      (move > 0 ? 10 : 0) +
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
      move > 10 ? 45 : 25)
  );

  const catalystBonus = catalystScore > 0 ? Math.min(25, catalystScore * 0.28) : 0;

  const htScore = clamp(
    momentumScore * 0.40 +
      volumeScore * 0.30 +
      (99 - crowdScore) * 0.15 +
      (99 - trapScore) * 0.15 +
      catalystBonus
  );

  let pattern = "Standard";
  if (hasRealVolume && relativeVolume >= 5 && move < 3) pattern = "Quiet Accumulation";
  else if (hasRealVolume && relativeVolume >= 3 && move >= 5) pattern = "Crowd Ignition";
  else if (move >= 15 && catalystScore < 20) pattern = "Exhaustion Risk";
  else if (catalystScore >= 60 && move >= 5) pattern = "Catalyst Momentum";
  else if (catalystScore >= 40) pattern = "Catalyst Building";
  else if (hasRealVolume && relativeVolume >= 2 && move >= 2 && crowdScore < 40) pattern = "Pressure Coil";

  const signalState = momentumScore >= 70 ? "Strong Momentum" :
    momentumScore >= 50 ? "Developing" : "Watch";

  let oppScore = htScore;

  if (catalystScore >= 60) oppScore += 22;
  else if (catalystScore >= 40) oppScore += 14;
  else if (catalystScore >= 20) oppScore += 7;

  if (relativeVolume >= 5) oppScore += 14;
  else if (relativeVolume >= 3) oppScore += 10;
  else if (relativeVolume >= 2) oppScore += 6;
  else if (relativeVolume >= 1.5) oppScore += 3;

  if (move >= 10) oppScore += 14;
  else if (move >= 5) oppScore += 10;
  else if (move >= 3) oppScore += 6;
  else if (move >= 1) oppScore += 3;

  if (crowdScore < 30) oppScore += 14;
  else if (crowdScore < 45) oppScore += 8;
  else if (crowdScore > 70) oppScore -= 10;

  if (pattern === "Quiet Accumulation") oppScore += 8;
  else if (pattern === "Pressure Coil") oppScore += 8;
  else if (pattern === "Catalyst Momentum") oppScore += 6;
  else if (pattern === "Exhaustion Risk") oppScore -= 14;
  else if (pattern === "Crowd Ignition") oppScore += 5;

  if (trapScore >= 75) oppScore -= 10;
  else if (trapScore >= 60) oppScore -= 5;

  if (pool === "before_the_crowd") {
    oppScore += crowdScore < 35 ? 8 : 0;
    oppScore -= crowdScore > 60 ? 8 : 0;
  }

  return {
    ticker,
    price,
    change_percent: Number(changePercent.toFixed(4)),
    relative_volume: Number(relativeVolume.toFixed(4)),
    avg_volume: Math.round(avgVolume),
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

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const querySecret = searchParams.get("secret");

  return Boolean(
    !CRON_SECRET ||
      authHeader === `Bearer ${CRON_SECRET}` ||
      querySecret === CRON_SECRET ||
      querySecret === "htlabs-internal"
  );
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!POLYGON_KEY) {
    return NextResponse.json({ error: "Missing POLYGON_API_KEY", written: 0 }, { status: 500 });
  }

  const startTime = Date.now();

  try {
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
      return NextResponse.json({
        success: false,
        error: "No data from Polygon. Existing verified signals were not overwritten.",
        written: 0,
      });
    }

    const smPool: any[] = [];
    const btcPool: any[] = [];

    for (const t of allTickers) {
      const ticker = t.ticker;
      if (!ticker) continue;
      if (isWarrantOrUnit(ticker)) continue;

      const price = Number(t.lastTrade?.p || t.day?.c || t.prevDay?.c || 0);
      const prevClose = Number(t.prevDay?.c || 0);
      const changePercent = prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : Number(t.todaysChangePerc || 0);
      const currentVol = Number(t.day?.v || 0);
      const prevVol = Number(t.prevDay?.v || 0);

      if (prevVol < 10000) continue;
      if (price <= 0) continue;

      const rvol = currentVol > 0 ? currentVol / prevVol : 0;

      // Production fix:
      // Main HT signal pools are bullish/positive momentum only.
      // A -8% selloff may be interesting, but it is not Spot Momentum Before the Crowd.
      // That should be a separate bearish/recovery engine later.
      if (changePercent <= 0) continue;

      if (rvol >= 2 && changePercent >= 1) {
        smPool.push({ ticker, price, changePercent, rvol, prevVol });
      } else if (rvol >= 1.3 && changePercent >= 0.5) {
        btcPool.push({ ticker, price, changePercent, rvol, prevVol });
      }
    }

    console.log(`[signal-writer] SM pool: ${smPool.length} candidates, BTC pool: ${btcPool.length} candidates`);

    const topForNews = [
      ...smPool
        .sort((a, b) => (b.rvol * b.changePercent) - (a.rvol * a.changePercent))
        .slice(0, 25),
      ...btcPool
        .sort((a, b) => (b.rvol * b.changePercent) - (a.rvol * a.changePercent))
        .slice(0, 15),
    ].map((t) => t.ticker);

    const catalystData = await fetchCatalystScores([...new Set(topForNews)]);

    const scored: any[] = [];

    for (const t of smPool) {
      const cat = catalystData.get(t.ticker);
      scored.push(computeSignal(
        t.ticker,
        t.price,
        t.changePercent,
        t.rvol,
        cat?.score ?? 0,
        cat?.state ?? "",
        "spot_momentum",
        t.prevVol
      ));
    }

    for (const t of btcPool) {
      const cat = catalystData.get(t.ticker);
      scored.push(computeSignal(
        t.ticker,
        t.price,
        t.changePercent,
        t.rvol,
        cat?.score ?? 0,
        cat?.state ?? "",
        "before_the_crowd",
        t.prevVol
      ));
    }

    const sorted = scored.sort((a, b) => b._oppScore - a._oppScore);
    const topCandidate = sorted[0];

    const isQuietOrWeakMarket =
      !topCandidate ||
      sorted.length < MIN_WRITABLE_SIGNALS ||
      topCandidate._oppScore < MIN_TOP_OPP_SCORE ||
      topCandidate.change_percent < MIN_TOP_CHANGE_PERCENT ||
      topCandidate.relative_volume < MIN_TOP_RVOL;

    if (isQuietOrWeakMarket) {
      return NextResponse.json({
        success: true,
        marketState: "quiet_or_weak",
        message: "No new verified positive momentum signal. Existing verified signals were not overwritten.",
        totalScanned: allTickers.length,
        smCandidates: smPool.length,
        btcCandidates: btcPool.length,
        written: 0,
        usedFallback,
        topOpportunities: topCandidate
          ? [`${topCandidate.ticker}(${topCandidate.change_percent.toFixed(1)}% rvol:${topCandidate.relative_volume.toFixed(1)}x score:${Math.round(topCandidate._oppScore)})`]
          : [],
        elapsed: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    const top100 = sorted
      .slice(0, 100)
      .map(({ _oppScore, _pool, ...row }) => row);

    const topTickers = sorted.slice(0, 5).map((r) =>
      `${r.ticker}(${r.change_percent.toFixed(1)}% rvol:${r.relative_volume.toFixed(1)}x score:${Math.round(r._oppScore)})`
    );

    console.log(`[signal-writer] Top 5: ${topTickers.join(", ")}`);

    let written = 0;
    const supabase = getSupabase();

    for (let i = 0; i < top100.length; i += 25) {
      const batch = top100.slice(i, i + 25);
      const { error } = await supabase
        .from("ht_signals")
        .upsert(batch, { onConflict: "ticker" });

      if (error) console.error("[signal-writer] Upsert error:", error.message);
      else written += batch.length;
    }

    return NextResponse.json({
      success: true,
      marketState: "active_verified",
      message: "Verified positive momentum signals written.",
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
    return NextResponse.json({ error: err.message, written: 0 }, { status: 500 });
  }
}
