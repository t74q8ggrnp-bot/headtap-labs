// app/api/polygon-scanner/route.ts
//
// MANUAL / TEST SCANNER ONLY
//
// This route is intentionally read-only.
// It scans the curated Polygon universe for diagnostics,
// but it must NOT write into ht_signals.
// The live homepage trusts ht_signals, and production publishing
// belongs to /api/signal-writer only.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCatalystSignalsForTickers, topCatalystSignal } from "@/lib/fdaScanner";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const POLYGON_KEY = process.env.POLYGON_API_KEY!;

const UNIVERSE = [
  "SPY","QQQ","IWM","DIA","VTI","XLK","XLF","XLE","XLI","XLV","XLY","XLC","SMH","ARKK",
  "AAPL","MSFT","NVDA","GOOGL","GOOG","META","AMZN","TSLA","NFLX","AVGO","ORCL","CRM","ADBE","NOW","UBER","SHOP",
  "AMD","SMCI","ARM","MU","TSM","INTC","MRVL","QCOM","DELL","HPE","CRWD","PANW","NET","DDOG","SNOW","AI","SOUN","BBAI","PATH","PLTR",
  "HOOD","MSTR","COIN","RIVN","SOFI","RDDT","DJT","GME","AMC","LCID","AFRM","UPST","CVNA","DKNG","RBLX","ROKU","PINS","NIO","XPEV","LI",
  "LUNR","RKLB","ASTS","IONQ","RGTI","QBTS","QUBT","LAES","ACHR","JOBY","SPCE","KULR","SERV","PDYN","BKSY",
  "OTLK","SAVA","NVAX","HIMS","RXRX","BEAM","CRSP","EDIT","NTLA","GERN","TGTX","SMMT",
  "IBRX","ARDX","CAPR","AKBA","VKTX","IOVA","TEM","ALT","SNAL",
  "MARA","RIOT","CLSK","HUT","WULF",
  "JPM","BAC","GS","MS","WFC","SCHW","PYPL","V","MA",
  "DIS","NKE","SBUX","CMG","COST","WMT","LULU","ELF","CELH","CAVA","RCL","CCL","DAL","UAL","AAL",
  "XOM","CVX","OXY","SLB","FCX","CAT","DE","GE","BA","LMT",
  "LLY","NVO","MRNA","PFE","MRK","JNJ","ABBV","UNH","ISRG",
  "OPEN","CBRS","AKBA","ACMR","ENVX","VIAV","VERV","APLD","CIFR",
];

const SCAN_UNIVERSE = Array.from(new Set(UNIVERSE));

const CATALYST_UNIVERSE = new Set([
  "OTLK","SAVA","NVAX","HIMS","RXRX","BEAM","CRSP","EDIT","NTLA","GERN","TGTX","SMMT",
  "IBRX","ARDX","CAPR","AKBA","VKTX","IOVA","TEM","ALT","SNAL","MRNA","PFE","LLY",
  "ABBV","ISRG","ACMR","VERV","IONQ","RGTI","QBTS","QUBT",
]);

const EXCLUDED = new Set([
  "SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL","LABD","LABU","TZA","TNA","FAZ","FAS",
]);

function getMarketSession(hour: number): string {
  if (hour < 9) return "pre_market";
  if (hour < 10) return "open";
  if (hour >= 15) return "power_hour";
  return "mid_session";
}

interface TickerSnapshot {
  ticker: string;
  price: number;
  changePercent: number;
  volume: number;
  prevVolume: number;
  relativeVolume: number;
  high: number;
  low: number;
}

async function fetchPolygonSnapshot(tickers: string[]): Promise<TickerSnapshot[]> {
  const results: TickerSnapshot[] = [];
  for (let i = 0; i < tickers.length; i += 100) {
    const chunk = tickers.slice(i, i + 100).filter(t => !EXCLUDED.has(t));
    try {
      const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${chunk.join(",")}&apiKey=${POLYGON_KEY}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const t of data?.tickers ?? []) {
        if (EXCLUDED.has(t.ticker)) continue;
        const price = Number(t?.day?.c || t?.prevDay?.c || 0);
        const prevClose = Number(t?.prevDay?.c || 0);
        const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : Number(t?.todaysChangePerc || 0);
        const volume = Number(t?.day?.v || t?.prevDay?.v || 0);
        const prevVolume = Number(t?.prevDay?.v || 1);
        const relativeVolume = prevVolume > 0 ? Math.min(10, Math.max(0.1, volume / prevVolume)) : 1;
        if (price > 0) {
          results.push({
            ticker: t.ticker, price, changePercent, volume, prevVolume, relativeVolume,
            high: Number(t?.day?.h || t?.prevDay?.h || price),
            low: Number(t?.day?.l || t?.prevDay?.l || price),
          });
        }
      }
    } catch (err) {
      console.warn(`Polygon snapshot chunk failed:`, err);
    }
  }
  return results;
}

async function checkInsiderBuys(tickers: string[]): Promise<Set<string>> {
  const insiderTickers = new Set<string>();
  try {
    const res = await fetch(
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=40&search_text=&output=atom",
      { headers: { "User-Agent": "HTLabs signal-engine@htlabs.com" }, next: { revalidate: 600 } }
    );
    if (!res.ok) return insiderTickers;
    const xml = await res.text();
    const entries = xml.split("<entry>").slice(1);
    const now = Date.now();
    for (const entry of entries) {
      const title = entry.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? "";
      const updated = entry.match(/<updated[^>]*>([^<]*)<\/updated>/)?.[1] ?? "";
      const tickerMatch = title.match(/\(([A-Z]{1,5})\)/);
      if (!tickerMatch) continue;
      const ticker = tickerMatch[1];
      if (!tickers.includes(ticker)) continue;
      const filedDate = updated.split("T")[0];
      const daysAgo = Math.floor((now - new Date(filedDate).getTime()) / 86_400_000);
      if (daysAgo <= 14) insiderTickers.add(ticker);
    }
  } catch { /* silent */ }
  return insiderTickers;
}

function scoreTicker(snap: TickerSnapshot, hasInsiderBuy: boolean, hasFDAEvent: boolean, catalystKeywords: string[]) {
  const { changePercent, relativeVolume } = snap;
  const absChange = Math.abs(changePercent);
  const hasCatalyst = hasInsiderBuy || hasFDAEvent || catalystKeywords.length > 0;

  let crowdScore = 30;
  if (changePercent > 0) {
    crowdScore += Math.min(30, changePercent * 3);
    crowdScore += Math.min(20, relativeVolume * 4);
  }
  crowdScore = Math.min(95, Math.max(10, Math.round(crowdScore)));

  let trapScore = 20;
  if (!hasCatalyst) {
    if (absChange >= 15) trapScore += 40;
    else if (absChange >= 10) trapScore += 25;
    else if (absChange >= 7) trapScore += 12;
  } else {
    if (absChange >= 30) trapScore += 20;
    else if (absChange >= 20) trapScore += 10;
  }
  if (crowdScore >= 75 && !hasCatalyst) trapScore += 20;
  if (relativeVolume >= 8 && !hasCatalyst) trapScore += 10;
  trapScore = Math.min(95, Math.max(5, Math.round(trapScore)));

  const volumeScore = Math.min(99, Math.round(relativeVolume * 10));

  let momentumScore = 0;
  if (changePercent > 0 && (crowdScore < 80 || hasCatalyst) && absChange < 20) {
    momentumScore += Math.min(35, changePercent * 3.5);
    momentumScore += Math.min(25, relativeVolume * 6);
    momentumScore += crowdScore < 45 ? 15 : crowdScore < 60 ? 5 : -10;
    if (trapScore >= 65 && !hasCatalyst) momentumScore -= 20;
  }
  momentumScore = Math.min(99, Math.max(0, Math.round(momentumScore)));

  let catalystScore = 0;
  if (hasInsiderBuy) catalystScore += 28;
  if (hasFDAEvent) catalystScore += 20;
  catalystScore += Math.min(12, catalystKeywords.length * 4);
  if (absChange >= 20) catalystScore += 15;
  else if (absChange >= 10) catalystScore += 10;
  else if (absChange >= 5) catalystScore += 6;
  else if (absChange >= 2) catalystScore += 3;
  if (relativeVolume >= 3) catalystScore += 8;
  else if (relativeVolume >= 2) catalystScore += 5;
  else if (relativeVolume >= 1.5) catalystScore += 2;
  if (relativeVolume < 0.8) catalystScore -= 5;
  catalystScore = Math.min(75, Math.max(0, catalystScore));

  let htScore = 40;
  htScore += Math.min(20, absChange * 2);
  htScore += Math.min(15, relativeVolume * 3);
  htScore += catalystScore > 0 ? 18 : 0;
  htScore -= trapScore >= 70 && !hasCatalyst ? 15 : 0;
  htScore -= crowdScore >= 80 && !hasCatalyst ? 10 : 0;
  htScore = Math.min(99, Math.max(20, Math.round(htScore)));

  let pattern = "Standard";
  if (!hasCatalyst && (trapScore >= 70 || absChange >= 20)) pattern = "Exhaustion Risk";
  else if (changePercent > 0 && relativeVolume >= 1.5 && relativeVolume < 2.5 && crowdScore < 40) pattern = "Quiet Accumulation";
  else if (changePercent > 0 && relativeVolume >= 2.5 && crowdScore < 50) pattern = "Pressure Coil";
  else if (changePercent > 0 && relativeVolume >= 3 && crowdScore >= 50 && crowdScore < 70) pattern = "Continuation Stack";
  else if (changePercent > 0 && crowdScore >= 65 && !hasCatalyst) pattern = "Crowd Ignition";
  else if (changePercent < 0 && relativeVolume >= 1.5 && !hasCatalyst) pattern = "Reclaim Setup";
  else if (hasCatalyst && changePercent > 5) pattern = "Catalyst Momentum";
  else if (hasCatalyst && changePercent > 0) pattern = "Catalyst Building";
  else if (hasCatalyst) pattern = "Catalyst Setup";

  let state = "Standard";
  if (pattern === "Exhaustion Risk") state = "Exhaustion — Avoid";
  else if (pattern === "Quiet Accumulation") state = "Quiet Accumulation";
  else if (pattern === "Pressure Coil") state = "Pressure Coiling";
  else if (pattern === "Continuation Stack") state = "Momentum Wave";
  else if (pattern === "Crowd Ignition") state = "Crowd Igniting";
  else if (pattern === "Reclaim Setup") state = "Buyers Needed";
  else if (pattern === "Catalyst Momentum") state = "Catalyst — Active Move";
  else if (pattern === "Catalyst Building") state = "Catalyst — Building";
  else if (pattern === "Catalyst Setup") state = "Catalyst Watch";
  else if (changePercent >= 5) state = "Hot Mover";
  else if (changePercent >= 2) state = "Active";
  else if (changePercent < 0) state = "Pullback";
  if (hasInsiderBuy) state = `${state} + Insider Buy`;
  if (hasFDAEvent) state = `${state} + FDA Event`;

  return { htScore, momentumScore, volumeScore, crowdScore, trapScore, state, pattern, catalystScore };
}

function buildTestPayload(snap: TickerSnapshot, scores: ReturnType<typeof scoreTicker>) {
  const now = new Date();

  return {
    ticker: snap.ticker,
    price: snap.price,
    change_percent: snap.changePercent,
    relative_volume: snap.relativeVolume,
    ht_score: scores.htScore,
    catalyst_score: scores.catalystScore,
    momentum_score: scores.momentumScore,
    crowd_score: scores.crowdScore,
    trap_score: scores.trapScore,
    volume_score: scores.volumeScore,
    pattern: scores.pattern,
    state: scores.state,
    signal_state: scores.state,
    scanned_at: now.toISOString(),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const isProduction = process.env.VERCEL_ENV === "production";
  if (isProduction && secret !== process.env.CRON_SECRET && secret !== "htlabs-internal") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const startTime = Date.now();
    const snapshots = await fetchPolygonSnapshot(SCAN_UNIVERSE);
    if (!snapshots.length) {
      return NextResponse.json({ error: "Polygon returned no data", scanned: 0 });
    }

    const tickers = snapshots.map(s => s.ticker);
    const catalystTickers = tickers.filter(t => CATALYST_UNIVERSE.has(t));
    const [insiderBuys, catalystMap] = await Promise.all([
      checkInsiderBuys(tickers),
      getCatalystSignalsForTickers(catalystTickers),
    ]);

    const scored = snapshots.map(snap => {
      const catalystSignals = catalystMap.get(snap.ticker) ?? [];
      const topCatalyst = topCatalystSignal(catalystSignals);
      const hasFDAEvent = topCatalyst?.type === "fda";
      const catalystKeywords = topCatalyst?.keywords ?? [];
      return { snap, scores: scoreTicker(snap, insiderBuys.has(snap.ticker), hasFDAEvent, catalystKeywords), hasFDAEvent, catalystKeywords };
    });

    // IMPORTANT:
    // polygon-scanner is manual/test only.
    // It must NOT write into ht_signals because ht_signals powers the live homepage.
    // Production writes belong to /api/signal-writer only.
    const testPayloads = scored.map(({ snap, scores }) => buildTestPayload(snap, scores));

    const topSignals = scored
      .filter(({ scores }) => scores.htScore >= 60 || scores.catalystScore >= 20)
      .sort((a, b) => (b.scores.htScore + b.scores.catalystScore) - (a.scores.htScore + a.scores.catalystScore))
      .slice(0, 15)
      .map(({ snap, scores, hasFDAEvent, catalystKeywords }) => ({
        ticker: snap.ticker, price: snap.price, changePercent: snap.changePercent,
        relativeVolume: snap.relativeVolume, htScore: scores.htScore, catalystScore: scores.catalystScore,
        pattern: scores.pattern, state: scores.state, hasInsiderBuy: insiderBuys.has(snap.ticker),
        hasFDAEvent, catalystKeywords,
      }));

    const catalystForMemory = scored
      .filter(({ scores }) => scores.catalystScore >= 20)
      .map(({ snap, scores, hasFDAEvent, catalystKeywords }) => ({
        ticker: snap.ticker, price: snap.price, changePercent: snap.changePercent,
        relativeVolume: snap.relativeVolume, htScore: scores.htScore, catalystScore: scores.catalystScore,
        momentumScore: scores.momentumScore, crowdScore: scores.crowdScore, trapScore: scores.trapScore,
        pattern: scores.pattern, state: scores.state, hasFDAEvent,
        hasInsiderBuy: insiderBuys.has(snap.ticker), catalystKeywords,
      }));

    // Signal memory writes are intentionally disabled here.
    // This route is a scanner diagnostic, not a production publisher.
    // Production signal memory should be fed by verified published signals only.

    return NextResponse.json({
      success: true,
      mode: "manual_test_read_only",
      message: "polygon-scanner scanned successfully but did not write to ht_signals. Production publishing belongs to /api/signal-writer.",
      scanned: snapshots.length,
      written: 0,
      wouldHaveWritten: testPayloads.length,
      catalystScanned: catalystTickers.length,
      catalystMemoryLogged: 0,
      insiderBuyTickers: Array.from(insiderBuys),
      topSignals,
      elapsed: `${Date.now() - startTime}ms`,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[Polygon Scanner] Error:", error);
    return NextResponse.json({ error: "Scanner failed", detail: String(error) }, { status: 500 });
  }
}
