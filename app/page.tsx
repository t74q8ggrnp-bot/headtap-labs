"use client";

export const dynamic = "force-dynamic";

declare global { interface Window { _htScannerLastFetch?: number } }

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import MiniStockChart from "./components/MiniStockChart";
import { supabase } from "@/lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

type Stock = {
  symbol: string;
  price: number;
  change: number;
  volume?: number;
  prevVolume?: number;
  // Polygon-enriched fields from ht_signals
  relativeVolume?: number;
  catalystScore?: number;
  htSignalScore?: number;
  momentumScore?: number;
  crowdScore?: number;
  trapScore?: number;
  signalState?: string;
  signalPattern?: string;
  hasFDAEvent?: boolean;
  hasInsiderBuy?: boolean;
  changePercent?: number;
};

type MarketBadge = {
  symbol: string;
  label: string;
  change: number;
};

type ScannerFilter = "all" | "hot" | "bullish" | "watchlist";
type AllocationStyle = "short" | "swing" | "long";
type AllocationRisk = "conservative" | "moderate" | "aggressive";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";
type CommandMode = "command" | "capital" | "portfolio" | "signals" | "replay";

type PortfolioHolding = {
  id: string;
  symbol: string;
  amount: string;
};

type Catalyst = {
  symbol: string;
  title: string;
  impact: "High" | "Medium" | "Watch";
  note: string;
};

type HeatSignal = {
  symbol: string;
  mentions: string;
  sentiment: string;
  score: number;
};

type NewsItem = {
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number;
};

type NewsIntel = {
  articles: NewsItem[];
  newsVelocity: number;
  catalystStrength: string;
  narrativeSignal: string;
  sentimentBias: string;
  sentimentScore: number;
  hypeScore: number;
  sourceCount: number;
  socialVelocity?: number;
  redditMentions?: number;
  xMentions?: number;
  stocktwitsMentions?: number;
  crowdSignal?: string;
};

type MarketScanStats = {
  scanned: number;
  gainers: number;
  losers: number;
  highVolume: number;
  lastFullScan: Date | null;
};

const fallbackQuotes: Record<string, Stock> = {
  NVDA: { symbol: "NVDA", price: 945.75, change: 2.18 },
  PLTR: { symbol: "PLTR", price: 132.4, change: 3.84 },
  AMD: { symbol: "AMD", price: 165.22, change: 1.72 },
  TSLA: { symbol: "TSLA", price: 181.63, change: -0.92 },
  QUBT: { symbol: "QUBT", price: 8.42, change: 7.35 },
  SNAL: { symbol: "SNAL", price: 1.12, change: 18.9 },
  SMCI: { symbol: "SMCI", price: 48.8, change: 2.93 },
  MSTR: { symbol: "MSTR", price: 1875.2, change: 4.11 },
  HOOD: { symbol: "HOOD", price: 66.34, change: 2.48 },
  AAPL: { symbol: "AAPL", price: 209.14, change: 0.76 },
  MSFT: { symbol: "MSFT", price: 423.9, change: 1.09 },
  SPY: { symbol: "SPY", price: 627.55, change: 0.58 },
  QQQ: { symbol: "QQQ", price: 534.42, change: 0.91 },
  DIA: { symbol: "DIA", price: 412.2, change: -0.12 },
};

const catalystRadar: Catalyst[] = [
  {
    symbol: "SNAL",
    title: "Retail Attention Spike",
    impact: "High",
    note: "Small-cap attention is moving fast. HT is watching whether crowd interest becomes durable participation. Watch volume retention and pullback behavior.",
  },
  {
    symbol: "NVDA",
    title: "AI Leadership Tape",
    impact: "Medium",
    note: "NVDA is a bellwether for AI risk appetite. Watch whether strength spreads into AMD, SMCI, and QQQ.",
  },
  {
    symbol: "QUBT",
    title: "Speculative Quantum Watch",
    impact: "Watch",
    note: "High-beta quantum attention. Watch continuation after pullbacks instead of chasing first green candles.",
  },
];

const heatSignals: HeatSignal[] = [
  { symbol: "SNAL", mentions: "+214%", sentiment: "Explosive", score: 94 },
  { symbol: "QUBT", mentions: "+88%", sentiment: "Speculative", score: 81 },
  { symbol: "PLTR", mentions: "+42%", sentiment: "Accumulating", score: 76 },
  { symbol: "NVDA", mentions: "+31%", sentiment: "Institutional", score: 72 },
];

const defaultStarterTickers = [
  "NVDA",
  "PLTR",
  "AMD",
  "TSLA",
  "QUBT",
  "SNAL",
  "SMCI",
  "MSTR",
  "HOOD",
  "AAPL",
  "MSFT",
];

const broadMarketUniverse = [
  // Index / market pulse
  "SPY", "QQQ", "IWM", "DIA", "VTI", "XLK", "XLF", "XLE", "XLI", "XLV", "XLY", "XLC", "SMH", "ARKK",

  // Mega-cap / institutional leaders
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "META", "AMZN", "TSLA", "NFLX", "AVGO", "ORCL", "CRM", "ADBE", "NOW", "UBER", "SHOP",

  // AI / semis / infrastructure
  "AMD", "SMCI", "ARM", "MU", "TSM", "INTC", "MRVL", "ASML", "QCOM", "ON", "WDC", "DELL", "HPE", "CRWD", "PANW", "NET", "DDOG", "SNOW", "AI", "SOUN", "BBAI", "PATH", "PLTR",

  // Momentum / retail attention / risk-on proxies
  "HOOD", "MSTR", "COIN", "RIVN", "SOFI", "RDDT", "DJT", "GME", "AMC", "LCID", "CHPT", "OPEN", "AFRM", "UPST", "CVNA", "DKNG", "RBLX", "ROKU", "PINS", "BILI", "NIO", "XPEV", "LI",

  // Space / quantum / speculative innovation
  "LUNR", "RKLB", "ASTS", "IONQ", "RGTI", "QBTS", "QUBT", "LAES", "ARQQ", "ACHR", "JOBY", "EVTL", "SPCE", "KULR", "SERV", "PDYN", "RR", "BKSY",

  // Small-cap / high-beta / unusual activity watch
  "SNAL", "OTLK", "ALT", "VKTX", "IOVA", "TEM", "HIMS", "RXRX", "BEAM", "CRSP", "EDIT", "NTLA", "GERN", "TGTX", "SMMT", "NVAX", "IBRX", "ARDX", "LXRX", "CAPR", "AKBA", "MARA", "RIOT", "CLSK", "BTBT", "HUT", "BITF", "WULF",

  // Financials / liquidity / market confidence
  "JPM", "BAC", "GS", "MS", "WFC", "C", "AXP", "SCHW", "PYPL", "V", "MA",

  // Consumer / rotation / earnings momentum
  "DIS", "NKE", "SBUX", "CMG", "COST", "WMT", "TGT", "LULU", "ELF", "CELH", "CAVA", "SHAK", "RCL", "CCL", "DAL", "UAL", "AAL",

  // Energy / industrial / macro momentum
  "XOM", "CVX", "OXY", "SLB", "FCX", "NEM", "CAT", "DE", "GE", "BA", "LMT", "RTX",

  // Healthcare / biotech large-cap pulse
  "LLY", "NVO", "MRNA", "PFE", "MRK", "JNJ", "ABBV", "UNH", "ISRG", "TMDX",

  // Defense / aerospace — real momentum movers
  "AVAV", "KTOS", "RCAT", "DFEN", "HII", "NOC", "GD", "TDG", "AXON", "CACI", "SAIC", "LDOS",

  // Quality mid-cap tech with real momentum history
  "FTNT", "ZS", "OKTA", "GTLB", "CFLT", "MDB", "ESTC", "BILL", "HUBS", "SPRK",
  "TTD", "TRADE", "APP", "APPLOVIN", "IREN", "CLBT", "CLOV", "CIFR", "APLD",

  // Healthcare mid-cap momentum
  "INSP", "ALGN", "IRTC", "NVCR", "ATRC", "PCVX", "BHVN", "ACAD", "RARE",
  "SUPN", "ITCI", "HRMY", "PRAX", "TVTX",

  // Industrial / clean energy momentum
  "ENPH", "SEDG", "FSLR", "ARRY", "RUN", "NOVA", "STEM", "FLNC", "GNRC",
  "CHPT", "BLNK", "EVGO", "PTRA",

  // Retail / consumer mid-cap movers
  "PTON", "CHWY", "ETSY", "W", "REAL", "CPNG", "SE", "GRAB", "DIDI",
  "CART", "IBEX", "SKIN", "CURV",

  // Small-cap special situations / catalyst-prone
  "SIGA", "FULC", "URGN", "KALA", "NUVL", "JANX", "ERAS", "IMVT",
  "CGON", "IRON", "KRUS", "BROS", "CAVA",
];

const marketUniverse = Array.from(new Set([...defaultStarterTickers, ...broadMarketUniverse]));

const scannerFilters: { label: string; value: ScannerFilter }[] = [
  { label: "All", value: "all" },
  { label: "Hot", value: "hot" },
  { label: "Bullish", value: "bullish" },
  { label: "Watchlist", value: "watchlist" },
];


// ── MobileCardDetail ──────────────────────────────────────────────────────────
// Per-swipe-card detail section. Extracted here so its internal variables
// (read, stance, exits, isGreen) are properly scoped to this component and
// cannot bleed into the Before The Crowd hero card or any other section.
// All data it needs is passed explicitly as props — no captured closure state.
// ──────────────────────────────────────────────────────────────────────────────
interface MobileCardDetailProps {
  current: Stock;
  mobileCards: Stock[];
  mobileCardIndex: number;
  isHeroCard: boolean;
  convictionLeaders: Stock[];
  emergingRadarCandidates: { stock: Stock; radarScore: number }[];
  watchlist: string[];
  setMobileCardIndex: (fn: ((i: number) => number) | number) => void;
  setSelectedStock: (s: Stock) => void;
  toggleWatchlist: (sym: string) => void;
  getHTScore: (s: Stock) => number;
  getRelativeVolume: (s: Stock) => number;
  getAttentionScore: (s: Stock) => number;
  getContinuationStrengthScore: (s: Stock) => number;
  getTrapRiskScore: (s: Stock) => number;
  getEntryQualityScore: (s: Stock) => number;
  detectPatternSignal: (s: Stock) => { name: string };
  getSimpleConvictionRead: (s: Stock) => { state: string; score: number };
  getHTStance: (s: Stock) => { label: string; desc: string; color: string; bg: string };
  getContinuationWindows: (s: Stock) => { conservative: string };
  getBackgroundOpportunityEngine: (s: Stock) => { crowdSaturationScore: number };
}

function MobileCardDetail({
  current,
  mobileCards,
  mobileCardIndex,
  isHeroCard,
  convictionLeaders,
  emergingRadarCandidates,
  watchlist,
  setMobileCardIndex,
  setSelectedStock,
  toggleWatchlist,
  getHTScore,
  getRelativeVolume,
  getAttentionScore,
  getContinuationStrengthScore,
  getTrapRiskScore,
  getEntryQualityScore,
  detectPatternSignal,
  getSimpleConvictionRead,
  getHTStance,
  getContinuationWindows,
  getBackgroundOpportunityEngine,
}: MobileCardDetailProps) {
  // All vars here describe `current` (the swiped card), never the hero card.
  const read = getSimpleConvictionRead(current);
  const stance = getHTStance(current);
  const exits = getContinuationWindows(current);
  const isGreen = current.change >= 0;

  return (
    <>
                  <div className="relative px-4 pt-4 pb-3 flex-shrink-0">

                    {/* Swipe indicator + Live badge */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1.5">
                          {mobileCards.slice(0, 8).map((_, i) => (
                            <button
                              key={i}
                              onClick={() => setMobileCardIndex(i)}
                              className={`h-1 rounded-full transition-all ${i === mobileCardIndex ? "w-6 bg-orange-400" : "w-2 bg-white/20"}`}
                            />
                          ))}
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600">
                          {mobileCardIndex + 1} of {mobileCards.length} · swipe for more
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-green-400">Live</span>
                      </div>
                    </div>

                    {/* 1. Ranking */}
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400 mb-2">
                      {isHeroCard ? "HT Top Signal" : `#${mobileCardIndex + 1} Active Read`}
                    </p>

                    {/* 2. TICKER — only show if different from BTC hero above */}
                    {!isHeroCard && (
                      <h1 className="font-mono text-[5.5rem] font-black uppercase leading-[0.82] tracking-[-0.12em] text-white">
                        {current.symbol}
                      </h1>
                    )}
                    {isHeroCard && (
                      <h1 className="font-mono text-[3rem] font-black uppercase leading-[0.9] tracking-[-0.08em] text-white">
                        {current.symbol} — Signal Detail
                      </h1>
                    )}

                    {/* 3. Stage badge */}
                    <div className="mt-3 inline-flex items-center rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2">
                      <p className="text-base font-black text-white">{read.state}</p>
                    </div>

                    {/* 4. WHY NOW — one sentence */}
                    <p className="mt-2 text-sm font-semibold text-zinc-400 leading-5">
                      {(() => {
                        const rvol = getRelativeVolume(current);
                        const attention = getAttentionScore(current);
                        const crowd = getBackgroundOpportunityEngine(current).crowdSaturationScore;
                        if (read.state.includes("Crowd Igniting"))
                          return `Volume is ${rvol}x normal and crowd participation is accelerating.`;
                        if (read.state.includes("Quiet Accumulation"))
                          return `Buying pressure is building quietly while attention remains low.`;
                        if (read.state.includes("Pressure"))
                          return `Momentum is building before it becomes obvious to everyone.`;
                        if (read.state.includes("Momentum Wave"))
                          return `The move is holding and buyers continue to show up.`;
                        if (read.state.includes("Breakout"))
                          return `Setup is approaching a key trigger — volume confirmation needed.`;
                        if (read.state.includes("Avoid") || read.state.includes("Trap"))
                          return `Risk is too elevated for a clean entry right now.`;
                        if (read.state.includes("Buyers Needed"))
                          return `Price is dropping. Wait for buyers to step in with volume.`;
                        if (read.state.includes("Pullback"))
                          return `Good setup — a cleaner entry will come after it settles.`;
                        if (read.state.includes("Exhaustion"))
                          return `The move is extended. Entering here means buying late.`;
                        if (read.state.includes("Attention"))
                          return `Interest is increasing without signs of crowd saturation.`;
                        return `HT is watching for one more confirmation before acting.`;
                      })()}
                    </p>

                    {/* 5. Price + Change — only show if different from BTC hero */}
                    {!isHeroCard && (
                      <div className="mt-4 flex items-center gap-3">
                        <span className="font-mono text-2xl font-black text-white">${current.price.toFixed(2)}</span>
                        <span className={`font-mono text-xl font-black ${isGreen ? "text-green-400" : "text-red-400"}`}>
                          {isGreen ? "+" : ""}{current.change.toFixed(2)}%
                        </span>
                      </div>
                    )}

                    {/* 6. Conviction score — only show if different from BTC hero */}
                    {!isHeroCard && <div className="mt-3">
                      <div className="inline-flex flex-col rounded-2xl border border-orange-400/25 bg-orange-500/10 px-4 py-3">
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-black text-orange-300">{getHTScore(current)}</span>
                          <span className="text-sm font-black uppercase text-orange-400">Conviction</span>
                        </div>
                        <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                          {getHTScore(current) >= 90 ? "Top Active Read Right Now" :
                           getHTScore(current) >= 80 ? "High Rated Setup" :
                           getHTScore(current) >= 70 ? "Active Watch" :
                           "Developing Setup"}
                        </p>
                      </div>
                      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-600">
                        Entry Quality:{" "}
                        <span className={getEntryQualityScore(current) >= 78 ? "text-green-400" : getEntryQualityScore(current) >= 62 ? "text-yellow-400" : "text-zinc-600"}>
                          {getEntryQualityScore(current) >= 78 ? "Strong" : getEntryQualityScore(current) >= 62 ? "Fair" : "Weak"}
                        </span>
                      </p>
                    </div>}
                  </div>

                  {/* Why HT Likes This */}
                  <div className="px-4 pb-3 flex-shrink-0">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300 mb-2.5">Why HT Likes This</p>
                      <div className="space-y-1.5">
                        {[
                          { good: getRelativeVolume(current) >= 2, text: getRelativeVolume(current) >= 2 ? "Volume is accelerating" : "Volume is not yet elevated" },
                          { good: getAttentionScore(current) >= 65, text: getAttentionScore(current) >= 65 ? "Crowd attention is increasing" : "Crowd has not noticed yet" },
                          { good: getContinuationStrengthScore(current) >= 60, text: getContinuationStrengthScore(current) >= 60 ? "Price structure remains clean" : "Price structure needs to hold" },
                          { good: getTrapRiskScore(current) < 55, text: getTrapRiskScore(current) < 55 ? "Low reversal risk" : "Watch for potential reversal" },
                        ].map(({ good, text }) => (
                          <div key={text} className="flex items-center gap-2.5">
                            <span className={`text-sm font-black ${good ? "text-green-400" : "text-zinc-700"}`}>{good ? "✓" : "×"}</span>
                            <p className={`text-sm font-semibold ${good ? "text-zinc-200" : "text-zinc-600"}`}>{text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* CTAs */}
                  <div className="px-4 pb-3 flex-shrink-0">
                    <button
                      onClick={() => setSelectedStock(current)}
                      className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-black uppercase tracking-[0.08em] text-black shadow-[0_0_20px_rgba(249,115,22,0.28)]"
                    >
                      View Full Analysis →
                    </button>
                    <button
                      onClick={() => toggleWatchlist(current.symbol)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent py-3 text-sm font-black uppercase tracking-[0.08em] text-zinc-500"
                    >
                      {watchlist.includes(current.symbol) ? "✓ In Watchlist" : "Add to Watchlist ☆"}
                    </button>
                  </div>

                  {/* HT Decision */}
                  <div className="px-4 pb-4 flex-shrink-0">
                    <div className={`rounded-2xl border p-5 ${stance.bg}`}>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500 mb-1">HT Decision</p>
                      <p className={`text-3xl font-black ${stance.color}`}>{stance.label}</p>
                      <p className="mt-2 text-sm font-semibold text-zinc-300">{stance.desc}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-black/30 p-3">
                          <p className="text-[9px] font-black uppercase text-green-400">Target</p>
                          <p className="mt-1 font-mono text-lg font-black text-green-300">{exits.conservative}</p>
                        </div>
                        <div className="rounded-xl bg-black/30 p-3">
                          <p className="text-[9px] font-black uppercase text-red-400">Exit If</p>
                          <p className="mt-1 text-xs font-black text-red-300">Volume drops below normal</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Before The Crowd */}
                  <div className="px-4 pb-6 flex-shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300 mb-3">👁 What HT Is Watching</p>
                    <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
                      {emergingRadarCandidates.slice(0, 6).map(({ stock, radarScore }) => (
                        <button
                          key={stock.symbol}
                          onClick={() => setSelectedStock(stock)}
                          className="shrink-0 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.04] p-4 w-36"
                        >
                          <p className="font-mono text-xl font-black text-white">{stock.symbol}</p>
                          <p className={`mt-1 font-mono text-sm font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(1)}%
                          </p>
                          <p className="mt-1.5 text-[9px] font-black uppercase text-cyan-300">{radarScore}% conf</p>
                          <p className="mt-0.5 text-[9px] font-semibold text-zinc-500">Early watch</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Today's Battlefield */}
                  <div className="px-4 pb-24 flex-shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-300 mb-3">Today's Battlefield</p>
                    <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
                      {convictionLeaders.slice(0, 10).map((stock) => {
                        const pattern = detectPatternSignal(stock).name;
                        const emoji =
                          stock.change < 0 ? "📉" :
                          pattern === "Quiet Accumulation" ? "👀" :
                          pattern === "Crowd Ignition" ? "🔥" :
                          pattern === "Continuation Stack" ? "🌊" :
                          getHTScore(stock) >= 85 ? "🔥" : "⚡";
                        return (
                          <button
                            key={stock.symbol}
                            onClick={() => setSelectedStock(stock)}
                            className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.03] p-3 w-28"
                          >
                            <p className="font-mono text-base font-black text-white">{stock.symbol}</p>
                            <p className="mt-1 text-lg">{emoji}</p>
                            <p className={`mt-1 font-mono text-xs font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                              {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(1)}%
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
    </>
  );
}

export default function Home() {
  // build: v149-auth-stability-v120-behavior
  // V70 command center cleanup: live tape/search/auth first, top conviction as hero, capital and portfolio below, old marketing hero hidden.
  // v106 pre-market stabilization pass: preserve identity, polish nav/search spacing, compress support metrics, and keep market-open usability stable.
  // Frontend starts empty.
  // No fake/local starter board. Real display data must come from the live pipeline.
  const initialStocks: Stock[] = [];

  const [stocks, setStocks] = useState<Stock[]>(initialStocks);
  const [ticker, setTicker] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [scannerFilter, setScannerFilter] = useState<ScannerFilter>("all");
  const [marketSession, setMarketSession] = useState<
    "live" | "premarket" | "afterhours"
  >("live");
  const [news, setNews] = useState<Record<string, NewsItem[]>>({});
  const [newsIntel, setNewsIntel] = useState<Record<string, NewsIntel>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mobileCardIndex, setMobileCardIndex] = useState(0);

  // ATR cache — keyed by ticker symbol.
  // Only fetched when active top pick changes. Never refetched on 30s refresh.
  type ATRData = {
    atr14: number;
    support: number;
    resistance: number;
    volatility20d: number;
    fetchedAt: number; // timestamp for stale detection
  };
  const [atrCache, setAtrCache] = useState<Record<string, ATRData>>({});

  // Trade framework result — computed from ATR + engine data
  type TradeFramework = {
    uptideMin: number;   // % upside lower bound
    uptideMax: number;   // % upside upper bound
    riskZone: number;    // % downside
    rr: number;          // risk/reward ratio (upside mid / risk)
    confidence: "High" | "Moderate" | "Early" | "Speculative";
    horizon: string;     // "Multi-day", "1–3 days", "Intraday", "Event-driven"
    sentence: string;    // one-line explanation
    isLive: boolean;     // false when market is closed
  };
  const [smFramework, setSMFramework] = useState<TradeFramework | null>(null);
  const [btcFramework, setBTCFramework] = useState<TradeFramework | null>(null);

  // Morning Market Context
  type MarketContext = {
    spy: { price: number; change: number; rvol: number };
    qqq: { price: number; change: number; rvol: number };
    iwm: { price: number; change: number; rvol: number };
    vix: { price: number; change: number } | null;
    mood: string;
    moodColor: string;
    volumeEnv: string;
    avgRvol: number;
  };
  const [marketCtx, setMarketCtx] = useState<MarketContext | null>(null);

  // Decision Trace — computed alongside frameworks, shows engine reasoning
  type DecisionTrace = {
    opportunityScore: number;
    confidence: "High" | "Moderate" | "Early" | "Speculative";
    primaryDrivers: string[];
    rejectedAlternatives: { symbol: string; reason: string }[];
    candidatesEvaluated: number;
  };
  const [smTrace, setSMTrace] = useState<DecisionTrace | null>(null);
  const [btcTrace, setBTCTrace] = useState<DecisionTrace | null>(null);

  // HT Alert System
  type HTAlert = {
    id: string;
    ticker: string;
    type: "before_crowd" | "momentum" | "recovery" | "social";
    title: string;
    message: string;
    confidence: number;
    timestamp: Date;
    read: boolean;
  };
  const [alerts, setAlerts] = useState<HTAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const prevAlertTickers = useRef<Set<string>>(new Set());

  const generateAlerts = (currentStocks: Stock[]) => {
    if (!mounted || currentStocks.length === 0) return;
    const newAlerts: HTAlert[] = [];
    const now = new Date();

    for (const stock of currentStocks.slice(0, 20)) {
      const ticker = stock.symbol;
      const ht = getHTScore(stock);
      const rvol = getRelativeVolume(stock);
      const crowd = getBackgroundOpportunityEngine(stock).crowdSaturationScore;
      const pattern = detectPatternSignal(stock).name;
      const isDown = stock.change < 0;
      const recovery = getRecoveryScore(stock);

      // Skip exhaustion risk and excluded tickers
      if (pattern.includes("Exhaustion") || crowd >= 80) continue;

      const alertId = `btc-${ticker}`;
      const momId = `mom-${ticker}`;
      const recId = `rec-${ticker}`;

      // ── ALERT THRESHOLDS ─────────────────────────────
      // These are intentionally strict. The bell should mean something.
      // If it rings, the user should pay attention.

      // Before The Crowd — must be early AND strong
      // crowd < 40% (not crowded), rvol >= 3x (real unusual volume), ht >= 80
      if (!isDown && crowd < 40 && rvol >= 3 && ht >= 80 && !prevAlertTickers.current.has(alertId)) {
        newAlerts.push({
          id: `${alertId}-${now.getTime()}`,
          ticker,
          type: "before_crowd",
          title: `⚡ Before The Crowd — ${ticker}`,
          message: `${ticker} has ${rvol.toFixed(1)}x unusual volume and crowd saturation is only ${crowd}%. HT sees ${ht}% confidence — the crowd has not arrived yet.`,
          confidence: ht,
          timestamp: now,
          read: false,
        });
        prevAlertTickers.current.add(alertId);
      }
      // High Conviction — must be elite level
      // ht >= 90, rvol >= 2.5x, not exhaustion, not crowded
      else if (!isDown && ht >= 90 && rvol >= 2.5 && crowd < 65 && !pattern.includes("Exhaustion") && !prevAlertTickers.current.has(momId)) {
        newAlerts.push({
          id: `${momId}-${now.getTime()}`,
          ticker,
          type: "momentum",
          title: `🔥 Elite Conviction — ${ticker}`,
          message: `${ticker} reached ${ht}% HT confidence with ${rvol.toFixed(1)}x volume. This is a top-tier setup — ${getSimpleConvictionRead(stock).state}.`,
          confidence: ht,
          timestamp: now,
          read: false,
        });
        prevAlertTickers.current.add(momId);
      }
      // Recovery — must be strong signal, not just any dip
      // recovery >= 70, rvol >= 2x (volume confirming), ht >= 55
      else if (isDown && recovery >= 70 && rvol >= 2 && ht >= 55 && !prevAlertTickers.current.has(recId)) {
        newAlerts.push({
          id: `${recId}-${now.getTime()}`,
          ticker,
          type: "recovery",
          title: `📉 Recovery Confirmed — ${ticker}`,
          message: `${ticker} is down ${Math.abs(stock.change).toFixed(1)}% but volume at ${rvol.toFixed(1)}x suggests selling is exhausting. Recovery signals are strengthening.`,
          confidence: recovery,
          timestamp: now,
          read: false,
        });
        prevAlertTickers.current.add(recId);
      }

    }

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 20));
    }
  };
  const [mobileTouchStart, setMobileTouchStart] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<"home" | "convictions" | "scanner" | "watchlist" | "profile">("home");

  // Social Momentum Layer


  // Premarket Intelligence
  type PremarketMover = {
    symbol: string;
    price: number;
    extendedChangePercent: number;
    regularChangePercent: number;
    htPremarketScore: number;
    opportunityType: string;
    signal: string;
    whyItMatters: string;
    riskNote: string;
    sessionType: string;
  };
  const [premarketMovers, setPremarketMovers] = useState<PremarketMover[]>([]);
  const [premarketLoaded, setPremarketLoaded] = useState(false);
  const [marketStatus, setMarketStatus] = useState<string>("regular");

  const [sessionLabel, setSessionLabel] = useState("📋 Session Movers");

  const fetchPremarket = async () => {
    try {
      const res = await fetch("/api/premarket");
      if (!res.ok) return;
      const data = await res.json();
      if (data.movers?.length) setPremarketMovers(data.movers);
      if (data.marketStatus) setMarketStatus(data.marketStatus);
      if (data.sessionLabel) setSessionLabel(data.sessionLabel);
      setPremarketLoaded(true);
    } catch (e) {
      console.warn("Premarket fetch failed:", e);
    }
  };

  // Market Behavior Intelligence
  type DayStat = { day: string; signals: number; winRate: number; avgGain1d: number; avgGain3d: number };
  type MarketIntelligence = {
    insights: string[];
    totalSignals: number;
    dayStats: DayStat[];
    overallWinRate: number;
    patterns: { pattern: string; signals: number; winRate: number; avgGain: number }[];
  };
  const [marketIntel, setMarketIntel] = useState<MarketIntelligence | null>(null);
  const [marketIntelLoaded, setMarketIntelLoaded] = useState(false);

  const fetchMarketIntel = async (force = false) => {
    if (marketIntelLoaded && !force) return;
    try {
      const res = await fetch("/api/market-behavior?mode=patterns");
      if (!res.ok) return;
      const data = await res.json();
      setMarketIntel(data);
      setMarketIntelLoaded(true);
    } catch (e) {
      console.warn("Market intel fetch failed:", e);
    }
  };

  const logMarketBehaviorSignal = async (stock: Stock, socialScore = 0, crowdStage = 1) => {
    try {
      await fetch("/api/market-behavior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: stock.symbol,
          htScore: getHTScore(stock),
          momentumScore: getMomentumScore ? getMomentumScore(stock) : 0,
          volumeScore: Math.round(getRelativeVolume(stock) * 10),
          socialScore,
          crowdStage,
          signalState: getSimpleConvictionRead(stock).state,
          pattern: detectPatternSignal(stock).name,
          price: stock.price,
          userId: session?.user?.id ?? null,
        }),
      });
    } catch (e) {
      console.warn("Market behavior log failed:", e);
    }
  };

  // API Opportunity Intelligence
  type APIOpportunity = {
    ticker: string;
    price: number;
    change: number;
    opportunityType: string;
    opportunityScore: number;
    momentumScore: number;
    recoveryScore: number;
    attentionScore: number;
    riskScore: number;
    stage: string;
    stageEmoji: string;
    confidence: number;
    whyItMatters: string;
    whatChanged: string;
    riskNote: string;
    signals: string[];
    isBeforeCrowd: boolean;
    catalystScore?: number;
    catalystTags?: string[];
    relativeVolume?: number;
    crowdStage?: number;
    scannedAt?: string | null;
    freshnessLabel?: string;
    _convictionTier?: string;
    _isCatalyst?: boolean;
  };
  const [apiMomentum, setApiMomentum] = useState<APIOpportunity | null>(null);
  const [apiRecovery, setApiRecovery] = useState<APIOpportunity | null>(null);
  const [apiCatalyst, setApiCatalyst] = useState<APIOpportunity | null>(null);
  // Before The Crowd — backend-ranked list (top 5), same architecture as SM.
  // A list, not a single value, so we can pick the best BTC candidate that
  // ISN'T the same ticker SM already claimed (Dual Engine Confirmation logic).
  const [apiBeforeCrowdList, setApiBeforeCrowdList] = useState<APIOpportunity[]>([]);

  // Bull/Bear case state — generated when top conviction ticker changes
  type BullBearData = {
    ticker: string;
    onRadar: string;
    bullCase: string[];
    bearCase: string[];
    crowdFocus: string;
    htRead: string;
    newsCount: number;
    timestamp: string;
  };
  const [bullBearData, setBullBearData] = useState<BullBearData | null>(null);
  const [bullBearLoading, setBullBearLoading] = useState(false);
  const [bullBearTicker, setBullBearTicker] = useState<string>("");
  const [bullBearExpanded, setBullBearExpanded] = useState(false);

  const fetchAPIOpportunities = async () => {
    try {
      const [topRes, catalystRes, btcRes] = await Promise.all([
        fetch("/api/opportunities?limit=1"),
        fetch("/api/opportunities?type=catalyst&limit=3"),
        fetch("/api/opportunities?type=before_crowd&limit=5"),
      ]);

      // The backend/API owns signal eligibility, ranking, and top selection.
      // The frontend only displays the first verified opportunity returned.
      if (topRes.ok) {
        const data = await topRes.json();
        const topOpportunity = data.opportunities?.[0] ?? null;

        if (topOpportunity) {
          topOpportunity._convictionTier =
            topOpportunity.freshnessLabel === "Last Verified Signal"
              ? "Last Trading Session"
              : "Top Opportunity";
        }

        setApiMomentum(topOpportunity);
      } else {
        setApiMomentum(null);
      }

      // Recovery is no longer a homepage pillar.
      // Keep the state cleared so old local/recovery logic cannot hijack the UI.
      setApiRecovery(null);

      if (catalystRes.ok) {
        const data = await catalystRes.json();
        setApiCatalyst(data.opportunities?.[0] ?? null);
      } else {
        setApiCatalyst(null);
      }

      // Backend already ranks these by the before-the-crowd flavored score.
      // We keep the top 5 so the frontend can pick the best one that isn't
      // the same ticker SM claimed, without a second network round-trip.
      if (btcRes.ok) {
        const data = await btcRes.json();
        setApiBeforeCrowdList(data.opportunities ?? []);
      } else {
        setApiBeforeCrowdList([]);
      }
    } catch (e) {
      console.warn("API opportunities fetch failed:", e);
      setApiMomentum(null);
      setApiRecovery(null);
      setApiCatalyst(null);
      setApiBeforeCrowdList([]);
    }
  };



  // HT Change Log — tracks what changed between scans
  type ChangeLogEntry = {
    time: string;
    type: "state" | "score" | "pattern" | "crowd";
    message: string;
  };
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const prevConvictionState = useRef<{ symbol: string; state: string; htScore: number; pattern: string; crowdPhase: string } | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [searchStatus, setSearchStatus] = useState("Search any ticker to pull it into HT instantly.");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");
  const [signalMemoryInsight, setSignalMemoryInsight] = useState<SignalMemoryInsight | null>(null);
  const lastSignalMemoryKey = useRef("");
  const lastOutcomeEvaluationKey = useRef("");
  const [savedSetups, setSavedSetups] = useState<string[]>([]);
  const [traderMode, setTraderMode] = useState<
    "Scalper" | "Momentum" | "Swing" | "Conservative" | "Aggressive"
  >("Momentum");
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [viewedTickers, setViewedTickers] = useState<string[]>([]);
  const [deskPulseIndex, setDeskPulseIndex] = useState(0);
  const [terminalPulse, setTerminalPulse] = useState(0);
  const [expandedInsight, setExpandedInsight] = useState<string | null>("why-this-matters");
  const [hoveredInsight, setHoveredInsight] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<CommandMode>("command");
  const [capitalInput, setCapitalInput] = useState("500");
  const [allocationStyle, setAllocationStyle] = useState<AllocationStyle>("short");
  const [allocationRisk, setAllocationRisk] = useState<AllocationRisk>("moderate");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("beginner");
  const [cashInput, setCashInput] = useState("180");
  const [marketScanStats, setMarketScanStats] = useState<MarketScanStats>({
    scanned: marketUniverse.length,
    gainers: 0,
    losers: 0,
    highVolume: 0,
    lastFullScan: null,
  });
  const [lastSessionStats, setLastSessionStats] = useState<{ gainers: number; losers: number; highVolume: number } | null>(null);
  const [portfolioHoldings, setPortfolioHoldings] = useState<PortfolioHolding[]>([
    { id: "holding-1", symbol: "SNAL", amount: "120" },
    { id: "holding-2", symbol: "QUBT", amount: "80" },
    { id: "holding-3", symbol: "NVDA", amount: "120" },
  ]);

  const updatePortfolioHolding = (id: string, field: "symbol" | "amount", value: string) => {
    setPortfolioHoldings((current) =>
      current.map((holding) =>
        holding.id === id
          ? { ...holding, [field]: field === "symbol" ? value.toUpperCase() : value }
          : holding,
      ),
    );
  };

  const addPortfolioHolding = () => {
    setPortfolioHoldings((current) => [
      ...current,
      { id: `holding-${Date.now()}`, symbol: "", amount: "" },
    ]);
  };

  const removePortfolioHolding = (id: string) => {
    setPortfolioHoldings((current) => current.filter((holding) => holding.id !== id));
  };

  const defaultTickers = marketUniverse;

  const clampScore = (value: number, min = 0, max = 99) => {
    return Math.min(max, Math.max(min, Math.round(value)));
  };

  const marketBadges: MarketBadge[] = [
    { symbol: "SPY", label: "Broad Market", change: fallbackQuotes.SPY.change },
    {
      symbol: "QQQ",
      label: "Tech Strength",
      change: fallbackQuotes.QQQ.change,
    },
    { symbol: "DIA", label: "Blue Chips", change: fallbackQuotes.DIA.change },
  ];

  const getNewsArticles = (symbol: string) => {
    return newsIntel[symbol]?.articles || news[symbol] || [];
  };

  const getNewsVelocityScore = (stock: Stock) => {
    const intel = newsIntel[stock.symbol];

    if (intel?.newsVelocity) {
      return clampScore(intel.newsVelocity, 20, 95);
    }

    const articles = getNewsArticles(stock.symbol);

    if (articles.length >= 5) return 84;
    if (articles.length >= 3) return 72;
    if (articles.length >= 1) return 56;

    return stock.change >= 5 ? 42 : 28;
  };

  const getCatalystStrength = (stock: Stock) => {
    const intel = newsIntel[stock.symbol];
    const velocity = getNewsVelocityScore(stock);

    if (intel?.catalystStrength) return intel.catalystStrength;
    if (velocity >= 80) return "Narrative acceleration";
    if (velocity >= 65) return "Fresh catalyst activity";
    if (velocity >= 50) return "Light news activity";

    return "No fresh catalyst";
  };

  const getNarrativeSignal = (stock: Stock) => {
    const intel = newsIntel[stock.symbol];
    const topHeadline = getNewsArticles(stock.symbol)[0]?.headline;
    const velocity = getNewsVelocityScore(stock);

    if (intel?.narrativeSignal) return intel.narrativeSignal;
    if (velocity >= 80) return "Narrative pressure accelerating";
    if (topHeadline) return "Fresh headline detected";
    if (stock.change >= 4 && getRelativeVolume(stock) >= 2.5) return "Price moving before clear headline";

    return "Narrative still quiet";
  };

  const getNewsCatalystScore = (stock: Stock) => {
    const velocity = getNewsVelocityScore(stock);
    const articles = getNewsArticles(stock.symbol);
    const hasHeadline = Boolean(articles[0]?.headline);
    const rvol = getRelativeVolume(stock);

    let score = hasHeadline ? velocity : 34;

    if (articles.length >= 3) score += 6;
    if (stock.change >= 4 && rvol >= 2.5 && !hasHeadline) score += 10;
    if (stock.change < 0 && velocity < 55) score -= 6;

    return clampScore(score, 25, 95);
  };

  const getNewsTextBundle = (stock: Stock) => {
    return getNewsArticles(stock.symbol)
      .slice(0, 5)
      .map((article) => `${article.headline || ""} ${article.summary || ""}`)
      .join(" ")
      .toLowerCase();
  };

  const getNarrativeSentimentScore = (stock: Stock) => {
    const intel = newsIntel[stock.symbol];

    if (typeof intel?.sentimentScore === "number") {
      return clampScore(intel.sentimentScore, 20, 95);
    }

    const text = getNewsTextBundle(stock);
    const bullishWords = [
      "surge",
      "surges",
      "rally",
      "rallies",
      "beat",
      "beats",
      "raises",
      "upgrade",
      "growth",
      "record",
      "breakout",
      "strong",
      "profit",
      "partnership",
      "approval",
      "launch",
    ];
    const bearishWords = [
      "fall",
      "falls",
      "drop",
      "drops",
      "miss",
      "cuts",
      "downgrade",
      "loss",
      "probe",
      "lawsuit",
      "warning",
      "weak",
      "selloff",
      "slump",
      "risk",
      "concern",
    ];

    const bullishHits = bullishWords.filter((word) => text.includes(word)).length;
    const bearishHits = bearishWords.filter((word) => text.includes(word)).length;
    const rawScore = 55 + bullishHits * 7 - bearishHits * 8 + (stock.change >= 0 ? 4 : -4);

    return clampScore(rawScore, 20, 95);
  };

  const getNarrativeSentimentBias = (stock: Stock) => {
    const intel = newsIntel[stock.symbol];
    const score = getNarrativeSentimentScore(stock);

    if (intel?.sentimentBias) return intel.sentimentBias;
    if (score >= 75) return "Bullish narrative pressure";
    if (score >= 58) return "Constructive narrative";
    if (score <= 38) return "Bearish narrative pressure";
    if (score <= 48) return "Cautious narrative";

    return "Neutral narrative";
  };

  const getRetailHypeScore = (stock: Stock) => {
    const intel = newsIntel[stock.symbol];

    if (typeof intel?.hypeScore === "number") {
      return clampScore(intel.hypeScore, 20, 95);
    }

    const text = getNewsTextBundle(stock);
    const hypeWords = [
      "meme",
      "retail",
      "short squeeze",
      "squeeze",
      "reddit",
      "wallstreetbets",
      "stocktwits",
      "trending",
      "viral",
      "options",
      "unusual volume",
      "speculative",
      "crypto",
      "ai",
      "quantum",
    ];
    const hypeHits = hypeWords.filter((word) => text.includes(word)).length;
    const attention = getAttentionScore(stock);
    const rvol = getRelativeVolume(stock);

    return clampScore(35 + hypeHits * 9 + Math.min(22, rvol * 3) + attention * 0.18, 20, 95);
  };

  const tickerTape = useMemo(
    () =>
      stocks.length
        ? stocks.slice(0, 8)
        : defaultTickers
            .slice(0, 8)
            .map((symbol) => fallbackQuotes[symbol])
            .filter(Boolean),
    [stocks],
  );

  const hotStocks = useMemo(
    () => stocks.filter((stock) => Math.abs(stock.change) > 4),
    [stocks],
  );

  const bullishCount = useMemo(
    () => stocks.filter((stock) => stock.change >= 0).length,
    [stocks],
  );

  const bearishCount = Math.max(0, stocks.length - bullishCount);
  const topStock = stocks[0];

  const marketPulse = useMemo(() => {
    if (stocks.length === 0) return "Scanning";
    if (bullishCount > bearishCount + 2) return "Bullish";
    if (bearishCount > bullishCount + 2) return "Defensive";
    return "Mixed";
  }, [bearishCount, bullishCount, stocks.length]);

  const filteredStocks = useMemo(() => {
    if (scannerFilter === "hot") {
      return stocks.filter((stock) => Math.abs(stock.change) > 4);
    }

    if (scannerFilter === "bullish") {
      return stocks.filter((stock) => stock.change >= 0);
    }

    if (scannerFilter === "watchlist") {
      return stocks.filter((stock) => watchlist.includes(stock.symbol));
    }

    return stocks;
  }, [scannerFilter, stocks, watchlist]);

  const topGainers = useMemo(
    () =>
      [...stocks]
        .filter((stock) => stock.change > 0)
        .sort((a, b) => b.change - a.change)
        .slice(0, 3),
    [stocks],
  );

  const topLosers = useMemo(
    () =>
      [...stocks]
        .filter((stock) => stock.change < 0)
        .sort((a, b) => a.change - b.change)
        .slice(0, 3),
    [stocks],
  );

  const topMovers = useMemo(
    () =>
      [...stocks]
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 5),
    [stocks],
  );

  const getMomentumScore = (stock: Stock) => {
    const isBullish = stock.change >= 0;

    return Math.min(
      99,
      Math.max(
        52,
        Math.round(60 + Math.abs(stock.change) * 6 + (isBullish ? 8 : -2)),
      ),
    );
  };

  // RECOVERY OPPORTUNITY ENGINE
  const getRecoveryScore = (stock: Stock) => {
    const move = stock.change;
    const rvol = getRelativeVolume(stock);
    const trapRisk = getTrapRiskScore(stock);
    const htScore = getHTScore(stock);
    const attention = getAttentionScore(stock);

    // Recovery candidates: stocks that dropped but are showing stabilization signs
    if (move >= 0) return 0; // Not a recovery candidate if up on the day

    const dropDepth = Math.abs(move);
    const sellingExhaustion = dropDepth >= 3 && dropDepth <= 25 ? Math.min(40, dropDepth * 2) : 0;
    const volumeStabilizing = rvol >= 1.5 && rvol < 4 ? 20 : 0; // High but not panic volume
    const sentimentImproving = attention >= 55 ? 15 : 0;
    const trapLow = trapRisk < 50 ? 15 : 0;
    const htSignal = htScore >= 60 ? 10 : 0;

    return Math.min(99, Math.max(0, Math.round(sellingExhaustion + volumeStabilizing + sentimentImproving + trapLow + htSignal)));
  };

  const getRecoveryStage = (stock: Stock): { stage: string; emoji: string; desc: string } => {
    const score = getRecoveryScore(stock);
    const move = stock.change;
    const rvol = getRelativeVolume(stock);

    if (score === 0) return { stage: "Not a Recovery", emoji: "—", desc: "Price is not in recovery territory." };
    if (score >= 80) return { stage: "Recovery Confirmed", emoji: "✅", desc: "Multiple signals confirm recovery is underway." };
    if (score >= 65) return { stage: "Recovery Beginning", emoji: "🌱", desc: "Early signs of stabilization are forming." };
    if (score >= 45) return { stage: "Stabilizing", emoji: "⚖️", desc: "Selling pressure is slowing. Watch for confirmation." };
    if (score >= 25) return { stage: "Capitulation", emoji: "📉", desc: "Heavy selling. Potential exhaustion forming." };
    return { stage: "Still Falling", emoji: "🔻", desc: "No stabilization signals detected yet." };
  };

  const getRecoveryWhy = (stock: Stock): string => {
    const move = stock.change;
    const rvol = getRelativeVolume(stock);
    const score = getRecoveryScore(stock);
    const attention = getAttentionScore(stock);

    const parts: string[] = [];
    if (Math.abs(move) >= 5) parts.push(`Stock is down ${Math.abs(move).toFixed(1)}% today.`);
    if (rvol >= 2 && rvol < 5) parts.push(`Volume is ${rvol.toFixed(1)}x normal — selling may be exhausting.`);
    if (attention >= 65) parts.push(`Attention is increasing as traders watch the level.`);
    if (score >= 60) parts.push(`Recovery signals are strengthening.`);
    if (getTrapRiskScore(stock) < 40) parts.push(`Low trap risk suggests the dip may be buyable.`);
    if (parts.length === 0) parts.push(`Early recovery signals detected. Watching for confirmation.`);
    return parts.join(" ");
  };

  // MOMENTUM OPPORTUNITY ENGINE
  const getMomentumStage = (stock: Stock): { stage: string; emoji: string; desc: string } => {
    const ht = getHTScore(stock);
    const rvol = getRelativeVolume(stock);
    const move = stock.change;
    const crowd = getBackgroundOpportunityEngine(stock).crowdSaturationScore;

    if (move < 0) return { stage: "Not Momentum", emoji: "—", desc: "Price is not in momentum territory." };
    if (crowd >= 80 || move >= 20) return { stage: "Exhaustion Risk", emoji: "⚠️", desc: "Move is extended. Late entry risk is high." };
    if (crowd >= 65) return { stage: "Crowd Arrival", emoji: "🔥", desc: "Crowd is arriving. Edge is narrowing." };
    if (rvol >= 3 && ht >= 80) return { stage: "Acceleration", emoji: "⚡", desc: "Volume and price are accelerating together." };
    if (rvol >= 2 && ht >= 65) return { stage: "Discovery", emoji: "👀", desc: "Early attention forming before broad crowd arrives." };
    return { stage: "Early Watch", emoji: "🌱", desc: "Momentum forming. Not yet confirmed." };
  };

  const getMomentumWhy = (stock: Stock): string => {
    const rvol = getRelativeVolume(stock);
    const ht = getHTScore(stock);
    const move = stock.change;
    const attention = getAttentionScore(stock);
    const parts: string[] = [];
    if (rvol >= 2) parts.push(`Volume is ${rvol.toFixed(1)}x average.`);
    if (move >= 3) parts.push(`Price is up ${move.toFixed(1)}% with structure intact.`);
    if (attention >= 75) parts.push(`Market attention remains elevated.`);
    if (ht >= 85) parts.push(`HT confidence is ${ht}% — momentum continues to accelerate.`);
    if (parts.length === 0) parts.push(`Momentum is building. Volume and price are aligned.`);
    return parts.join(" ");
  };

  // FIND BEST MOMENTUM + RECOVERY CANDIDATES
  const getRiskLabel = (stock: Stock) => {
    const move = Math.abs(stock.change);

    if (move >= 10) return "Extreme Volatility";
    if (move >= 5) return "High Attention Spike";
    if (move >= 2) return "Active";
    return "Normal";
  };

  const getRelativeVolume = (stock: Stock) => {
    // Priority 1: Use pre-computed relativeVolume from ht_signals (Polygon data)
    if (stock.relativeVolume && stock.relativeVolume > 0) {
      return Number(Math.min(10, Math.max(0.1, stock.relativeVolume)).toFixed(1));
    }

    // Priority 2: Compute from raw volume if available
    if (stock.volume && stock.volume > 0 && stock.prevVolume && stock.prevVolume > 0) {
      const rvol = stock.volume / stock.prevVolume;
      return Number(Math.min(10, Math.max(0.1, rvol)).toFixed(1));
    }

    // Priority 3: Estimate from price change (last resort — no Polygon data available)
    const move = Math.abs(stock.change);
    return Number(Math.max(0.8, 1 + move / 3).toFixed(1));
  };

  const getGapSignal = (stock: Stock) => {
    const change = stock.change;

    if (change >= 10) return "Major Gap Up";
    if (change >= 4) return "Gap Up";
    if (change <= -6) return "Gap Down";
    if (change < 0) return "Soft Open";

    return "Flat / Building";
  };

  const getVolumeAcceleration = (stock: Stock) => {
    const rvol = getRelativeVolume(stock);

    if (rvol >= 5) return "Explosive";
    if (rvol >= 3) return "Accelerating";
    if (rvol >= 1.5) return "Active";

    return "Normal";
  };

  const getAttentionScore = (stock: Stock) => {
    // Use Polygon-backed crowdScore from ht_signals when available
    if (stock.crowdScore && stock.crowdScore > 0) {
      const isSaved = watchlist.includes(stock.symbol) || savedSetups.includes(stock.symbol);
      const catalystBoost = (stock.catalystScore ?? 0) >= 20 ? 10 : 0;
      return Math.min(99, Math.max(35, Math.round(stock.crowdScore + (isSaved ? 5 : 0) + catalystBoost)));
    }

    // Fallback: compute from price/volume when ht_signals not available
    const rvol = getRelativeVolume(stock);
    const move = Math.abs(stock.change);
    const hasNews = Boolean(getNewsArticles(stock.symbol)[0]?.headline);
    const newsVelocity = getNewsVelocityScore(stock);
    const isSaved = watchlist.includes(stock.symbol) || savedSetups.includes(stock.symbol);

    let score = 45;
    score += Math.min(24, move * 2);
    score += Math.min(18, rvol * 3);
    if (hasNews) score += 8;
    if (newsVelocity >= 75) score += 7;
    if (newsVelocity >= 60) score += 4;
    if (isSaved) score += 5;

    return Math.min(99, Math.max(35, Math.round(score)));
  };

  const getAttentionTrend = (stock: Stock) => {
    const score = getAttentionScore(stock);

    if (score >= 90) return "Momentum Expanding";
    if (score >= 80) return "Accelerating";
    if (score >= 68) return "Building";
    if (stock.change < 0) return "Fading";

    return "Watching";
  };

  const getNotificationTrigger = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const rvol = getRelativeVolume(stock);

    if (attention >= 90 && signal >= 85)
      return "Push-worthy: attention + signal quality aligned.";
    if (attention >= 80 && rvol >= 3)
      return "Notify watchlist users if momentum holds.";
    if (signal >= 85)
      return "High-quality pressure pocket forming; monitor for the breakout trigger before the crowd piles in.";
    if (stock.change < 0) return "No push. Wait for reclaim confirmation.";

    return "Monitor only. HT has not detected a crowd-pressure shift worth alerting yet.";
  };

  const getUrgencyLevel = (stock: Stock) => {
    const attention = getAttentionScore(stock);

    if (attention >= 90) return "Immediate";
    if (attention >= 80) return "High";
    if (attention >= 68) return "Medium";

    return "Low";
  };

  const attentionLeaders = useMemo(() => {
    return [...stocks]
      .sort((a, b) => getAttentionScore(b) - getAttentionScore(a))
      .slice(0, 6);
  }, [stocks, news, watchlist, savedSetups]);

  const getSignalQuality = (stock: Stock) => {
    const setupScore = getSetupScore(stock);
    const rvol = getRelativeVolume(stock);
    const hasNews = Boolean(getNewsArticles(stock.symbol)[0]?.headline);

    let quality = setupScore;

    if (rvol >= 3) quality += 5;
    if (hasNews) quality += 4;
    if (Math.abs(stock.change) >= 10) quality -= 3;

    return Math.min(99, Math.max(40, quality));
  };

  const getSignalGrade = (stock: Stock) => {
    const quality = getSignalQuality(stock);

    if (quality >= 90) return "Elite";
    if (quality >= 82) return "Strong";
    if (quality >= 72) return "Tradable";
    if (quality >= 62) return "Developing";

    return "Weak";
  };

  const getPremarketBias = (stock: Stock) => {
    const quality = getSignalQuality(stock);

    if (stock.change >= 6 && quality >= 80)
      return "Gap-and-go candidate if volume holds.";
    if (stock.change >= 3) return "Needs opening range confirmation.";
    if (stock.change < 0)
      return "Watch for reclaim before considering long bias.";

    return "Wait for volume confirmation after open.";
  };

  const getConfidence = (stock: Stock) => {
    const base = getMomentumScore(stock);
    const momentumBonus = stock.change >= 0 ? 3 : -4;

    return Math.min(98, Math.max(45, base + momentumBonus));
  };

  const getSetupScore = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const confidence = getConfidence(stock);

    let score = 48;

    if (move >= 1) score += 5;
    if (move >= 2) score += 7;
    if (move >= 4) score += 10;
    if (move >= 8) score += 12;
    if (move >= 15) score += 8;

    if (stock.change > 0) score += 6;
    if (confidence >= 80) score += 6;
    if (getNewsArticles(stock.symbol)[0]?.headline) score += 5;

    return Math.min(99, Math.max(35, score));
  };

  const getMomentumConfidence = (score: number) => {
    if (score >= 90) return "EXTREME";
    if (score >= 82) return "HIGH";
    if (score >= 72) return "ELEVATED";
    if (score >= 60) return "MODERATE";

    return "LOW";
  };

  const getRiskProfile = (stock: Stock) => {
    const move = Math.abs(stock.change);

    if (move >= 15) return "VERY AGGRESSIVE";
    if (move >= 8) return "HIGH RISK";
    if (move >= 4) return "MODERATE";
    if (stock.change < 0) return "DEFENSIVE";

    return "CONTROLLED";
  };

  const getCrowdStrength = (stock: Stock) => {
    const move = Math.abs(stock.change);

    if (stock.symbol === "SNAL" || move >= 15) return "PARABOLIC";
    if (stock.symbol === "QUBT" || move >= 8) return "ACCELERATING";
    if (move >= 4) return "ACTIVE";

    return "EARLY";
  };

  const getAIBias = (stock: Stock) => {
    if (stock.change >= 10) {
      return "Bullish pressure is extended. HT wants proof that participation can absorb profit-taking before chasing.";
    }

    if (stock.change >= 4) {
      return "Crowd pressure is building, but continuation only matters if participation expands with the move.";
    }

    if (stock.change < 0) {
      return "Weak structure. HT needs reclaim strength before calling crowd pressure back into the name.";
    }

    return "Pre-signal watch. HT needs attention, participation, or catalyst pressure before calling it early.";
  };

  const getSetupGrade = (score: number) => {
    if (score >= 92) return "A+";
    if (score >= 85) return "A";
    if (score >= 78) return "B+";
    if (score >= 70) return "B";
    if (score >= 60) return "C+";

    return "C";
  };

  const getAlertLevel = (stock: Stock) => {
    const score = getSetupScore(stock);
    const move = Math.abs(stock.change);

    if (score >= 90 || move >= 15) return "Priority";
    if (score >= 82 || move >= 8) return "High";
    if (score >= 72 || move >= 4) return "Watch";

    return "Monitor";
  };

  const getAlertMessage = (stock: Stock) => {
    const score = getSetupScore(stock);
    const topNews = getNewsArticles(stock.symbol)[0];

    if (topNews?.headline && score >= 82) {
      return `${stock.symbol} has a strong pressure score with fresh catalyst activity. Wait for participation quality to confirm continuation.`;
    }

    if (stock.change >= 8) {
      return `${stock.symbol} is showing aggressive momentum. Avoid chasing vertical candles; wait for reclaim or pullback.`;
    }

    if (stock.change >= 4) {
      return `${stock.symbol} momentum is building above scanner threshold. Track participation quality, higher-low structure, and whether crowd pressure keeps expanding.`;
    }

    if (stock.change < 0) {
      return `${stock.symbol} is weak today. Alert remains defensive until reclaim confirmation.`;
    }

    return `${stock.symbol} is on monitor status. No major momentum trigger yet.`;
  };

  const getScoreTrend = (stock: Stock) => {
    const score = getSetupScore(stock);

    if (score >= 85) return "Upgraded";
    if (score >= 72) return "Improving";
    if (stock.change < 0) return "Downgraded";

    return "Stable";
  };

  const alertFeed = useMemo(() => {
    return [...stocks]
      .sort((a, b) => getSetupScore(b) - getSetupScore(a))
      .slice(0, 6)
      .map((stock, index) => ({
        symbol: stock.symbol,
        level: getAlertLevel(stock),
        message: getAlertMessage(stock),
        score: getSetupScore(stock),
        grade: getSetupGrade(getSetupScore(stock)),
        trend: getScoreTrend(stock),
        time: index === 0 ? "Now" : `${index * 3}m ago`,
      }));
  }, [stocks, news]);

  const signalLeaders = useMemo(() => {
    return [...stocks]
      .sort((a, b) => getSignalQuality(b) - getSignalQuality(a))
      .slice(0, 6);
  }, [stocks, news]);

  const getDailyMarketMood = () => {
    if (marketPulse === "Bullish" && attentionLeaders[0]?.change >= 4) {
      return "Attention Spike Risk-On";
    }

    if (marketPulse === "Defensive") {
      return "Defensive Tape";
    }

    if (hotStocks.length >= 3) {
      return "Selective Attention Spike";
    }

    return "Mixed / Wait For Confirmation";
  };

  const getDailyFocus = () => {
    const leader = attentionLeaders[0] || signalLeaders[0] || topStock;

    if (!leader) return "Scanner warming up. Wait for live quotes.";

    if (getAttentionScore(leader) >= 85) {
      return `${leader.symbol} is the current focus: attention, movement, and signal quality are leading the board.`;
    }

    if (getSignalQuality(leader) >= 80) {
      return `${leader.symbol} has the cleanest signal quality. Watch confirmation before chasing.`;
    }

    return `${leader.symbol} is leading the tape, but confirmation still matters.`;
  };

  const getDailyRiskEnvironment = () => {
    const extendedNames = stocks.filter(
      (stock) => Math.abs(stock.change) >= 8,
    ).length;

    if (extendedNames >= 3)
      return "High chase risk. Focus on pullbacks, reclaims, and smaller size.";
    if (bearishCount > bullishCount)
      return "Defensive conditions. Avoid forcing longs until reclaim strength appears.";
    if (hotStocks.length > 0)
      return "Attention Spike active. Respect volatility and avoid vertical candle entries.";

    return "Normal risk. Wait for signal quality and volume confirmation.";
  };

  const dailyBriefing = useMemo(() => {
    const focus = attentionLeaders[0] || signalLeaders[0] || topStock;
    const strongest = signalLeaders[0];
    const weakest = topLosers[0];

    return {
      mood: getDailyMarketMood(),
      focus: getDailyFocus(),
      risk: getDailyRiskEnvironment(),
      strongestSymbol: strongest?.symbol || "--",
      strongestScore: strongest ? getSignalQuality(strongest) : 0,
      attentionSymbol: focus?.symbol || "--",
      attentionScore: focus ? getAttentionScore(focus) : 0,
      weakestSymbol: weakest?.symbol || "--",
      watchlistCount: watchlist.length,
      savedCount: savedSetups.length,
    };
  }, [
    stocks,
    news,
    watchlist,
    savedSetups,
    marketPulse,
    bullishCount,
    bearishCount,
  ]);

  const dailyActionItems = useMemo(() => {
    const leader = attentionLeaders[0] || signalLeaders[0];

    return [
      leader
        ? `Watch ${leader.symbol} first. Attention score ${getAttentionScore(leader)} with ${getSignalQuality(leader)}/99 signal quality.`
        : "Wait for scanner data to populate.",
      hotStocks.length
        ? "Do not chase extended names. Let pullbacks or reclaim levels form first."
        : "No major hot-mover cluster yet. Wait for attention expansion.",
      watchlist.length
        ? "Check saved watchlist names for alert upgrades before scanning random tickers."
        : "Add 3-5 tickers to your watchlist to unlock a better daily workflow.",
    ];
  }, [stocks, news, watchlist, savedSetups]);

  const getTraderMemoryProfile = () => {
    if (traderMode === "Scalper") {
      return "Fast reaction trader focused on liquidity and quick continuation.";
    }

    if (traderMode === "Swing") {
      return "Prefers cleaner continuation structure and multi-day patience.";
    }

    if (traderMode === "Conservative") {
      return "Risk-managed workflow prioritizing confirmation over speed.";
    }

    if (traderMode === "Aggressive") {
      return "High-volatility tolerance with earlier speculative positioning.";
    }

    return "Attention Spike-focused trader seeking attention and continuation setups.";
  };

  const getTraderPatternInsight = () => {
    if (watchlist.length >= 5 && savedSetups.length >= 3) {
      return "Your workflow is evolving into a structured high-conviction process.";
    }

    if (viewedTickers.length >= 5) {
      return "You frequently revisit momentum leaders before breakout expansion.";
    }

    if (dismissedAlerts.length >= 3) {
      return "AI noticed you avoid weaker continuation setups.";
    }

    return "Continue interacting with setups so HT Labs can sharpen recommendations.";
  };

  const getAdaptiveRecommendation = () => {
    const leader = attentionLeaders[0];

    if (!leader) {
      return "Scanner waiting for live market movement.";
    }

    if (traderMode === "Conservative") {
      return `Wait for ${leader.symbol} confirmation instead of chasing current extension.`;
    }

    if (traderMode === "Aggressive") {
      return `${leader.symbol} fits aggressive momentum conditions. Volatility remains elevated.`;
    }

    if (traderMode === "Swing") {
      return `Focus on structure quality and continuation potential around ${leader.symbol}.`;
    }

    return `${leader.symbol} currently aligns best with your active trader profile.`;
  };

  const traderModes = [
    "Scalper",
    "Momentum",
    "Swing",
    "Conservative",
    "Aggressive",
  ] as const;

  const getTraderModeDescription = () => {
    switch (traderMode) {
      case "Scalper":
        return "Fast execution focus with tighter momentum thresholds and intraday reaction alerts.";
      case "Momentum":
        return "Prioritizing explosive movement, attention flow, and continuation setups.";
      case "Swing":
        return "Cleaner continuation setups with stronger structure and patience.";
      case "Conservative":
        return "Lower-risk positioning with stronger confirmation requirements.";
      case "Aggressive":
        return "Higher volatility tolerance with earlier setup detection.";
    }
  };

  const getAdaptiveRiskTone = () => {
    switch (traderMode) {
      case "Scalper":
        return "Avoid hesitation. Focus on liquidity and reaction speed.";
      case "Momentum":
        return "Attention Spike strongest when attention and signal quality align.";
      case "Swing":
        return "Wait for confirmation and avoid emotional entries.";
      case "Conservative":
        return "Capital preservation comes first. Avoid extended names.";
      case "Aggressive":
        return "High volatility accepted. Risk management still matters.";
    }
  };

  const getPersonalizedSetupBias = (stock: Stock) => {
    const signal = getSignalQuality(stock);

    if (traderMode === "Scalper") {
      return signal >= 75
        ? "Fast intraday setup with strong reaction potential."
        : "Needs stronger liquidity and intraday confirmation.";
    }

    if (traderMode === "Swing") {
      return signal >= 82
        ? "Swing pressure structure is tightening beneath rising attention."
        : "Wait for cleaner multi-day confirmation.";
    }

    if (traderMode === "Conservative") {
      return signal >= 88
        ? "High-quality setup with better risk structure."
        : "Too much uncertainty for conservative mode.";
    }

    if (traderMode === "Aggressive") {
      return "High-volatility opportunity detected. Manage risk aggressively.";
    }

    return "Attention Spike conditions are improving with trader attention.";
  };

  const getConvictionScore = (stock: Stock) => {
    const signal = getSignalQuality(stock);
    const attention = getAttentionScore(stock);
    const setup = getSetupScore(stock);
    const rvol = getRelativeVolume(stock);
    const hasNews = Boolean(getNewsArticles(stock.symbol)[0]?.headline);

    let conviction = Math.round(
      signal * 0.42 + attention * 0.34 + setup * 0.24,
    );

    if (hasNews) conviction += 4;
    if (rvol >= 3) conviction += 3;
    if (Math.abs(stock.change) >= 12)
      conviction -= traderMode === "Aggressive" ? 2 : 7;
    if (traderMode === "Conservative" && getRiskProfile(stock).includes("HIGH"))
      conviction -= 8;
    if (traderMode === "Aggressive" && attention >= 80) conviction += 4;
    if (traderMode === "Swing" && signal >= 82) conviction += 3;

    return Math.min(99, Math.max(35, conviction));
  };

  const getConvictionLabel = (stock: Stock) => {
    const conviction = getConvictionScore(stock);

    if (conviction >= 90) return "Top Read";
    if (conviction >= 82) return "Pressure Building";
    if (conviction >= 72) return "Developing";
    if (conviction >= 62) return "Low Conviction";

    return "Avoid / Wait";
  };

  const getConvictionReason = (stock: Stock) => {
    const conviction = getConvictionScore(stock);
    const signal = getSignalQuality(stock);
    const attention = getAttentionScore(stock);

    if (conviction >= 90) {
      return `${stock.symbol} has strong alignment between signal quality, attention, pressure score, and trader profile.`;
    }

    if (signal >= 85 && attention < 75) {
      return `${stock.symbol} has quality structure, but attention is not fully confirming yet.`;
    }

    if (attention >= 85 && signal < 75) {
      return `${stock.symbol} has crowd attention, but setup quality needs confirmation.`;
    }

    if (Math.abs(stock.change) >= 10) {
      return `${stock.symbol} is moving aggressively, but extension risk reduces clean conviction.`;
    }

    if (stock.change < 0) {
      return `${stock.symbol} remains defensive until reclaim confirmation improves.`;
    }

    return `${stock.symbol} is still developing. Wait for stronger confirmation before treating it as priority.`;
  };

  const getDecisionClarity = (stock: Stock) => {
    const conviction = getConvictionScore(stock);

    if (conviction >= 90) return "Focus";
    if (conviction >= 82) return "Watch Closely";
    if (conviction >= 72) return "Wait For Confirmation";
    if (conviction >= 62) return "Ignore Noise";

    return "Stand Down";
  };

  const highBetaMomentumPockets = [
    "RGTI",
    "QBTS",
    "LUNR",
    "RKLB",
    "IONQ",
    "IOVA",
    "ACHR",
    "SOUN",
    "ASTS",
    "COIN",
    "MSTR",
    "HOOD",
    "BBAI",
    "AI",
    "SERV",
    "JOBY",
    "OPEN",
    "RIOT",
    "MARA",
  ];

  const getMomentumFreshnessScore = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const isStarterName = defaultStarterTickers.includes(stock.symbol);
    const freshDiscoveryBoost = isStarterName ? 0 : 8;
    const quietPressureBoost = rvol >= 2.5 && move < 8 ? 6 : 0;
    const socialWatchBoost = attention >= 78 && move < 12 ? 4 : 0;
    const stalePenalty = isStarterName && move < 4 && attention < 72 ? 7 : 0;

    return Math.max(
      0,
      Math.round(freshDiscoveryBoost + quietPressureBoost + socialWatchBoost - stalePenalty),
    );
  };

  const getParticipationScore = (stock: Stock) => {
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const move = Math.abs(stock.change);
    const hasFreshNews = Boolean(getNewsArticles(stock.symbol)[0]?.headline);

    return Math.min(
      99,
      Math.max(
        35,
        Math.round(attention * 0.42 + Math.min(35, rvol * 7) + Math.min(18, move * 1.25) + (hasFreshNews ? 6 : 0)),
      ),
    );
  };

  const getContinuationStrengthScore = (stock: Stock) => {
    const signal = getSignalQuality(stock);
    const participation = getParticipationScore(stock);
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const isTooExtended = move >= 18 || (move >= 12 && rvol < 3);
    const structurePenalty = stock.change < 0 ? 12 : isTooExtended ? 9 : 0;

    return Math.min(
      99,
      Math.max(
        35,
        Math.round(signal * 0.45 + participation * 0.35 + Math.min(20, rvol * 3.5) - structurePenalty),
      ),
    );
  };

  type PatternSignalName =
    | "Pressure Coil"
    | "Quiet Accumulation"
    | "Crowd Ignition"
    | "Continuation Stack"
    | "Exhaustion Risk"
    | "Reclaim Setup"
    | "No Clean Pattern";

  type PatternSignal = {
    name: PatternSignalName;
    score: number;
    summary: string;
    bias: string;
  };

  type ContenderStatus =
    | "Confirmed Contender"
    | "Developing Contender"
    | "Pattern Detected / Needs Proof"
    | "Rejected: Trap Risk"
    | "Rejected: Weak Confirmation"
    | "Rejected: No Clean Pattern";

  type ContenderConfirmation = {
    status: ContenderStatus;
    score: number;
    passed: boolean;
    reason: string;
  };

  type TrapRiskLabel = "Healthy Momentum" | "Extended" | "High Trap Risk";
  type QualityGateLabel = "Pass" | "Caution" | "Reject";

  type MomentumFingerprint = {
    label: string;
    pattern: PatternSignalName;
    attention: number;
    signalQuality: number;
    participation: number;
    continuation: number;
    entryQuality: number;
    trapRisk: number;
    rvol: number;
    newsVelocity: number;
    move: number;
    weight: number;
  };

  type FingerprintMatch = {
    score: number;
    bestMatch: string;
    matchQuality: "Strong Historical Match" | "Moderate Historical Match" | "Weak Historical Match";
    reason: string;
  };

  type DiscoveryPhase =
    | "Pre-Crowd Discovery"
    | "Early Momentum"
    | "Known Mover"
    | "Late / Crowded"
    | "No Discovery Edge";

  type DiscoverySignal = {
    score: number;
    phase: DiscoveryPhase;
    early: boolean;
    reason: string;
  };

  type MomentumBaseline = {
    symbol: string;
    attention: number;
    participation: number;
    continuation: number;
    discovery: number;
    newsVelocity: number;
    rvol: number;
    observed: string;
  };

  type MomentumAccelerationSignal = {
    score: number;
    label:
      | "Accelerating Fast"
      | "Acceleration Building"
      | "Stable Momentum"
      | "Fading / Late"
      | "No Acceleration Edge";
    direction: "up" | "flat" | "down";
    reason: string;
  };


  type SignalMemoryStatus = "tracking" | "watching" | "winner" | "strong_winner" | "neutral" | "failed" | "failed_momentum" | "fake_momentum" | "trap";

  type OutcomeStatus = "tracking" | "strong_winner" | "winner" | "neutral" | "failed" | "failed_momentum" | "fake_momentum" | "trap";

  type SignalMemoryRow = {
    id: string;
    symbol: string;
    entry_price: number | null;
    picked_at: string | null;
    discovery_score: number | null;
    acceleration_score: number | null;
    crowd_saturation_score: number | null;
    opportunity_window: OpportunityWindow | string | null;
    status: SignalMemoryStatus | string | null;
    outcome_status: OutcomeStatus | string | null;
    max_gain: number | null;
    max_drawdown: number | null;
    price_1d: number | null;
    price_3d: number | null;
    price_5d: number | null;
  };

  type SignalMemoryInsight = {
    tracked: number;
    winners: number;
    failures: number;
    traps: number;
    tracking: number;
    successRate: number | null;
    confidenceStatus: "Developing" | "Active" | "Proving";
    confidenceLabel: string;
    winnerDNA: string;
    failureDNA: string;
    summary: string;
  };

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
    opportunity_window: OpportunityWindow;
    opportunity_window_open: boolean;
    pattern: PatternSignalName;
    contender_status: ContenderStatus;
    quality_gate: QualityGateLabel;
    trap_risk: number;
    entry_quality: number;
    participation: number;
    continuation: number;
    consumer_label: BackgroundOpportunityEngine["consumerLabel"];
    discovery_read: string;
    internal_reason: string;
    status: SignalMemoryStatus;
  };



  type CrowdSaturationLevel =
    | "Low Saturation"
    | "Building Crowd"
    | "Elevated Crowd"
    | "Crowd Arrived"
    | "Exhausted Crowd";

  type CrowdSaturationSignal = {
    score: number;
    level: CrowdSaturationLevel;
    crowded: boolean;
    reason: string;
  };

  type OpportunityWindow =
    | "EARLY WINDOW OPEN"
    | "EARLY WINDOW BUILDING"
    | "CONFIRMATION PHASE"
    | "CROWD ARRIVED"
    | "EXHAUSTION RISK";

  type OpportunityWindowSignal = {
    window: OpportunityWindow;
    scoreImpact: number;
    open: boolean;
    reason: string;
  };

  type BackgroundOpportunityEngine = {
    symbol: string;
    finalScore: number;
    pattern: PatternSignalName;
    patternScore: number;
    contenderStatus: ContenderStatus;
    contenderScore: number;
    fingerprintScore: number;
    fingerprintMatch: string;
    fingerprintQuality: FingerprintMatch["matchQuality"];
    discoveryScore: number;
    discoveryPhase: DiscoveryPhase;
    accelerationScore: number;
    accelerationLabel: MomentumAccelerationSignal["label"];
    accelerationDirection: MomentumAccelerationSignal["direction"];
    crowdSaturationScore: number;
    crowdSaturationLevel: CrowdSaturationLevel;
    opportunityWindow: OpportunityWindow;
    opportunityWindowOpen: boolean;
    tooLate: boolean;
    tooLateReason: string;
    trapRisk: number;
    entryQuality: number;
    participation: number;
    continuation: number;
    qualityGate: QualityGateLabel;
    consumerLabel: "Top Conviction" | "Strong Watch" | "Developing" | "Trap Filtered" | "Monitor Only";
    consumerReason: string;
    internalReason: string;
  };

  type EmergingRadarCandidate = {
    stock: Stock;
    engine: BackgroundOpportunityEngine;
    radarScore: number;
    status: "Needs Review" | "Early Watch" | "Building Fast";
    reason: string;
  };

  type ScoreContribution = {
    label: string;
    score: number;
    weight: number;
    contribution: number;
  };

  type PressureStack = {
    symbol: string;
    priceMomentum: number;
    relativeVolume: number;
    volumeVelocity: number;
    attentionAcceleration: number;
    newsCatalyst: number;
    newsVelocity: number;
    catalystStrength: string;
    narrativeSignal: string;
    sentimentBias: string;
    sentimentScore: number;
    hypeScore: number;
    patternSignal: PatternSignalName;
    patternScore: number;
    patternSummary: string;
    patternBias: string;
    trapRiskScore: number;
    trapRiskLabel: TrapRiskLabel;
    entryQualityScore: number;
    qualityGate: QualityGateLabel;
    opportunityScore: number;
    scoreBreakdown: ScoreContribution[];
    participationQuality: number;
    continuationStrength: number;
    extensionRisk: number;
    riskRewardQuality: number;
    convictionScore: number;
    convictionLabel: string;
    behavioralState: string;
    behavioralSummary: string;
    warnings: string[];
  };

  const getExtensionRiskScore = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);

    let risk = 20;

    if (move >= 3) risk += 12;
    if (move >= 6) risk += 14;
    if (move >= 10) risk += 18;
    if (move >= 15) risk += 20;
    if (rvol >= 4) risk += 10;
    if (rvol >= 6) risk += 12;
    if (attention >= 88) risk += 8;
    if (stock.change < 0) risk += 10;

    return clampScore(risk);
  };

  const getRiskRewardQualityScore = (stock: Stock) => {
    const signal = getSignalQuality(stock);
    const participation = getParticipationScore(stock);
    const extensionRisk = getExtensionRiskScore(stock);

    return clampScore(
      signal * 0.42 + participation * 0.38 + (99 - extensionRisk) * 0.2,
      35,
      99,
    );
  };

  const detectPatternSignal = (stock: Stock): PatternSignal => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const sentimentScore = getNarrativeSentimentScore(stock);
    const hypeScore = getRetailHypeScore(stock);
    const extensionRisk = getExtensionRiskScore(stock);
    const riskRewardQuality = getRiskRewardQualityScore(stock);
    const pressureBlend = clampScore(
      rvol * 9 + attention * 0.22 + signal * 0.22 + newsVelocity * 0.14 + hypeScore * 0.08,
      35,
      99,
    );

    if (stock.change < 0 && (attention >= 70 || rvol >= 2.2) && signal >= 62) {
      return {
        name: "Reclaim Setup",
        score: clampScore(pressureBlend - 5, 35, 92),
        summary: "Weak tape is showing signs of buyer interest. HT wants reclaim strength before upgrading conviction.",
        bias: "Wait for reclaim confirmation",
      };
    }

    if (extensionRisk >= 78 || (move >= 12 && attention >= 82)) {
      return {
        name: "Exhaustion Risk",
        score: clampScore(74 + Math.min(18, move) + Math.max(0, attention - 82) * 0.25, 55, 98),
        summary: "The move is getting loud. HT is watching whether participation can absorb profit-taking.",
        bias: "Protect against late-crowd chasing",
      };
    }

    if (attention >= 84 && rvol >= 3 && stock.change > 0 && move < 12) {
      return {
        name: "Crowd Ignition",
        score: clampScore(pressureBlend + 8, 60, 99),
        summary: "Retail attention, volume, and early price lift are waking up together.",
        bias: "Fast attention expansion",
      };
    }

    if (continuation >= 82 && participation >= 78 && stock.change > 0 && extensionRisk < 76) {
      return {
        name: "Continuation Stack",
        score: clampScore(continuation * 0.48 + participation * 0.32 + riskRewardQuality * 0.2, 55, 99),
        summary: "Momentum is holding with participation. HT is watching whether the trend can keep stacking.",
        bias: "Continuation behavior improving",
      };
    }

    if (rvol >= 2.5 && move < 6 && (attention >= 68 || newsVelocity >= 62) && sentimentScore >= 50) {
      return {
        name: "Pressure Coil",
        score: clampScore(pressureBlend + 6, 55, 96),
        summary: "Volume and attention are building while price has not fully expanded yet.",
        bias: "Breakout pressure building early",
      };
    }

    if (move < 4 && rvol >= 1.8 && signal >= 74 && attention < 84) {
      return {
        name: "Quiet Accumulation",
        score: clampScore(signal * 0.42 + participation * 0.28 + rvol * 8 + newsVelocity * 0.12, 50, 94),
        summary: "Structure is improving quietly before the crowd fully notices.",
        bias: "Early positioning watch",
      };
    }

    return {
      name: "No Clean Pattern",
      score: clampScore(pressureBlend - 8, 35, 76),
      summary: "No dominant momentum fingerprint yet. HT is monitoring for pressure to separate.",
      bias: "Monitor only",
    };
  };

  const getPatternSignal = (stock: Stock) => detectPatternSignal(stock).name;
  const getPatternScore = (stock: Stock) => detectPatternSignal(stock).score;
  const getPatternSummary = (stock: Stock) => detectPatternSignal(stock).summary;

  const getTrapRiskScore = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const signal = getSignalQuality(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const hypeScore = getRetailHypeScore(stock);
    const isHighBetaPocket = highBetaMomentumPockets.includes(stock.symbol);

    let risk = 10;

    // Anti-RGTI layer: momentum is valuable only if the entry is not already emotionally crowded.
    if (move >= 4) risk += 8;
    if (move >= 7) risk += 12;
    if (move >= 10) risk += 18;
    if (move >= 14) risk += 22;
    if (move >= 20) risk += 28;

    // Loud crowd + large move = possible exit liquidity.
    if (attention >= 78 && move >= 7) risk += 10;
    if (attention >= 88 && move >= 10) risk += 14;
    if (attention >= 92 && move >= 14) risk += 16;
    if (hypeScore >= 72 && move >= 7) risk += 9;
    if (hypeScore >= 84 && move >= 10) risk += 12;

    // Big RVOL after extension can be continuation, but it also needs stronger quality control.
    if (rvol >= 4 && move >= 7) risk += 8;
    if (rvol >= 6 && move >= 9) risk += 12;
    if (rvol >= 8 && move >= 10) risk += 16;

    // High-beta names need stricter filtering because they trap faster at the open.
    if (isHighBetaPocket && move >= 8) risk += 8;
    if (isHighBetaPocket && attention >= 86 && move >= 10) risk += 8;

    // If structure is not keeping up with excitement, punish it hard.
    if (continuation < 70 && move >= 6) risk += 14;
    if (continuation < 78 && move >= 10) risk += 10;
    if (signal < 72 && attention >= 82) risk += 10;

    // Fresh catalysts help early moves, but they should not excuse chase conditions.
    if (newsVelocity >= 70 && move < 7) risk -= 7;
    if (continuation >= 84 && move < 8) risk -= 10;
    if (rvol >= 2.4 && rvol < 6 && move < 6 && attention >= 62) risk -= 8;
    if (stock.change < 0) risk += 16;

    return clampScore(risk, 0, 99);
  };

  const getTrapRiskLabel = (stock: Stock) => {
    const risk = getTrapRiskScore(stock);

    if (risk >= 72) return "High Trap Risk";
    if (risk >= 52) return "Extended";

    return "Healthy Momentum";
  };

  const getTimingQualityLabel = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);

    if (trapRisk >= 72 || entryQuality < 45) return "High Chase Risk";
    if (move >= 12 || trapRisk >= 58) return "Extended";
    if (entryQuality >= 78 && move < 8 && rvol >= 2.2 && attention >= 62) return "Early / Clean";
    if (entryQuality >= 68 && trapRisk < 45) return "Valid Watch";

    return "Needs Proof";
  };

  const getEntryQualityScore = (stock: Stock) => {
    const signal = getSignalQuality(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const pattern = detectPatternSignal(stock).name;

    const earlyPressureBonus = rvol >= 2.2 && move < 7 && attention >= 62 ? 10 : 0;
    const cleanContinuationBonus = continuation >= 82 && participation >= 78 && move < 9 ? 8 : 0;
    const catalystSupport = newsVelocity >= 68 && move < 9 ? 5 : 0;
    const patternBonus = pattern === "Pressure Coil" || pattern === "Quiet Accumulation" ? 8 : pattern === "Continuation Stack" ? 5 : 0;
    const extensionPenalty = move >= 20 ? 28 : move >= 15 ? 22 : move >= 11 ? 16 : move >= 8 ? 10 : move >= 5 ? 4 : 0;
    const fomoPenalty = attention >= 88 && move >= 8 ? 10 : attention >= 80 && move >= 10 ? 8 : 0;
    const reclaimPenalty = stock.change < 0 ? 18 : 0;

    return clampScore(
      signal * 0.18 +
        participation * 0.2 +
        continuation * 0.22 +
        (99 - trapRisk) * 0.32 +
        Math.min(12, rvol * 1.4) +
        earlyPressureBonus +
        cleanContinuationBonus +
        catalystSupport +
        patternBonus -
        extensionPenalty -
        fomoPenalty -
        reclaimPenalty,
      0,
      99,
    );
  };

  const getQualityGateLabel = (stock: Stock) => {
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const move = Math.abs(stock.change);
    const attention = getAttentionScore(stock);

    if (trapRisk >= 70 || entryQuality < 48) return "Reject";
    if (move >= 14 && attention >= 84) return "Reject";
    if (trapRisk >= 48 || entryQuality < 68) return "Caution";

    return "Pass";
  };

  const confirmPatternContender = (stock: Stock): ContenderConfirmation => {
    const pattern = detectPatternSignal(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const qualityGate = getQualityGateLabel(stock);
    const move = Math.abs(stock.change);

    const confirmationScore = clampScore(
      pattern.score * 0.28 +
        participation * 0.22 +
        continuation * 0.2 +
        entryQuality * 0.22 +
        (99 - trapRisk) * 0.08,
      0,
      99,
    );

    if (pattern.name === "No Clean Pattern") {
      return {
        status: "Rejected: No Clean Pattern",
        score: confirmationScore,
        passed: false,
        reason:
          "HT detected movement, but no clean repeatable momentum pattern has separated yet.",
      };
    }

    if (qualityGate === "Reject" || trapRisk >= 72) {
      return {
        status: "Rejected: Trap Risk",
        score: confirmationScore,
        passed: false,
        reason:
          "The pattern is visible, but trap risk is too high for HT to rank it as a clean contender.",
      };
    }

    if (participation < 64 || continuation < 62 || entryQuality < 58) {
      return {
        status: "Rejected: Weak Confirmation",
        score: confirmationScore,
        passed: false,
        reason:
          "Pattern detected, but participation, continuation, or entry quality is not strong enough yet.",
      };
    }

    if (
      confirmationScore >= 82 &&
      pattern.score >= 76 &&
      participation >= 72 &&
      continuation >= 70 &&
      entryQuality >= 68 &&
      trapRisk < 58 &&
      qualityGate === "Pass" &&
      stock.change >= 0
    ) {
      return {
        status: "Confirmed Contender",
        score: confirmationScore,
        passed: true,
        reason: `${pattern.name} confirmed with participation, continuation, and entry quality aligned.`,
      };
    }

    if (
      confirmationScore >= 72 &&
      pattern.score >= 68 &&
      trapRisk < 66 &&
      move < 14
    ) {
      return {
        status: "Developing Contender",
        score: confirmationScore,
        passed: true,
        reason: `${pattern.name} is developing, but HT still wants stronger confirmation before ranking it as priority.`,
      };
    }

    return {
      status: "Pattern Detected / Needs Proof",
      score: confirmationScore,
      passed: false,
      reason: `${pattern.name} detected, but second-layer confirmation is not strong enough yet.`,
    };
  };

  const historicalMomentumFingerprints: MomentumFingerprint[] = [
    {
      label: "SNAL-style early retail ignition",
      pattern: "Crowd Ignition",
      attention: 88,
      signalQuality: 84,
      participation: 86,
      continuation: 78,
      entryQuality: 74,
      trapRisk: 44,
      rvol: 5.8,
      newsVelocity: 58,
      move: 7.5,
      weight: 1.14,
    },
    {
      label: "QUBT-style speculative pressure coil",
      pattern: "Pressure Coil",
      attention: 82,
      signalQuality: 80,
      participation: 78,
      continuation: 74,
      entryQuality: 78,
      trapRisk: 38,
      rvol: 4.2,
      newsVelocity: 64,
      move: 4.8,
      weight: 1.12,
    },
    {
      label: "RKLB/ASTS-style theme rotation",
      pattern: "Continuation Stack",
      attention: 76,
      signalQuality: 86,
      participation: 80,
      continuation: 84,
      entryQuality: 76,
      trapRisk: 42,
      rvol: 3.4,
      newsVelocity: 68,
      move: 5.6,
      weight: 1.08,
    },
    {
      label: "PLTR-style quiet accumulation",
      pattern: "Quiet Accumulation",
      attention: 68,
      signalQuality: 82,
      participation: 72,
      continuation: 78,
      entryQuality: 82,
      trapRisk: 30,
      rvol: 2.2,
      newsVelocity: 52,
      move: 2.8,
      weight: 1.0,
    },
    {
      label: "HOOD/MSTR-style risk-on momentum",
      pattern: "Crowd Ignition",
      attention: 86,
      signalQuality: 78,
      participation: 84,
      continuation: 72,
      entryQuality: 68,
      trapRisk: 52,
      rvol: 4.8,
      newsVelocity: 62,
      move: 8.4,
      weight: 1.02,
    },
  ];

  const getRangeSimilarity = (actual: number, target: number, tolerance: number) => {
    return clampScore(100 - (Math.abs(actual - target) / tolerance) * 100, 0, 100);
  };

  const getMomentumFingerprintMatch = (stock: Stock): FingerprintMatch => {
    const pattern = detectPatternSignal(stock);
    const attention = getAttentionScore(stock);
    const signalQuality = getSignalQuality(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const rvol = getRelativeVolume(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const move = Math.abs(stock.change);

    const rankedMatches = historicalMomentumFingerprints
      .map((fingerprint) => {
        const patternScore = pattern.name === fingerprint.pattern ? 100 : pattern.name === "No Clean Pattern" ? 32 : 58;
        const score = clampScore(
          patternScore * 0.18 +
            getRangeSimilarity(attention, fingerprint.attention, 32) * 0.13 +
            getRangeSimilarity(signalQuality, fingerprint.signalQuality, 28) * 0.13 +
            getRangeSimilarity(participation, fingerprint.participation, 30) * 0.13 +
            getRangeSimilarity(continuation, fingerprint.continuation, 30) * 0.12 +
            getRangeSimilarity(entryQuality, fingerprint.entryQuality, 30) * 0.12 +
            getRangeSimilarity(99 - trapRisk, 99 - fingerprint.trapRisk, 34) * 0.11 +
            getRangeSimilarity(rvol, fingerprint.rvol, 4.5) * 0.1 +
            getRangeSimilarity(newsVelocity, fingerprint.newsVelocity, 38) * 0.06 +
            getRangeSimilarity(move, fingerprint.move, 9) * 0.02,
          0,
          99,
        );

        return {
          label: fingerprint.label,
          score: clampScore(score * fingerprint.weight, 0, 99),
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = rankedMatches[0] || { label: "No historical match", score: 0 };
    const matchQuality =
      best.score >= 82
        ? "Strong Historical Match"
        : best.score >= 68
          ? "Moderate Historical Match"
          : "Weak Historical Match";

    return {
      score: best.score,
      bestMatch: best.label,
      matchQuality,
      reason:
        best.score >= 82
          ? `Current pressure resembles ${best.label}, a prior momentum-leader fingerprint.`
          : best.score >= 68
            ? `Some traits resemble ${best.label}, but HT still wants stronger confirmation.`
            : "Current action does not strongly match HT's stored momentum-winner fingerprints yet.",
    };
  };


  const megaCapDiscoveryPenaltySymbols = [
    "AAPL",
    "MSFT",
    "GOOGL",
    "GOOG",
    "AMZN",
    "META",
    "NVDA",
    "TSLA",
    "AVGO",
    "LLY",
    "NVO",
    "JPM",
    "V",
    "MA",
    "COST",
    "NFLX",
  ];

  const institutionalQualitySymbols = [
    "CRWD",
    "PANW",
    "MU",
    "NOW",
    "ADBE",
    "CRM",
    "ORCL",
    "ASML",
    "TSM",
    "QCOM",
    "SHOP",
  ];

  const getDiscoverySignal = (stock: Stock): DiscoverySignal => {
    const pattern = detectPatternSignal(stock);
    const attention = getAttentionScore(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const rvol = getRelativeVolume(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const hypeScore = getRetailHypeScore(stock);
    const move = Math.abs(stock.change);
    const isHighBetaPocket = highBetaMomentumPockets.includes(stock.symbol);
    const isMegaCap = megaCapDiscoveryPenaltySymbols.includes(stock.symbol);
    const isInstitutionalQuality = institutionalQualitySymbols.includes(stock.symbol);

    const earlyPressure = rvol >= 2.2 && rvol <= 6.8 && move >= 1.2 && move < 8.5;
    const crowdNotFullyLate = attention >= 58 && attention <= 86;
    const qualityWithoutChase = entryQuality >= 62 && trapRisk < 58;
    const constructivePattern =
      pattern.name === "Pressure Coil" ||
      pattern.name === "Quiet Accumulation" ||
      pattern.name === "Crowd Ignition" ||
      pattern.name === "Continuation Stack";

    let score = 34;

    if (constructivePattern) score += 13;
    if (earlyPressure) score += 16;
    if (crowdNotFullyLate) score += 12;
    if (qualityWithoutChase) score += 14;
    if (participation >= 70 && continuation >= 66) score += 8;
    if (newsVelocity >= 48 && newsVelocity <= 76) score += 6;
    if (hypeScore >= 46 && hypeScore <= 76) score += 6;
    if (isHighBetaPocket && move < 9 && trapRisk < 62) score += 8;
    if (!defaultStarterTickers.includes(stock.symbol) && attention >= 62 && move < 9) score += 6;

    // Discovery is not the same as quality. Penalize names that are already obvious, too crowded, or too late.
    if (move >= 9) score -= 8;
    if (move >= 13) score -= 13;
    if (move >= 18) score -= 20;
    if (attention >= 90 && move >= 8) score -= 12;
    if (hypeScore >= 86 && move >= 8) score -= 9;
    if (trapRisk >= 62) score -= 12;
    if (trapRisk >= 74) score -= 18;
    if (pattern.name === "Exhaustion Risk") score -= 18;
    if (pattern.name === "No Clean Pattern") score -= 12;
    if (stock.change < 0) score -= 16;
    if (isMegaCap) score -= 10;
    if (isInstitutionalQuality && attention >= 80 && move >= 5) score -= 7;

    const discoveryScore = clampScore(score, 0, 99);
    const phase: DiscoveryPhase =
      discoveryScore >= 82
        ? "Pre-Crowd Discovery"
        : discoveryScore >= 70
          ? "Early Momentum"
          : discoveryScore >= 56
            ? "Known Mover"
            : trapRisk >= 70 || move >= 13 || pattern.name === "Exhaustion Risk"
              ? "Late / Crowded"
              : "No Discovery Edge";

    const reason =
      phase === "Pre-Crowd Discovery"
        ? "HT sees volume, participation, and pattern quality building before the setup becomes fully obvious."
        : phase === "Early Momentum"
          ? "The move is active, but the crowd does not look fully late yet."
          : phase === "Known Mover"
            ? "The setup has quality, but the discovery edge is not dominant."
            : phase === "Late / Crowded"
              ? "Momentum is visible, but chase risk is starting to outweigh the early edge."
              : "HT does not see enough early separation to call this a discovery setup.";

    return {
      score: discoveryScore,
      phase,
      early: phase === "Pre-Crowd Discovery" || phase === "Early Momentum",
      reason,
    };
  };

  const momentumBaselines: MomentumBaseline[] = [
    {
      symbol: "SOUN",
      attention: 58,
      participation: 62,
      continuation: 60,
      discovery: 58,
      newsVelocity: 42,
      rvol: 2.2,
      observed: "prior-watch",
    },
    {
      symbol: "QUBT",
      attention: 64,
      participation: 66,
      continuation: 64,
      discovery: 62,
      newsVelocity: 46,
      rvol: 2.6,
      observed: "prior-watch",
    },
    {
      symbol: "SNAL",
      attention: 66,
      participation: 68,
      continuation: 61,
      discovery: 64,
      newsVelocity: 44,
      rvol: 2.8,
      observed: "prior-watch",
    },
    {
      symbol: "RGTI",
      attention: 60,
      participation: 64,
      continuation: 62,
      discovery: 60,
      newsVelocity: 40,
      rvol: 2.5,
      observed: "prior-watch",
    },
    {
      symbol: "RKLB",
      attention: 57,
      participation: 61,
      continuation: 65,
      discovery: 59,
      newsVelocity: 45,
      rvol: 2.0,
      observed: "prior-watch",
    },
    {
      symbol: "ASTS",
      attention: 59,
      participation: 63,
      continuation: 66,
      discovery: 60,
      newsVelocity: 45,
      rvol: 2.1,
      observed: "prior-watch",
    },
    {
      symbol: "IONQ",
      attention: 61,
      participation: 64,
      continuation: 63,
      discovery: 61,
      newsVelocity: 43,
      rvol: 2.4,
      observed: "prior-watch",
    },
    {
      symbol: "HOOD",
      attention: 62,
      participation: 64,
      continuation: 62,
      discovery: 58,
      newsVelocity: 47,
      rvol: 2.2,
      observed: "prior-watch",
    },
  ];

  const getMomentumBaseline = (stock: Stock, discovery: DiscoverySignal): MomentumBaseline => {
    const saved = momentumBaselines.find((baseline) => baseline.symbol === stock.symbol);

    if (saved) return saved;

    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const fallbackCompression = highBetaMomentumPockets.includes(stock.symbol) ? 16 : 10;

    return {
      symbol: stock.symbol,
      attention: clampScore(attention - Math.min(24, move * 1.35) - fallbackCompression, 30, 88),
      participation: clampScore(participation - Math.min(22, rvol * 2.4) - 6, 30, 88),
      continuation: clampScore(continuation - Math.min(18, move * 0.9) - 4, 30, 88),
      discovery: clampScore(discovery.score - Math.min(22, move * 1.1) - 6, 20, 88),
      newsVelocity: clampScore(newsVelocity - 10, 20, 88),
      rvol: Math.max(0.8, Number((rvol - 1.1).toFixed(1))),
      observed: "synthetic-prior",
    };
  };

  const getMomentumAccelerationSignal = (stock: Stock, discovery: DiscoverySignal): MomentumAccelerationSignal => {
    const baseline = getMomentumBaseline(stock, discovery);
    const attention = getAttentionScore(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const newsVelocity = getNewsVelocityScore(stock);
    const rvol = getRelativeVolume(stock);
    const trapRisk = getTrapRiskScore(stock);
    const move = Math.abs(stock.change);
    const pattern = detectPatternSignal(stock).name;

    const attentionDelta = attention - baseline.attention;
    const participationDelta = participation - baseline.participation;
    const continuationDelta = continuation - baseline.continuation;
    const discoveryDelta = discovery.score - baseline.discovery;
    const newsDelta = newsVelocity - baseline.newsVelocity;
    const rvolDelta = (rvol - baseline.rvol) * 8;

    let rawScore =
      42 +
      attentionDelta * 0.22 +
      participationDelta * 0.24 +
      continuationDelta * 0.16 +
      discoveryDelta * 0.2 +
      newsDelta * 0.08 +
      rvolDelta * 0.1;

    if (discovery.early && attentionDelta >= 10 && participationDelta >= 8) rawScore += 8;
    if (pattern === "Pressure Coil" || pattern === "Quiet Accumulation") rawScore += 5;
    if (pattern === "Crowd Ignition" && move < 9) rawScore += 4;
    if (move >= 9) rawScore -= 6;
    if (move >= 14) rawScore -= 12;
    if (trapRisk >= 62) rawScore -= 10;
    if (trapRisk >= 74) rawScore -= 16;
    if (stock.change < 0) rawScore -= 14;

    const score = clampScore(rawScore, 0, 99);
    const netDelta = attentionDelta + participationDelta + discoveryDelta;
    const direction: MomentumAccelerationSignal["direction"] =
      netDelta >= 18 ? "up" : netDelta <= -8 || stock.change < 0 ? "down" : "flat";

    const label: MomentumAccelerationSignal["label"] =
      score >= 82 && direction === "up"
        ? "Accelerating Fast"
        : score >= 70 && direction !== "down"
          ? "Acceleration Building"
          : score >= 56
            ? "Stable Momentum"
            : direction === "down"
              ? "Fading / Late"
              : "No Acceleration Edge";

    const reason =
      label === "Accelerating Fast"
        ? "Attention, participation, and discovery strength are improving faster than the prior watch baseline."
        : label === "Acceleration Building"
          ? "Momentum is improving, but HT still wants more confirmation before treating it as a full acceleration event."
          : label === "Stable Momentum"
            ? "The setup is holding quality, but the acceleration edge is not dominant yet."
            : label === "Fading / Late"
              ? "Momentum is losing freshness or becoming too crowded for a clean early read."
              : "HT does not see enough score expansion versus the prior watch baseline yet.";

    return {
      score,
      label,
      direction,
      reason,
    };
  };

  const getTooLateFilter = (
    stock: Stock,
    discovery: DiscoverySignal,
    acceleration: MomentumAccelerationSignal,
  ) => {
    const pattern = detectPatternSignal(stock);
    const move = Math.abs(stock.change);
    const attention = getAttentionScore(stock);
    const hypeScore = getRetailHypeScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const qualityGate = getQualityGateLabel(stock);
    const rvol = getRelativeVolume(stock);

    const blocked =
      qualityGate === "Reject" ||
      discovery.phase === "Late / Crowded" ||
      acceleration.label === "Fading / Late" ||
      pattern.name === "Exhaustion Risk" ||
      trapRisk >= 70 ||
      entryQuality < 48 ||
      move >= 14 ||
      (move >= 10 && attention >= 84) ||
      (move >= 8 && hypeScore >= 86) ||
      (rvol >= 6 && move >= 9 && continuation < 82);

    const reason =
      qualityGate === "Reject" || trapRisk >= 70
        ? "Filtered because trap risk is too high for a clean early read."
        : pattern.name === "Exhaustion Risk" || discovery.phase === "Late / Crowded"
          ? "Filtered because momentum looks visible, crowded, or extended instead of early."
          : acceleration.label === "Fading / Late"
            ? "Filtered because acceleration is fading versus the prior watch baseline."
            : move >= 14 || (move >= 10 && attention >= 84)
              ? "Filtered because the move is already too extended relative to attention."
              : (move >= 8 && hypeScore >= 86) || (rvol >= 6 && move >= 9 && continuation < 82)
                ? "Filtered because hype or volume expansion looks too crowded for a clean setup."
                : "Still eligible for Top Conviction ranking.";

    return { blocked, reason };
  };


  const getCrowdSaturationSignal = (
    stock: Stock,
    discovery: DiscoverySignal,
    acceleration: MomentumAccelerationSignal,
  ): CrowdSaturationSignal => {
    const pattern = detectPatternSignal(stock);
    const move = Math.abs(stock.change);
    const attention = getAttentionScore(stock);
    const hypeScore = getRetailHypeScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const rvol = getRelativeVolume(stock);
    const continuation = getContinuationStrengthScore(stock);
    const entryQuality = getEntryQualityScore(stock);

    let score = 18;

    // Crowd saturation is different from strength.
    // Strong + early is good. Strong + obvious + extended is crowded.
    if (attention >= 72) score += 10;
    if (attention >= 84) score += 12;
    if (attention >= 92) score += 14;
    if (hypeScore >= 70) score += 9;
    if (hypeScore >= 84) score += 12;
    if (move >= 6) score += 8;
    if (move >= 9) score += 12;
    if (move >= 13) score += 16;
    if (rvol >= 4.5 && move >= 6) score += 8;
    if (rvol >= 6.5 && move >= 8) score += 11;
    if (trapRisk >= 58) score += 10;
    if (trapRisk >= 72) score += 16;
    if (pattern.name === "Exhaustion Risk") score += 18;
    if (acceleration.label === "Fading / Late") score += 12;

    // Pull saturation down when pressure is building early instead of arriving late.
    if (discovery.phase === "Pre-Crowd Discovery" && acceleration.direction === "up" && move < 8) score -= 16;
    if (discovery.phase === "Early Momentum" && move < 8.5) score -= 10;
    if (entryQuality >= 72 && trapRisk < 48 && move < 8) score -= 9;
    if (continuation >= 78 && move < 9 && trapRisk < 56) score -= 5;

    const saturationScore = clampScore(score, 0, 99);
    const level: CrowdSaturationLevel =
      saturationScore >= 84
        ? "Exhausted Crowd"
        : saturationScore >= 70
          ? "Crowd Arrived"
          : saturationScore >= 56
            ? "Elevated Crowd"
            : saturationScore >= 38
              ? "Building Crowd"
              : "Low Saturation";

    const reason =
      level === "Low Saturation"
        ? "Crowd participation remains below saturation while the setup is still developing."
        : level === "Building Crowd"
          ? "Crowd attention is building, but HT does not read the setup as fully crowded yet."
          : level === "Elevated Crowd"
            ? "Crowd attention is elevated, so HT needs cleaner confirmation before upgrading conviction."
            : level === "Crowd Arrived"
              ? "The crowd appears to have arrived, reducing the before-crowd edge."
              : "The move looks saturated or exhausted, so HT should protect users from late-chase risk.";

    return {
      score: saturationScore,
      level,
      crowded: level === "Crowd Arrived" || level === "Exhausted Crowd",
      reason,
    };
  };

  const getOpportunityWindowSignal = (
    stock: Stock,
    discovery: DiscoverySignal,
    acceleration: MomentumAccelerationSignal,
    saturation: CrowdSaturationSignal,
  ): OpportunityWindowSignal => {
    const pattern = detectPatternSignal(stock);
    const move = Math.abs(stock.change);
    const attention = getAttentionScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const continuation = getContinuationStrengthScore(stock);

    if (
      saturation.level === "Exhausted Crowd" ||
      pattern.name === "Exhaustion Risk" ||
      trapRisk >= 74 ||
      move >= 15
    ) {
      return {
        window: "EXHAUSTION RISK",
        scoreImpact: -25,
        open: false,
        reason: "Opportunity window is closed because extension, saturation, or trap risk is too elevated.",
      };
    }

    if (
      saturation.level === "Crowd Arrived" ||
      (attention >= 90 && move >= 9) ||
      (acceleration.label === "Fading / Late" && trapRisk >= 58)
    ) {
      return {
        window: "CROWD ARRIVED",
        scoreImpact: -15,
        open: false,
        reason: "The ticker may still matter, but HT reads the before-crowd edge as mostly gone.",
      };
    }

    if (
      discovery.phase === "Pre-Crowd Discovery" &&
      acceleration.score >= 70 &&
      saturation.score < 48 &&
      entryQuality >= 68 &&
      trapRisk < 52 &&
      move < 8.5
    ) {
      return {
        window: "EARLY WINDOW OPEN",
        scoreImpact: 12,
        open: true,
        reason: "Early pressure, acceleration, and entry quality are aligned before crowd saturation.",
      };
    }

    if (
      (discovery.phase === "Pre-Crowd Discovery" || discovery.phase === "Early Momentum") &&
      acceleration.score >= 58 &&
      saturation.score < 62 &&
      trapRisk < 62 &&
      move < 10
    ) {
      return {
        window: "EARLY WINDOW BUILDING",
        scoreImpact: 8,
        open: true,
        reason: "The window is building, but HT still wants stronger confirmation before treating it as the cleanest read.",
      };
    }

    if (
      continuation >= 76 &&
      entryQuality >= 62 &&
      trapRisk < 66 &&
      saturation.score < 70
    ) {
      return {
        window: "CONFIRMATION PHASE",
        scoreImpact: 3,
        open: true,
        reason: "The early window is not perfect, but confirmation is still strong enough to keep the setup eligible.",
      };
    }

    return {
      window: saturation.crowded ? "CROWD ARRIVED" : "CONFIRMATION PHASE",
      scoreImpact: saturation.crowded ? -15 : 0,
      open: !saturation.crowded,
      reason: saturation.crowded
        ? "Crowd saturation is limiting the opportunity window."
        : "HT needs cleaner early-window evidence before upgrading this setup.",
    };
  };

  const getBackgroundOpportunityEngine = (
    stock: Stock,
  ): BackgroundOpportunityEngine => {
    const pattern = detectPatternSignal(stock);
    const contender = confirmPatternContender(stock);
    const trapRisk = getTrapRiskScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const qualityGate = getQualityGateLabel(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const conviction = getConvictionScore(stock);
    const move = Math.abs(stock.change);
    const intel = newsIntel[stock.symbol];
    const socialVelocity = clampScore(intel?.socialVelocity || 0, 0, 99);
    const fingerprint = getMomentumFingerprintMatch(stock);
    const discovery = getDiscoverySignal(stock);
    const acceleration = getMomentumAccelerationSignal(stock, discovery);
    const saturation = getCrowdSaturationSignal(stock, discovery, acceleration);
    const opportunityWindow = getOpportunityWindowSignal(stock, discovery, acceleration, saturation);
    const tooLateFilter = getTooLateFilter(stock, discovery, acceleration);

    const contenderBoost =
      contender.status === "Confirmed Contender"
        ? 10
        : contender.status === "Developing Contender"
          ? 5
          : contender.status.includes("Rejected")
            ? -14
            : -4;

    const discoveryBoost =
      discovery.phase === "Pre-Crowd Discovery"
        ? 12
        : discovery.phase === "Early Momentum"
          ? 7
          : discovery.phase === "Known Mover"
            ? 2
            : discovery.phase === "Late / Crowded"
              ? -13
              : -6;

    const accelerationBoost =
      acceleration.label === "Accelerating Fast"
        ? 10
        : acceleration.label === "Acceleration Building"
          ? 6
          : acceleration.label === "Stable Momentum"
            ? 1
            : acceleration.label === "Fading / Late"
              ? -10
              : -4;

    const trapPenalty =
      trapRisk >= 72 ? 18 : trapRisk >= 58 ? 10 : trapRisk >= 48 ? 5 : 0;

    const extensionPenalty =
      move >= 20 ? 18 : move >= 15 ? 13 : move >= 11 ? 8 : move >= 8 ? 4 : 0;

    const gatePenalty =
      qualityGate === "Reject" ? 20 : qualityGate === "Caution" ? 8 : 0;

    const rawFinalScore = clampScore(
      pattern.score * 0.15 +
        contender.score * 0.19 +
        entryQuality * 0.17 +
        participation * 0.12 +
        continuation * 0.1 +
        signal * 0.06 +
        attention * 0.04 +
        conviction * 0.025 +
        socialVelocity * 0.025 +
        fingerprint.score * 0.07 +
        discovery.score * 0.13 +
        acceleration.score * 0.09 +
        (99 - saturation.score) * 0.05 +
        opportunityWindow.scoreImpact +
        contenderBoost +
        discoveryBoost +
        accelerationBoost -
        trapPenalty -
        extensionPenalty -
        gatePenalty,
      0,
      99,
    );

    // Hard rule: if HT considers the setup late, crowded, exhausted, or trap-heavy,
    // it cannot appear as Top Conviction no matter how strong the raw score looks.
    const finalScore = tooLateFilter.blocked || opportunityWindow.window === "CROWD ARRIVED" || opportunityWindow.window === "EXHAUSTION RISK"
      ? clampScore(Math.min(rawFinalScore, opportunityWindow.window === "EXHAUSTION RISK" ? 36 : 42), 0, 99)
      : rawFinalScore;

    const consumerLabel =
      tooLateFilter.blocked || qualityGate === "Reject" || opportunityWindow.window === "CROWD ARRIVED" || opportunityWindow.window === "EXHAUSTION RISK"
        ? "Trap Filtered"
        : finalScore >= 88 &&
            contender.status === "Confirmed Contender" &&
            fingerprint.score >= 68 &&
            discovery.early &&
            acceleration.score >= 62 &&
            opportunityWindow.open &&
            !saturation.crowded
          ? "Top Conviction"
          : finalScore >= 80
            ? "Strong Watch"
            : finalScore >= 70
              ? "Developing"
              : "Monitor Only";

    const consumerReason =
      consumerLabel === "Top Conviction"
        ? `HT detected strong alignment between early discovery pressure, acceleration, controlled saturation, and an ${opportunityWindow.window.toLowerCase()} read.`
        : consumerLabel === "Strong Watch"
          ? "Momentum is building with enough confirmation to stay near the top of the board."
          : consumerLabel === "Developing"
            ? "A pattern is forming, but HT still wants stronger confirmation before calling it top conviction."
            : consumerLabel === "Trap Filtered"
              ? tooLateFilter.reason
              : "HT is monitoring the ticker, but it has not earned priority status yet.";

    return {
      symbol: stock.symbol,
      finalScore,
      pattern: pattern.name,
      patternScore: pattern.score,
      contenderStatus: contender.status,
      contenderScore: contender.score,
      fingerprintScore: fingerprint.score,
      fingerprintMatch: fingerprint.bestMatch,
      fingerprintQuality: fingerprint.matchQuality,
      discoveryScore: discovery.score,
      discoveryPhase: discovery.phase,
      accelerationScore: acceleration.score,
      accelerationLabel: acceleration.label,
      accelerationDirection: acceleration.direction,
      crowdSaturationScore: saturation.score,
      crowdSaturationLevel: saturation.level,
      opportunityWindow: opportunityWindow.window,
      opportunityWindowOpen: opportunityWindow.open,
      tooLate: tooLateFilter.blocked || !opportunityWindow.open,
      tooLateReason: tooLateFilter.reason,
      trapRisk,
      entryQuality,
      participation,
      continuation,
      qualityGate,
      consumerLabel,
      consumerReason,
      internalReason: `${opportunityWindow.reason} ${saturation.reason} ${tooLateFilter.reason} ${discovery.reason} ${acceleration.reason} ${contender.reason} ${fingerprint.reason}`,
    };
  };

  const getScannerSelectionScore = (stock: Stock) => {
    const ht = getConvictionScore(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const rvol = getRelativeVolume(stock);
    const move = Math.abs(stock.change);
    const freshness = getMomentumFreshnessScore(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const trapSafety = 99 - trapRisk;
    const pattern = detectPatternSignal(stock).name;
    const qualityGate = getQualityGateLabel(stock);
    const cleanPatternBoost =
      pattern === "Pressure Coil" || pattern === "Quiet Accumulation"
        ? 8
        : pattern === "Continuation Stack"
          ? 5
          : pattern === "Crowd Ignition" && entryQuality >= 70
            ? 4
            : 0;
    const moveBonus = move < 8 ? Math.min(8, move * 0.75) : 0;
    const extensionPenalty = move >= 20 ? 24 : move >= 15 ? 18 : move >= 11 ? 12 : move >= 8 ? 7 : 0;
    const reclaimPenalty = stock.change < 0 ? 14 : 0;
    const gatePenalty = qualityGate === "Reject" ? 26 : qualityGate === "Caution" ? 10 : 0;

    // Full market discoveries arrive with ht_signals enrichment data.
    // Give them a direct opportunity bonus based on their actual rvol and
    // price movement so they can compete with known stocks that have full
    // pressure stack data computed from historical signals.
    const isNewDiscovery = rvol >= 2 && move >= 1 && (
      participation < 20 || continuation < 20 || entryQuality < 20
    );
    const discoveryBonus = isNewDiscovery
      ? Math.min(35, (rvol >= 5 ? 25 : rvol >= 3 ? 18 : 12) + (move >= 10 ? 10 : move >= 5 ? 6 : 3))
      : 0;

    return Math.round(
      ht * 0.2 +
        signal * 0.14 +
        attention * 0.1 +
        participation * 0.13 +
        continuation * 0.13 +
        entryQuality * 0.18 +
        trapSafety * 0.1 +
        Math.min(10, rvol * 1.7) +
        Math.min(8, freshness * 0.65) +
        moveBonus +
        cleanPatternBoost +
        discoveryBonus -
        extensionPenalty -
        reclaimPenalty -
        gatePenalty,
    );
  };

  const getLiveConvictionScore = (stock: Stock) => {
    const scannerScore = getScannerSelectionScore(stock);
    const conviction = getConvictionScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const participation = getParticipationScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const trapSafety = 99 - trapRisk;
    const qualityGate = getQualityGateLabel(stock);
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const riskPenalty =
      move >= 18 || trapRisk >= 72
        ? 18
        : move >= 12 || trapRisk >= 58
          ? 12
          : move >= 8 || attention >= 88 || rvol >= 5
            ? 6
            : 0;
    const gatePenalty = qualityGate === "Reject" ? 28 : qualityGate === "Caution" ? 12 : 0;

    // Public opportunity ranking score. This is intentionally stricter than raw conviction.
    // HT should elevate the best opportunity right now, not the loudest ticker on the board.
    return clampScore(
      scannerScore * 0.22 +
        conviction * 0.26 +
        entryQuality * 0.3 +
        trapSafety * 0.14 +
        continuation * 0.06 +
        participation * 0.04 -
        riskPenalty -
        gatePenalty,
      20,
      99,
    );
  };

  const getScannerConfidenceLabel = (stock: Stock) => {
    const score = getLiveConvictionScore(stock);
    const gate = getQualityGateLabel(stock);

    if (gate === "Reject") return "Trap Filtered";
    if (gate === "Caution") return "Entry Caution";
    if (score >= 92) return "HT Priority";
    if (score >= 86) return "Strong Conviction";
    if (score >= 78) return "Momentum Building";
    if (stock.change < 0) return "Reclaim Watch";

    return "Monitor Only";
  };

  const convictionLeaders = useMemo(() => {
    const eligible = [...stocks]
      .map((stock) => ({
        stock,
        engine: getBackgroundOpportunityEngine(stock),
      }))
      .filter(({ engine }) => !engine.tooLate && engine.qualityGate !== "Reject");

    const ranked = eligible.length
      ? eligible
      : [...stocks].map((stock) => ({
          stock,
          engine: getBackgroundOpportunityEngine(stock),
        }));

    return ranked
      .sort((a, b) => b.engine.finalScore - a.engine.finalScore)
      .map((item) => item.stock)
      .slice(0, 10);
  }, [stocks, news, newsIntel, watchlist, savedSetups, traderMode]);

  const getEmergingRadarStatus = (engine: BackgroundOpportunityEngine): EmergingRadarCandidate["status"] => {
    if (engine.accelerationScore >= 78 || engine.discoveryScore >= 84) return "Building Fast";
    if (engine.discoveryScore >= 72 && engine.trapRisk < 62) return "Early Watch";
    return "Needs Review";
  };

  const getEmergingRadarReason = (stock: Stock, engine: BackgroundOpportunityEngine) => {
    const catalyst = getCatalystStrength(stock);

    if (engine.opportunityWindow === "EARLY WINDOW OPEN") {
      return "HT noticed early discovery before full crowd saturation. Needs review before it earns Top Conviction.";
    }

    if (engine.accelerationScore >= 78 && engine.discoveryScore >= 70) {
      return "Discovery and acceleration are rising together, but confirmation is not complete yet.";
    }

    if (engine.pattern === "Pressure Coil" || engine.pattern === "Quiet Accumulation") {
      return `${engine.pattern} forming while the move is still early. Watch for participation expansion.`;
    }

    if (engine.fingerprintScore >= 72) {
      return `Behavior resembles ${engine.fingerprintMatch}, but HT still wants cleaner proof.`;
    }

    if (catalyst !== "No fresh catalyst") {
      return `${catalyst} detected. HT is watching whether attention turns into durable participation.`;
    }

    return "Unusual early pressure detected. HT is watching before it becomes a conviction call.";
  };

  const emergingRadarCandidates = useMemo<EmergingRadarCandidate[]>(() => {
    const convictionSymbols = new Set(convictionLeaders.slice(0, 3).map((stock) => stock.symbol));

    return [...stocks]
      .map((stock) => {
        const engine = getBackgroundOpportunityEngine(stock);
        const move = Math.abs(stock.change);
        const radarScore = clampScore(
          engine.discoveryScore * 0.32 +
            engine.accelerationScore * 0.26 +
            engine.fingerprintScore * 0.14 +
            engine.participation * 0.12 +
            engine.entryQuality * 0.1 +
            (99 - engine.trapRisk) * 0.06 +
            (engine.opportunityWindow === "EARLY WINDOW OPEN" ? 8 : 0) +
            (engine.opportunityWindow === "EARLY WINDOW BUILDING" ? 5 : 0) -
            (move >= 12 ? 14 : move >= 9 ? 8 : 0) -
            (engine.tooLate ? 24 : 0),
          0,
          99,
        );

        return {
          stock,
          engine,
          radarScore,
          status: getEmergingRadarStatus(engine),
          reason: getEmergingRadarReason(stock, engine),
        };
      })
      .filter(({ stock, engine, radarScore }) => {
        if (convictionSymbols.has(stock.symbol)) return false;
        if (engine.qualityGate === "Reject") return false;
        if (engine.tooLate) return false;
        if (engine.opportunityWindow === "CROWD ARRIVED" || engine.opportunityWindow === "EXHAUSTION RISK") return false;
        if (Math.abs(stock.change) >= 14) return false;

        return (
          radarScore >= 64 ||
          engine.discoveryScore >= 72 ||
          engine.accelerationScore >= 72 ||
          engine.pattern === "Pressure Coil" ||
          engine.pattern === "Quiet Accumulation"
        );
      })
      .sort((a, b) => b.radarScore - a.radarScore)
      .slice(0, 4);
  }, [stocks, convictionLeaders, news, newsIntel, watchlist, savedSetups, traderMode]);

  const priorityTarget = convictionLeaders[0];
  const secondaryTarget = convictionLeaders[1];
  const dangerTarget = topLosers[0];

  const commandCenterLeaders = convictionLeaders.slice(0, 3);
  const v26ReadinessScore = priorityTarget
    ? Math.round(
        getConvictionScore(priorityTarget) * 0.45 +
          getAttentionScore(priorityTarget) * 0.3 +
          getSignalQuality(priorityTarget) * 0.25,
      )
    : 0;

  const v26CommandStatus =
    v26ReadinessScore >= 90
      ? "Attack Mode"
      : v26ReadinessScore >= 82
        ? "Prime Watch"
        : v26ReadinessScore >= 72
          ? "Building"
          : "Standby";

  const v26RiskRule = priorityTarget
    ? Math.abs(priorityTarget.change) >= 10
      ? "Do not chase the first vertical move. Wait for pullback, reclaim, or clear continuation."
      : priorityTarget.change < 0
        ? "Risk is defensive. Wait for reclaim before treating this as a long idea."
        : "Attention Spike is tradable only if volume and structure continue confirming."
    : "Scanner is warming up. Wait for the first clean priority target.";

  const getPriorityReason = (stock: Stock) => {
    const conviction = getConvictionScore(stock);
    const attention = getAttentionScore(stock);

    if (conviction >= 90) {
      return "Highest alignment between signal quality, attention flow, and trader profile.";
    }

    if (attention >= 85) {
      return "Attention is accelerating faster than the rest of the scanner.";
    }

    if (stock.change < 0) {
      return "Weak structure and fading participation increase risk.";
    }

    return "Developing setup still waiting for stronger confirmation.";
  };

  const getFlowDirective = () => {
    if (!priorityTarget) {
      return "Scanner waiting for actionable opportunity.";
    }

    return `Ignore lower-quality noise. ${priorityTarget.symbol} currently deserves the majority of trader attention.`;
  };

  const getMarketNarrativeHeadline = () => {
    if (marketPulse === "Bullish" && hotStocks.length >= 2) {
      return "Risk appetite is expanding across momentum names.";
    }

    if (marketPulse === "Defensive") {
      return "Tape is defensive. Traders are rewarding patience over aggression.";
    }

    if (priorityTarget && getConvictionScore(priorityTarget) >= 88) {
      return `${priorityTarget.symbol} is controlling the current tape narrative.`;
    }

    return "Market is mixed. Confirmation matters more than prediction.";
  };

  const getMarketNarrativeBody = () => {
    if (priorityTarget && getAttentionScore(priorityTarget) >= 85) {
      return `${priorityTarget.symbol} is pulling the most attention because conviction, signal quality, and trader interest are clustering around the same name. The key is whether participation holds or fades after the initial move.`;
    }

    if (hotStocks.length >= 3) {
      return "Multiple momentum names are active, but the risk of chasing increases when too many movers extend at the same time. Focus on clean pullbacks, reclaims, and higher-quality setups.";
    }

    if (bearishCount > bullishCount) {
      return "More names are weakening than strengthening. HT Labs is prioritizing defensive reads until reclaim strength improves.";
    }

    return "The tape is still developing. HT Labs is watching for rotation, volume expansion, and conviction upgrades before calling a stronger narrative.";
  };

  const getNarrativeShift = () => {
    if (
      priorityTarget?.symbol === "SNAL" ||
      priorityTarget?.symbol === "QUBT"
    ) {
      return "Speculative momentum is leading trader attention.";
    }

    if (
      priorityTarget?.symbol === "NVDA" ||
      priorityTarget?.symbol === "AMD" ||
      priorityTarget?.symbol === "SMCI"
    ) {
      return "AI and semiconductor names remain the dominant attention pocket.";
    }

    if (priorityTarget?.symbol === "MSTR") {
      return "Crypto-beta risk appetite is influencing the tape.";
    }

    if (marketPulse === "Defensive") {
      return "Attention is rotating away from risk and toward confirmation.";
    }

    return "Rotation is still forming. No single theme owns the tape yet.";
  };

  const getWhatChanged = () => {
    if (!priorityTarget) {
      return "No priority target has separated from the scanner yet.";
    }

    if (getAttentionScore(priorityTarget) >= 90) {
      return `${priorityTarget.symbol} separated because attention accelerated above the rest of the board.`;
    }

    if (getConvictionScore(priorityTarget) >= 88) {
      return `${priorityTarget.symbol} separated because conviction quality improved versus other active names.`;
    }

    return `${priorityTarget.symbol} is leading for now, but the advantage is not dominant yet.`;
  };

  const narrativeFeed = useMemo(() => {
    return [
      {
        label: "Market Tone",
        value: getMarketNarrativeHeadline(),
      },
      {
        label: "Rotation",
        value: getNarrativeShift(),
      },
      {
        label: "What Changed",
        value: getWhatChanged(),
      },
      {
        label: "Risk Read",
        value: getDailyRiskEnvironment(),
      },
    ];
  }, [stocks, news, watchlist, savedSetups, traderMode, marketPulse]);


  const getInvalidationRule = (stock: Stock) => {
    if (stock.change >= 8) {
      return "Invalidates if the move loses volume, fails reclaim, or breaks the first higher-low structure.";
    }

    if (stock.change >= 2) {
      return "Invalidates if momentum fades below the active scanner threshold or volume dries up.";
    }

    if (stock.change < 0) {
      return "Invalidates bullish bias until price reclaims strength with confirmation.";
    }

    return "Invalidates if no attention, volume, or catalyst confirmation appears.";
  };

  const getBestTraderFit = (stock: Stock) => {
    const move = Math.abs(stock.change);

    if (move >= 10) return "Best for aggressive momentum traders only.";
    if (move >= 4) return "Best for active momentum traders watching confirmation.";
    if (stock.change < 0) return "Best for patient traders waiting for reclaim confirmation.";

    return "Best for watchlist builders, not immediate chasing.";
  };

  const getConfirmationTrigger = (stock: Stock) => {
    if (stock.change >= 8) return "Pullback hold, reclaim, or clean continuation after volume confirms.";
    if (stock.change >= 2) return "Higher-low structure with volume staying elevated.";
    if (stock.change < 0) return "Reclaim above weakness with improving signal quality.";

    return "Fresh volume, catalyst, or attention expansion.";
  };

  const liveDeskFeed = useMemo(() => {
    const leader = priorityTarget || attentionLeaders[0] || topStock;
    const secondary = secondaryTarget || signalLeaders[1];
    const riskName = dangerTarget;

    return [
      {
        tag: "Priority",
        tone: "text-orange-300",
        message: leader
          ? `${leader.symbol} is leading the live board with ${getConvictionScore(leader)}/99 conviction and ${getAttentionScore(leader)} attention.`
          : "Scanner is waiting for the first clean priority target.",
      },
      {
        tag: "Alert",
        tone: "text-green-300",
        message: leader
          ? getNotificationTrigger(leader)
          : "No notification-worthy setup yet.",
      },
      {
        tag: "Risk",
        tone: "text-red-300",
        message: riskName
          ? `${riskName.symbol} is the weakest name on the board. Avoid forcing long bias until reclaim improves.`
          : getDailyRiskEnvironment(),
      },
      {
        tag: "Rotation",
        tone: "text-zinc-300",
        message: secondary
          ? `${secondary.symbol} is the secondary watch if attention rotates away from ${leader?.symbol || "the current leader"}.`
          : getNarrativeShift(),
      },
    ];
  }, [stocks, news, watchlist, savedSetups, traderMode, marketPulse]);


  const getHTSignalLanguage = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const conviction = getConvictionScore(stock);
    const rvol = getRelativeVolume(stock);

    if (attention >= 90 && conviction >= 86) {
      return "Attention pressure is outrunning the rest of the board. HT is flagging this before the crowd fully crowds in.";
    }

    if (signal >= 88 && attention >= 76) {
      return "Signal quality and participation are starting to align. This is the kind of pressure shift traders usually notice late.";
    }

    if (rvol >= 3 && stock.change >= 3) {
      return "Participation quality is expanding beneath the move. Attention Spike is real only if this pressure keeps building.";
    }

    if (stock.change < 0) {
      return "Weak tape. HT is not calling this early until reclaim strength proves participation is returning.";
    }

    return "Attention Spike structure is forming, but HT is waiting for stronger attention pressure before calling it a true Top Conviction.";
  };

  const getCrowdPhase = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const conviction = getConvictionScore(stock);

    if (attention >= 90 && conviction >= 88) return "Crowd Waking Up";
    if (attention >= 80) return "Attention Building";
    if (conviction >= 82) return "Quiet Accumulation";
    if (stock.change < 0) return "Crowd Fading";

    return "Pre-Signal Watch";
  };

  const getFirstSignalStatus = (stock: Stock) => {
    const conviction = getConvictionScore(stock);
    const attention = getAttentionScore(stock);

    if (conviction >= 88 && attention >= 84) return "TOP READ LIVE";
    if (conviction >= 80 || attention >= 80) return "PRESSURE FORMING";
    if (stock.change < 0) return "NO LONG SIGNAL";

    return "WAITING FOR CONFIRMATION";
  };

  const getBeforeCrowdScore = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const rvol = getRelativeVolume(stock);
    const extensionPenalty = Math.abs(stock.change) >= 12 ? 8 : 0;

    return Math.min(
      99,
      Math.max(38, Math.round(signal * 0.42 + attention * 0.4 + rvol * 4 - extensionPenalty)),
    );
  };

  const firstSignal = useMemo(() => {
    const leader = priorityTarget || attentionLeaders[0] || signalLeaders[0] || topStock;

    if (!leader) return null;

    return {
      stock: leader,
      status: getFirstSignalStatus(leader),
      language: getHTSignalLanguage(leader),
      crowdPhase: getCrowdPhase(leader),
      beforeCrowdScore: getBeforeCrowdScore(leader),
      timestamp: mounted && lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live",
    };
  }, [priorityTarget, attentionLeaders, signalLeaders, topStock, lastUpdated, news, traderMode]);

  const firstSignalProofLoop = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget;
    const second = secondaryTarget || convictionLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];

    return [
      {
        label: "Top Conviction",
        value: leader ? `${leader.symbol} pressure detected` : "Scanning",
        note: leader ? `${getBeforeCrowdScore(leader)}/99 before-crowd score` : "Waiting for a clean read",
      },
      {
        label: "Attention Shift",
        value: heat ? `${heat.symbol} heat rising` : "No shift yet",
        note: heat ? `${getAttentionScore(heat)} attention / ${getCrowdPhase(heat)}` : "Crowd still quiet",
      },
      {
        label: "Proof Loop",
        value: leader ? `HT spotted ${leader.symbol}` : "No trigger",
        note: leader ? "Track whether pressure expands after the signal." : "Top Conviction will log here.",
      },
      {
        label: "Next Watch",
        value: second ? second.symbol : "--",
        note: second ? `${getConvictionScore(second)}/99 conviction if rotation hits.` : "No secondary setup yet.",
      },
    ];
  }, [firstSignal, priorityTarget, secondaryTarget, convictionLeaders, attentionLeaders, topMovers, news, traderMode]);


  const signalHistory = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    const second = secondaryTarget || convictionLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];
    const defensive = dangerTarget || topLosers[0];

    return [
      {
        symbol: leader?.symbol || "--",
        event: "HT Top Conviction™",
        result: leader ? `${leader.change >= 0 ? "+" : ""}${leader.change.toFixed(2)}% live move` : "Scanning",
        status: leader && getBeforeCrowdScore(leader) >= 82 ? "Confirmed Pressure" : "Tracking",
        note: leader
          ? `Detected at ${firstSignal?.timestamp || "Live"} with ${leader ? getBeforeCrowdScore(leader) : 0}/99 before-crowd pressure.`
          : "No clean pressure pocket yet.",
      },
      {
        symbol: heat?.symbol || "--",
        event: "Attention Shift",
        result: heat ? `${getAttentionScore(heat)}/99 attention` : "No shift",
        status: heat && getAttentionScore(heat) >= 80 ? "Crowd Waking" : "Watching",
        note: heat
          ? `${getCrowdPhase(heat)} — HT is watching if attention expands into participation.`
          : "Crowd behavior has not separated yet.",
      },
      {
        symbol: second?.symbol || "--",
        event: "Rotation Watch",
        result: second ? `${getConvictionScore(second)}/99 conviction` : "No rotation",
        status: second && getConvictionScore(second) >= 82 ? "Prime Watch" : "Secondary",
        note: second
          ? "If the Top Conviction fades, this is the next pressure pocket HT is monitoring."
          : "No secondary conviction cluster yet.",
      },
      {
        symbol: defensive?.symbol || "--",
        event: "Risk Filter",
        result: defensive ? `${defensive.change.toFixed(2)}% weak tape` : "No danger",
        status: defensive ? "Avoid Chase" : "Clean Tape",
        note: defensive
          ? "HT is filtering weaker names so the trader does not confuse movement with opportunity."
          : "No major downside pressure pocket detected.",
      },
    ];
  }, [firstSignal, priorityTarget, secondaryTarget, convictionLeaders, attentionLeaders, topMovers, topLosers, dangerTarget, news, traderMode]);

  const proofMetrics = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget;
    const bestScore = leader ? getBeforeCrowdScore(leader) : 0;
    const strongSignals = stocks.filter((stock) => getBeforeCrowdScore(stock) >= 78).length;
    const avgPressure = stocks.length
      ? Math.round(stocks.reduce((total, stock) => total + getBeforeCrowdScore(stock), 0) / stocks.length)
      : 0;

    return [
      ["Signals Today", strongSignals || 0, "pressure pockets"],
      ["Flow Accuracy", "Sim", "proof layer"],
      ["Best Signal", leader?.symbol || "--", bestScore ? `${bestScore}/99` : "Scanning"],
      ["Avg Pressure", avgPressure || "--", "board-wide"],
      ["Crowd Status", leader ? getCrowdPhase(leader) : "Scanning", "live read"],
    ];
  }, [stocks, firstSignal, priorityTarget, news, traderMode]);

  const buildPressureStack = (stock: Stock): PressureStack => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const participation = getParticipationScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const hasNews = Boolean(getNewsArticles(stock.symbol)[0]?.headline);
    const newsVelocity = getNewsVelocityScore(stock);
    const newsCatalyst = getNewsCatalystScore(stock);
    const catalystStrength = getCatalystStrength(stock);
    const narrativeSignal = getNarrativeSignal(stock);
    const sentimentScore = getNarrativeSentimentScore(stock);
    const sentimentBias = getNarrativeSentimentBias(stock);
    const hypeScore = getRetailHypeScore(stock);
    const pattern = detectPatternSignal(stock);

    const priceMomentum = clampScore(45 + move * 4 + (stock.change >= 0 ? 8 : -10), 35, 99);
    const relativeVolume = clampScore(rvol * 14, 25, 99);
    const volumeVelocity = clampScore(relativeVolume * 0.7 + attention * 0.3, 25, 99);
    const attentionAcceleration = clampScore(attention * 0.58 + newsVelocity * 0.24 + hypeScore * 0.18, 25, 99);
    const extensionRisk = getExtensionRiskScore(stock);
    const riskRewardQuality = getRiskRewardQualityScore(stock);
    const trapRiskScore = getTrapRiskScore(stock);
    const trapRiskLabel = getTrapRiskLabel(stock) as TrapRiskLabel;
    const entryQualityScore = getEntryQualityScore(stock);
    const qualityGate = getQualityGateLabel(stock) as QualityGateLabel;

    const earlyPressureBonus =
      rvol >= 2.5 && move < 8 && attention >= 68 ? 7 : 0;

    const narrativeEarlyBonus =
      newsVelocity >= 68 && sentimentScore >= 58 && move < 10 ? 5 : 0;

    const patternEarlyBonus =
      pattern.name === "Pressure Coil" || pattern.name === "Quiet Accumulation"
        ? 8
        : pattern.name === "Crowd Ignition"
          ? 6
          : pattern.name === "Continuation Stack"
            ? 5
            : pattern.name === "Exhaustion Risk"
              ? -7
              : pattern.name === "Reclaim Setup"
                ? stock.change < 0 ? -3 : 4
                : 0;

    const lateChasePenalty =
      move >= 18 ? 14 : move >= 12 ? 9 : move >= 8 && extensionRisk >= 72 ? 5 : 0;

    const reclaimPenalty = stock.change < 0 ? 14 : 0;

    const convictionScore = clampScore(
      priceMomentum * 0.12 +
        relativeVolume * 0.11 +
        volumeVelocity * 0.1 +
        attentionAcceleration * 0.12 +
        newsCatalyst * 0.06 +
        newsVelocity * 0.05 +
        sentimentScore * 0.04 +
        hypeScore * 0.035 +
        pattern.score * 0.12 +
        participation * 0.095 +
        continuation * 0.12 +
        riskRewardQuality * 0.12 +
        earlyPressureBonus +
        narrativeEarlyBonus +
        patternEarlyBonus -
        lateChasePenalty -
        reclaimPenalty,
      35,
      99,
    );

    const trapSafety = 99 - trapRiskScore;
    const opportunityScore = clampScore(
      convictionScore * 0.42 +
        entryQualityScore * 0.38 +
        trapSafety * 0.2 -
        (qualityGate === "Reject" ? 24 : qualityGate === "Caution" ? 10 : 0),
      20,
      99,
    );

    const scoreBreakdown: ScoreContribution[] = [
      { label: "Momentum", score: priceMomentum, weight: 12, contribution: Math.round(priceMomentum * 0.12) },
      { label: "Relative Volume", score: relativeVolume, weight: 11, contribution: Math.round(relativeVolume * 0.11) },
      { label: "Volume Velocity", score: volumeVelocity, weight: 10, contribution: Math.round(volumeVelocity * 0.1) },
      { label: "Attention", score: attentionAcceleration, weight: 12, contribution: Math.round(attentionAcceleration * 0.12) },
      { label: "News", score: newsVelocity, weight: 5, contribution: Math.round(newsVelocity * 0.05) },
      { label: "Pattern", score: pattern.score, weight: 12, contribution: Math.round(pattern.score * 0.12) },
      { label: "Participation", score: participation, weight: 10, contribution: Math.round(participation * 0.095) },
      { label: "Continuation", score: continuation, weight: 12, contribution: Math.round(continuation * 0.12) },
      { label: "Risk/Reward", score: riskRewardQuality, weight: 12, contribution: Math.round(riskRewardQuality * 0.12) },
      { label: "Entry Quality", score: entryQualityScore, weight: 32, contribution: Math.round(entryQualityScore * 0.32) },
      { label: "Trap Safety", score: trapSafety, weight: 16, contribution: Math.round(trapSafety * 0.16) },
    ];

    const convictionLabel =
      convictionScore >= 92
        ? "HT Priority"
        : convictionScore >= 86
          ? "Strong Conviction"
          : convictionScore >= 78
            ? "Pressure Building"
            : stock.change < 0
              ? "Reclaim Watch"
              : "Monitor Only";

    const behavioralState =
      pattern.name === "Pressure Coil"
        ? "Pressure coil forming"
        : pattern.name === "Quiet Accumulation"
          ? "Quiet accumulation detected"
          : pattern.name === "Crowd Ignition"
            ? "Crowd ignition forming"
            : pattern.name === "Continuation Stack"
              ? "Continuation stack strengthening"
              : stock.change < 0
                ? "Pressure fading"
                : pattern.name === "Exhaustion Risk" || extensionRisk >= 78
                  ? "Potential exhaustion forming"
                  : hypeScore >= 78 && move < 10
          ? "Retail narrative heating up"
          : newsVelocity >= 78 && move < 10
            ? "Narrative pressure accelerating"
            : sentimentScore <= 42 && newsVelocity >= 60
              ? "Cautious catalyst pressure"
              : convictionScore >= 90
              ? "Breakout pressure building"
              : attention >= 84
                ? "Retail attention accelerating"
                : rvol >= 3 && move < 8
                  ? "Volume conviction strengthening"
                  : "Early pressure forming";

    const warnings: string[] = [];

    if (extensionRisk >= 78) warnings.push("Extension risk is elevated. Avoid emotional chasing.");
    if (stock.change < 0) warnings.push("Weak tape. Wait for reclaim strength.");
    if (attention >= 88 && signal < 76) warnings.push("Crowd attention is high, but setup quality still needs confirmation.");
    if (rvol >= 3 && attention < 75) warnings.push("Volume is expanding before full crowd confirmation.");
    if (newsVelocity >= 78 && move < 8) warnings.push("Narrative is heating up before price fully expands.");
    if (hypeScore >= 80 && extensionRisk >= 70) warnings.push("Retail hype is hot. Protect against late-crowd reversals.");
    if (sentimentScore <= 42 && newsVelocity >= 60) warnings.push("News flow is active, but sentiment is cautious. Demand cleaner confirmation.");
    if (trapRiskLabel === "High Trap Risk") warnings.push("High trap risk. HT should not treat this as a clean entry even if conviction is high.");
    if (qualityGate === "Reject") warnings.push("Quality gate rejected this as a primary momentum opportunity.");
    if (entryQualityScore < 55 && convictionScore >= 80) warnings.push("Conviction is high, but entry quality is weak. Important ticker does not equal clean trade.");
    if (pattern.name === "Pressure Coil") warnings.push("Pressure coil detected. Watch for breakout confirmation before the crowd reacts.");
    if (pattern.name === "Quiet Accumulation") warnings.push("Quiet accumulation detected. This may still need patience before ignition.");
    if (pattern.name === "Crowd Ignition") warnings.push("Crowd ignition is forming. Manage speed and avoid late emotional entries.");

    const behavioralSummary =
      convictionScore >= 88
        ? `${stock.symbol} is showing layered pressure, but HT is validating entry quality and trap risk before calling it a clean opportunity.`
        : stock.change < 0
          ? `${stock.symbol} is not clean yet. HT wants reclaim strength before upgrading conviction.`
          : `${stock.symbol} is developing with a ${pattern.name} read. HT is watching whether pressure becomes real participation.`;

    return {
      symbol: stock.symbol,
      priceMomentum,
      relativeVolume,
      volumeVelocity,
      attentionAcceleration,
      newsCatalyst,
      newsVelocity,
      catalystStrength,
      narrativeSignal,
      sentimentBias,
      sentimentScore,
      hypeScore,
      patternSignal: pattern.name,
      patternScore: pattern.score,
      patternSummary: pattern.summary,
      patternBias: pattern.bias,
      trapRiskScore,
      trapRiskLabel,
      entryQualityScore,
      qualityGate,
      opportunityScore,
      scoreBreakdown,
      participationQuality: participation,
      continuationStrength: continuation,
      extensionRisk,
      riskRewardQuality,
      convictionScore,
      convictionLabel,
      behavioralState,
      behavioralSummary,
      warnings,
    };
  };

  const getHTScore = (stock: Stock) => {
    try {
      const stack = buildPressureStack(stock);
      const base = stack.convictionScore;

      // Catalyst bonus — uses only data already on the stock object or
      // synchronously computed from newsIntel. Does NOT call
      // getBackgroundOpportunityEngine which reads async newsIntel state
      // and made getHTScore non-deterministic (same stock, different calls,
      // different scores depending on newsIntel population order).
      const newsCatalystScore = getNewsCatalystScore(stock);
      const catalystRaw = Math.max(
        stock.catalystScore ?? 0,
        newsCatalystScore >= 55 ? newsCatalystScore * 0.4 : 0
      );

      // Use pressure stack's own continuation/participation data for multiplier
      // These are synchronous and always available — no async state dependency.
      const isStrongContinuation = stack.continuationStrength >= 75;
      const isModerateUp = stack.continuationStrength >= 55;
      const catalystMultiplier = isStrongContinuation ? 1.35 : isModerateUp ? 1.15 : 1.0;

      const catalystBonus = catalystRaw > 0
        ? Math.min(25, catalystRaw * 0.28 * catalystMultiplier)
        : 0;

      const qualityPenalty =
        stack.qualityGate === "Reject" ? 18 :
        stack.qualityGate === "Caution" ? 8 :
        (stack.trapRiskScore ?? 0) >= 70 ? 6 : 0;

      const total = base + catalystBonus - qualityPenalty;
      if (!isFinite(total)) return 0;
      return Math.min(100, Math.max(0, Math.round(total)));
    } catch {
      return 0; // broken data should never pass any gate
    }
  };


  // ── PIPELINE REDESIGN ────────────────────────────────────────────────────
  // Old: Universe → Score Everything → Highest Score Wins
  // New: Universe → Eligibility Gate → getOpportunityScore → Rank → Winner
  //
  // Two separate gates. Two separate ranking philosophies.
  // Catalyst score is a first-class variable in both.
  // ─────────────────────────────────────────────────────────────────────────

  // Stocks that are permanently saturated by institutional ownership and
  // global awareness. These can never qualify for Before The Crowd.
  // A catalyst exception exists: if catalystScore >= 55 AND it's a real
  // event (FDA/Earnings/M&A), even a mega-cap can qualify for BTC.
  const PERMANENTLY_SATURATED = new Set([
    // Mega-cap tech
    "META","AAPL","MSFT","GOOGL","GOOG","AMZN","NVDA","TSLA","NFLX","AVGO",
    "ORCL","CRM","ADBE","NOW","UBER","SHOP","ARM","QCOM","INTC","MU",
    // Major ETFs — never a discovery opportunity
    "SPY","QQQ","IWM","DIA","VTI","VTK","XLK","XLF","XLE","XLI","XLV",
    "XLY","XLC","SMH","ARKK","GLD","SLV","TLT","HYG",
    // Major financials
    "JPM","BAC","GS","MS","WFC","V","MA","AXP","SCHW","BRK","BRK.B",
    // Major consumer / healthcare
    "WMT","COST","TGT","NKE","DIS","SBUX","JNJ","UNH","PFE","MRK",
    "ABBV","LLY","NVO","ISRG",
    // Major energy / industrial
    "XOM","CVX","CAT","GE","BA","LMT","RTX",
    // High-profile retail favorites — permanently crowded, always watched
    // These stocks have millions of retail followers and should never
    // appear as "Before The Crowd" or early SM opportunities
    "HOOD","MSTR","COIN","GME","AMC","PLTR","RDDT","RIVN","SOFI",
  ]);

  // ── Spot Momentum eligibility gate ───────────────────────────────────────
  // SM should only consider stocks where something is actually happening today.
  // Stable large caps with no movement do not represent asymmetric opportunity.
  const qualifiesForSpotMomentum = (stock: Stock): boolean => {
    try {
      const rvol = getRelativeVolume(stock);
      const absChange = Math.abs(stock.change ?? 0);
      const score = getHTScore(stock);
      const hce = isHighConvictionEvent(stock);
      const saturation = getBackgroundOpportunityEngine(stock).crowdSaturationScore;
      const stack = buildPressureStack(stock);
      const extensionRisk = getExtensionRiskScore(stock);

      // Hard floor
      if (score < 50) return false;

      // A crowded stock is not a Spot Momentum opportunity.
      // Crowded means the crowd already arrived — there is no early edge.
      // This applies regardless of how much the stock moved today.
      if (saturation > 65 && !hce) return false;

      // Also block heavily extended moves without a catalyst
      if (extensionRisk >= 75 && !hce) return false;

      // HCE always qualifies regardless of crowd/extension
      if (hce) return (stock.catalystScore ?? 0) >= 35;

      // ETFs never win SM
      const isETF = ["SPY","QQQ","IWM","DIA","VTI","SMH","ARKK","XLK","XLF","XLE","XLI","XLV","XLY","XLC"].includes(stock.symbol);
      if (isETF) return false;

      // Hard exclusion — stocks that are permanently famous regardless of
      // what the computed saturation score says. These will never be
      // early opportunities. Period.
      const isAlwaysCrowded = [
        // Meme/retail favorites
        "HOOD","GME","AMC","MSTR","COIN","RDDT","RIVN","SOFI","DJT",
        // Mega-cap tech — billions of people know these stocks
        "AAPL","MSFT","GOOGL","GOOG","META","AMZN","NVDA","TSLA","NFLX",
        "AVGO","ORCL","CRM","ADBE","PLTR","AMD",
        // Mega-cap semis and hardware
        "TSM","INTC","QCOM","ARM","ASML","MU","AMAT","LRCX","KLAC",
        // Major financials and consumer
        "JPM","BAC","GS","V","MA","WMT","COST","DIS","NKE",
      ].includes(stock.symbol);
      if (isAlwaysCrowded && !hce) return false;

      // No minimum price filter — a stock at $0.21 with real volume
      // is a legitimate opportunity (OTLK ran from $0.21 to $1.60+).
      // Volume is the quality gate, not price.
      // Minimum average daily volume — must be liquid enough to trade
      const avgVol = stock.prevVolume ?? 0;
      if (avgVol > 0 && avgVol < 50000 && !hce) return false;

      // Must have real activity
      return rvol >= 1.15 || absChange >= 0.8;
    } catch { return false; }
  };

  // ── Before The Crowd eligibility gate ────────────────────────────────────
  // BTC requires genuine early positioning. Two layers:
  // Layer 1 — Permanent exclusion (mega caps, major ETFs)
  //   Exception: real catalyst (FDA/Earnings/M&A) with score >= 55 can override
  // Layer 2 — Dynamic checks (saturation, volume, pattern)
  const qualifiesForBeforeTheCrowd = (stock: Stock): boolean => {
    try {
      const rvol = getRelativeVolume(stock);
      const engine = getBackgroundOpportunityEngine(stock);
      const saturation = engine.crowdSaturationScore;
      const pattern = detectPatternSignal(stock).name;
      const hce = isHighConvictionEvent(stock);
      const catalystRaw = stock.catalystScore ?? 0;
      const score = getHTScore(stock);

      // Must have a baseline score
      if (score < 50) return false;

      // Layer 1 — Permanent exclusion check
      if (PERMANENTLY_SATURATED.has(stock.symbol)) {
        // Only exception: extraordinary catalyst (FDA/M&A/Earnings) with strong score
        // even then, saturation must still be reasonable
        if (hce && catalystRaw >= 55 && saturation < 60) return true;
        return false; // Permanently saturated, no exception
      }

      // Layer 2 — Dynamic eligibility
      // HCE with any reasonable activity qualifies
      if (hce && catalystRaw >= 35 && rvol >= 0.9) return true;

      // Non-HCE: must have real volume AND early saturation
      if (rvol >= 1.3 && saturation < 45) return true;

      // Pattern-based qualification — these patterns signal genuine early discovery
      if ((pattern === "Quiet Accumulation" || pattern === "Pressure Coil") && saturation < 55) return true;

      return false;
    } catch { return false; }
  };

  // ── getOpportunityScore — unified ranking signal ──────────────────────────
  // Replaces raw HT Score as the sort key for both engines.
  // Incorporates: HT Score, catalyst quality, crowd earliness,
  // activity level, and market cap awareness.
  //
  // This is what determines which stock wins when multiple candidates qualify.
  const getOpportunityScore = (stock: Stock, mode: "spot_momentum" | "before_the_crowd"): number => {
    try {
      const htScore = getHTScore(stock);
      const rvol = getRelativeVolume(stock);
      const absChange = Math.abs(stock.change ?? 0);
      const engine = getBackgroundOpportunityEngine(stock);
      const saturation = engine.crowdSaturationScore;
      const catalystRaw = stock.catalystScore ?? 0;
      const hce = isHighConvictionEvent(stock);
      const hceCat = getHCECategory(stock);
      const stack = buildPressureStack(stock);
      const isMegaCap = PERMANENTLY_SATURATED.has(stock.symbol);
      const extensionRisk = getExtensionRiskScore(stock);
      const rrQuality = getRiskRewardQualityScore(stock);

      // ── Base: HT Score — structural quality of the stock ───────────────
      // HT Score answers: "Is this stock structurally strong right now?"
      // Opportunity Score answers: "Is this the best tradeable opportunity?"
      let score = htScore;

      // ── Catalyst weight — scaled by event type ──────────────────────────
      // FDA/PDUFA highest — binary outcome, massive moves, known date
      // M&A next — price locked in, clear catalyst
      // Earnings — high impact but two-sided
      // Commercial/Analyst — real but smaller magnitude
      // Catalyst boosts opportunity but does NOT override risk signals
      if (hce && catalystRaw > 0) {
        const catalystWeight =
          hceCat === "FDA / PDUFA" ? 0.55 :
          hceCat === "Acquisition / Merger" ? 0.45 :
          hceCat === "Earnings" ? 0.40 :
          hceCat === "Regulatory / Legal" ? 0.38 :
          hceCat === "Commercial Event" ? 0.28 :
          hceCat === "Analyst Event" ? 0.20 :
          0.25;
        score += Math.min(28, catalystRaw * catalystWeight);
      } else if (catalystRaw >= 30) {
        // Sub-HCE catalyst — still adds signal, smaller weight
        score += Math.min(8, catalystRaw * 0.12);
      }

      // ── Crowd earliness bonus ────────────────────────────────────────────
      // BTC mode weights this much more — it's the core thesis
      if (saturation < 35) score += mode === "before_the_crowd" ? 14 : 5;
      else if (saturation < 45) score += mode === "before_the_crowd" ? 9 : 3;
      else if (saturation < 55) score += mode === "before_the_crowd" ? 4 : 1;
      else if (saturation > 70) score -= mode === "before_the_crowd" ? 12 : 4;
      else if (saturation > 80) score -= mode === "before_the_crowd" ? 18 : 8;

      // ── Activity confirmation — reward real movement ─────────────────────
      // A stock with no movement should never win over one that's actually moving
      if (rvol >= 3.0) score += 10;
      else if (rvol >= 2.0) score += 7;
      else if (rvol >= 1.5) score += 4;
      else if (rvol >= 1.2) score += 2;
      else if (rvol < 0.8) score -= 8;

      if (absChange >= 5) score += 6;
      else if (absChange >= 2) score += 3;
      else if (absChange >= 0.5) score += 1;
      else if (absChange < 0.2 && !hce) score -= 6; // flat with no catalyst = no opportunity

      // ── Extension risk penalty ───────────────────────────────────────────
      // Extended moves have less remaining opportunity — penalize proportionally
      // HCE stocks get a lighter penalty (extended moves on FDA can still run)
      if (extensionRisk >= 85) score -= hce ? 8 : 18;
      else if (extensionRisk >= 75) score -= hce ? 5 : 12;
      else if (extensionRisk >= 65) score -= hce ? 2 : 7;
      else if (extensionRisk < 30) score += 4; // low extension = more room

      // ── Risk/Reward quality ──────────────────────────────────────────────
      // Higher R/R quality = better opportunity, scaled modestly
      if (rrQuality >= 80) score += 8;
      else if (rrQuality >= 65) score += 4;
      else if (rrQuality < 35) score -= 6;
      else if (rrQuality < 20) score -= 12;

      // ── Liquidity quality proxy ──────────────────────────────────────────
      // Very low-priced stocks (<$1) have spread/liquidity issues
      // Very high volume with tiny price = risk of manipulation
      const price = stock.price ?? 0;
      if (price < 1) score -= 10;
      else if (price < 2) score -= 5;
      else if (price > 5 && rvol >= 1.2) score += 2; // liquid + active = quality

      // ── Market cap / awareness penalty ───────────────────────────────────
      // Mega-caps that somehow passed the gate still rank much lower
      // Ensures small genuine opportunities beat large stable stocks
      if (isMegaCap) score -= 20;
      else if (["TSLA","COIN","HOOD","MSTR","PLTR"].includes(stock.symbol)) score -= 4;

      // ── Pattern quality ──────────────────────────────────────────────────
      const pattern = detectPatternSignal(stock).name;
      if (pattern === "Pressure Coil") score += 8;
      else if (pattern === "Quiet Accumulation") score += 6;
      else if (pattern === "Continuation Stack") score += 4;
      else if (pattern === "Exhaustion Risk") score -= 14;

      // ── Structural risk penalties ────────────────────────────────────────
      if (stack.qualityGate === "Reject") score -= 15;
      else if (stack.qualityGate === "Caution") score -= 5;
      if (stack.trapRiskScore >= 78 && !hce) score -= 10;
      else if (stack.trapRiskScore >= 65 && !hce) score -= 5;

      return Math.min(150, Math.max(0, Math.round(score)));
    } catch { return 0; }
  };

  // ── DECISION TRACE ───────────────────────────────────────────────────────
  // Pure function. Answers three questions for every pick:
  //   Why this stock? → primaryDrivers
  //   Why now?        → opportunityScore + confidence
  //   Why not others? → rejectedAlternatives
  //
  // This is what separates HT Labs from a scanner.
  // A scanner shows data. A decision engine explains its reasoning.
  // ─────────────────────────────────────────────────────────────────────────
  const buildDecisionTrace = (
    winner: Stock,
    allStocks: Stock[],
    mode: "spot_momentum" | "before_the_crowd"
  ): {
    opportunityScore: number;
    confidence: "High" | "Moderate" | "Early" | "Speculative";
    primaryDrivers: string[];
    rejectedAlternatives: { symbol: string; reason: string }[];
    candidatesEvaluated: number;
  } => {
    try {
      const oppScore = getOpportunityScore(winner, mode);
      const confidence: "High" | "Moderate" | "Early" | "Speculative" =
        oppScore >= 100 ? "High" : oppScore >= 80 ? "Moderate" : oppScore >= 65 ? "Early" : "Speculative";

      const htScore = getHTScore(winner);
      const rvol = getRelativeVolume(winner);
      const saturation = getBackgroundOpportunityEngine(winner).crowdSaturationScore;
      const catalystRaw = winner.catalystScore ?? 0;
      const hce = isHighConvictionEvent(winner);
      const hceCat = getHCECategory(winner);
      const extensionRisk = getExtensionRiskScore(winner);
      const rrQuality = getRiskRewardQualityScore(winner);
      const pattern = detectPatternSignal(winner).name;
      const stack = buildPressureStack(winner);
      const absChange = Math.abs(winner.change ?? 0);

      // ── Primary Drivers — what made this stock win ──────────────────────
      const drivers: { label: string; magnitude: number }[] = [];

      // HT Score base quality
      if (htScore >= 80) drivers.push({ label: `HT Score ${htScore} — strong structural quality`, magnitude: htScore * 0.3 });
      else if (htScore >= 65) drivers.push({ label: `HT Score ${htScore} — solid setup quality`, magnitude: htScore * 0.2 });

      // Catalyst — most impactful single factor
      if (hce && catalystRaw > 0) {
        const catLabel =
          hceCat === "FDA / PDUFA" ? `FDA/PDUFA catalyst — binary outcome event` :
          hceCat === "Earnings" ? `Earnings catalyst — high-impact event` :
          hceCat === "Acquisition / Merger" ? `M&A catalyst — price target event` :
          hceCat === "Regulatory / Legal" ? `Regulatory catalyst active` :
          hceCat === "Commercial Event" ? `Commercial catalyst — partnership/contract` :
          hceCat === "Analyst Event" ? `Analyst upgrade driving attention` :
          `Verified catalyst event (score ${catalystRaw})`;
        drivers.push({ label: catLabel, magnitude: catalystRaw * 0.55 });
      } else if (catalystRaw >= 30) {
        drivers.push({ label: `Catalyst signal present — score ${catalystRaw}`, magnitude: catalystRaw * 0.15 });
      }

      // Crowd saturation
      if (saturation < 35) drivers.push({ label: `Crowd saturation ${saturation} — very early window open`, magnitude: mode === "before_the_crowd" ? 14 : 6 });
      else if (saturation < 45) drivers.push({ label: `Crowd saturation ${saturation} — early positioning available`, magnitude: mode === "before_the_crowd" ? 9 : 3 });

      // Volume activity
      if (rvol >= 3.0) drivers.push({ label: `Relative volume ${rvol.toFixed(1)}× — unusual activity detected`, magnitude: 10 });
      else if (rvol >= 2.0) drivers.push({ label: `Relative volume ${rvol.toFixed(1)}× above baseline`, magnitude: 7 });
      else if (rvol >= 1.5) drivers.push({ label: `Volume ${rvol.toFixed(1)}× above average`, magnitude: 4 });

      // Price action
      if (absChange >= 5) drivers.push({ label: `Price ${winner.change >= 0 ? "+" : ""}${winner.change?.toFixed(1)}% — strong price confirmation`, magnitude: 6 });
      else if (absChange >= 2) drivers.push({ label: `Price ${winner.change >= 0 ? "+" : ""}${winner.change?.toFixed(1)}% — active movement`, magnitude: 3 });

      // Pattern
      if (pattern === "Pressure Coil") drivers.push({ label: "Pressure Coil — breakout tension building before ignition", magnitude: 8 });
      else if (pattern === "Quiet Accumulation") drivers.push({ label: "Quiet Accumulation — smart money positioning detected", magnitude: 6 });
      else if (pattern === "Continuation Stack") drivers.push({ label: "Continuation Stack — momentum layering confirmed", magnitude: 4 });

      // R/R quality
      if (rrQuality >= 80) drivers.push({ label: "Risk/reward quality — favorable asymmetric setup", magnitude: 8 });
      else if (rrQuality >= 65) drivers.push({ label: "Risk/reward quality — acceptable entry conditions", magnitude: 4 });

      // Low extension (positive signal)
      if (extensionRisk < 30) drivers.push({ label: "Low extension risk — significant room remaining", magnitude: 5 });

      const primaryDrivers = drivers
        .sort((a, b) => b.magnitude - a.magnitude)
        .slice(0, 4)
        .map(d => d.label);

      // ── Rejected Alternatives — why not others ──────────────────────────
      const rejectedAlternatives: { symbol: string; reason: string }[] = [];
      const gate = mode === "spot_momentum" ? qualifiesForSpotMomentum : qualifiesForBeforeTheCrowd;

      // Check notable stocks a trader would wonder about
      const notableSymbols = ["META","NVDA","AAPL","MSFT","GOOGL","AMZN","TSLA","SPY","QQQ"];
      for (const sym of notableSymbols) {
        if (sym === winner.symbol) continue;
        if (rejectedAlternatives.length >= 2) break;
        const stock = allStocks.find(s => s.symbol === sym);
        if (!stock) continue;

        if (PERMANENTLY_SATURATED.has(sym)) {
          rejectedAlternatives.push({ symbol: sym, reason: "Permanently saturated — not a discovery opportunity" });
        } else if (!gate(stock)) {
          const absChg = Math.abs(stock.change ?? 0);
          const rvolS = getRelativeVolume(stock);
          rejectedAlternatives.push({
            symbol: sym,
            reason: absChg < 0.5 && rvolS < 1.1
              ? "No meaningful activity — flat with normal volume"
              : "Did not meet eligibility threshold",
          });
        } else {
          const theirScore = getOpportunityScore(stock, mode);
          const diff = oppScore - theirScore;
          if (diff > 5) {
            const theirExt = getExtensionRiskScore(stock);
            const theirSat = getBackgroundOpportunityEngine(stock).crowdSaturationScore;
            const theirRvol = getRelativeVolume(stock);
            const reason =
              theirExt >= 75 ? `Extension risk elevated — less remaining opportunity` :
              theirSat > 65 ? `Crowd saturation ${theirSat} — window narrowing` :
              theirRvol < 1.0 ? `Volume insufficient to confirm setup` :
              `Opportunity score ${theirScore} vs ${oppScore} — lower conviction`;
            rejectedAlternatives.push({ symbol: sym, reason });
          }
        }
      }

      // Add runner-up from actual candidate pool
      const runnerUp = allStocks
        .filter(s => s.symbol !== winner.symbol && gate(s))
        .map(s => ({ stock: s, score: getOpportunityScore(s, mode) }))
        .sort((a, b) => b.score - a.score)[0];

      if (runnerUp && !rejectedAlternatives.find(r => r.symbol === runnerUp.stock.symbol)) {
        const theirExt = getExtensionRiskScore(runnerUp.stock);
        const theirSat = getBackgroundOpportunityEngine(runnerUp.stock).crowdSaturationScore;
        const diff = oppScore - runnerUp.score;
        const reason =
          diff > 25 ? `Opportunity score ${runnerUp.score} — significantly lower conviction` :
          theirExt >= 70 ? `Extension risk reducing remaining opportunity` :
          theirSat > 60 ? `Crowd more saturated (${theirSat}) — later in window` :
          `Opportunity score ${runnerUp.score} vs ${oppScore}`;
        rejectedAlternatives.push({ symbol: runnerUp.stock.symbol, reason });
      }

      // Count candidates the gate actually evaluated
      const candidatesEvaluated = allStocks.filter(gate).length;

      return {
        opportunityScore: oppScore,
        confidence,
        primaryDrivers,
        rejectedAlternatives: rejectedAlternatives.slice(0, 3),
        candidatesEvaluated,
      };
    } catch {
      return {
        opportunityScore: 0,
        confidence: "Speculative",
        primaryDrivers: [],
        rejectedAlternatives: [],
        candidatesEvaluated: 0,
      };
    }
  };


  // Shows top 5 candidates with full score breakdown so we can verify
  // the engine is making the right decisions. Logs to console only.
  const logSelectionDebug = (
    candidates: Stock[],
    winner: Stock | null,
    mode: "spot_momentum" | "before_the_crowd",
    gate: (s: Stock) => boolean
  ) => {
    if (typeof window === "undefined") return; // server only
    if (!window.location.hostname.includes("localhost")) return; // dev only
    try {
      const qualified = candidates.filter(gate);
      const ranked = qualified
        .map(s => ({
          symbol: s.symbol,
          htScore: getHTScore(s),
          catalystScore: s.catalystScore ?? 0,
          oppScore: getOpportunityScore(s, mode),
          saturation: getBackgroundOpportunityEngine(s).crowdSaturationScore,
          rvol: getRelativeVolume(s).toFixed(2),
          hce: isHighConvictionEvent(s),
          isMegaCap: PERMANENTLY_SATURATED.has(s.symbol),
          passedGate: gate(s),
        }))
        .sort((a, b) => b.oppScore - a.oppScore)
        .slice(0, 5);

      const metaData = candidates.find(s => s.symbol === "META");
      if (metaData) {
        const metaGate = gate(metaData);
        console.log(`[HT ${mode.toUpperCase()}] META debug:`, {
          passedGate: metaGate,
          htScore: getHTScore(metaData),
          catalystScore: metaData.catalystScore ?? 0,
          oppScore: getOpportunityScore(metaData, mode),
          saturation: getBackgroundOpportunityEngine(metaData).crowdSaturationScore,
          rvol: getRelativeVolume(metaData).toFixed(2),
          isMegaCap: PERMANENTLY_SATURATED.has("META"),
          reason: metaGate ? "PASSED gate (unexpected)" : "BLOCKED by eligibility gate",
        });
      }

      console.log(`[HT ${mode.toUpperCase()}] Top 5 candidates:`, ranked);
      console.log(`[HT ${mode.toUpperCase()}] Winner: ${winner?.symbol ?? "NONE"} | oppScore: ${winner ? getOpportunityScore(winner, mode) : 0} | htScore: ${winner ? getHTScore(winner) : 0}`);
    } catch (e) {
      console.warn("[HT debug] logging error:", e);
    }
  };


  const getBehaviorNarrative = (stock: Stock) => {
    const stack = buildPressureStack(stock);
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const extensionRisk = getExtensionRiskScore(stock);

    const base = {
      patternScore: stack.patternScore,
      convictionScore: stack.convictionScore,
      behaviorLabel: stack.behavioralState,
      operatorDirective: "Let the evidence lead. HT is prioritizing pressure quality over emotional price chasing.",
    };

    if (stack.patternSignal === "Crowd Ignition") {
      return {
        ...base,
        patternTitle: "CROWD IGNITION",
        behaviorRead: "Retail attention is accelerating while volume participation expands across the active board.",
        pressureSummary: "HT is detecting narrative pressure building before the crowd fully confirms the move. The setup is no longer just green — attention, participation, and market behavior are starting to stack together.",
        continuationOutlook: continuation >= 82
          ? "Continuation probability is improving while volume expansion stays intact. Watch whether buyers defend the first pullback instead of chasing vertical candles."
          : "Continuation is possible, but HT still needs cleaner follow-through after the first pressure burst.",
        riskState: extensionRisk >= 72 ? "Fast tape / elevated chase risk" : "Moderate aggression",
        operatorDirective: "Treat this like an early crowd-expansion read. Speed matters, but discipline matters more.",
      };
    }

    if (stack.patternSignal === "Exhaustion Risk") {
      return {
        ...base,
        patternTitle: "PARABOLIC EXTENSION",
        behaviorRead: "Price expansion is beginning to outrun healthy continuation structure.",
        pressureSummary: "Late-stage participation is increasing while extension risk rises. The move can keep running, but HT is warning that emotional entries are now easier to punish.",
        continuationOutlook: "Continuation is still possible, but risk/reward quality is weakening. Favor pullbacks, reclaims, and protected profit windows over late-chase entries.",
        riskState: "Aggressive / elevated volatility",
        operatorDirective: "Protect capital first. If the crowd is late, HT does not want the user becoming exit liquidity.",
      };
    }

    if (stack.patternSignal === "Quiet Accumulation") {
      return {
        ...base,
        patternTitle: "SMART MONEY ACCUMULATION",
        behaviorRead: "Relative volume is increasing while price remains controlled.",
        pressureSummary: "HT is detecting stealth participation before broader retail expansion. This is the kind of setup that can look quiet before the tape starts reacting.",
        continuationOutlook: "Early-stage breakout pressure may be forming. Confirmation improves if volume keeps rising without price overextending.",
        riskState: "Controlled / constructive",
        operatorDirective: "Patience setup. The edge is watching pressure build before the obvious breakout candle.",
      };
    }

    if (stack.patternSignal === "Pressure Coil") {
      return {
        ...base,
        patternTitle: "PRESSURE COIL",
        behaviorRead: "Volume and attention are building while price has not fully expanded yet.",
        pressureSummary: "HT is watching compression turn into pressure. This is an early-alert structure where the market may be preparing for a stronger directional move.",
        continuationOutlook: "Breakout pressure improves if buyers keep absorbing dips and volume stays above normal before confirmation.",
        riskState: "Constructive / waiting for trigger",
        operatorDirective: "Do not force it yet. Let the trigger confirm while HT tracks the pressure underneath.",
      };
    }

    if (stack.patternSignal === "Continuation Stack") {
      return {
        ...base,
        patternTitle: "CONTINUATION STACK",
        behaviorRead: "Momentum is holding while participation and signal quality keep confirming.",
        pressureSummary: "HT is seeing evidence that the move still has structure, not just hype. Buyers are attempting to sustain control after the first expansion.",
        continuationOutlook: "Continuation remains favored while volume retention and higher-low behavior stay intact.",
        riskState: extensionRisk >= 70 ? "Active / manage extension" : "Active / healthy continuation",
        operatorDirective: "Manage the move like a runner. Respect profit windows and do not ignore weakening participation.",
      };
    }

    if (stack.patternSignal === "Reclaim Setup") {
      return {
        ...base,
        patternTitle: "RECLAIM SETUP",
        behaviorRead: "Weak tape is showing early signs of buyer interest returning.",
        pressureSummary: "HT is not calling this clean yet. The system is watching whether buyers can reclaim control with volume instead of producing a weak bounce.",
        continuationOutlook: "Upside modeling improves only after reclaim strength appears and participation confirms.",
        riskState: "Defensive / confirmation required",
        operatorDirective: "Stand down until buyers prove control. No forced long bias.",
      };
    }

    return {
      ...base,
      patternTitle: move >= 8 && attention >= 84 ? "LATE CROWD PRESSURE" : "EARLY PRESSURE WATCH",
      behaviorRead: stack.behavioralSummary,
      pressureSummary: `${stock.symbol} has ${rvol}x relative volume, ${attention}/99 attention, and ${stack.convictionScore}/99 HT conviction. HT is waiting for a cleaner behavioral fingerprint before upgrading the read.`,
      continuationOutlook: "Monitor only until pressure separates from noise. Confirmation matters more than prediction here.",
      riskState: extensionRisk >= 72 ? "Elevated / wait for cleaner entry" : "Controlled / developing",
      operatorDirective: "Keep it on the board, but do not treat it like the main thesis until pattern quality improves.",
    };
  };

  const getSimpleConvictionRead = (stock: Stock) => {
    const stack = buildPressureStack(stock);
    const move = Math.abs(stock.change);
    const attention = getAttentionScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const riskReward = getRiskRewardQualityScore(stock);
    const extensionRisk = getExtensionRiskScore(stock);
    const pattern = stack.patternSignal;
    const entryQuality = stack.entryQualityScore;
    const trapRisk = stack.trapRiskScore;
    const qualityGate = stack.qualityGate;

    let state = "⚡ Pressure Building";
    let opinion = "More traders are noticing this setup, but it is not crowded yet.";
    let risk = "Controlled aggression";
    let operatorRead = "Stay patient. Let the setup confirm before acting.";

    if (qualityGate === "Reject" || trapRisk >= 72 || entryQuality < 45) {
      state = "💣 Volatility Trap";
      opinion = "This is moving fast, but the entry is not clean right now. Better to wait.";
      risk = "Avoid chase";
      operatorRead = "Do not chase this. The move is extended. Wait for a pullback or reset.";
    } else if (qualityGate === "Caution" || trapRisk >= 52 || entryQuality < 62) {
      state = "⏳ Wait for Pullback";
      opinion = "Good setup, but the ideal entry has passed. Wait for it to pull back first.";
      risk = "Caution";
      operatorRead = "Let the initial move calm down. A cleaner entry may come after it stabilizes.";
    } else if (stock.change < 0 || pattern === "Reclaim Setup") {
      state = "📉 Buyers Needed";
      opinion = "The price is dropping. Wait for buyers to take back control before acting.";
      risk = "Defensive";
      operatorRead = "Stay out for now. Wait for buyers to show up with volume before acting.";
    } else if (pattern === "Exhaustion Risk" || extensionRisk >= 78 || move >= 12) {
      state = "⚠️ Exhaustion Risk";
      opinion = "This has already moved a lot. Chasing it now is risky.";
      risk = "Late chase risk";
      operatorRead = "If you are already in, protect your profits. Do not enter for the first time here.";
    } else if (pattern === "Quiet Accumulation" || pattern === "Pressure Coil") {
      state = "👀 Quiet Accumulation";
      opinion = "Interest is building quietly before the crowd notices. This is early.";
      risk = "Constructive";
      operatorRead = "Keep watching. Do not force an entry — let the setup confirm first.";
    } else if (pattern === "Crowd Ignition" || attention >= 86) {
      state = "🔥 Crowd Igniting";
      opinion = "More traders are noticing this setup, but it is not crowded yet.";
      risk = extensionRisk >= 68 ? "Moderate aggression" : "Controlled aggression";
      operatorRead = "Momentum is real, but do not chase it. Let the pressure confirm before acting.";
    } else if (pattern === "Continuation Stack" || continuation >= 82) {
      state = "🌊 Momentum Wave";
      opinion = "The move is holding and more buyers keep joining. Momentum is intact.";
      risk = extensionRisk >= 70 ? "Manage extension" : "Constructive";
      operatorRead = "The move has legs. Stay in if you are already positioned, but watch for signs of slowing.";
    } else if (stack.convictionScore < 72 || riskReward < 58) {
      state = "🧲 Attention Building";
      opinion = "Too early to act. HT is watching for stronger confirmation before flagging this.";
      risk = "Wait for clarity";
      operatorRead = "Nothing to do here yet. Keep scanning for a cleaner opportunity.";
    }

    const backgroundRead = getBackgroundOpportunityEngine(stock);
    const discoveryRead =
      backgroundRead.opportunityWindow === "EARLY WINDOW OPEN"
        ? `The crowd has not piled in yet. This is still early — the best time to be watching.`
        : backgroundRead.opportunityWindow === "EARLY WINDOW BUILDING"
          ? `Momentum is building before the crowd fully arrives. HT wants one more confirmation.`
          : backgroundRead.opportunityWindow === "CONFIRMATION PHASE"
            ? `The setup is valid but past peak early entry. Proceed with more caution.`
            : backgroundRead.opportunityWindow === "CROWD ARRIVED"
              ? `The crowd has arrived. The early advantage is mostly gone. Be selective.`
              : `This move looks late and crowded. HT is filtering it out to protect you from chasing.`;

    return {
      state,
      opinion,
      risk,
      operatorRead,
      discoveryRead,
      discoveryScore: backgroundRead.discoveryScore,
      fingerprintScore: backgroundRead.fingerprintScore,
      fingerprintMatch: backgroundRead.fingerprintMatch,
      accelerationScore: backgroundRead.accelerationScore,
      accelerationLabel: backgroundRead.accelerationLabel,
      crowdSaturationScore: backgroundRead.crowdSaturationScore,
      crowdSaturationLevel: backgroundRead.crowdSaturationLevel,
      opportunityWindow: backgroundRead.opportunityWindow,
      score: stack.opportunityScore,
      scoreLabel: `HT EDGE ${stack.opportunityScore}`,
      convictionScore: stack.convictionScore,
      entryQuality,
      trapRisk,
      qualityGate,
      timingQuality: getTimingQualityLabel(stock),
      internalPattern: stack.patternSignal,
    };
  };

  const getSignalMemoryStatus = (engine: BackgroundOpportunityEngine): SignalMemoryStatus => {
    if (engine.tooLate || engine.qualityGate === "Reject") return "fake_momentum";
    if (engine.consumerLabel === "Top Conviction" && engine.opportunityWindowOpen) return "tracking";
    if (engine.consumerLabel === "Strong Watch" || engine.consumerLabel === "Developing") return "watching";

    return "tracking";
  };

  const buildSignalMemoryPayload = (stock: Stock): SignalMemoryPayload | null => {
    if (!session?.user?.id) return null;

    const engine = getBackgroundOpportunityEngine(stock);
    const read = getSimpleConvictionRead(stock);

    return {
      user_id: session.user.id,
      symbol: stock.symbol,
      picked_at: new Date().toISOString(),
      entry_price: Number(stock.price || 0),
      change_percent: Number(stock.change || 0),
      ht_score: read.score,
      final_score: engine.finalScore,
      discovery_score: engine.discoveryScore,
      acceleration_score: engine.accelerationScore,
      fingerprint_score: engine.fingerprintScore,
      crowd_saturation_score: engine.crowdSaturationScore,
      opportunity_window: engine.opportunityWindow,
      opportunity_window_open: engine.opportunityWindowOpen,
      pattern: engine.pattern,
      contender_status: engine.contenderStatus,
      quality_gate: engine.qualityGate,
      trap_risk: engine.trapRisk,
      entry_quality: engine.entryQuality,
      participation: engine.participation,
      continuation: engine.continuation,
      consumer_label: engine.consumerLabel,
      discovery_read: read.discoveryRead,
      internal_reason: engine.internalReason,
      status: getSignalMemoryStatus(engine),
    };
  };

  const saveTopConvictionToMemory = async (stock: Stock) => {
    if (!session?.user?.id) {
      return;
    }

    const payload = buildSignalMemoryPayload(stock);
    if (!payload) return;

    const memoryKey = `${payload.user_id}-${payload.symbol}-${payload.opportunity_window}-${new Date().toISOString().slice(0, 13)}`;

    if (lastSignalMemoryKey.current === memoryKey) return;
    lastSignalMemoryKey.current = memoryKey;

    try {
      const since = new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString();
      const { data: recentExisting, error: lookupError } = await supabase
        .from("ht_signal_memory")
        .select("id")
        .eq("user_id", payload.user_id)
        .eq("symbol", payload.symbol)
        .gte("picked_at", since)
        .limit(1);

      if (lookupError) {
        console.error("SIGNAL MEMORY LOOKUP ERROR:", lookupError);
        return;
      }

      if (recentExisting && recentExisting.length > 0) {
        return;
      }

      const { error } = await supabase.from("ht_signal_memory").insert(payload);

      if (error) {
        console.error("SIGNAL MEMORY INSERT ERROR:", error);
        return;
      }
    } catch (error) {
      console.error("SIGNAL MEMORY SAVE ERROR:", error);
    }
  };


  // ── Before The Crowd pick logging ──
  const logBeforeCrowdPick = async (stock: Stock) => {
    if (!session?.user?.id) return;
    try {
      const score = getHTScore(stock);
      const { error } = await supabase.from("ht_before_crowd_log").insert({
        user_id: session.user.id,
        symbol: stock.symbol,
        picked_at: new Date().toISOString(),
        entry_price: Number(stock.price || 0),
        change_percent: Number(stock.change || 0),
        ht_score: score,
        outcome_status: null,
        price_after_1d: null,
        price_after_3d: null,
        price_after_5d: null,
        graded_at: null,
      });
      if (error) console.warn("[BTC Log]:", error.message);
    } catch (err) {
      console.warn("[BTC Log] Error:", err);
    }
  };


  const getOutcomeLabel = (
    row: SignalMemoryRow,
    currentReturnPct: number,
    maxGain: number,
    maxDrawdown: number,
    ageHours: number,
  ): OutcomeStatus => {
    const discovery = Number(row.discovery_score || 0);
    const acceleration = Number(row.acceleration_score || 0);
    const saturation = Number(row.crowd_saturation_score || 0);
    const window = String(row.opportunity_window || "");
    const hadStrongSetup = discovery >= 78 && acceleration >= 68;
    const crowdWasHot = saturation >= 70 || window === "CROWD ARRIVED" || window === "EXHAUSTION RISK";

    // Strong winners are the signals HT should learn from first.
    if (maxGain >= 18 || currentReturnPct >= 15) return "strong_winner";
    if (maxGain >= 10 || currentReturnPct >= 10) return "winner";

    // Trap = the setup moved against the original read before proving upside follow-through.
    if (ageHours >= 24 && maxDrawdown <= -8 && maxGain < 5 && crowdWasHot) {
      return "trap";
    }

    // Failed momentum = the setup looked strong on discovery/acceleration but did not follow through.
    if (ageHours >= 48 && maxGain < 4 && currentReturnPct <= 1.5 && hadStrongSetup) {
      return "failed_momentum";
    }

    if (ageHours >= 24 && currentReturnPct <= -5 && crowdWasHot) {
      return "failed_momentum";
    }

    if (ageHours >= 72 && currentReturnPct <= -3) return "failed";
    if (ageHours >= 120 && maxGain < 5 && currentReturnPct > -3 && currentReturnPct < 5) return "neutral";

    return "tracking";
  };

  const getOutcomeSuccessScore = (
    currentReturnPct: number,
    maxGain: number,
    maxDrawdown: number,
    outcomeStatus: OutcomeStatus,
  ) => {
    const statusBoost =
      outcomeStatus === "strong_winner"
        ? 28
        : outcomeStatus === "winner"
          ? 18
          : outcomeStatus === "neutral"
            ? 0
            : outcomeStatus === "failed"
              ? -16
              : outcomeStatus === "failed_momentum" || outcomeStatus === "fake_momentum"
                ? -24
                : outcomeStatus === "trap"
                  ? -30
                  : 0;

    return clampScore(
      50 + maxGain * 3.2 + currentReturnPct * 1.35 + maxDrawdown * 1.25 + statusBoost,
      0,
      99,
    );
  };

  const evaluateTrackedSignalOutcomes = async () => {
    if (!session?.user?.id) return;

    const evaluationKey = `${session.user.id}-${new Date().toISOString().slice(0, 13)}`;
    if (lastOutcomeEvaluationKey.current === evaluationKey) return;
    lastOutcomeEvaluationKey.current = evaluationKey;

    try {
      const { data, error } = await supabase
        .from("ht_signal_memory")
        .select(
          "id,symbol,entry_price,picked_at,discovery_score,acceleration_score,crowd_saturation_score,opportunity_window,status,outcome_status,max_gain,max_drawdown,price_1d,price_3d,price_5d",
        )
        .eq("user_id", session.user.id)
        .in("status", ["tracking", "watching", "fake_momentum"])
        .order("picked_at", { ascending: false })
        .limit(24);

      if (error) {
        console.error("SIGNAL OUTCOME LOOKUP ERROR:", error);
        return;
      }

      const rows = (data || []) as SignalMemoryRow[];
      if (!rows.length) return;

      let updates = 0;

      for (const row of rows) {
        const entryPrice = Number(row.entry_price || 0);
        if (!entryPrice || !row.symbol || !row.picked_at) continue;

        const pickedAt = new Date(row.picked_at).getTime();
        const ageHours = (Date.now() - pickedAt) / (1000 * 60 * 60);

        // Avoid over-writing brand new records. HT needs a little time before judging the signal.
        if (ageHours < 0.25) continue;

        const quoteRes = await fetch(`/api/quote?symbol=${row.symbol}`);
        const quoteData = await quoteRes.json();
        const currentQuote = { price: Number(quoteData.c || 0), change: Number(quoteData.dp || 0) };
        const currentPrice = Number(currentQuote.price || 0);
        if (!currentPrice) continue;

        const currentReturnPct = Number((((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2));
        const previousMaxGain = Number(row.max_gain ?? currentReturnPct);
        const previousMaxDrawdown = Number(row.max_drawdown ?? currentReturnPct);
        const maxGain = Number(Math.max(previousMaxGain, currentReturnPct).toFixed(2));
        const maxDrawdown = Number(Math.min(previousMaxDrawdown, currentReturnPct).toFixed(2));
        const outcomeStatus = getOutcomeLabel(row, currentReturnPct, maxGain, maxDrawdown, ageHours);
        const successScore = getOutcomeSuccessScore(currentReturnPct, maxGain, maxDrawdown, outcomeStatus);

        const updatePayload: Record<string, number | string | null> = {
          max_gain: maxGain,
          max_drawdown: maxDrawdown,
          outcome_status: outcomeStatus,
          success_score: successScore,
          evaluated_at: new Date().toISOString(),
        };

        if (ageHours >= 20 && row.price_1d === null) updatePayload.price_1d = currentPrice;
        if (ageHours >= 68 && row.price_3d === null) updatePayload.price_3d = currentPrice;
        if (ageHours >= 116 && row.price_5d === null) updatePayload.price_5d = currentPrice;

        const { error: updateError } = await supabase
          .from("ht_signal_memory")
          .update(updatePayload)
          .eq("id", row.id)
          .eq("user_id", session.user.id);

        if (updateError) {
          console.error("SIGNAL OUTCOME UPDATE ERROR:", updateError);
          continue;
        }

        updates += 1;
      }

      if (updates > 0) {
      }
    } catch (error) {
      console.error("SIGNAL OUTCOME EVALUATION ERROR:", error);
    }
  };

  const loadSignalMemoryIntelligence = async () => {
    if (!session?.user?.id) {
      setSignalMemoryInsight(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("ht_signal_memory")
        .select("outcome_status,status,discovery_score,acceleration_score,crowd_saturation_score,trap_risk,ht_score,pattern")
        .eq("user_id", session.user.id)
        .order("picked_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("SIGNAL MEMORY INTELLIGENCE ERROR:", error);
        return;
      }

      const rows = (data || []) as Array<{
        outcome_status: string | null;
        status: string | null;
        discovery_score: number | null;
        acceleration_score: number | null;
        crowd_saturation_score: number | null;
        trap_risk: number | null;
        ht_score: number | null;
        pattern: string | null;
      }>;

      const tracked = rows.length;
      if (!tracked) {
        setSignalMemoryInsight({
          tracked: 0,
          winners: 0,
          failures: 0,
          traps: 0,
          tracking: 0,
          successRate: null,
          confidenceStatus: "Developing",
          confidenceLabel: "Confidence developing",
          winnerDNA: "Winner DNA: collecting outcome data...",
          failureDNA: "Failure DNA: collecting outcome data...",
          summary: "HT confidence is online and waiting for tracked outcomes.",
        });
        return;
      }

      const outcomeFor = (row: { outcome_status: string | null; status: string | null }) =>
        String(row.outcome_status || row.status || "tracking").toLowerCase();

      const winnerRows = rows.filter((row) => ["strong_winner", "winner"].includes(outcomeFor(row)));
      const failureRows = rows.filter((row) => ["failed", "failed_momentum", "fake_momentum", "trap"].includes(outcomeFor(row)));
      const trapRows = rows.filter((row) => ["trap", "fake_momentum", "failed_momentum"].includes(outcomeFor(row)));
      const trackingRows = rows.filter((row) => ["tracking", "watching"].includes(outcomeFor(row)));
      const gradedCount = winnerRows.length + failureRows.length;
      const successRate = gradedCount ? Math.round((winnerRows.length / gradedCount) * 100) : null;

      const avg = (items: typeof rows, field: keyof (typeof rows)[number]) => {
        const values = items
          .map((item) => Number(item[field] || 0))
          .filter((value) => Number.isFinite(value) && value > 0);

        if (!values.length) return 0;
        return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
      };

      const topPattern = (items: typeof rows) => {
        const counts = items.reduce<Record<string, number>>((acc, item) => {
          const pattern = String(item.pattern || "Unknown");
          acc[pattern] = (acc[pattern] || 0) + 1;
          return acc;
        }, {});

        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Building";
      };

      const winnerDNA = winnerRows.length >= 5
        ? `Winner DNA: Discovery ${avg(winnerRows, "discovery_score")}, Acceleration ${avg(winnerRows, "acceleration_score")}, HT Score ${avg(winnerRows, "ht_score")}, Pattern ${topPattern(winnerRows)}.`
        : `Winner DNA: collecting outcome data... ${Math.max(0, 5 - winnerRows.length)} more winner sample${Math.max(0, 5 - winnerRows.length) === 1 ? "" : "s"} needed.`;

      const failureDNA = failureRows.length >= 5
        ? `Failure DNA: Saturation ${avg(failureRows, "crowd_saturation_score")}, Acceleration ${avg(failureRows, "acceleration_score")}, HT Score ${avg(failureRows, "ht_score")}, Pattern ${topPattern(failureRows)}.`
        : `Failure DNA: collecting outcome data... ${Math.max(0, 5 - failureRows.length)} more failure sample${Math.max(0, 5 - failureRows.length) === 1 ? "" : "s"} needed.`;

      const confidenceStatus: SignalMemoryInsight["confidenceStatus"] =
        tracked >= 50
          ? "Proving"
          : tracked >= 10
            ? "Active"
            : "Developing";

      const confidenceLabel = successRate === null || tracked < 10
        ? "Confidence developing"
        : `HT Confidence ${successRate}%`;

      const summary = successRate === null || tracked < 10
        ? `Status: ${confidenceStatus} · ${tracked}/10 signals needed for active confidence.`
        : `Status: ${confidenceStatus} · ${successRate}% graded success · ${trapRows.length} fake/trap cluster${trapRows.length === 1 ? "" : "s"}.`;

      setSignalMemoryInsight({
        tracked,
        winners: winnerRows.length,
        failures: failureRows.length,
        traps: trapRows.length,
        tracking: trackingRows.length,
        successRate,
        confidenceStatus,
        confidenceLabel,
        winnerDNA,
        failureDNA,
        summary,
      });
    } catch (error) {
      console.error("SIGNAL MEMORY INTELLIGENCE LOAD ERROR:", error);
    }
  };

  const getSignalEvolutionState = (stock: Stock) => {
    const htScore = getHTScore(stock);
    const attention = getAttentionScore(stock);
    const move = Math.abs(stock.change);
    const pattern = detectPatternSignal(stock);

    if (pattern.name === "Pressure Coil") return "Pressure Coil";
    if (pattern.name === "Quiet Accumulation") return "Quiet Accumulation";
    if (pattern.name === "Crowd Ignition") return "Crowd Ignition";
    if (pattern.name === "Continuation Stack") return "Continuation Stack";
    if (pattern.name === "Reclaim Setup") return "Reclaim Setup";
    if (stock.change < 0 && attention < 75) return "Fading";
    if (pattern.name === "Exhaustion Risk" || (move >= 12 && htScore < 84)) return "Exhaustion Risk";
    if (htScore >= 90 && attention >= 88) return "Attention Spike Expansion";
    if (htScore >= 84) return "Crowd Arriving";
    if (attention >= 78 || htScore >= 76) return "Pressure Building";

    return "Early Detection";
  };

  const getSignalEvolutionDetail = (stock: Stock) => {
    const state = getSignalEvolutionState(stock);

    if (state === "Pressure Coil") {
      return "Volume and attention are building while price has not fully expanded. HT is watching for breakout pressure before confirmation.";
    }

    if (state === "Quiet Accumulation") {
      return "Structure is improving quietly before the crowd fully notices. HT is monitoring for ignition.";
    }

    if (state === "Crowd Ignition") {
      return "Retail attention, volume, and early price lift are waking up together. Speed matters, but discipline matters more.";
    }

    if (state === "Continuation Stack") {
      return "Momentum is holding with participation. HT is watching whether the trend can keep stacking cleanly.";
    }

    if (state === "Reclaim Setup") {
      return "Weakness is trying to turn into buyer control. HT wants reclaim confirmation before upgrading conviction.";
    }

    if (state === "Attention Spike Expansion") {
      return "Crowd pressure, conviction, and participation are aligned. HT is watching for continuation quality, not just price movement.";
    }

    if (state === "Crowd Arriving") {
      return "The crowd is starting to notice. This is where HT separates clean pressure from late chase behavior.";
    }

    if (state === "Pressure Building") {
      return "Attention is forming beneath the move. Participation still needs to prove the signal has legs.";
    }

    if (state === "Exhaustion Risk") {
      return "The move is getting loud. HT is watching whether liquidity can absorb profit-taking before calling continuation.";
    }

    if (state === "Fading") {
      return "Pressure is leaking out. HT needs reclaim strength before this deserves fresh attention.";
    }

    return "Early pressure pocket. Not fully public yet, but HT is monitoring for attention expansion.";
  };






  const getEmotionalMomentumState = (stock: Stock) => {
    const ht = getHTScore(stock);
    const attention = getAttentionScore(stock);
    const move = Math.abs(stock.change);

    if (stock.change < 0) return "Pressure Fading";
    if (move >= 12 && attention >= 86) return "Crowd Rushing In";
    if (ht >= 90 || attention >= 90) return "Momentum Expanding";
    if (ht >= 82 || attention >= 82) return "Crowd Arriving";
    if (ht >= 72 || attention >= 72) return "Pressure Building";
    return "Early Watch";
  };

  const getEmotionalRiskState = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);

    if (move >= 15 || rvol >= 6) return "Chase Risk Elevated";
    if (move >= 8 || attention >= 88 || rvol >= 4) return "Overheated";
    if (move >= 3 || attention >= 72 || rvol >= 2) return "Aggressive";
    return "Controlled";
  };

  const getEmotionalStyle = (stock: Stock) => {
    const risk = getEmotionalRiskState(stock);
    const momentum = getEmotionalMomentumState(stock);
    const signal = getSignalQuality(stock);

    if (stock.change < 0) return "Reclaim Only";
    if (risk === "Chase Risk Elevated") return "Reactive Scalping";
    if (risk === "Overheated" && signal >= 82) return "Confirmation Entry";
    if (momentum === "Crowd Arriving") return "Early Crowd Entry";
    if (momentum === "Pressure Building") return "High Conviction Watch";
    return "Momentum Watch";
  };

  const getEmotionalOpportunity = (stock: Stock) => {
    const risk = getEmotionalRiskState(stock);
    const momentum = getEmotionalMomentumState(stock);
    const ht = getHTScore(stock);

    if (stock.change < 0) {
      return {
        label: "Reclaim Window",
        defensive: "Stand down",
        balanced: "Wait for reclaim",
        aggressive: "Pressure must return",
        note: "HT wants buyers to prove control before modeling upside.",
      };
    }

    if (risk === "Chase Risk Elevated") {
      return {
        label: "Late Crowd Risk",
        defensive: "+3% to +6%",
        balanced: "+7% to +15%",
        aggressive: "+15%+",
        note: "Expansion potential is real, but late entries can get punished fast.",
      };
    }

    if (momentum === "Momentum Expanding" || ht >= 86) {
      return {
        label: "Momentum Window",
        defensive: "+2% to +5%",
        balanced: "+6% to +12%",
        aggressive: "+13%+",
        note: "Best when participation keeps expanding after the first move.",
      };
    }

    return {
      label: "Early Window",
      defensive: "+1% to +3%",
      balanced: "+3% to +7%",
      aggressive: "+8%+",
      note: "Still early. HT wants confirmation before upgrading the setup.",
    };
  };

  const getEmotionalSignalReason = (stock: Stock) => {
    const momentum = getEmotionalMomentumState(stock);
    const risk = getEmotionalRiskState(stock);

    if (momentum === "Crowd Rushing In") return "Attention is moving fast. Great for urgency, dangerous for late chase.";
    if (momentum === "Momentum Expanding") return "Pressure is spreading beyond price. Participation is starting to confirm the move.";
    if (momentum === "Crowd Arriving") return "The crowd is noticing, but the move is not fully saturated yet.";
    if (risk === "Overheated") return "The setup is alive, but emotional buying can turn into fast reversals.";
    if (stock.change < 0) return "The setup is losing control. HT wants reclaim strength first.";
    return "Pressure is forming. HT is watching for confirmation before calling it real.";
  };


  const getMomentumStrength = (stock: Stock) => {
    const ht = getHTScore(stock);
    const attention = getAttentionScore(stock);
    const move = Math.abs(stock.change);

    if (stock.change < 0) return "Weakening";
    if (ht >= 90 || attention >= 90 || move >= 12) return "Momentum Expanding";
    if (ht >= 82 || attention >= 82 || move >= 6) return "Strong";
    if (ht >= 72 || attention >= 72 || move >= 3) return "Building";

    return "Quiet";
  };

  const getRiskTemperature = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);

    if (move >= 15 || rvol >= 6) return "Explosive";
    if (move >= 8 || attention >= 88 || rvol >= 4) return "Overheated";
    if (move >= 3 || attention >= 72 || rvol >= 2) return "Active";

    return "Stable";
  };

  const getSuggestedStyle = (stock: Stock) => {
    const risk = getRiskTemperature(stock);
    const momentum = getMomentumStrength(stock);
    const signal = getSignalQuality(stock);

    if (stock.change < 0) return "Reclaim Watch";
    if (risk === "Explosive" && momentum === "Momentum Expanding") return "High Risk Runner";
    if (risk === "Overheated" && signal >= 82) return "Confirmation Entry";
    if (momentum === "Building" && signal >= 78) return "Swing Opportunity";
    if (signal < 68) return "Watchlist Candidate";

    return "Momentum Watch";
  };

  const getOpportunityRange = (stock: Stock) => {
    const risk = getRiskTemperature(stock);
    const momentum = getMomentumStrength(stock);
    const ht = getHTScore(stock);

    if (stock.change < 0) {
      return {
        label: "Reclaim First",
        defensive: "Wait",
        balanced: "Reclaim",
        aggressive: "Only if pressure returns",
        note: "HT does not model upside until buyers prove control again.",
      };
    }

    if (risk === "Explosive" || momentum === "Momentum Expanding") {
      return {
        label: "Late Crowd Risk",
        defensive: "+3% to +6%",
        balanced: "+7% to +15%",
        aggressive: "+15%+",
        note: "Higher upside potential, but chase risk and fast reversals are elevated.",
      };
    }

    if (ht >= 82) {
      return {
        label: "Active Range",
        defensive: "+2% to +4%",
        balanced: "+5% to +9%",
        aggressive: "+10%+",
        note: "Best if volume and crowd pressure keep confirming after the first move.",
      };
    }

    return {
      label: "Developing Range",
      defensive: "+1% to +3%",
      balanced: "+3% to +6%",
      aggressive: "+7%+",
      note: "Still forming. HT wants more confirmation before treating it as a main opportunity.",
    };
  };

  const getRiskTemperatureNote = (stock: Stock) => {
    const temp = getRiskTemperature(stock);

    if (temp === "Explosive") return "Fast-moving setup. Upside exists, but sizing discipline matters.";
    if (temp === "Overheated") return "Momentum is active. Avoid chasing without confirmation.";
    if (temp === "Active") return "Tradable attention forming, but not yet emotionally extreme.";

    return "Controlled tape. Wait for pressure to separate.";
  };


  const getCatalystCardRead = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const rvol = getRelativeVolume(stock);
    const state = getLiveSignalState(stock);

    if (stock.symbol === "SNAL") {
      return {
        title: "Retail pressure building",
        reason: "Small-cap attention is moving fast. HT is watching whether the crowd can turn interest into real participation.",
        signal: "High volatility. Strong upside if pressure holds, but fade risk stays elevated.",
        next: "Watch volume retention and reclaim behavior after pullbacks.",
      };
    }

    if (stock.symbol === "NVDA") {
      return {
        title: "AI leadership still matters",
        reason: "NVDA is a bellwether for AI risk appetite. Strength here can support related names across semis and large-cap tech.",
        signal: "Institutional flow read. Less explosive, but important for market tone.",
        next: "Watch whether AI strength spreads into AMD, SMCI, and QQQ.",
      };
    }

    if (stock.symbol === "QUBT") {
      return {
        title: "Speculative quantum attention",
        reason: "QUBT is pulling high-beta attention. This is the kind of name that can move before fundamentals are fully clear.",
        signal: "Crowd-sensitive setup. Can accelerate fast, but chasing risk rises when attention gets loud.",
        next: "Watch for continuation after the first pullback, not just the first green candle.",
      };
    }

    if (stock.symbol === "SMCI") {
      return {
        title: "Semiconductor rotation watch",
        reason: "SMCI can act as a risk-on AI infrastructure proxy. HT is checking whether buyers rotate back into high-beta semis.",
        signal: "Momentum pocket. Needs volume confirmation to avoid fake strength.",
        next: "Watch if strength follows NVDA/AMD or fades against the group.",
      };
    }

    if (stock.symbol === "AMD") {
      return {
        title: "AI sympathy flow",
        reason: "AMD often catches secondary AI rotation when traders look beyond the main leader.",
        signal: "Secondary momentum read. Better when sector pressure is broad.",
        next: "Watch whether AMD confirms with QQQ and NVDA strength.",
      };
    }

    if (stock.symbol === "MSTR") {
      return {
        title: "Crypto-beta risk appetite",
        reason: "MSTR often reflects crypto-linked risk appetite. Movement here can signal speculative appetite returning or fading.",
        signal: "High beta. HT treats this as a volatility read, not a clean low-risk setup.",
        next: "Watch BTC direction and whether buyers defend dips.",
      };
    }

    if (stock.symbol === "HOOD") {
      return {
        title: "Retail trading activity proxy",
        reason: "HOOD can reflect retail participation and risk appetite. Strength can suggest traders are getting more active.",
        signal: "Sentiment read. Stronger when meme/speculative names are also heating up.",
        next: "Watch if retail flow spreads into smaller momentum names.",
      };
    }

    return {
      title: state === "Cooling" ? "Reclaim watch" : "Setup still forming",
      reason: `${stock.symbol} has ${attention}/99 attention, ${signal}/99 signal quality, and ${rvol}x relative volume. HT is watching if this becomes real pressure or stays noise.`,
      signal: getDeskAlertTone(stock),
      next: getCatalystWatchNext(stock),
    };
  };


  const getCatalystFallbackTitle = (stock: Stock) => {
    const state = getLiveSignalState(stock);
    const attention = getAttentionScore(stock);
    const rvol = getRelativeVolume(stock);

    if (getNewsArticles(stock.symbol)[0]?.headline) return getNewsArticles(stock.symbol)[0]?.headline || "Live catalyst detected";
    if (stock.change >= 6 && attention >= 80) return "Attention-led momentum building";
    if (stock.change >= 3 && rvol >= 3) return "Volume expansion without headline";
    if (state === "Exhaustion Risk") return "Extended move needs confirmation";
    if (stock.change < 0) return "Weak tape / reclaim watch";
    if (getSignalQuality(stock) >= 82) return "Clean setup forming";

    return "Scanner watchlist read";
  };

  const getCatalystFallbackBody = (stock: Stock) => {
    const headline = getNewsArticles(stock.symbol)[0]?.headline;
    const summary = getNewsArticles(stock.symbol)[0]?.summary;

    if (headline) {
      return summary || "Fresh headline detected. HT is watching whether news flow converts into participation.";
    }

    if (stock.change >= 6 && getAttentionScore(stock) >= 80) {
      return "No headline found yet, but price and attention are already moving. HT is watching if crowd interest becomes durable participation.";
    }

    if (getRelativeVolume(stock) >= 3) {
      return "Volume is expanding before a clear news catalyst appears. That can signal early rotation or speculative attention.";
    }

    if (stock.change < 0) {
      return "Ticker is weak right now. HT is waiting for reclaim strength before treating this as opportunity.";
    }

    if (getSignalQuality(stock) >= 82) {
      return "Structure is improving even without a headline. HT is watching confirmation instead of chasing noise.";
    }

    return "No major catalyst is confirmed yet. Keep it on watch until volume, attention, or news flow separates.";
  };

  const getCatalystWatchNext = (stock: Stock) => {
    if (stock.change < 0) return "Watch for reclaim + volume returning.";
    if (Math.abs(stock.change) >= 10) return "Watch pullback, liquidity, and failed breakout risk.";
    if (getRelativeVolume(stock) >= 3) return "Watch if volume holds above normal.";
    if (getAttentionScore(stock) >= 80) return "Watch if attention turns into continuation.";
    return "Watch for headline, volume, or scanner upgrade.";
  };

  const getCatalystBadge = (stock: Stock) => {
    if (getNewsArticles(stock.symbol)[0]?.headline) return "Live News";
    if (stock.change >= 6 || getAttentionScore(stock) >= 85) return "Attention";
    if (getRelativeVolume(stock) >= 3) return "Volume";
    if (stock.change < 0) return "Risk";
    return "Watch";
  };


  const getLiveSignalState = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const ht = getHTScore(stock);
    const move = Math.abs(stock.change);
    const rvol = getRelativeVolume(stock);

    if (stock.change < 0) return "Cooling";
    if (move >= 12 && ht < 88) return "Exhaustion Risk";
    if (attention >= 88 && ht >= 88 && rvol >= 3) return "Accelerating";
    if (attention >= 78 || ht >= 80) return "Building";

    return "Watching";
  };

  const getSetupPersonality = (stock: Stock) => {
    const state = getLiveSignalState(stock);
    const attention = getAttentionScore(stock);
    const rvol = getRelativeVolume(stock);

    if (state === "Exhaustion Risk") return "Crowded Momentum";
    if (state === "Accelerating") return "Attention Spike";
    if (rvol >= 3 && attention < 82) return "Quiet Pressure";
    if (stock.change < 0) return "Reclaim Watch";
    if (getConvictionScore(stock) >= 84) return "Authority Build";

    return "Early Rotation";
  };

  const getWhatChangedNow = (stock: Stock) => {
    const state = getLiveSignalState(stock);
    const attention = getAttentionScore(stock);
    const conviction = getConvictionScore(stock);
    const rvol = getRelativeVolume(stock);

    if (state === "Accelerating") {
      return "Crowd pressure is accelerating faster than the rest of the board.";
    }

    if (state === "Exhaustion Risk") {
      return "The move is getting loud. HT is watching for profit-taking or failed continuation.";
    }

    if (state === "Cooling") {
      return "Pressure is cooling. HT wants reclaim strength before trusting the setup again.";
    }

    if (attention >= 80 && conviction >= 82) {
      return "Attention and conviction are starting to align instead of fighting each other.";
    }

    if (rvol >= 3) {
      return "Volume is waking up before the crowd fully commits.";
    }

    return "HT is monitoring whether this setup upgrades from watchlist noise into real pressure.";
  };

  const getLivePressureCue = (stock: Stock) => {
    const state = getLiveSignalState(stock);
    const attention = getAttentionScore(stock);
    const ht = getHTScore(stock);

    if (state === "Accelerating") return "Pressure rising now";
    if (state === "Building") return "Signal building";
    if (state === "Exhaustion Risk") return "Chase risk elevated";
    if (state === "Cooling") return "Momentum cooling";
    if (ht >= 80 || attention >= 76) return "Pressure forming";

    return "Waiting for confirmation";
  };

  const getSignalEvolutionNote = (stock: Stock) => {
    const state = getLiveSignalState(stock);
    const personality = getSetupPersonality(stock);

    if (state === "Accelerating") {
      return `${personality}: attention is moving fast, but HT still wants clean continuation quality.`;
    }

    if (state === "Building") {
      return `${personality}: pressure is forming, but the crowd has not fully priced the move yet.`;
    }

    if (state === "Exhaustion Risk") {
      return `${personality}: strong move, but discipline matters because late entries can get punished.`;
    }

    if (state === "Cooling") {
      return `${personality}: not an automatic long until buyers prove control again.`;
    }

    return `${personality}: early read only until participation confirms.`;
  };


  const getDeskAlertTone = (stock: Stock) => {
    const state = getSignalEvolutionState(stock);

    if (state === "Attention Spike Expansion") return "Signal is expanding. Watch for clean continuation instead of emotional chase.";
    if (state === "Crowd Arriving") return "Crowd is arriving. This is where discipline matters most.";
    if (state === "Pressure Building") return "Pressure is building quietly. HT is watching for the confirmation trigger.";
    if (state === "Exhaustion Risk") return "Extension risk is rising. Wait for pullback, reclaim, or liquidity proof.";
    if (state === "Fading") return "Stand down until reclaim strength returns.";

    return "Early read only. Let participation confirm before treating it as actionable.";
  };

  const htScoreLeaders = useMemo(() => {
    return [...stocks]
      .sort((a, b) => getHTScore(b) - getHTScore(a))
      .slice(0, 5);
  }, [stocks, news, watchlist, savedSetups, traderMode]);

  const liveIntelligenceFeed = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || htScoreLeaders[0];
    const rotation = htScoreLeaders.find((stock) => stock.symbol !== leader?.symbol) || secondaryTarget;
    const heat = attentionLeaders.find((stock) => stock.symbol !== leader?.symbol) || topMovers[1];
    const riskName = dangerTarget || topLosers[0];

    return [
      {
        tag: "HT Desk",
        tone: "text-orange-200",
        symbol: leader?.symbol || "--",
        state: leader ? getSignalEvolutionState(leader) : "Scanning",
        score: leader ? getHTScore(leader) : 0,
        message: leader
          ? `${leader.symbol} is the live HT focus. ${getDeskAlertTone(leader)}`
          : "HT Desk is waiting for the first clean pressure pocket.",
      },
      {
        tag: "Signal Evolution",
        tone: "text-green-300",
        symbol: leader?.symbol || "--",
        state: leader ? getSignalEvolutionState(leader) : "Waiting",
        score: leader ? getBeforeCrowdScore(leader) : 0,
        message: leader
          ? getSignalEvolutionDetail(leader)
          : "No lifecycle state has separated yet.",
      },
      {
        tag: "Rotation Watch",
        tone: "text-zinc-200",
        symbol: rotation?.symbol || "--",
        state: rotation ? getSignalEvolutionState(rotation) : "No rotation",
        score: rotation ? getHTScore(rotation) : 0,
        message: rotation
          ? `${rotation.symbol} is the next pressure pocket if attention rotates away from ${leader?.symbol || "the leader"}.`
          : "No secondary pressure pocket yet.",
      },
      {
        tag: "Crowd Heat",
        tone: "text-orange-300",
        symbol: heat?.symbol || "--",
        state: heat ? getCrowdPhase(heat) : "Quiet",
        score: heat ? getAttentionScore(heat) : 0,
        message: heat
          ? `${heat.symbol} crowd behavior is ${getCrowdPhase(heat).toLowerCase()}. HT is watching if attention converts into participation.`
          : "Crowd heat is not concentrated yet.",
      },
      {
        tag: "Risk Desk",
        tone: "text-red-300",
        symbol: riskName?.symbol || "--",
        state: riskName ? "Avoid Chase" : "Clean",
        score: riskName ? Math.abs(Math.round(riskName.change)) : 0,
        message: riskName
          ? `${riskName.symbol} is where HT is filtering noise. Movement without reclaim strength is not opportunity.`
          : "No major downside pressure pocket detected.",
      },
    ];
  }, [stocks, firstSignal, priorityTarget, htScoreLeaders, secondaryTarget, attentionLeaders, topMovers, topLosers, dangerTarget, news, traderMode]);

  const activeDeskPulse = mounted ? liveIntelligenceFeed[deskPulseIndex % Math.max(1, liveIntelligenceFeed.length)] : liveIntelligenceFeed[0];


  const signalTimeline = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    if (!leader) return [];

    const baseTime = lastUpdated || new Date();
    const times = [34, 26, 18, 9, 0].map((minutesAgo) => {
      const time = new Date(baseTime.getTime() - minutesAgo * 60000);
      return time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    });

    const evolution = getSignalEvolutionState(leader);

    return [
      {
        time: times[0],
        phase: "Early Detection",
        status: "Pressure Pocket Found",
        detail: `${leader.symbol} started separating from the board before the move became obvious.`,
        intensity: 54,
      },
      {
        time: times[1],
        phase: "Pressure Building",
        status: "Attention Expanding",
        detail: `Crowd attention climbed to ${getAttentionScore(leader)}/99 while participation quality improved.`,
        intensity: Math.min(88, getAttentionScore(leader)),
      },
      {
        time: times[2],
        phase: "Top Conviction Triggered",
        status: firstSignal?.status || "Signal Forming",
        detail: `HT Top Conviction™ tagged ${leader.symbol} with ${getBeforeCrowdScore(leader)}/99 before-crowd pressure.`,
        intensity: getBeforeCrowdScore(leader),
      },
      {
        time: times[3],
        phase: evolution,
        status: getCrowdPhase(leader),
        detail: getSignalEvolutionDetail(leader),
        intensity: getHTScore(leader),
      },
      {
        time: times[4],
        phase: "Current Desk Read",
        status: getDeskAlertTone(leader),
        detail: `${leader.symbol} remains the live HT focus unless rotation pulls pressure into ${secondaryTarget?.symbol || "the next watch"}.`,
        intensity: getHTScore(leader),
      },
    ];
  }, [firstSignal, priorityTarget, topStock, secondaryTarget, lastUpdated, news, traderMode, stocks]);

  const attentionHeatmap = useMemo(() => {
    const groups = [
      {
        theme: "AI / Semis",
        symbols: ["NVDA", "AMD", "SMCI", "MSFT"],
        identity: "Institutional Rotation",
      },
      {
        theme: "Quantum / Spec",
        symbols: ["QUBT"],
        identity: "Speculative Attention",
      },
      {
        theme: "Retail Attention Spike",
        symbols: ["SNAL", "HOOD", "PLTR"],
        identity: "Retail Swarm",
      },
      {
        theme: "Crypto Beta",
        symbols: ["MSTR"],
        identity: "Risk Appetite",
      },
      {
        theme: "Mega Cap Flow",
        symbols: ["AAPL", "MSFT", "NVDA"],
        identity: "Quality Bid",
      },
    ];

    return groups.map((group) => {
      const groupStocks = group.symbols
        .map((symbol) => stocks.find((stock) => stock.symbol === symbol))
        .filter(Boolean) as Stock[];
      const score = groupStocks.length
        ? Math.round(groupStocks.reduce((total, stock) => total + getAttentionScore(stock), 0) / groupStocks.length)
        : 42;
      const leader = [...groupStocks].sort((a, b) => getHTScore(b) - getHTScore(a))[0];

      return {
        ...group,
        score,
        leader: leader?.symbol || group.symbols[0],
        state: score >= 84 ? "Heating Fast" : score >= 72 ? "Building" : score >= 58 ? "Watching" : "Quiet",
      };
    });
  }, [stocks, news, watchlist, savedSetups, traderMode]);

  const smartAlertPersonalities = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    const rotation = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];
    const riskName = dangerTarget || topLosers[0];

    return [
      {
        title: "Early Signal",
        symbol: leader?.symbol || "--",
        tone: "text-orange-200",
        copy: leader
          ? `HT is watching ${leader.symbol} before the crowd fully prices the pressure shift.`
          : "Waiting for the first clean early signal.",
      },
      {
        title: "Retail Swarm",
        symbol: heat?.symbol || "--",
        tone: "text-green-300",
        copy: heat
          ? `${heat.symbol} attention is ${getCrowdPhase(heat).toLowerCase()}; confirm participation before chasing.`
          : "No retail swarm has separated yet.",
      },
      {
        title: "Rotation Watch",
        symbol: rotation?.symbol || "--",
        tone: "text-zinc-200",
        copy: rotation
          ? `${rotation.symbol} becomes important if pressure rotates away from the current Top Conviction.`
          : "Rotation map is still forming.",
      },
      {
        title: "Exhaustion Warning",
        symbol: riskName?.symbol || leader?.symbol || "--",
        tone: "text-red-300",
        copy: riskName
          ? `${riskName.symbol} is where movement can fake opportunity. HT wants reclaim strength first.`
          : "No major exhaustion warning has separated.",
      },
    ];
  }, [firstSignal, priorityTarget, topStock, secondaryTarget, htScoreLeaders, attentionLeaders, topMovers, dangerTarget, topLosers, news, traderMode]);


  const premiumCommandMetrics = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    const pressure = leader ? getBeforeCrowdScore(leader) : 0;
    const ht = leader ? getHTScore(leader) : 0;
    const attention = leader ? getAttentionScore(leader) : 0;
    const conviction = leader ? getConvictionScore(leader) : 0;

    return [
      ["HT Score", ht || "--", leader ? getSignalEvolutionState(leader) : "Scanning"],
      ["Pressure", pressure || "--", leader ? `${getCrowdPhase(leader)} phase` : "No signal yet"],
      ["Attention", attention || "--", attention >= 80 ? "Crowd activity rising" : "Crowd still forming"],
      ["Conviction", conviction || "--", conviction >= 82 ? "Prime watch quality" : "Needs confirmation"],
    ];
  }, [firstSignal, priorityTarget, topStock, news, traderMode, stocks]);

  const premiumFocusStack = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    const rotation = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];

    return [
      {
        label: "Look Here First",
        title: leader ? `${leader.symbol} owns the current HT read.` : "HT is scanning for a clean signal.",
        detail: leader
          ? getDeskAlertTone(leader)
          : "The terminal is waiting for attention, conviction, and participation to align.",
      },
      {
        label: "Then Watch Rotation",
        title: rotation ? `${rotation.symbol} is the backup pressure pocket.` : "No secondary pressure pocket yet.",
        detail: rotation
          ? `${getSignalEvolutionState(rotation)} · ${getHTScore(rotation)}/99 HT Score.`
          : "Rotation becomes important when the Top Conviction fades or crowd heat shifts.",
      },
      {
        label: "Ignore Noise",
        title: heat ? `${heat.symbol} has crowd heat, not automatic conviction.` : "Crowd heat is still scattered.",
        detail: heat
          ? "HT separates attention from actual participation quality before calling a real move."
          : "Movement alone is not enough. HT waits for pressure quality.",
      },
    ];
  }, [firstSignal, priorityTarget, secondaryTarget, htScoreLeaders, attentionLeaders, topMovers, topStock, news, traderMode]);

  const premiumSignalBars = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    if (!leader) return [];

    return [
      ["Attention", getAttentionScore(leader)],
      ["Conviction", getConvictionScore(leader)],
      ["Participation", Math.min(99, Math.round(getRelativeVolume(leader) * 13))],
      ["Signal Strength", getSignalQuality(leader)],
    ];
  }, [firstSignal, priorityTarget, topStock, news, traderMode, stocks]);


  const getPriorityFlowMode = () => {
    const leader = firstSignal?.stock || priorityTarget || topStock;

    if (!leader) return "Scanning Atmosphere";
    if (marketPulse === "Defensive") return "Defensive Pressure";
    if (getSignalEvolutionState(leader) === "Exhaustion Risk") return "Chase Risk Rising";
    if (getHTScore(leader) >= 90 && getAttentionScore(leader) >= 88) return "Crowd Frenzy";
    if (getConvictionScore(leader) >= 84 && getAttentionScore(leader) < 80) return "Quiet Accumulation";
    if (hotStocks.length >= 2) return "Risk-On Flow";

    return "Pressure Building";
  };

  const getPriorityFlowAtmosphere = () => {
    const mode = getPriorityFlowMode();

    if (mode === "Crowd Frenzy") {
      return "Crowd behavior is accelerating. HT is watching whether participation quality can keep up with the speed of attention.";
    }

    if (mode === "Quiet Accumulation") {
      return "Conviction is forming before the loud crowd arrives. This is where HT separates early pressure from obvious movement.";
    }

    if (mode === "Defensive Pressure") {
      return "The tape is defensive. HT is prioritizing reclaim strength, risk filters, and patience over forced aggression.";
    }

    if (mode === "Chase Risk Rising") {
      return "The move is getting emotionally loud. HT is watching for exhaustion, failed reclaims, and weak participation behind the price.";
    }

    if (mode === "Risk-On Flow") {
      return "Momentum appetite is expanding across the board. HT is ranking which pressure pocket deserves attention first.";
    }

    return "Pressure is building beneath the surface. HT is waiting for attention, participation, and conviction to align.";
  };

  const livingPressureMap = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    const rotation = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];
    const riskName = dangerTarget || topLosers[0];

    return [
      {
        zone: "Directive Core",
        label: leader?.symbol || "--",
        score: leader ? getHTScore(leader) : 0,
        state: leader ? getSignalEvolutionState(leader) : "Scanning",
        note: leader
          ? `${leader.symbol} is where attention, conviction, and participation are currently clustering.`
          : "Waiting for a clean pressure cluster.",
      },
      {
        zone: "Rotation Field",
        label: rotation?.symbol || "--",
        score: rotation ? getHTScore(rotation) : 0,
        state: rotation ? getSignalEvolutionState(rotation) : "No rotation",
        note: rotation
          ? `${rotation.symbol} becomes important if the current directive loses pressure.`
          : "No secondary flow has separated yet.",
      },
      {
        zone: "Crowd Heat",
        label: heat?.symbol || "--",
        score: heat ? getAttentionScore(heat) : 0,
        state: heat ? getCrowdPhase(heat) : "Quiet",
        note: heat
          ? `${heat.symbol} is drawing attention, but HT still wants participation proof.`
          : "Crowd behavior is scattered.",
      },
      {
        zone: "Risk Filter",
        label: riskName?.symbol || "--",
        score: riskName ? Math.min(99, Math.round(Math.abs(riskName.change) * 7)) : 0,
        state: riskName ? "Noise Check" : "Clean",
        note: riskName
          ? `${riskName.symbol} is where movement can fake opportunity if reclaim strength is missing.`
          : "No major downside pressure pocket detected.",
      },
    ];
  }, [firstSignal, priorityTarget, secondaryTarget, htScoreLeaders, attentionLeaders, topMovers, dangerTarget, topLosers, topStock, stocks, news, traderMode]);

  const aiDeskMemory = useMemo(() => {
    const leader = firstSignal?.stock || priorityTarget || topStock;
    const previous = signalTimeline[1];
    const rotation = secondaryTarget || htScoreLeaders[1];

    return [
      leader
        ? `${leader.symbol} remains the active Top Conviction after earlier ${previous?.phase || "pressure building"}. HT is watching whether crowd pressure becomes durable participation.`
        : "HT Desk is waiting for the first clean directive to separate from the board.",
      rotation
        ? `${rotation.symbol} is still the rotation memory. If the lead signal fades, HT will check whether pressure transfers there or disappears completely.`
        : "No secondary rotation memory has separated yet.",
      hotStocks.length
        ? "Momentum is emotionally active today. The desk is filtering urgency from actual edge so traders do not chase noise."
        : "The tape is quieter. HT is prioritizing patience until pressure clusters become obvious.",
    ];
  }, [firstSignal, priorityTarget, topStock, signalTimeline, secondaryTarget, htScoreLeaders, hotStocks.length, stocks, news, traderMode]);


  const convictionEngineTarget = firstSignal?.stock || priorityTarget || htScoreLeaders[0] || topStock;
  const topConviction = convictionEngineTarget;

  // ── Single source of truth for "Before The Crowd" ticker selection ──
  // Mirrors the eligibility logic used by the hero card itself (HT Score ≥ 65
  // AND Stage is Early/Developing). Computing this once here — instead of
  // separately inside the JSX — is what keeps the bull/bear fetch and the
  // displayed ticker in sync. Previously the fetch was keyed off
  // convictionEngineTarget while the card displayed a different, independently
  // resolved candidate, so the data only matched by coincidence and would
  // flash in/out as they drifted apart on re-render.
  //
  // Pure highest-score-wins: scans every eligible stock (API catalyst targets
  // ═══════════════════════════════════════════════════════════════════
  // SELECTION ENGINE — separate from the scoring engine.
  //
  // The scoring engine (getHTScore / buildPressureStack) measures signal
  // quality objectively. This engine answers a different question:
  // "Which stock best represents Before The Crowd right now?"
  //
  // Philosophy: Before The Crowd = best asymmetric opportunity before
  // widespread participation, not simply the highest score today.
  //
  // Rules (in order):
  // 1. High-Conviction Events (verified catalyst, catalystScore ≥ 40,
  //    clear event label from ht_signals) are evaluated first.
  // 2. Among HCE candidates, highest HT Score wins.
  // 3. If no HCE qualifies, fall back to highest HT Score ≥ 65.
  // 4. Hysteresis: current winner keeps its slot unless a challenger
  //    is materially better for 2 consecutive refreshes.
  //    — Momentum challenger needs 5+ point lead × 2 refreshes.
  //    — HCE can only displace another HCE with 10+ point lead.
  //    — Any stock dropping below 65 or losing catalyst status
  //      allows immediate replacement.
  // ═══════════════════════════════════════════════════════════════════

  // ── High-Conviction Event detection ─────────────────────────────────
  // Single source of truth. Event-quality based, not sector based.
  // To add a new event type: add its label to HIGH_CONVICTION_EVENT_LABELS.
  // selectTopContender calls this — logic lives here, nowhere else.

  const CATALYST_SCORE_MIN = 40; // below this = keyword noise, not a verified event

  // Labels written by signal-writer into ht_signals.state from real Polygon News.
  // Not guessed from price/volume — must come from a recognized article keyword.
  const HIGH_CONVICTION_EVENT_LABELS = new Set([
    // Biotech / drug development
    "FDA Event",
    "FDA Catalyst Active",
    "PDUFA Date",
    // Corporate actions
    "Earnings Catalyst",
    "M&A Activity",
    "Acquisition",
    "Merger Vote",
    // Regulatory / legal
    "Regulatory Event",
    "Court Ruling",
    // Commercial / product
    "Major Contract",
    "Product Launch",
    "Partnership",
    // Analyst / institutional
    "Analyst Upgrade",
  ]);

  type HCECategory =
    | "FDA / PDUFA"
    | "Earnings"
    | "Acquisition / Merger"
    | "Regulatory / Legal"
    | "Commercial Event"
    | "Analyst Event"
    | "Verified Catalyst";

  // Returns the event category string if HCE, null if not.
  // Use this when you need the category label, isHighConvictionEvent when you only need boolean.
  const getHCECategory = (stock: Stock): HCECategory | null => {
    const hasScore = (stock.catalystScore ?? 0) >= CATALYST_SCORE_MIN;
    if (!hasScore) return null;

    if (stock.hasFDAEvent) return "FDA / PDUFA";

    const label = stock.signalState ?? "";
    if (!HIGH_CONVICTION_EVENT_LABELS.has(label)) return null;

    if (label === "FDA Event" || label === "FDA Catalyst Active" || label === "PDUFA Date") return "FDA / PDUFA";
    if (label === "Earnings Catalyst") return "Earnings";
    if (label === "M&A Activity" || label === "Acquisition" || label === "Merger Vote") return "Acquisition / Merger";
    if (label === "Regulatory Event" || label === "Court Ruling") return "Regulatory / Legal";
    if (label === "Major Contract" || label === "Product Launch" || label === "Partnership") return "Commercial Event";
    if (label === "Analyst Upgrade") return "Analyst Event";
    return "Verified Catalyst";
  };

  const isHighConvictionEvent = (stock: Stock): boolean => getHCECategory(stock) !== null;

  // ── Before The Crowd reason bullets ──────────────────────────────────
  // Returns 3–5 short user-facing bullets explaining why HT Labs selected
  // this stock. Used in both desktop and mobile hero cards.
  // Language: short, premium, not overly technical.
  const getBeforeCrowdReason = (stock: Stock): string[] => {
    const hceCategory = getHCECategory(stock);
    const rvol = getRelativeVolume(stock);
    const saturation = getBackgroundOpportunityEngine(stock).crowdSaturationScore;
    const score = getHTScore(stock);
    const bullets: string[] = [];

    // Lead with catalyst if HCE
    if (hceCategory) {
      if (hceCategory === "FDA / PDUFA") bullets.push("Verified FDA catalyst window detected.");
      else if (hceCategory === "Earnings") bullets.push("Earnings catalyst approaching.");
      else if (hceCategory === "Acquisition / Merger") bullets.push("Corporate action event identified.");
      else if (hceCategory === "Regulatory / Legal") bullets.push("Regulatory decision window active.");
      else if (hceCategory === "Commercial Event") bullets.push("Near-term commercial catalyst confirmed.");
      else if (hceCategory === "Analyst Event") bullets.push("Institutional conviction signal present.");
      else bullets.push("Verified time-defined catalyst detected.");
    }

    // Volume signal
    if (rvol >= 2.5) bullets.push(`Volume running ${rvol.toFixed(1)}× above normal.`);
    else if (rvol >= 1.4) bullets.push("Volume expanding ahead of price.");

    // Crowd position
    if (saturation < 35) bullets.push("Crowd participation still early.");
    else if (saturation < 55) bullets.push("Momentum building before broad participation.");

    // Price direction
    if (stock.change > 3) bullets.push("Bullish pressure outweighing selling.");
    else if (stock.change > 0) bullets.push("Price holding structure above support.");
    else if (stock.change < 0) bullets.push("Selling pressure may be exhausting.");

    // Score confidence
    if (score >= 80) bullets.push("Setup above HT Labs high-conviction threshold.");
    else if (score >= 65) bullets.push("Setup clears HT Labs minimum threshold.");

    return bullets.slice(0, 5);
  };



  // ═══════════════════════════════════════════════════════════════════
  // TRADE FRAMEWORK ENGINE
  // Pure function — no state, no async, no side effects.
  // Answers: "If someone discovered this stock right now, what does
  // the current opportunity look like?"
  //
  // Inputs: stock (live), atrData (cached per ticker).
  // Output: percentage-based window, risk zone, R/R, horizon, sentence.
  // ═══════════════════════════════════════════════════════════════════
  const buildTradeFramework = (
    stock: Stock,
    atrData: { atr14: number; support: number; resistance: number; volatility20d: number } | null,
    isMarketLive: boolean
  ): {
    uptideMin: number;
    uptideMax: number;
    riskZone: number;
    rr: number;
    confidence: "High" | "Moderate" | "Early" | "Speculative";
    horizon: string;
    sentence: string;
    isLive: boolean;
  } | null => {
    try {
      if (!stock.price || stock.price <= 0) return null;

      const stack = buildPressureStack(stock);
      const engine = getBackgroundOpportunityEngine(stock);
      const rvol = getRelativeVolume(stock);
      const score = getHTScore(stock);
      const saturation = engine.crowdSaturationScore;
      const hce = isHighConvictionEvent(stock);
      const hceCat = getHCECategory(stock);
      const pattern = detectPatternSignal(stock).name;

      const price = stock.price;

      // ── Upside window base ──────────────────────────────────────────
      // Primary: ATR-anchored if we have real historical data
      // Fallback: volatility estimate from price action and extension
      let baseUpside: number;

      if (atrData && atrData.atr14 > 0) {
        // Days forward driven by continuation strength
        const daysForward =
          stack.continuationStrength >= 70 ? 3 :
          stack.continuationStrength >= 50 ? 2 : 1;
        baseUpside = (atrData.atr14 * daysForward / price) * 100;
      } else {
        // Fallback: estimate from rvol and price action
        baseUpside = Math.max(3, rvol * 2.5 + Math.abs(stock.change) * 0.5);
      }

      // Opportunity multipliers
      let upsideMult = 1.0;
      if (hce) upsideMult *= 1.6;                          // catalyst = wider window
      if (pattern === "Pressure Coil") upsideMult *= 1.4;
      if (pattern === "Quiet Accumulation") upsideMult *= 1.3;
      if (saturation < 35) upsideMult *= 1.3;              // very early crowd
      else if (saturation < 50) upsideMult *= 1.1;
      if (saturation > 65) upsideMult *= 0.6;              // crowd already in
      if (rvol >= 3) upsideMult *= 1.15;

      // Compression from extension
      const extRisk = stack.extensionRisk;
      if (extRisk >= 78) upsideMult *= 0.45;               // heavily extended
      else if (extRisk >= 65) upsideMult *= 0.7;
      else if (extRisk >= 50) upsideMult *= 0.85;

      const upsideMid = Math.max(2, baseUpside * upsideMult);
      const uptideMin = Number((upsideMid * 0.65).toFixed(1));
      const uptideMax = Number((upsideMid * 1.35).toFixed(1));

      // ── Risk zone ───────────────────────────────────────────────────
      // Always tighter than reward — that's the core philosophy
      let baseRisk: number;

      if (atrData && atrData.atr14 > 0) {
        baseRisk = (atrData.atr14 * 0.8 / price) * 100;
      } else {
        baseRisk = Math.max(2, upsideMid * 0.38);
      }

      let riskMult = 1.0;
      if (stack.trapRiskScore > 75) riskMult *= 1.5;
      else if (stack.trapRiskScore > 60) riskMult *= 1.25;
      if (stack.qualityGate === "Reject") riskMult *= 1.6;
      else if (stack.qualityGate === "Caution") riskMult *= 1.3;
      if (pattern === "Exhaustion Risk") riskMult *= 1.4;

      const riskZone = Number(Math.max(1.5, baseRisk * riskMult).toFixed(1));

      // ── R/R ratio ───────────────────────────────────────────────────
      const upsideMidpoint = (uptideMin + uptideMax) / 2;
      const rr = Number((upsideMidpoint / riskZone).toFixed(1));

      // ── Confidence ──────────────────────────────────────────────────
      const confidence: "High" | "Moderate" | "Early" | "Speculative" =
        score >= 80 ? "High" :
        score >= 70 ? "Moderate" :
        score >= 65 ? "Early" : "Speculative";

      // ── Time horizon ────────────────────────────────────────────────
      const horizon =
        hce ? `Event-driven${hceCat ? ` · ${hceCat}` : ""}` :
        stock.change < -2 ? "Speculative · Setup not confirmed" :
        stack.continuationStrength >= 70 && saturation < 50 ? "Multi-day" :
        stack.continuationStrength >= 50 ? "1–3 days" :
        extRisk >= 70 ? "Intraday · Extended" : "1–3 days";

      // ── One sentence ────────────────────────────────────────────────
      const sentence =
        extRisk >= 78 ? "Window is compressed — setup is extended above baseline." :
        hce ? `Window supported by unresolved ${hceCat ?? "catalyst"}.` :
        saturation < 35 ? "Wide window — crowd participation remains very early." :
        saturation < 50 ? "Window supported by early crowd position." :
        saturation > 70 ? "Crowd has arrived — window is narrowing." :
        stack.trapRiskScore > 70 ? "Risk zone elevated — trap risk signals present." :
        pattern === "Pressure Coil" ? "Coil pattern suggests breakout window is near." :
        pattern === "Quiet Accumulation" ? "Accumulation pattern supports a patient entry window." :
        stack.continuationStrength >= 70 ? "Strong continuation supports a multi-day window." :
        "Window reflects current momentum with moderate continuation.";

      return {
        uptideMin,
        uptideMax,
        riskZone,
        rr,
        confidence,
        horizon,
        sentence,
        isLive: isMarketLive,
      };
    } catch {
      return null;
    }
  };


  // Asks: "Does the current momentum leader still deserve to remain?"
  // Returns 0–100. Display only — does NOT override hysteresis.
  // ═══════════════════════════════════════════════════════════════════
  const evaluateMomentumEndurance = (stock: Stock): number => {
    try {
      const stack = buildPressureStack(stock);
      const engine = getBackgroundOpportunityEngine(stock);
      let endurance = 100;
      if (engine.accelerationLabel === "Fading / Late") endurance -= 25;
      if (stack.participationQuality < 40) endurance -= 20;
      if (stack.trapRiskScore > 75) endurance -= 25;
      if (getRelativeVolume(stock) < 1.0) endurance -= 20;
      if (stack.continuationStrength < 35) endurance -= 15;
      return Math.min(100, Math.max(0, Math.round(endurance)));
    } catch { return 75; }
  };

  const getMomentumEnduranceLabel = (score: number, htScore?: number): string => {
    // Never say "Momentum Confirmed" when HT Score is weak
    if (htScore !== undefined && htScore < 65) {
      return htScore >= 55 ? "Early Setup" : "Monitoring";
    }
    if (score >= 80) return "Momentum Confirmed";
    if (score >= 65) return "Momentum Holding";
    if (score >= 50) return "Momentum Cooling";
    return "Momentum Weakening";
  };

  // ═══════════════════════════════════════════════════════════════════
  // BEFORE THE CROWD — THESIS ENDURANCE ENGINE
  // Every qualifying thesis starts at 100. Deductions remove conviction.
  // The stock that loses the least conviction wins.
  // ═══════════════════════════════════════════════════════════════════

  const evaluateThesisEndurance = (stock: Stock): number => {
    try {
      const rvol = getRelativeVolume(stock);
      const engine = getBackgroundOpportunityEngine(stock);
      const stack = buildPressureStack(stock);
      const saturation = engine.crowdSaturationScore;
      const pattern = detectPatternSignal(stock).name;
      const hce = isHighConvictionEvent(stock);
      let conviction = 100;
      if (saturation > 65) conviction -= 25;
      if (rvol < 1.1) conviction -= 20;
      if (pattern === "Exhaustion Risk") conviction -= 20;
      if (stack.trapRiskScore > 70 && !hce) conviction -= 15;
      if (hce && getNewsVelocityScore(stock) < 30) conviction -= 10;
      if (stack.qualityGate === "Reject") conviction -= 20;
      else if (stack.qualityGate === "Caution") conviction -= 10;
      return Math.min(100, Math.max(0, Math.round(conviction)));
    } catch { return 60; }
  };

  const selectBeforeTheCrowd = (stocks: Stock[]): Stock | null => {
    const pool = stocks.filter(qualifiesForBeforeTheCrowd);
    if (pool.length === 0) {
      logSelectionDebug(stocks, null, "before_the_crowd", qualifiesForBeforeTheCrowd);
      return null;
    }
    const winner = pool
      .map(stock => ({ stock, score: getOpportunityScore(stock, "before_the_crowd") }))
      .sort((a, b) => b.score - a.score)[0].stock;
    logSelectionDebug(stocks, winner, "before_the_crowd", qualifiesForBeforeTheCrowd);
    return winner;
  };

  const getThesisEnduranceLabel = (conviction: number): string => {
    if (conviction >= 80) return "Strong Before The Crowd";
    if (conviction >= 65) return "Developing Before The Crowd";
    if (conviction >= 50) return "Early Watch";
    return "Speculative Watch";
  };

  const getThesisEnduranceReason = (stock: Stock): string[] => {
    const rvol = getRelativeVolume(stock);
    const engine = getBackgroundOpportunityEngine(stock);
    const stack = buildPressureStack(stock);
    const saturation = engine.crowdSaturationScore;
    const pattern = detectPatternSignal(stock).name;
    const hce = isHighConvictionEvent(stock);
    const hceCategory = getHCECategory(stock);
    const bullets: string[] = [];
    if (hce && hceCategory) bullets.push(`${hceCategory} catalyst window still open.`);
    if (saturation <= 40) bullets.push("Crowd participation remains early with minimal saturation.");
    else if (saturation <= 55) bullets.push("Crowd still building — broad participation has not arrived.");
    if (rvol >= 1.5) bullets.push(`Volume remains ${rvol.toFixed(1)}× above normal.`);
    if (pattern === "Quiet Accumulation") bullets.push("Quiet accumulation pattern intact.");
    else if (pattern === "Pressure Coil") bullets.push("Pressure coil pattern continuing to build.");
    else if (pattern !== "Exhaustion Risk") bullets.push("No signs of exhaustion detected.");
    if (stack.qualityGate === "Pass") bullets.push("Passed HT Labs quality screening.");
    if (stack.trapRiskScore <= 50) bullets.push("Risk profile remains within acceptable range.");
    return bullets.slice(0, 5);
  };

  // Takes the eligible pool (already filtered to HT Score ≥ 65)
  // and returns the best Top Contender per HT Labs philosophy.
  const selectTopContender = (pool: Stock[]): Stock | null => {
    if (pool.length === 0) return null;

    const hceCandidates = pool
      .filter(isHighConvictionEvent)
      .sort((a, b) => getOpportunityScore(b, "spot_momentum") - getOpportunityScore(a, "spot_momentum"));

    const momentumCandidates = pool
      .filter(s => !isHighConvictionEvent(s))
      .sort((a, b) => getOpportunityScore(b, "spot_momentum") - getOpportunityScore(a, "spot_momentum"));

    const winner = hceCandidates.length > 0 ? hceCandidates[0] : (momentumCandidates[0] || null);
    logSelectionDebug(pool, winner, "spot_momentum", qualifiesForSpotMomentum);
    return winner;
  };

  // Hysteresis state — lives outside the memo so React can't corrupt it
  // by re-running the memo multiple times. The memo reads these refs but
  // never writes them — only the effect below writes them.
  const topContenderRef = useRef<Stock | null>(null);
  const challengerRef = useRef<{ symbol: string; consecutiveLeadCount: number } | null>(null);
  // ── SM CANDIDATE POOL — single shared helper ─────────────────────────────
  // Both the memo and the effect call this. One function = one gate = one
  // scoring method = one set of thresholds. They can never drift apart.
  const getSMCandidatePool = (stockList: Stock[]) => {
    // SM winner comes ONLY from the scored stock universe.
    // apiMomentum is intentionally excluded here — it feeds the
    // SM winner comes ONLY from the scored stock universe.
    // apiMomentum is intentionally excluded here.
    // If nothing passes the gate — return empty pool.
    // The engine will show an honest empty state rather than force a weak pick.
    const eligiblePool = stockList.filter(qualifiesForSpotMomentum);
    return { pool: stockList, effectivePool: eligiblePool };
  };

  const getSMHysteresisThresholds = (currentIsHCE: boolean, challengerIsHCE: boolean) => {
    if (currentIsHCE && !challengerIsHCE) return { requiredLead: 25, requiredStreak: 5 };
    if (currentIsHCE && challengerIsHCE)  return { requiredLead: 15, requiredStreak: 3 };
    return { requiredLead: 15, requiredStreak: 4 };
  };

  const apiMomentumAsStock = useMemo<Stock | null>(() => {
    if (!apiMomentum) return null;

    return {
      symbol: apiMomentum.ticker,
      price: Number(apiMomentum.price || 0),
      change: Number(apiMomentum.change || 0),
      relativeVolume: Number(apiMomentum.relativeVolume || 0),
      catalystScore: Number(apiMomentum.catalystScore || 0),
      htSignalScore: Number(apiMomentum.confidence || apiMomentum.opportunityScore || 0),
      momentumScore: Number(apiMomentum.momentumScore || 0),
      crowdScore: Number(apiMomentum.attentionScore || 0),
      trapScore: Number(apiMomentum.riskScore || 0),
      signalState: apiMomentum.stage,
      signalPattern: apiMomentum.signals?.[2] ?? apiMomentum.stage,
      changePercent: Number(apiMomentum.change || 0),
    };
  }, [apiMomentum]);

  // Same conversion for Before The Crowd — the backend has already ranked
  // these by the before-the-crowd flavored opportunity score (earliness
  // weighted heavier). We pick the best one that ISN'T the same ticker SM
  // already claimed, so the two cards answer different questions whenever
  // the market offers more than one real candidate. If the market only
  // offers one genuine opportunity today, both cards showing it together
  // IS the Dual Engine Confirmation — that's the honest signal, not a bug.
  const apiBeforeCrowdPick = useMemo<APIOpportunity | null>(() => {
    if (!apiBeforeCrowdList.length) return null;
    const smTicker = apiMomentum?.ticker;
    const distinct = apiBeforeCrowdList.find(o => o.ticker !== smTicker);
    return distinct ?? apiBeforeCrowdList[0] ?? null;
  }, [apiBeforeCrowdList, apiMomentum]);

  const apiBeforeCrowdAsStock = useMemo<Stock | null>(() => {
    if (!apiBeforeCrowdPick) return null;
    return {
      symbol: apiBeforeCrowdPick.ticker,
      price: Number(apiBeforeCrowdPick.price || 0),
      change: Number(apiBeforeCrowdPick.change || 0),
      relativeVolume: Number(apiBeforeCrowdPick.relativeVolume || 0),
      catalystScore: Number(apiBeforeCrowdPick.catalystScore || 0),
      htSignalScore: Number(apiBeforeCrowdPick.confidence || apiBeforeCrowdPick.opportunityScore || 0),
      momentumScore: Number(apiBeforeCrowdPick.momentumScore || 0),
      crowdScore: Number(apiBeforeCrowdPick.attentionScore || 0),
      trapScore: Number(apiBeforeCrowdPick.riskScore || 0),
      signalState: apiBeforeCrowdPick.stage,
      signalPattern: apiBeforeCrowdPick.signals?.[2] ?? apiBeforeCrowdPick.stage,
      changePercent: Number(apiBeforeCrowdPick.change || 0),
    };
  }, [apiBeforeCrowdPick]);

  // Memo: reads refs, never writes them. Returns which stock to display.
  const resolvedBeforeCrowdTarget: Stock | null = useMemo(() => {
    // The API opportunity is the homepage truth source.
    // If it exists, desktop and mobile hero both render this exact same object.
    if (apiMomentumAsStock) return apiMomentumAsStock;

    const { pool, effectivePool } = getSMCandidatePool(stocks);
    const candidate = selectTopContender(effectivePool);
    const current = topContenderRef.current;

    if (!current) return candidate;

    // Only keep the current pick if it STILL passes the eligibility gate.
    // If it no longer qualifies (e.g. TSM from previous session when market
    // was more active), release it and show the new candidate.
    const currentStillInPool = effectivePool.find(s => s.symbol === current.symbol);
    if (!currentStillInPool) return candidate;
    if (!candidate || candidate.symbol === current.symbol) return current;

    const currentScore = getOpportunityScore(currentStillInPool, "spot_momentum");
    const challengerScore = getOpportunityScore(candidate, "spot_momentum");
    const { requiredLead, requiredStreak } = getSMHysteresisThresholds(
      isHighConvictionEvent(currentStillInPool),
      isHighConvictionEvent(candidate)
    );

    if (challengerScore - currentScore >= requiredLead) {
      const prevStreak = challengerRef.current?.symbol === candidate.symbol
        ? challengerRef.current.consecutiveLeadCount : 0;
      if (prevStreak + 1 >= requiredStreak) return candidate;
    }
    return current;
  }, [stocks, apiMomentumAsStock]);

  // Effect: writes refs after render. Same pool, same thresholds as memo above.
  useEffect(() => {
    const { effectivePool } = getSMCandidatePool(stocks);
    const candidate = selectTopContender(effectivePool);
    const current = topContenderRef.current;

    if (!current || !effectivePool.find(s => s.symbol === current.symbol)) {
      topContenderRef.current = candidate;
      challengerRef.current = null;
      return;
    }
    if (!candidate || candidate.symbol === current.symbol) {
      challengerRef.current = null;
      return;
    }

    const currentStock = effectivePool.find(s => s.symbol === current.symbol)!;
    const currentScore = getOpportunityScore(currentStock, "spot_momentum");
    const challengerScore = getOpportunityScore(candidate, "spot_momentum");
    const { requiredLead, requiredStreak } = getSMHysteresisThresholds(
      isHighConvictionEvent(currentStock),
      isHighConvictionEvent(candidate)
    );

    if (challengerScore - currentScore >= requiredLead) {
      const prevStreak = challengerRef.current?.symbol === candidate.symbol
        ? challengerRef.current.consecutiveLeadCount : 0;
      const newStreak = prevStreak + 1;
      challengerRef.current = { symbol: candidate.symbol, consecutiveLeadCount: newStreak };
      if (newStreak >= requiredStreak) {
        topContenderRef.current = candidate;
        challengerRef.current = null;
      }
    } else {
      challengerRef.current = null;
    }
  }, [stocks]);

  // Before The Crowd — backend-ranked first (same architecture as SM now),
  // client-side selectBeforeTheCrowd as fallback when the API has nothing.
  const resolvedBeforeTheCrowdTarget: Stock | null = useMemo(() => {
    if (apiBeforeCrowdAsStock) return apiBeforeCrowdAsStock;

    const btcWinner = selectBeforeTheCrowd(stocks);

    // If BTC picks the same stock as SM, that IS the Dual Engine Confirmation.
    // In that case, BTC also surfaces the next best qualifying candidate
    // so the two cards always answer different questions when possible.
    const smWinner = resolvedBeforeCrowdTarget;
    if (btcWinner && smWinner && btcWinner.symbol === smWinner.symbol) {
      // Try to find the next best BTC candidate
      const nextBest = selectBeforeTheCrowd(
        stocks.filter(s => s.symbol !== btcWinner.symbol)
      );
      // If a genuine second candidate exists, show it on the BTC card.
      // If not, show the same stock — Dual Engine Confirmation is the story.
      return nextBest ?? btcWinner;
    }

    return btcWinner;
  }, [stocks, resolvedBeforeCrowdTarget, apiBeforeCrowdAsStock]);

  const beforeTheCrowdConviction: number = useMemo(() => {
    return resolvedBeforeTheCrowdTarget
      ? evaluateThesisEndurance(resolvedBeforeTheCrowdTarget)
      : 0;
  }, [resolvedBeforeTheCrowdTarget]);

  const isDualEngineConfirmation = Boolean(
    resolvedBeforeCrowdTarget &&
    resolvedBeforeTheCrowdTarget &&
    resolvedBeforeCrowdTarget.symbol === resolvedBeforeTheCrowdTarget.symbol
  );

  // Bull/Bear effect — runs when the resolved Before The Crowd ticker changes
  const btcTickerForAnalysis = resolvedBeforeCrowdTarget?.symbol ?? "";
  useEffect(() => {
    if (!btcTickerForAnalysis || btcTickerForAnalysis === bullBearTicker) return;
    setBullBearLoading(true);
    setBullBearExpanded(false);
    fetch(`/api/bull-bear?ticker=${btcTickerForAnalysis}`)
      .then(res => res.json())
      .then(data => {
        setBullBearData(data);
        setBullBearTicker(btcTickerForAnalysis);
      })
      .catch(err => console.warn("[Bull-Bear] fetch failed:", err))
      .finally(() => setBullBearLoading(false));
  }, [btcTickerForAnalysis]);

  // When selectedStock opens and its ticker doesn't match current bull/bear data,
  // fetch bull/bear for it so the mobile detail sheet always has content.
  useEffect(() => {
    if (!selectedStock) return;
    if (selectedStock.symbol === bullBearTicker) return; // already have it
    setBullBearLoading(true);
    fetch(`/api/bull-bear?ticker=${selectedStock.symbol}`)
      .then(res => res.json())
      .then(data => {
        setBullBearData(data);
        setBullBearTicker(selectedStock.symbol);
      })
      .catch(err => console.warn("[Bull-Bear] selectedStock fetch failed:", err))
      .finally(() => setBullBearLoading(false));
  }, [selectedStock?.symbol]);

  // HT Score / Stage logging — fires whenever the resolved pick changes,
  // capturing the full score breakdown so it can be checked against the
  // ticker's actual forward performance later.
  useEffect(() => {
    if (!resolvedBeforeCrowdTarget) return;
    logBeforeCrowdPick(resolvedBeforeCrowdTarget);
  }, [resolvedBeforeCrowdTarget?.symbol, session?.user?.id]);

  const getBreakoutProbability = (stock: Stock) => {
    const ht = getHTScore(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const rvol = getRelativeVolume(stock);
    const extensionPenalty = Math.abs(stock.change) >= 12 ? 9 : 0;

    return Math.min(
      96,
      Math.max(
        28,
        Math.round(ht * 0.38 + attention * 0.24 + signal * 0.24 + rvol * 3 - extensionPenalty),
      ),
    );
  };

  const getEdgeStatus = (stock: Stock) => {
    const confidence = getHTScore(stock);
    const breakout = getBreakoutProbability(stock);
    const attention = getAttentionScore(stock);

    if (confidence >= 90 && breakout >= 82) return "Edge Active";
    if (attention >= 85 && confidence >= 80) return "Crowd Waking";
    if (confidence >= 74) return "Developing Edge";
    if (stock.change < 0) return "Wait For Reclaim";

    return "Ignore Noise";
  };

  const getWhyThisMatters = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const rvol = getRelativeVolume(stock);
    const breakout = getBreakoutProbability(stock);
    const state = getSignalEvolutionState(stock);
    const htScore = getHTScore(stock);
    const signal = getSignalQuality(stock);
    const move = Math.abs(stock.change);

    if (stock.change < 0) {
      return `${stock.symbol} matters because weakness is still controlling the read. HT is not treating this as opportunity until reclaim strength, volume, and signal quality prove buyers are returning.`;
    }

    if (state === "Exhaustion Risk" || move >= 12) {
      return `${stock.symbol} matters because the move is getting emotionally loud. HT sees attention, but the edge now depends on whether participation can absorb profit-taking instead of turning into a late chase.`;
    }

    if (breakout >= 84 && attention >= 84 && htScore >= 86) {
      return `${stock.symbol} matters because attention, participation, and conviction are compressing at the same time. HT is flagging a real pressure pocket — not just a green candle — while the crowd is still deciding whether to pile in.`;
    }

    if (state === "Crowd Arriving") {
      return `${stock.symbol} matters because the crowd is starting to notice, but the setup is not fully saturated yet. HT is watching whether attention turns into durable participation or fades into late-chase noise.`;
    }

    if (rvol >= 3 && attention < 82) {
      return `${stock.symbol} matters because volume is expanding before crowd attention is fully saturated. That imbalance is where HT looks for informational edge before the move becomes obvious.`;
    }

    if (signal >= 84 && attention < 76) {
      return `${stock.symbol} matters because structure is improving before the crowd is fully awake. HT is monitoring whether quiet pressure becomes a cleaner public momentum signal.`;
    }

    return `${stock.symbol} matters because pressure is forming beneath the surface. HT is waiting for attention, participation, and conviction to align before upgrading it from noise to priority.`;
  };

  const getWhyThisMattersHeadline = (stock: Stock) => {
    const state = getSignalEvolutionState(stock);
    const attention = getAttentionScore(stock);
    const breakout = getBreakoutProbability(stock);
    const move = Math.abs(stock.change);

    if (stock.change < 0) return "Reclaim needed before HT trusts the move.";
    if (state === "Exhaustion Risk" || move >= 12) return "Momentum is loud — chase risk is rising.";
    if (breakout >= 84 && attention >= 84) return "Attention and conviction are compressing together.";
    if (state === "Crowd Arriving") return "The crowd is noticing, but saturation is not complete.";
    if (getRelativeVolume(stock) >= 3 && attention < 82) return "Volume is moving before the crowd fully wakes up.";
    return "Pressure is forming, but HT still wants confirmation.";
  };

  const getWhyThisMattersBullets = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const conviction = getConvictionScore(stock);
    const breakout = getBreakoutProbability(stock);
    const rvol = getRelativeVolume(stock);
    const state = getSignalEvolutionState(stock);

    if (stock.change < 0) {
      return [
        "Do not force long bias until reclaim strength improves.",
        `${stock.symbol} needs better participation before HT upgrades the read.`,
        "Use this as a risk filter, not an automatic opportunity.",
      ];
    }

    if (state === "Exhaustion Risk" || Math.abs(stock.change) >= 12) {
      return [
        "Move is emotionally extended; avoid chasing vertical candles.",
        `${rvol}x volume must hold or the signal can fade fast.`,
        "Best use: wait for pullback, reclaim, or liquidity proof.",
      ];
    }

    if (breakout >= 84 && attention >= 84) {
      return [
        `${attention}/99 attention shows crowd pressure is accelerating.`,
        `${conviction}/99 conviction means the read is more than raw momentum.`,
        "Best use: monitor continuation quality, not blind entry hype.",
      ];
    }

    if (rvol >= 3 && attention < 82) {
      return [
        `${rvol}x volume is expanding before full crowd saturation.`,
        "That imbalance can create early informational edge.",
        "Best use: watch for attention confirmation before size increases.",
      ];
    }

    return [
      `${state} is the current lifecycle read.`,
      "HT wants attention, volume, and conviction aligned.",
      "Best use: keep it on watch until the signal separates from noise.",
    ];
  };

  const getNextTriggerShort = (stock: Stock) => {
    if (stock.change >= 8) return "Pullback hold";
    if (stock.change >= 2) return "Higher-low hold";
    if (stock.change < 0) return "Reclaim first";
    return "Fresh volume";
  };

  const getEntryBiasShort = (stock: Stock) => {
    if (Math.abs(stock.change) >= 10) return "Do not chase";
    if (getBreakoutProbability(stock) >= 82) return "Watch breakout";
    if (stock.change < 0) return "Wait only";
    return "Build watch";
  };

  const getRiskGuardrailShort = (stock: Stock) => {
    if (Math.abs(stock.change) >= 10) return "Extension risk";
    if (stock.change < 0) return "Weak tape";
    if (getRelativeVolume(stock) >= 3) return "Volume must hold";
    return "Needs proof";
  };

  const getSetupRoleShort = (stock: Stock) => {
    if (getHTScore(stock) >= 88) return "Main focus";
    if (getAttentionScore(stock) >= 80) return "Crowd watch";
    if (stock.change < 0) return "Risk filter";
    return "Secondary watch";
  };

  const getMarketRank = (stock: Stock) => {
    const ranked = [...stocks].sort((a, b) => getLiveConvictionScore(b) - getLiveConvictionScore(a));
    const index = ranked.findIndex((item) => item.symbol === stock.symbol);

    return index >= 0 ? index + 1 : 1;
  };

  const getBoardAverageMove = () => {
    if (!stocks.length) return 0;

    return stocks.reduce((total, item) => total + Math.abs(item.change), 0) / stocks.length;
  };

  const getHardProofLine = (stock: Stock) => {
    const rank = getMarketRank(stock);
    const rvol = getRelativeVolume(stock);
    const ht = getHTScore(stock);
    const boardAverage = getBoardAverageMove();
    const move = Math.abs(stock.change);
    const moveMultiplier = boardAverage > 0 ? Math.max(1, move / boardAverage) : 1;

    return `HT selected this from the active market scan • Rank #${rank} • ${rvol}x RVOL • ${getLiveConvictionScore(stock)}/99 live conviction • ${moveMultiplier.toFixed(1)}x board move.`;
  };

  const getHardProofSummary = (stock: Stock) => {
    const rank = getMarketRank(stock);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);

    return `${stock.symbol} was elevated because participation is expanding: ${rvol}x relative volume, ${attention}/99 attention, ${signal}/99 signal quality, and ${getContinuationStrengthScore(stock)}/99 continuation strength. HT is filtering the active board for pressure, not recycling a watchlist.`;
  };

  const getHardProofBullets = (stock: Stock) => [
    [`#${getMarketRank(stock)}`, `of ${stocks.length || marketScanStats.scanned} scanned`],
    [`${getRelativeVolume(stock)}x`, "relative volume"],
    [`${getParticipationScore(stock)}/99`, "participation"],
    [`${getContinuationStrengthScore(stock)}/99`, "continuation"],
  ];

  const getContinuationWindows = (stock: Stock) => {
    const ht = getHTScore(stock);
    const rvol = getRelativeVolume(stock);
    const signal = getSignalQuality(stock);
    const attention = getAttentionScore(stock);
    const move = Math.abs(stock.change);
    const isExtended = move >= 10 || getRiskTemperature(stock) === "Explosive";

    let conservativeLow = 3;
    let conservativeHigh = 6;
    let aggressiveLow = 7;
    let aggressiveHigh = 10;

    if (ht >= 90 && signal >= 88 && rvol >= 3) {
      conservativeLow = 7;
      conservativeHigh = 11;
      aggressiveLow = 12;
      aggressiveHigh = 18;
    } else if (ht >= 84 || attention >= 84) {
      conservativeLow = 5;
      conservativeHigh = 8;
      aggressiveLow = 9;
      aggressiveHigh = 14;
    } else if (ht >= 76 || rvol >= 2) {
      conservativeLow = 3;
      conservativeHigh = 6;
      aggressiveLow = 7;
      aggressiveHigh = 11;
    }

    if (isExtended) {
      conservativeLow = Math.max(2, conservativeLow - 2);
      conservativeHigh = Math.max(4, conservativeHigh - 2);
      aggressiveLow = Math.max(conservativeHigh + 1, aggressiveLow - 2);
      aggressiveHigh = Math.max(aggressiveLow + 2, aggressiveHigh - 3);
    }

    if (stock.change < 0) {
      return {
        conservative: "Reclaim first",
        aggressive: "No chase",
        note: "HT needs buyers to regain control before modeling upside.",
        stance: "Standby",
      };
    }

    return {
      conservative: `${conservativeLow}-${conservativeHigh}%`,
      aggressive: `${aggressiveLow}-${aggressiveHigh}%`,
      note: isExtended
        ? "Momentum is active, but HT favors scaling into strength because extension risk is rising."
        : "HT favors continuation while participation and signal quality stay aligned.",
      stance: ht >= 84 ? "Continuation favored" : "Confirmation needed",
    };
  };


  // CONFIDENCE BREAKDOWN — show where the score comes from
  const getConfidenceBreakdown = (stock: Stock) => {
    const stack = buildPressureStack(stock);
    const rvol = getRelativeVolume(stock);
    const attention = getAttentionScore(stock);
    const continuation = getContinuationStrengthScore(stock);
    const trapSafety = 99 - getTrapRiskScore(stock);
    const entryQuality = getEntryQualityScore(stock);

    return [
      {
        label: "Volume Strength",
        value: Math.min(99, Math.round(rvol * 18)),
        desc: rvol >= 3 ? "Buying activity is unusually strong" : rvol >= 2 ? "More buyers than normal are showing up" : rvol >= 1.2 ? "Buying activity is steady" : "Volume is below average",
        positive: rvol >= 1.2,
      },
      {
        label: "Crowd Interest",
        value: Math.round(attention * 0.28),
        desc: attention >= 80 ? "More traders than normal are participating" : attention >= 65 ? "Trader interest is growing" : attention >= 50 ? "Some interest detected" : "Not widely noticed yet",
        positive: attention >= 50,
      },
      {
        label: "Price Structure",
        value: Math.round(continuation * 0.24),
        desc: continuation >= 75 ? "Price action remains orderly and upward" : continuation >= 60 ? "Price structure is taking shape" : continuation >= 45 ? "Price is stabilizing" : "Price needs to stabilize",
        positive: continuation >= 45,
      },
      {
        label: "Risk Control",
        value: Math.round(trapSafety * 0.18),
        desc: trapSafety >= 60 ? "Low chance of a sudden reversal" : trapSafety >= 40 ? "Some reversal risk — stay disciplined" : "Elevated risk of a fake-out",
        positive: trapSafety >= 40,
      },
      {
        label: "Entry Quality",
        value: Math.round(entryQuality * 0.30),
        desc: entryQuality >= 75 ? "This is a clean place to consider entering" : entryQuality >= 60 ? "Entry conditions are forming" : entryQuality >= 45 ? "Entry is possible with caution" : "Not the right time to enter yet",
        positive: entryQuality >= 45,
      },
    ];
  };

  // RECENT SIMILAR READS — use real conviction leaders from the active scan
  const getRecentSimilarReads = (stock: Stock) => {
    // Pull from actual live conviction leaders excluding current stock
    const similar = convictionLeaders
      .filter((s) => s.symbol !== stock.symbol)
      .slice(0, 5)
      .map((s) => ({
        symbol: s.symbol,
        change: s.change,
        htScore: getHTScore(s),
        pattern: detectPatternSignal(s).name,
      }));
    return similar;
  };

  // HT STANCE — clear action directive
  const getHTStance = (stock: Stock) => {
    const read = getSimpleConvictionRead(stock);
    const ht = getHTScore(stock);
    const trapRisk = getTrapRiskScore(stock);
    const entryQuality = getEntryQualityScore(stock);
    const pattern = detectPatternSignal(stock).name;
    const move = Math.abs(stock.change);

    if (stock.change < 0) return { label: "STAND BY", color: "text-zinc-300", bg: "bg-zinc-500/10 border-zinc-500/20", desc: "Price is dropping. Wait for buyers to take control first." };
    if (trapRisk >= 72 || entryQuality < 45) return { label: "AVOID CHASING", color: "text-red-300", bg: "bg-red-500/10 border-red-400/25", desc: "Momentum is real but the risk of a reversal is too high right now." };
    if (move >= 12 || trapRisk >= 58) return { label: "WAIT FOR PULLBACK", color: "text-orange-300", bg: "bg-orange-500/10 border-orange-400/25", desc: "This has already moved a lot. A better entry will come after it calms down." };
    if (pattern === "Quiet Accumulation" || pattern === "Pressure Coil") return { label: "WATCH CLOSELY", color: "text-cyan-300", bg: "bg-cyan-500/10 border-cyan-400/25", desc: "Early pressure is building. Keep watching — the move has not fully started yet." };
    if (ht >= 88 && entryQuality >= 70 && trapRisk < 45) return { label: "ACCUMULATE", color: "text-green-300", bg: "bg-green-500/10 border-green-400/25", desc: "Conditions are favorable. HT sees a clean setup with room to run." };
    if (ht >= 78 && entryQuality >= 62) return { label: "BREAKOUT WATCH", color: "text-green-300", bg: "bg-green-500/10 border-green-400/25", desc: "Setup is approaching trigger level. Watch for volume confirmation before acting." };
    if (pattern === "Continuation Stack") return { label: "MOMENTUM ACTIVE", color: "text-lime-300", bg: "bg-lime-500/10 border-lime-400/25", desc: "Confirmation already happened. Let the move work while participation holds." };
    return { label: "WATCH", color: "text-yellow-300", bg: "bg-yellow-500/10 border-yellow-400/25", desc: "Interesting setup but HT wants one more confirmation before calling it ready." };
  };

  // HT NEXT MOVE — what to watch for
  const getHTNextMove = (stock: Stock) => {
    const pattern = detectPatternSignal(stock).name;
    const trapRisk = getTrapRiskScore(stock);
    const rvol = getRelativeVolume(stock);
    const move = Math.abs(stock.change);

    if (stock.change < 0) return {
      watch: ["Price reclaims a key level with volume", "Buyers show up with conviction, not just a bounce"],
      avoid: ["Catching a falling setup", "Entering before reclaim is confirmed"],
      trigger: "Volume expands while price holds or reclaims",
    };
    if (trapRisk >= 65 || move >= 12) return {
      watch: ["A pullback to a cleaner entry zone", "Volume holding without a sharp reversal"],
      avoid: ["Chasing the current candle", "Entering at the top of an extended move"],
      trigger: "Price pulls back and holds with volume returning",
    };
    if (pattern === "Quiet Accumulation" || pattern === "Pressure Coil") return {
      watch: ["Volume expanding above the recent baseline", "Price breaking above short-term resistance"],
      avoid: ["Entering before the breakout is confirmed", "Mistaking low volume for safety"],
      trigger: "Relative volume spikes while price clears resistance",
    };
    if (pattern === "Crowd Ignition") return {
      watch: ["Whether volume continues or fades after the first pop", "Price holding higher-low structure"],
      avoid: ["Late emotional entries after a vertical candle", "Ignoring signs of exhaustion"],
      trigger: "Volume stays elevated and price holds above the breakout level",
    };
    return {
      watch: ["Volume staying above normal", "Price holding above its recent support level"],
      avoid: ["Chasing if volume suddenly drops", "Entering without a clear stop level"],
      trigger: `Relative volume stays above ${Math.max(1.5, rvol - 0.5).toFixed(1)}x while price structure holds`,
    };
  };

  // SIMILAR SETUP HISTORY — based on signal memory insight
  const getSimilarSetupHistory = (stock: Stock) => {
    const ht = getHTScore(stock);
    const pattern = detectPatternSignal(stock).name;
    const trapRisk = getTrapRiskScore(stock);

    // Use real signal memory data if available
    if (signalMemoryInsight && signalMemoryInsight.tracked >= 5) {
      return {
        total: signalMemoryInsight.tracked,
        winners: signalMemoryInsight.winners,
        neutral: signalMemoryInsight.tracked - signalMemoryInsight.winners - signalMemoryInsight.failures,
        failures: signalMemoryInsight.failures,
        avgMove: signalMemoryInsight.successRate ? `+${Math.round(signalMemoryInsight.successRate * 0.12)}%` : "Building",
        source: "live",
      };
    }

    // Synthetic baseline based on setup quality
    const winRate = ht >= 88 && trapRisk < 40 ? 0.72 : ht >= 78 ? 0.62 : 0.52;
    const total = 20;
    const winners = Math.round(total * winRate);
    const failures = Math.round(total * (1 - winRate) * 0.5);
    const neutral = total - winners - failures;
    const avgMove = ht >= 88 ? "+9.2%" : ht >= 78 ? "+6.8%" : "+4.1%";

    return { total, winners, neutral, failures, avgMove, source: "model" };
  };


  const getSelectionTrustLine = (stock: Stock) => {
    const rank = getMarketRank(stock);
    const rvol = getRelativeVolume(stock);
    const read = getSimpleConvictionRead(stock);

    if (read.score >= 88) {
      return `${stock.symbol} is the #${rank} active read because pressure, entry quality, and trap safety passed HT quality control. ${rvol}x RVOL • Entry ${read.entryQuality}/99 • Trap ${read.trapRisk}/99.`;
    }

    if (rvol >= 3) {
      return `${stock.symbol} is on the board because participation is expanding. #${rank} active read • ${rvol}x RVOL.`;
    }

    return `${stock.symbol} is being monitored until pressure separates from noise. #${rank} active read • ${read.scoreLabel}.`;
  };

  const convictionEngineMetrics = useMemo(() => {
    const leader = convictionEngineTarget;

    if (!leader) {
      return [
        ["Next Trigger", "--", "what HT needs next"],
        ["Entry Bias", "--", "how to treat it"],
        ["Risk Guardrail", "--", "what can break it"],
        ["Setup Role", "--", "where it fits"],
      ];
    }

    return [
      ["Next Trigger", getNextTriggerShort(leader), getConfirmationTrigger(leader)],
      ["Entry Bias", getEntryBiasShort(leader), getBestTraderFit(leader)],
      ["Risk Guardrail", getRiskGuardrailShort(leader), getInvalidationRule(leader)],
      ["Setup Role", getSetupRoleShort(leader), getEdgeStatus(leader)],
    ];
  }, [convictionEngineTarget, stocks, news, traderMode, watchlist, savedSetups]);

  const convictionHistory = useMemo(() => {
    const leader = convictionEngineTarget;
    const second = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];

    return [
      {
        label: "HT Detected",
        symbol: leader?.symbol || "--",
        result: leader ? `${getBeforeCrowdScore(leader)}/99 before-crowd pressure` : "Scanning",
        note: leader
          ? "Top Conviction logged before the move becomes obvious to the wider crowd."
          : "Waiting for a clean pressure pocket.",
      },
      {
        label: "Confidence Expanded",
        symbol: leader?.symbol || "--",
        result: leader ? `${getHTScore(leader)}% HT confidence` : "No read",
        note: leader
          ? "HT confidence rises when attention, signal quality, and participation compress together."
          : "No confidence expansion yet.",
      },
      {
        label: "Attention Shift",
        symbol: heat?.symbol || "--",
        result: heat ? `${getAttentionScore(heat)}/99 crowd attention` : "No shift",
        note: heat
          ? "Crowd behavior is being tracked before it turns into noisy consensus."
          : "Crowd heat is still scattered.",
      },
      {
        label: "Next Edge Watch",
        symbol: second?.symbol || "--",
        result: second ? `${getBreakoutProbability(second)}% breakout probability` : "No rotation",
        note: second
          ? "If the lead signal fades, HT checks whether pressure rotates here or disappears."
          : "No secondary edge pocket yet.",
      },
    ];
  }, [convictionEngineTarget, secondaryTarget, htScoreLeaders, attentionLeaders, topMovers, stocks, news, traderMode]);

  const beginnerRead = convictionEngineTarget
    ? `${convictionEngineTarget.symbol} is the current HT read. Translation: attention is moving here first, but HT still wants participation quality to confirm before calling it clean.`
    : "HT is scanning for the first clean pressure pocket. Translation: no forced trade, no fake urgency.";


  const getConvictionVerdict = (stock: Stock) => {
    const confidence = getHTScore(stock);
    const breakout = getBreakoutProbability(stock);
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);

    if (confidence >= 90 && breakout >= 84 && signal >= 84) {
      return "Highest-conviction read on the board. Pressure quality, attention, and signal integrity are aligned.";
    }

    if (attention >= 86 && confidence >= 80) {
      return "Crowd attention is waking up, but HT is still checking whether participation quality supports continuation.";
    }

    if (breakout >= 74 && confidence >= 74) {
      return "Developing conviction. The read is improving, but HT still wants cleaner confirmation before calling it elite.";
    }

    if (stock.change < 0) {
      return "Defensive read. HT is filtering this until reclaim strength proves pressure is returning.";
    }

    return "Monitor only. HT sees possible pressure, but not enough alignment to make this the main read yet.";
  };

  const convictionFlow = useMemo(() => {
    const leader = convictionEngineTarget;

    if (!leader) {
      return [
        ["Pressure Quality", 0, "scanning"],
        ["Crowd Timing", 0, "waiting"],
        ["Risk Control", 0, "neutral"],
        ["Signal Strength", 0, "no read"],
      ];
    }

    const pressureQuality = Math.min(99, Math.round((getHTScore(leader) + getSignalQuality(leader)) / 2));
    const crowdTiming = Math.min(99, Math.round((getAttentionScore(leader) + getBeforeCrowdScore(leader)) / 2));
    const riskControl = Math.max(30, Math.min(99, 100 - Math.round(Math.abs(leader.change) * 3)));
    const signalIntegrity = getSignalQuality(leader);

    return [
      ["Pressure Quality", pressureQuality, pressureQuality >= 84 ? "clean compression" : "still developing"],
      ["Crowd Timing", crowdTiming, crowdTiming >= 84 ? "early enough to matter" : "crowd still forming"],
      ["Risk Control", riskControl, riskControl >= 72 ? "manageable" : "chase risk rising"],
      ["Signal Strength", signalIntegrity, signalIntegrity >= 82 ? "trustworthy read" : "needs confirmation"],
    ];
  }, [convictionEngineTarget, stocks, news, traderMode, watchlist, savedSetups]);

  const convictionMemory = useMemo(() => {
    const leader = convictionEngineTarget;
    const second = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];

    return [
      {
        title: "What HT Chose",
        value: leader ? `${leader.symbol} as the conviction focus` : "Scanning",
        detail: leader ? getConvictionVerdict(leader) : "No clean conviction cluster has separated yet.",
      },
      {
        title: "What Changed",
        value: leader ? `${getAttentionScore(leader)}/99 attention pressure` : "Waiting",
        detail: leader
          ? `${leader.symbol} separated because pressure, crowd timing, and signal quality are clustering tighter than the rest of the board.`
          : "HT is waiting for attention and participation to compress together.",
      },
      {
        title: "What To Avoid",
        value: heat ? `${heat.symbol} crowd heat` : "Random chase",
        detail: heat
          ? `${heat.symbol} may be loud, but HT only promotes it if attention turns into durable participation.`
          : "Movement without confirmation stays filtered as noise.",
      },
      {
        title: "Backup Read",
        value: second?.symbol || "No rotation",
        detail: second
          ? `${second.symbol} becomes important if the main conviction read fades or pressure rotates.`
          : "No secondary pressure pocket is strong enough yet.",
      },
    ];
  }, [convictionEngineTarget, secondaryTarget, htScoreLeaders, attentionLeaders, topMovers, stocks, news, traderMode]);

  const beginnerConvictionRead = convictionEngineTarget
    ? `${convictionEngineTarget.symbol} is HT's current conviction read. Simple version: this is where attention and pressure are lining up best, but HT still wants confirmation so you do not chase noise.`
    : "HT is scanning for the first clean conviction read. Simple version: no forced trade, no fake urgency.";


  const getSignalOutcomeStatus = (stock: Stock) => {
    const confidence = getHTScore(stock);
    const beforeCrowd = getBeforeCrowdScore(stock);
    const breakout = getBreakoutProbability(stock);
    const move = stock.change;

    if (move >= 10 && confidence >= 84 && beforeCrowd >= 78) return "Validated Pressure";
    if (breakout >= 84 && confidence >= 84) return "Authority Building";
    if (move >= 4 && beforeCrowd >= 72) return "Pressure Confirming";
    if (stock.change < 0) return "Risk Filter Active";

    return "Tracking";
  };

  const signalAuthorityStats = useMemo(() => {
    const leader = convictionEngineTarget;

    if (!leader) {
      return [
        ["Authority Read", "Scanning", "waiting for signal memory"],
        ["Confidence Path", "--", "no compression yet"],
        ["Pressure Result", "--", "no validated outcome"],
        ["Crowd Evolution", "--", "quiet tape"],
      ];
    }

    const earlyConfidence = Math.max(42, getHTScore(leader) - 18);
    const currentConfidence = getHTScore(leader);
    const pressureResult = leader.change >= 0 ? `+${leader.change.toFixed(2)}% live move` : `${leader.change.toFixed(2)}% defensive read`;

    return [
      ["Authority Read", getSignalOutcomeStatus(leader), "tracked signal outcome"],
      ["Confidence Path", `${earlyConfidence} → ${currentConfidence}%`, "pressure expansion"],
      ["Pressure Result", pressureResult, leader.change >= 0 ? "move after HT focus" : "risk filter held"],
      ["Crowd Evolution", `${getCrowdPhase(leader)}`, getSignalEvolutionState(leader)],
    ];
  }, [convictionEngineTarget, stocks, news, traderMode, watchlist, savedSetups]);

  const signalOutcomeTimeline = useMemo(() => {
    const leader = convictionEngineTarget;
    const second = secondaryTarget || htScoreLeaders[1];

    if (!leader) {
      return [
        {
          phase: "Scanning",
          value: "No authority read yet",
          note: "HT is waiting for attention, participation, and conviction to compress before logging a signal outcome.",
        },
      ];
    }

    const earlyConfidence = Math.max(42, getHTScore(leader) - 18);
    const middleConfidence = Math.max(52, getHTScore(leader) - 8);

    return [
      {
        phase: "Early Read",
        value: `${leader.symbol} pressure found`,
        note: `HT detected ${getBeforeCrowdScore(leader)}/99 before-crowd pressure before the read became obvious.` ,
      },
      {
        phase: "Confidence Expanded",
        value: `${earlyConfidence}% → ${middleConfidence}%`,
        note: "Attention and signal integrity started compressing together instead of moving as random noise.",
      },
      {
        phase: "Crowd Status Shift",
        value: getCrowdPhase(leader),
        note: getSignalEvolutionDetail(leader),
      },
      {
        phase: "Outcome Check",
        value: getSignalOutcomeStatus(leader),
        note: leader.change >= 0
          ? `${leader.symbol} is being tracked against the original Top Conviction so users can see whether HT was early.`
          : `${leader.symbol} remains a risk-filter read until reclaim strength proves pressure is returning.`,
      },
      {
        phase: "Next Authority Watch",
        value: second?.symbol || "No rotation",
        note: second
          ? `${second.symbol} is the next pressure pocket if the current signal loses authority.`
          : "No secondary read has earned enough conviction yet.",
      },
    ];
  }, [convictionEngineTarget, secondaryTarget, htScoreLeaders, stocks, news, traderMode]);

  const authoritySummary = convictionEngineTarget
    ? `HT is not just flagging ${convictionEngineTarget.symbol}; it is tracking whether the original pressure read keeps earning authority through confidence expansion, crowd phase progression, and outcome behavior.`
    : "HT is waiting for a clean signal before assigning authority. No forced conviction, no fake certainty.";



  const getLiveTerminalState = () => {
    const leader = convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;

    if (!leader) return "Scanning For Pressure";
    if (marketPulse === "Defensive") return "Defensive Tape";
    if (getSignalEvolutionState(leader) === "Exhaustion Risk") return "Exhaustion Risk Rising";
    if (getHTScore(leader) >= 90 && getAttentionScore(leader) >= 88) return "Pressure Expanding";
    if (getConvictionScore(leader) >= 84 && getAttentionScore(leader) < 80) return "Quiet Accumulation";
    if (hotStocks.length >= 2) return "Risk-On Rotation";

    return "Pressure Building";
  };

  const getLiveTerminalBrief = () => {
    const leader = convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;
    const state = getLiveTerminalState();

    if (!leader) {
      return "HT is waiting for attention, conviction, and participation to align before forcing a read.";
    }

    if (state === "Pressure Expanding") {
      return `${leader.symbol} is gaining conviction while crowd attention expands. HT is watching whether participation stays clean or turns into late chase behavior.`;
    }

    if (state === "Quiet Accumulation") {
      return `${leader.symbol} is showing conviction before full crowd saturation. This is the type of early pressure pocket HT wants users to notice before it gets loud.`;
    }

    if (state === "Defensive Tape") {
      return "The tape is defensive. HT is prioritizing reclaim strength, risk control, and confirmation over forced aggression.";
    }

    if (state === "Exhaustion Risk Rising") {
      return `${leader.symbol} is moving loud enough for chase risk to matter. HT is watching liquidity, pullbacks, and participation quality.`;
    }

    if (state === "Risk-On Rotation") {
      return "Momentum appetite is active across the board. HT is ranking the cleanest pressure pocket instead of treating every mover equally.";
    }

    return `${leader.symbol} remains the active read while pressure, attention, and signal quality continue developing.`;
  };

  const liveTerminalMetrics = useMemo(() => {
    const leader = convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;
    const pulseBoost = mounted ? terminalPulse % 3 : 0;

    if (!leader) {
      return [
        ["Terminal State", "Scanning", "waiting for alignment"],
        ["Pressure Pulse", "--", "no clean read yet"],
        ["Crowd Motion", "--", "quiet"],
        ["HT Read", "--", "standby"],
      ];
    }

    const liveConfidence = Math.min(99, Math.max(35, getHTScore(leader) + pulseBoost - 1));
    const livePressure = Math.min(99, Math.max(35, getBeforeCrowdScore(leader) + (mounted ? (terminalPulse % 4) - 1 : 0)));
    const liveAttention = Math.min(99, Math.max(35, getAttentionScore(leader) + (mounted ? (terminalPulse % 5) - 2 : 0)));

    return [
      ["Terminal State", getLiveTerminalState(), "adaptive tape mood"],
      ["Pressure Pulse", `${livePressure}%`, getSignalEvolutionState(leader)],
      ["Crowd Motion", `${liveAttention}%`, getCrowdPhase(leader)],
      ["HT Read", `${liveConfidence}%`, getEdgeStatus(leader)],
    ];
  }, [
    convictionEngineTarget,
    firstSignal,
    priorityTarget,
    topStock,
    terminalPulse,
    marketPulse,
    hotStocks.length,
    stocks,
    news,
    traderMode,
    watchlist,
    savedSetups,
  ]);

  const livePulseFeed = useMemo(() => {
    const leader = convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;
    const rotation = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];

    return [
      leader
        ? `${leader.symbol}: ${getLiveTerminalState()} — ${getDeskAlertTone(leader)}`
        : "HT Desk: scanning for clean pressure alignment.",
      rotation
        ? `${rotation.symbol}: rotation memory active if the lead read fades.`
        : "Rotation memory: no secondary pressure pocket has separated yet.",
      heat
        ? `${heat.symbol}: crowd heat is ${getCrowdPhase(heat).toLowerCase()}, but HT still wants participation proof.`
        : "Crowd heat: scattered and not yet actionable.",
    ];
  }, [
    convictionEngineTarget,
    firstSignal,
    priorityTarget,
    topStock,
    secondaryTarget,
    htScoreLeaders,
    attentionLeaders,
    topMovers,
    terminalPulse,
    stocks,
    news,
    traderMode,
  ]);




  const getInteractiveReasoning = (type: string, stock?: Stock | null) => {
    const target = stock || convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;

    if (!target) return "HT is waiting for a clean pressure pocket before assigning conviction.";

    const attention = getAttentionScore(target);
    const conviction = getConvictionScore(target);
    const pressure = getBeforeCrowdScore(target);
    const signal = getSignalQuality(target);
    const breakout = getBreakoutProbability(target);
    const rvol = getRelativeVolume(target);

    if (type === "confidence") {
      return `${target.symbol} confidence is shaped by ${conviction}/99 conviction, ${attention}/99 attention, ${signal}/99 signal integrity, and ${rvol}x volume pressure. HT wants alignment, not just movement.`;
    }
    if (type === "crowd") {
      return `${target.symbol} is in the ${getCrowdPhase(target)} phase. HT is watching whether crowd attention converts into durable participation or late-chase behavior.`;
    }
    if (type === "pressure") {
      return `${target.symbol} has ${pressure}/99 before-crowd pressure. HT is tracking attention compression before the broader crowd fully prices the move.`;
    }
    if (type === "breakout") {
      return `${target.symbol} breakout probability is ${breakout}%. HT is balancing pressure expansion against extension risk so the read does not become blind hype.`;
    }
    if (type === "risk") return getInvalidationRule(target);

    return getWhyThisMatters(target);
  };

  const interactiveInsightCards = useMemo(() => {
    const target = convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;

    return [
      {
        id: "why-this-matters",
        label: "Why This Matters",
        value: target ? getEdgeStatus(target) : "Scanning",
        note: getInteractiveReasoning("why", target),
      },
      {
        id: "confidence",
        label: "Confidence Logic",
        value: target ? `${getHTScore(target)}%` : "--",
        note: getInteractiveReasoning("confidence", target),
      },
      {
        id: "crowd",
        label: "Crowd Status",
        value: target ? getCrowdPhase(target) : "--",
        note: getInteractiveReasoning("crowd", target),
      },
      {
        id: "breakout",
        label: "Breakout Read",
        value: target ? `${getBreakoutProbability(target)}%` : "--",
        note: getInteractiveReasoning("breakout", target),
      },
    ];
  }, [convictionEngineTarget, firstSignal, priorityTarget, topStock, terminalPulse, stocks, news, traderMode, watchlist, savedSetups]);

  const liveStatusShifts = useMemo(() => {
    const target = convictionEngineTarget || firstSignal?.stock || priorityTarget || topStock;
    const rotation = secondaryTarget || htScoreLeaders[1];
    const heat = attentionLeaders[1] || topMovers[1];

    return [
      {
        label: "Confidence",
        value: target ? "increasing" : "waiting",
        detail: target ? (mounted ? `${target.symbol} pressure read refreshed ${8 + (terminalPulse % 11)}s ago.` : `${target.symbol} pressure read refreshing...`) : "No active target yet.",
      },
      {
        label: "Attention",
        value: heat ? "rotating" : "quiet",
        detail: heat ? `${heat.symbol} crowd heat is moving, but HT still needs participation proof.` : "Crowd heat remains scattered.",
      },
      {
        label: "Risk",
        value: target && Math.abs(target.change) >= 10 ? "elevated" : "controlled",
        detail: target ? getInvalidationRule(target) : "Risk engine waiting for live tape structure.",
      },
      {
        label: "Rotation",
        value: rotation ? "armed" : "standby",
        detail: rotation ? `${rotation.symbol} becomes relevant if the lead Top Conviction fades.` : "No secondary pressure pocket has separated yet.",
      },
    ];
  }, [convictionEngineTarget, firstSignal, priorityTarget, topStock, secondaryTarget, htScoreLeaders, attentionLeaders, topMovers, terminalPulse, stocks, news, traderMode]);


  const watchlistStocks = useMemo(() => {
    return watchlist
      .map((symbol) => stocks.find((stock) => stock.symbol === symbol))
      .filter(Boolean) as Stock[];
  }, [watchlist, stocks]);

  const watchlistPriority = useMemo(() => {
    if (watchlistStocks.length === 0) return null;

    return [...watchlistStocks].sort(
      (a, b) => getConvictionScore(b) - getConvictionScore(a),
    )[0];
  }, [watchlistStocks, news, savedSetups, traderMode]);

  const savedSetupStocks = useMemo(() => {
    return savedSetups
      .map((symbol) => stocks.find((stock) => stock.symbol === symbol))
      .filter(Boolean) as Stock[];
  }, [savedSetups, stocks]);

  const recentlyViewedStocks = useMemo(() => {
    return viewedTickers
      .map((symbol) => stocks.find((stock) => stock.symbol === symbol))
      .filter(Boolean)
      .slice(0, 4) as Stock[];
  }, [viewedTickers, stocks]);

  const personalWorkspaceStatus = useMemo(() => {
    if (session && watchlist.length >= 3 && savedSetups.length >= 2) {
      return "Personal Terminal Active";
    }

    if (session && watchlist.length > 0) {
      return "Cloud Workspace Building";
    }

    if (watchlist.length > 0 || savedSetups.length > 0) {
      return "Local Workspace Active";
    }

    return "Guest Workspace";
  }, [session, watchlist.length, savedSetups.length]);

  const personalInsight = useMemo(() => {
    if (watchlistPriority) {
      return `${watchlistPriority.symbol} is the strongest ticker inside your watchlist right now with ${getConvictionScore(watchlistPriority)}/99 conviction.`;
    }

    if (recentlyViewedStocks[0]) {
      return `${recentlyViewedStocks[0].symbol} is your most recent focus. Save it or add it to watchlist if it matters.`;
    }

    if (priorityTarget) {
      return `${priorityTarget.symbol} is leading the public scanner. Add tickers to personalize your terminal.`;
    }

    return "Add 3-5 tickers to start building a personalized HT Labs workflow.";
  }, [watchlistPriority, recentlyViewedStocks, priorityTarget, news, savedSetups, traderMode]);

  const getTradePlan = (stock: Stock) => {
    if (stock.change >= 8) {
      return "Attention Spike is hot. Wait for pullback/reclaim instead of chasing the biggest candle.";
    }

    if (stock.change >= 2) {
      return "Attention pressure is forming. Participation quality must expand before the move earns conviction.";
    }

    if (stock.change < 0) {
      return "Defensive tape. Needs reclaim confirmation before treating it as a long setup.";
    }

    return "Pre-signal watch. HT needs attention, participation, or catalyst pressure before calling it early.";
  };

  const fetchNews = async (symbol: string) => {
    if (news[symbol] || newsIntel[symbol]) return;

    try {
      const response = await fetch(`/api/news-intel?symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`News request failed for ${symbol}`);
      }

      const data = await response.json();
      const articles = Array.isArray(data)
        ? data
        : Array.isArray(data?.articles)
          ? data.articles
          : [];

      const newsVelocity =
        typeof data?.newsVelocity === "number"
          ? data.newsVelocity
          : articles.length >= 5
            ? 84
            : articles.length >= 3
              ? 72
              : articles.length >= 1
                ? 56
                : 25;

      setNews((prev) => ({
        ...prev,
        [symbol]: articles,
      }));

      setNewsIntel((prev) => ({
        ...prev,
        [symbol]: {
          articles,
          newsVelocity,
          catalystStrength:
            data?.catalystStrength ||
            (articles.length >= 3
              ? "Fresh catalyst activity"
              : articles.length >= 1
                ? "Light news activity"
                : "No fresh catalyst"),
          narrativeSignal:
            data?.narrativeSignal ||
            (articles.length >= 3
              ? "Narrative pressure accelerating"
              : articles.length >= 1
                ? "Fresh headline detected"
                : "Narrative still quiet"),
          sentimentBias: data?.sentimentBias || "Neutral narrative",
          sentimentScore: typeof data?.sentimentScore === "number" ? data.sentimentScore : 55,
          hypeScore: typeof data?.hypeScore === "number" ? data.hypeScore : 35,
          sourceCount: articles.length,
        },
      }));
    } catch (error) {
      console.warn("NEWS FETCH:", error instanceof Error ? error.message : "fetch unavailable");

      setNews((prev) => ({
        ...prev,
        [symbol]: [],
      }));

      setNewsIntel((prev) => ({
        ...prev,
        [symbol]: {
          articles: [],
          newsVelocity: 25,
          catalystStrength: "No fresh catalyst",
          narrativeSignal: "Narrative still quiet",
          sentimentBias: "Neutral narrative",
          sentimentScore: 50,
          hypeScore: 25,
          sourceCount: 0,
        },
      }));
    }
  };

  const getTopNews = (symbol: string) => {
    return getNewsArticles(symbol)?.[0];
  };

  const getWhyMoving = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const topNews = getNewsArticles(stock.symbol)[0];

    if (topNews?.headline) {
      return `Recent catalyst detected: ${topNews.headline}`;
    }

    if (stock.symbol === "SNAL") {
      return "Retail attention and extreme volatility are driving the tape. Watch for volume fade risk after parabolic moves.";
    }

    if (stock.symbol === "QUBT") {
      return "Speculative quantum/AI narrative is attracting momentum traders. Best setups usually come after reclaim or higher-low confirmation.";
    }

    if (stock.symbol === "NVDA") {
      return "Large-cap AI leadership is supporting broader tech strength and institutional attention.";
    }

    if (stock.symbol === "MSTR") {
      return "Crypto-beta momentum is feeding into trader attention. Moves can expand quickly when risk appetite is strong.";
    }

    if (move >= 8) {
      return "Unusual percentage move detected. Trader attention is elevated, but chase risk is high.";
    }

    if (move >= 4) {
      return "Attention pressure is above scanner threshold. Watch whether participation quality keeps expanding.";
    }

    if (stock.change < 0) {
      return "Weak tape today. Needs reclaim confirmation before treating it as a long setup.";
    }

    return "No true pressure shift yet. Keep it on watch until crowd behavior starts changing.";
  };

  const liveHeroTarget = convictionEngineTarget || priorityTarget || topStock;
  const liveHeroPrice = liveHeroTarget ? Number(liveHeroTarget.price || 0) : 0;
  const liveHeroChange = liveHeroTarget ? Number(liveHeroTarget.change || 0) : 0;
  const liveHeroIsGreen = liveHeroChange >= 0;
  const liveHeroPriceDecimals = liveHeroPrice > 0 && liveHeroPrice < 10 ? 2 : 2;
  const liveHeroPriceDisplay = liveHeroTarget && mounted
    ? `$${liveHeroPrice.toLocaleString(undefined, {
        minimumFractionDigits: liveHeroPriceDecimals,
        maximumFractionDigits: liveHeroPriceDecimals,
      })}`
    : "--";
  const liveHeroChangeDisplay = liveHeroTarget
    ? `${liveHeroIsGreen ? "+" : ""}${liveHeroChange.toFixed(2)}%`
    : "--";
  const liveHeroMomentumBadge = liveHeroTarget
    ? getSignalEvolutionState(liveHeroTarget)
    : "Scanning";
  const liveHeroPricePulse = mounted && terminalPulse % 2 === 0;

  const emergingNextSetup = useMemo(() => {
    const leaderSymbol = liveHeroTarget?.symbol;
    const candidates = [...stocks]
      .filter((stock) => stock.symbol !== leaderSymbol)
      .sort((a, b) => {
        const aScore = getHTScore(a) * 0.45 + getAttentionScore(a) * 0.35 + getSignalQuality(a) * 0.2;
        const bScore = getHTScore(b) * 0.45 + getAttentionScore(b) * 0.35 + getSignalQuality(b) * 0.2;

        return bScore - aScore;
      });

    const next = candidates[0];

    if (!next) return null;

    const nextScore = getHTScore(next);
    const nextAttention = getAttentionScore(next);
    const nextSignal = getSignalQuality(next);

    if (nextScore < 74 && nextAttention < 76 && nextSignal < 74) {
      return null;
    }

    return next;
  }, [stocks, liveHeroTarget, news, traderMode, watchlist, savedSetups]);

  const getEmergingRead = (stock: Stock | null) => {
    if (!stock) {
      return "No clean secondary setup. HT is not forcing a backup ticker.";
    }

    if (getHTScore(stock) >= 86 && getAttentionScore(stock) >= 80) {
      return `${stock.symbol} is the next pressure pocket if the primary read fades or rotation expands.`;
    }

    if (getAttentionScore(stock) >= 78) {
      return `${stock.symbol} has attention building, but HT still wants participation proof before upgrading it.`;
    }

    return `${stock.symbol} is on secondary watch. Not priority yet, but pressure is forming.`;
  };

  const operatorPriorityStack = [
    {
      label: "Primary Focus",
      symbol: liveHeroTarget?.symbol || "--",
      state: liveHeroTarget ? getSignalEvolutionState(liveHeroTarget) : "Scanning",
      note: liveHeroTarget
        ? `${liveHeroTarget.symbol} still owns the main HT read unless pressure fades.`
        : "HT is scanning for a clean focus directive.",
    },
    {
      label: "Emerging Next",
      symbol: emergingNextSetup?.symbol || "No clean setup",
      state: emergingNextSetup ? getSignalEvolutionState(emergingNextSetup) : "Standby",
      note: getEmergingRead(emergingNextSetup),
    },
    {
      label: "Avoid / Weak Tape",
      symbol: dangerTarget?.symbol || "None",
      state: dangerTarget ? "Risk Filter" : "Clean",
      note: dangerTarget
        ? `${dangerTarget.symbol} is weak. HT does not confuse movement with opportunity.`
        : "No major weak-tape warning is dominating the board.",
    },
  ];

  const whyHTLikesThis = liveHeroTarget
    ? [
        {
          label: "Price Action",
          value: `${liveHeroIsGreen ? "+" : ""}${liveHeroChange.toFixed(2)}% live move`,
          note: liveHeroChange >= 8 ? "Momentum is active, but chase risk must be respected." : "Move is still developing; HT is watching confirmation quality.",
        },
        {
          label: "Volume Heat",
          value: `${getRelativeVolume(liveHeroTarget)}x relative flow`,
          note: getRelativeVolume(liveHeroTarget) >= 3 ? "Participation is expanding beneath the move." : "Volume needs to keep improving before HT treats this as elite.",
        },
        {
          label: "Crowd Behavior",
          value: getCrowdPhase(liveHeroTarget),
          note: getAttentionScore(liveHeroTarget) >= 80 ? "Attention is building faster than the rest of the board." : "Crowd participation is still forming.",
        },
        {
          label: "Risk Framing",
          value: getRiskProfile(liveHeroTarget),
          note: getSignalEvolutionState(liveHeroTarget) === "Exhaustion Risk" ? "Potential exhaustion forming. Wait for proof instead of chasing." : getDeskAlertTone(liveHeroTarget),
        },
      ]
    : [];

  const signalReplaySpotlight = useMemo(() => {
    const leader = liveHeroTarget;

    if (!leader) {
      return {
        symbol: "--",
        price: "--",
        change: "--",
        phase: "Scanning",
        detected: "--",
        high: "--",
        expansion: "--",
        status: "Scanning",
        thesis: "HT is waiting for the next pressure pocket worth logging.",
      };
    }

    const estimatedDetectedPrice = leader.symbol === "SNAL"
      ? 0.88
      : Math.max(0.01, leader.price / (1 + Math.max(1, Math.abs(leader.change)) / 100));
    const estimatedHigh = leader.symbol === "SNAL"
      ? 1.24
      : leader.price;
    const expansion = ((estimatedHigh - estimatedDetectedPrice) / estimatedDetectedPrice) * 100;

    return {
      symbol: leader.symbol,
      price: `$${Number(leader.price || 0).toFixed(2)}`,
      change: `${leader.change >= 0 ? "+" : ""}${leader.change.toFixed(2)}%`,
      phase: getCrowdPhase(leader),
      detected: `$${estimatedDetectedPrice.toFixed(2)}`,
      high: `$${estimatedHigh.toFixed(2)}`,
      expansion: `${expansion >= 0 ? "+" : ""}${expansion.toFixed(1)}%`,
      status: getSignalOutcomeStatus(leader),
      thesis: getHTSignalLanguage(leader),
    };
  }, [liveHeroTarget, stocks, news, traderMode, watchlist, savedSetups]);

  const capitalAvailable = Math.max(0, Number(capitalInput.replace(/[^0-9.]/g, "")) || 0);
  const coreCandidates = stocks.filter((stock) =>
    ["NVDA", "MSFT", "AAPL", "PLTR", "AMD", "SPY", "QQQ"].includes(stock.symbol),
  );
  const stabilityAnchor =
    [...coreCandidates].sort((a, b) => getHTScore(b) - getHTScore(a))[0] ||
    stocks.find((stock) => stock.symbol !== liveHeroTarget?.symbol) ||
    liveHeroTarget;

  const allocationProfileLabel =
    allocationStyle === "short"
      ? "Short-Term Momentum"
      : allocationStyle === "swing"
        ? "Swing / Multi-Day"
        : "Long-Term Growth";

  const riskProfileLabel =
    allocationRisk === "conservative"
      ? "Conservative"
      : allocationRisk === "moderate"
        ? "Moderate"
        : "Aggressive";

  const experienceLabel =
    experienceLevel === "beginner"
      ? "Beginner"
      : experienceLevel === "intermediate"
        ? "Intermediate"
        : "Advanced";

  const adaptiveAllocationPlan = useMemo(() => {
    const capital = capitalAvailable;
    const primary = liveHeroTarget;
    const secondary = emergingNextSetup;
    const anchor = stabilityAnchor;

    const reservePct = (() => {
      if (allocationRisk === "conservative") return allocationStyle === "long" ? 0.35 : 0.45;
      if (allocationRisk === "aggressive") return allocationStyle === "short" ? 0.22 : 0.18;
      return allocationStyle === "short" ? 0.32 : 0.25;
    })();

    const primaryPct = (() => {
      if (!primary) return 0;
      if (allocationStyle === "long") return allocationRisk === "aggressive" ? 0.18 : allocationRisk === "moderate" ? 0.12 : 0.08;
      if (allocationRisk === "aggressive") return 0.30;
      if (allocationRisk === "moderate") return 0.22;
      return 0.14;
    })();

    const secondaryPct = (() => {
      if (!secondary) return 0;
      if (allocationStyle === "long") return 0.08;
      if (allocationRisk === "aggressive") return 0.18;
      if (allocationRisk === "moderate") return 0.12;
      return 0.07;
    })();

    const anchorPct = Math.max(0, 1 - reservePct - primaryPct - secondaryPct);

    const items = [
      primary && {
        label: "Primary HT Read",
        symbol: primary.symbol,
        amount: Math.round(capital * primaryPct),
        pct: Math.round(primaryPct * 100),
        state: getSignalEvolutionState(primary),
        note: primaryPct >= 0.22
          ? "Momentum exposure sized for opportunity, not an all-in chase."
          : "Smaller exposure because HT is respecting volatility and user profile.",
      },
      secondary && {
        label: "Emerging Next",
        symbol: secondary.symbol,
        amount: Math.round(capital * secondaryPct),
        pct: Math.round(secondaryPct * 100),
        state: getSignalEvolutionState(secondary),
        note: "Only deploy if rotation confirms. This is a secondary pressure pocket, not the main read yet.",
      },
      anchor && {
        label: allocationStyle === "long" ? "Core / Stability" : "Stability Anchor",
        symbol: anchor.symbol,
        amount: Math.round(capital * anchorPct),
        pct: Math.round(anchorPct * 100),
        state: getSignalEvolutionState(anchor),
        note: "Balances the plan so the account is not fully dependent on one volatile momentum name.",
      },
      {
        label: "Cash Reserve",
        symbol: "CASH",
        amount: Math.round(capital * reservePct),
        pct: Math.round(reservePct * 100),
        state: "Flexibility",
        note: "Cash is a position. HT preserves buying power for pullbacks, reclaims, or cleaner signals.",
      },
    ].filter(Boolean) as { label: string; symbol: string; amount: number; pct: number; state: string; note: string }[];

    const deployment = items.reduce((sum, item) => item.symbol === "CASH" ? sum : sum + item.amount, 0);
    const reserve = items.find((item) => item.symbol === "CASH")?.amount || 0;
    const maxSingle = items.filter((item) => item.symbol !== "CASH").reduce((max, item) => Math.max(max, item.amount), 0);
    const maxSinglePct = capital > 0 ? Math.round((maxSingle / capital) * 100) : 0;

    return {
      items,
      deployment,
      reserve,
      maxSinglePct,
      summary: capital > 0
        ? `HT would deploy about $${mounted ? deployment.toLocaleString() : deployment} and keep $${mounted ? reserve.toLocaleString() : reserve} flexible based on your ${riskProfileLabel.toLowerCase()} ${allocationProfileLabel.toLowerCase()} profile.`
        : "Enter capital to generate an adaptive allocation read.",
    };
  }, [
    capitalAvailable,
    allocationStyle,
    allocationRisk,
    experienceLevel,
    liveHeroTarget,
    emergingNextSetup,
    stabilityAnchor,
    stocks,
    news,
    traderMode,
    watchlist,
    savedSetups,
  ]);

  const adaptiveRiskMessage = (() => {
    if (!liveHeroTarget) return "HT is waiting for a clean read before suggesting deployment.";
    if (allocationStyle === "short" && getRiskProfile(liveHeroTarget).includes("HIGH")) {
      return `${liveHeroTarget.symbol} has elevated volatility. HT will not recommend full-capital deployment into a speculative momentum move.`;
    }
    if (experienceLevel === "beginner") {
      return "Beginner mode keeps sizing tighter and preserves more cash so the user can learn without overexposure.";
    }
    return "Allocation adapts to the active signal, market pressure, and your stated risk profile.";
  })();

  const profitProtectionPlan = useMemo(() => {
    const target = liveHeroTarget;

    if (!target) {
      return {
        symbol: "--",
        headline: "HT Exit Assist waiting for a clean signal.",
        protectZone: "No setup",
        stopRule: "Wait for a live priority target before modeling exits.",
        trimStyle: "Standby",
        tiers: [
          { label: "First trim", range: "--", action: "No trade yet" },
          { label: "Runner trim", range: "--", action: "Let HT find pressure first" },
          { label: "Risk line", range: "--", action: "Do not force entries" },
        ],
      };
    }

    const opportunity = getOpportunityRange(target);
    const price = Number(target.price || 0);
    const move = Math.abs(target.change);
    const riskTemp = getRiskTemperature(target);
    const signalState = getSignalEvolutionState(target);

    const firstTrimPct =
      allocationRisk === "conservative" ? 0.025 : allocationRisk === "moderate" ? 0.045 : 0.07;
    const secondTrimPct =
      allocationRisk === "conservative" ? 0.05 : allocationRisk === "moderate" ? 0.085 : 0.14;
    const stopPct =
      allocationRisk === "conservative" ? 0.025 : allocationRisk === "moderate" ? 0.04 : 0.065;

    const firstTrim = price > 0 ? price * (1 + firstTrimPct) : 0;
    const secondTrim = price > 0 ? price * (1 + secondTrimPct) : 0;
    const riskLine = price > 0 ? price * (1 - stopPct) : 0;

    const trimStyle =
      allocationRisk === "conservative"
        ? "Take smaller wins faster and protect the account."
        : allocationRisk === "moderate"
          ? "Scale out in pieces so one winner can keep working."
          : "Let runners breathe, but cut fast if pressure fails.";

    const headline =
      target.change < 0
        ? `${target.symbol} is not an exit-ladder candidate yet. HT wants reclaim strength first.`
        : riskTemp === "Explosive" || signalState === "Exhaustion Risk" || move >= 10
          ? `${target.symbol} has upside energy, but chase risk is elevated. Protect profits in layers.`
          : `${target.symbol} has a cleaner compounding window. Plan trims before emotion takes over.`;

    return {
      symbol: target.symbol,
      headline,
      protectZone: opportunity.label,
      stopRule: getInvalidationRule(target),
      trimStyle,
      tiers: [
        {
          label: "First trim",
          range: price > 0 ? `$${firstTrim.toFixed(2)}` : opportunity.defensive,
          action: allocationRisk === "conservative" ? "Secure part of the win" : "Pay yourself, keep exposure" ,
        },
        {
          label: "Runner trim",
          range: price > 0 ? `$${secondTrim.toFixed(2)}` : opportunity.balanced,
          action: allocationRisk === "aggressive" ? "Let strength prove itself" : "Reduce emotional decision pressure",
        },
        {
          label: "Risk line",
          range: price > 0 ? `$${riskLine.toFixed(2)}` : "Reclaim/fail level",
          action: "If pressure fails, reassess instead of hoping",
        },
      ],
    };
  }, [
    liveHeroTarget,
    allocationRisk,
    allocationStyle,
    experienceLevel,
    stocks,
    news,
    traderMode,
    watchlist,
    savedSetups,
  ]);


  const portfolioIntelligence = useMemo(() => {
    const holdings = portfolioHoldings
      .map((holding) => {
        const symbol = holding.symbol.trim().toUpperCase();
        const amount = Math.max(0, Number(holding.amount) || 0);
        const stock = stocks.find((item) => item.symbol === symbol) || fallbackQuotes[symbol];
        const htScore = stock ? getHTScore(stock) : 50;
        const phase = stock ? getSignalEvolutionState(stock) : "Manual Watch";
        const risk = stock ? getRiskProfile(stock) : "UNKNOWN";

        return { ...holding, symbol, amount, stock, htScore, phase, risk };
      })
      .filter((holding) => holding.symbol && holding.amount > 0);

    const cash = Math.max(0, Number(cashInput) || 0);
    const invested = holdings.reduce((sum, holding) => sum + holding.amount, 0);
    const total = invested + cash;
    const cashPct = total > 0 ? Math.round((cash / total) * 100) : 0;
    const momentumExposure = holdings
      .filter((holding) =>
        holding.stock
          ? Math.abs(holding.stock.change) >= 4 || getSignalEvolutionState(holding.stock).includes("Crowd") || getSignalEvolutionState(holding.stock).includes("Priority")
          : ["SNAL", "QUBT", "MSTR", "HOOD"].includes(holding.symbol),
      )
      .reduce((sum, holding) => sum + holding.amount, 0);
    const momentumPct = total > 0 ? Math.round((momentumExposure / total) * 100) : 0;
    const largestHolding = [...holdings].sort((a, b) => b.amount - a.amount)[0];
    const concentrationPct = largestHolding && total > 0 ? Math.round((largestHolding.amount / total) * 100) : 0;
    const strongest = [...holdings].sort((a, b) => b.htScore - a.htScore)[0];
    const weakest = [...holdings].sort((a, b) => a.htScore - b.htScore)[0];

    const riskLevel =
      momentumPct >= 60 || concentrationPct >= 45 || cashPct < 10
        ? "Elevated"
        : momentumPct >= 40 || concentrationPct >= 32 || cashPct < 18
          ? "Moderate"
          : "Balanced";

    const cashHealth = cashPct >= 25 ? "Healthy" : cashPct >= 12 ? "Thin" : "Too Low";

    const rebalance = (() => {
      if (!total) return "Enter holdings and cash to activate the portfolio read.";
      if (cashPct < 12) return "Build cash back above 15-25% before chasing new pressure pockets.";
      if (concentrationPct >= 45 && largestHolding) return `Reduce concentration risk. ${largestHolding.symbol} is carrying ${concentrationPct}% of the portfolio.`;
      if (momentumPct >= 60) return "Momentum exposure is hot. Trim weaker conviction names first and preserve flexibility.";
      if (strongest && weakest && strongest.symbol !== weakest.symbol) return `Keep ${strongest.symbol} as the strongest read and review ${weakest.symbol} first if trimming is needed.`;
      return "Portfolio structure is workable. Keep cash flexible and let HT rank rotation before adding more exposure.";
    })();

    const warning = (() => {
      if (!total) return "No emotional risk read yet.";
      if (momentumPct >= 60) return "You may be overexposed to fast-moving names. HT would avoid revenge adds and random averaging down.";
      if (cashPct < 12) return "Cash is too thin. Low flexibility can force bad decisions when better setups appear.";
      if (concentrationPct >= 45) return "One position has too much control over the account outcome.";
      return "Risk is manageable. The key is staying selective instead of forcing every signal.";
    })();

    return {
      holdings,
      cash,
      invested,
      total,
      cashPct,
      momentumPct,
      concentrationPct,
      largestHolding,
      strongest,
      weakest,
      riskLevel,
      cashHealth,
      rebalance,
      warning,
    };
  }, [portfolioHoldings, cashInput, stocks, news, traderMode, watchlist, savedSetups]);


  const watchtowerAlerts = useMemo(() => {
    const leader = liveHeroTarget;
    const rotation = emergingNextSetup;
    const riskName = dangerTarget;
    const profileTone = `${riskProfileLabel} ${allocationProfileLabel}`;

    const alerts = [
      leader && {
        severity: getHTScore(leader) >= 90 ? "Priority" : "Watch",
        symbol: leader.symbol,
        title: `${leader.symbol} remains the active HT focus`,
        message: `${getSignalEvolutionState(leader)} with ${getHTScore(leader)}/99 HT Score and ${getAttentionScore(leader)}/99 attention. ${getDeskAlertTone(leader)}`,
        action: allocationRisk === "conservative"
          ? "Respect confirmation first. Do not size this like an aggressive momentum account."
          : "Monitor continuation quality, volume pressure, and reclaim behavior before adding size.",
        tone: "orange",
      },
      rotation && {
        severity: "Rotation",
        symbol: rotation.symbol,
        title: `${rotation.symbol} is the next pressure pocket`,
        message: `${rotation.symbol} is not the main read yet, but HT sees ${getAttentionScore(rotation)}/99 attention and ${getHTScore(rotation)}/99 HT Score building behind the leader.`,
        action: `If ${leader?.symbol || "the primary read"} fades, watch whether attention rotates into ${rotation.symbol} with real participation.`,
        tone: "green",
      },
      riskName && {
        severity: "Risk",
        symbol: riskName.symbol,
        title: `${riskName.symbol} is weak-tape noise`,
        message: `${riskName.symbol} is being filtered because movement without reclaim strength is not opportunity.`,
        action: "Avoid forcing long bias until reclaim strength and signal quality improve.",
        tone: "red",
      },
      portfolioIntelligence.total > 0 && {
        severity: portfolioIntelligence.riskLevel === "Elevated" ? "Portfolio Risk" : "Portfolio Check",
        symbol: "PORTFOLIO",
        title: `${portfolioIntelligence.riskLevel} portfolio risk detected`,
        message: `Momentum exposure is ${portfolioIntelligence.momentumPct}% and cash flexibility is ${portfolioIntelligence.cashPct}%. HT is reading this through your ${profileTone.toLowerCase()} profile.`,
        action: portfolioIntelligence.warning,
        tone: portfolioIntelligence.riskLevel === "Elevated" ? "red" : "zinc",
      },
      leader && Math.abs(leader.change) >= 10 && {
        severity: "Exhaustion",
        symbol: leader.symbol,
        title: `${leader.symbol} chase risk is elevated`,
        message: "The move is loud enough that emotional entries become dangerous. HT wants proof that liquidity can absorb profit-taking.",
        action: "Wait for pullback, reclaim, or clean continuation instead of reacting to the vertical candle.",
        tone: "red",
      },
    ].filter(Boolean) as {
      severity: string;
      symbol: string;
      title: string;
      message: string;
      action: string;
      tone: "orange" | "green" | "red" | "zinc";
    }[];

    return alerts.slice(0, 5);
  }, [
    liveHeroTarget,
    emergingNextSetup,
    dangerTarget,
    portfolioIntelligence,
    allocationRisk,
    allocationStyle,
    riskProfileLabel,
    allocationProfileLabel,
    stocks,
    news,
    traderMode,
    watchlist,
    savedSetups,
  ]);


  const fetchStockUniverse = async (symbols: string[]): Promise<Stock[]> => {
    // Step 1: Fetch Polygon bulk quotes first — this is the fast path.
    // ht-signals-feed (Supabase) runs in parallel but we don't wait for it
    // before rendering. Signals enrich the data when they arrive.
    const [bulkRes, signalsRes] = await Promise.allSettled([
      fetch("/api/bulk-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      }),
      // Fire signals fetch but don't block on it — always fresh, no cache
      fetch("/api/ht-signals-feed", { cache: "no-store" }).catch(() => null),
    ]);

    // Step 2: Parse bulk quote (Polygon price/volume — always fast)
    let quotes: Record<string, { price: number; change: number; volume?: number; prevVolume?: number; avgVolume?: number }> = {};
    if (bulkRes.status === "fulfilled" && bulkRes.value.ok) {
      try {
        const data = await bulkRes.value.json();
        quotes = data.quotes ?? {};
      } catch { /* silent */ }
    }

    // Step 3: Parse ht_signals if they arrived — optional enrichment
    let signalsMap: Record<string, {
      relativeVolume?: number;
      catalystScore?: number;
      htSignalScore?: number;
      momentumScore?: number;
      crowdScore?: number;
      trapScore?: number;
      signalState?: string;
      signalPattern?: string;
      hasFDAEvent?: boolean;
      hasInsiderBuy?: boolean;
    }> = {};
    if (signalsRes.status === "fulfilled" && signalsRes.value && (signalsRes.value as Response).ok) {
      try {
        const data = await (signalsRes.value as Response).json();
        for (const row of data.signals ?? []) {
          signalsMap[row.ticker] = {
            relativeVolume: row.relative_volume,
            catalystScore: row.catalyst_score,
            htSignalScore: row.ht_score,
            momentumScore: row.momentum_score,
            crowdScore: row.crowd_score,
            trapScore: row.trap_score,
            signalState: row.state,
            signalPattern: row.pattern,
            hasFDAEvent: row.state?.includes("FDA Event") ?? false,
            hasInsiderBuy: row.state?.includes("Insider Buy") ?? false,
          };
        }
      } catch { /* silent — signals are enrichment, not required */ }
    }

    // Step 4: Merge and normalize
    return symbols.map((symbol) => {
      const q = quotes[symbol];
      const sig = signalsMap[symbol];

      const base: Stock = q && (q.price > 0 || Math.abs(q.change) > 0)
        ? { symbol, price: q.price, change: q.change, volume: q.volume ?? 0, prevVolume: q.prevVolume ?? 0 }
        : fallbackQuotes[symbol] || { symbol, price: 0, change: 0, volume: 0, prevVolume: 0 };

      if (sig) {
        // For new discoveries, sig may have price data from the full market scan
        // Use it when bulk-quote returned nothing — prevents new stocks from
        // being filtered out as price=0
        const sigPrice = base.price > 0 ? base.price : 0;
        const sigChange = base.change !== 0 ? base.change : 0;
        return {
          ...base,
          price: sigPrice || base.price,
          change: sigChange || base.change,
          relativeVolume: sig.relativeVolume,
          catalystScore: sig.catalystScore,
          htSignalScore: sig.htSignalScore,
          momentumScore: sig.momentumScore,
          crowdScore: sig.crowdScore,
          trapScore: sig.trapScore,
          signalState: sig.signalState,
          signalPattern: sig.signalPattern,
          hasFDAEvent: sig.hasFDAEvent,
          hasInsiderBuy: sig.hasInsiderBuy,
        };
      }

      return base;
    });
  };

  const fetchStocks = async () => {
    try {
      setIsRefreshing(true);

      // Fetch market-wide movers AND ht_signals tickers in parallel.
      // ht_signals now contains top candidates from 12,913 stocks.
      // We need their prices too — not just the enrichment data.
      const [moversRes, signalsFeedRes] = await Promise.allSettled([
        fetch("/api/market-movers", { cache: "no-store" })
          .then(r => r.ok ? r.json() : { movers: [] })
          .catch(() => ({ movers: [] })),
        fetch("/api/ht-signals-feed", { cache: "no-store" })
          .then(r => r.ok ? r.json() : { signals: [] })
          .catch(() => ({ signals: [] })),
      ]);

      const moverSymbols: string[] = moversRes.status === "fulfilled"
        ? (moversRes.value.movers ?? []).map((m: any) => m.symbol)
        : [];

      // Pull tickers from ht_signals that aren't in our universe
      // These are the real discoveries from the full market scan
      const signalsRaw: any[] = signalsFeedRes.status === "fulfilled"
        ? (signalsFeedRes.value.signals ?? [])
        : [];
      const signalSymbols: string[] = signalsRaw.map((s: any) => s.ticker);

      // Build a map of signal data so new discoveries get proper enrichment
      // Include price and change so stocks with no bulk-quote data survive filtering
      const signalEnrichmentMap: Record<string, any> = {};
      for (const s of signalsRaw) {
        signalEnrichmentMap[s.ticker] = s;
      }

      // Merge all sources — universe + movers + signal discoveries
      const tickersToFetch = [...new Set([
        ...marketUniverse,
        ...moverSymbols,
        ...signalSymbols,
        ...watchlist,
      ])];

      const stockData = await fetchStockUniverse(tickersToFetch);

      // Apply ht_signals enrichment to any stock that doesn't have it yet.
      // CRITICAL: For new discoveries, also use signal price when bulk-quote
      // returned 0 — prevents new stocks from being filtered out.
      const enrichedStockData = stockData.map(stock => {
        const sig = signalEnrichmentMap[stock.symbol];
        if (!sig) return stock;
        return {
          ...stock,
          // Use signal price if bulk-quote returned nothing
          price: stock.price > 0 ? stock.price : (sig.price ?? 0),
          change: stock.change !== 0 ? stock.change : (sig.change_percent ?? 0),
          relativeVolume: stock.relativeVolume || sig.relative_volume,
          catalystScore: stock.catalystScore || sig.catalyst_score,
          crowdScore: stock.crowdScore || sig.crowd_score,
          momentumScore: stock.momentumScore || sig.momentum_score,
          trapScore: stock.trapScore || sig.trap_score,
          signalState: stock.signalState || sig.state,
          signalPattern: stock.signalPattern || sig.pattern,
        };
      });

      // Exclude leveraged/inverse ETFs — they distort momentum signals
      const EXCLUDED_TICKERS = new Set([
        "SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL",
        "LABD","LABU","TZA","TNA","FAZ","FAS","YANG","YINN",
        "SDOW","UDOW","ERY","ERX","HIBL","HIBS","DRIP","GUSH",
      ]);
      const tradableData = enrichedStockData.filter((stock) =>
        (stock.price > 0 || Math.abs(stock.change) > 0) &&
        !EXCLUDED_TICKERS.has(stock.symbol)
      );
      const sortedStocks = tradableData.sort(
        (a, b) => getScannerSelectionScore(b) - getScannerSelectionScore(a),
      );

      const visibleBoard = sortedStocks.slice(0, 100);

      setStocks(visibleBoard);
      const newGainers = tradableData.filter((stock) => stock.change > 0).length;
      const newLosers = tradableData.filter((stock) => stock.change < 0).length;
      const newHighVolume = tradableData.filter((stock) => getRelativeVolume(stock) >= 3).length;
      setMarketScanStats({
        scanned: tradableData.length,
        gainers: newGainers,
        losers: newLosers,
        highVolume: newHighVolume,
        lastFullScan: new Date(),
      });
      if (newGainers > 0 || newLosers > 0 || newHighVolume > 0) {
        setLastSessionStats({ gainers: newGainers, losers: newLosers, highVolume: newHighVolume });
      }
      setLastUpdated(new Date());
      setMobileCardIndex(0); // Reset mobile card index on every refresh to avoid blank cards
      generateAlerts(visibleBoard);

      // Check for escaped detection (big movers we ranked low)
      checkEscapedDetection(sortedStocks);

      // Log top 10 to ht_scan_log on every scan
      try {
        const scanPayload = visibleBoard.slice(0, 10).map((stock, index) => ({
          ticker: stock.symbol,
          price: stock.price,
          rank: index + 1,
          ht_confidence: getHTScore(stock),
          state: getSimpleConvictionRead(stock).state,
          volume_score: Math.round(getRelativeVolume(stock) * 10),
          crowd_score: getAttentionScore(stock),
          trap_score: getTrapRiskScore(stock),
          decision: getHTStance(stock).label,
          source: "auto_scan",
          ht_score: getHTScore(stock),
          change_percent: stock.change,
          relative_volume: getRelativeVolume(stock),
          catalyst_score: stock.catalystScore ?? 0,
          pattern: detectPatternSignal(stock).name,
          signal_state: stock.signalState ?? null,
        }));
        supabase.from("ht_scan_log").insert(scanPayload).then(({ error }) => {
          if (error) console.warn("Scan log error:", error.message);
        });
      } catch (e) {
        console.warn("Scan log failed:", e);
      }
    } catch (err) {
      console.error("Stock fetch error:", err);

      // No fake/local fallback board.
      // If the live quote pipeline fails, keep the current verified state instead of
      // replacing it with local/demo stocks that can hide real problems.
      setMarketScanStats((prev) => ({
        ...prev,
        lastFullScan: prev.lastFullScan,
      }));
      setLastUpdated(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  // Escaped Detection — log tickers with big moves that ranked outside top 10
  const checkEscapedDetection = async (allStocks: Stock[]) => {
    try {
      const escaped = allStocks.filter((stock, index) => {
        const bigMove = Math.abs(stock.change) >= 15;
        const lowRank = index >= 15; // was not in top 15
        return bigMove && lowRank;
      });

      if (escaped.length === 0) return;

      const payload = escaped.map((stock) => ({
        ticker: stock.symbol,
        move_pct: stock.change,
        move_start: new Date().toISOString(),
        catalyst: "Unknown — detected post-scan",
        why_missed: `Ranked outside top 15 despite ${stock.change.toFixed(1)}% move`,
        signal_gap: getHTScore(stock) < 70 ? "Low HT score at time of scan" : "Volume/attention did not trigger early",
      }));

      supabase.from("ht_escaped_detection").insert(payload).then(({ error }) => {
        if (error) console.warn("Escaped detection error:", error.message);
      });
    } catch (e) {
      console.warn("Escaped detection failed:", e);
    }
  };

  useEffect(() => {
    setMounted(true);

    const savedWatchlist = localStorage.getItem("headtap-watchlist");
    const savedAiSetups = localStorage.getItem("htlabs-saved-setups");

    if (savedWatchlist) {
      setWatchlist(JSON.parse(savedWatchlist));
    }

    if (savedAiSetups) {
      setSavedSetups(JSON.parse(savedAiSetups));
    }

    const savedViewed = localStorage.getItem("htlabs-viewed-tickers");
    const savedDismissed = localStorage.getItem("htlabs-dismissed-alerts");

    if (savedViewed) {
      setViewedTickers(JSON.parse(savedViewed));
    }

    if (savedDismissed) {
      setDismissedAlerts(JSON.parse(savedDismissed));
    }
  }, []);

  // Market context — fetched on mount, refreshed every 5 minutes
  useEffect(() => {
    const fetchCtx = () => {
      fetch("/api/market-context")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data && !data.error) setMarketCtx(data); })
        .catch(() => {});
    };
    fetchCtx();
    const interval = setInterval(fetchCtx, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);


  useEffect(() => {
    const pulse = setInterval(() => {
      setTerminalPulse((prev) => (prev + 1) % 1000);
      setDeskPulseIndex((prev) => prev + 1);
    }, 4500);

    return () => clearInterval(pulse);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      loadCloudWatchlist();
    }
    // Depend only on the user ID string, not the whole session object,
    // to avoid re-running every time Supabase refreshes the session token.
  }, [session?.user?.id]);

  // AUTH STABILITY PATCH v149:
  // Temporarily disable automatic Signal Memory Supabase writes after login/signup.
  // v120 auth worked because login only restored the user session + cloud watchlist.
  // These newer effects hit the ht_signal_memory table immediately after auth,
  // which can make onboarding feel broken if that table/RLS policy is not ready.


  useEffect(() => {
    // Fetch news for top stocks so hero card always has context
    const topStocksForFetch = stocks.slice(0, 12);
    if (liveHeroTarget && !topStocksForFetch.find(s => s.symbol === liveHeroTarget.symbol)) {
      topStocksForFetch.push(liveHeroTarget);
    }
    topStocksForFetch.forEach((stock) => {
      fetchNews(stock.symbol);
    });

    // Fetch API opportunities on every scan
    fetchAPIOpportunities();

    // Fetch expanded scanner universe every 5 minutes
    if (!window._htScannerLastFetch || Date.now() - window._htScannerLastFetch > 5 * 60 * 1000) {
      window._htScannerLastFetch = Date.now();
      fetch("/api/scanner-expansion?type=all")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.tickers?.length) return;
          const existing = new Set(stocks.map(s => s.symbol));
          const newTickers: Stock[] = data.tickers
            .filter((t: any) => !existing.has(t.symbol) && t.price > 0)
            .map((t: any) => ({ symbol: t.symbol, price: t.price, change: t.change || 0, volume: 0, prevVolume: 0 }));
          if (newTickers.length > 0) {
            setStocks(prev => [...prev, ...newTickers].slice(0, 50));
          }
        })
        .catch(e => console.warn("Scanner expansion failed:", e));
    }

    // Log top conviction signal to market behavior
    if (stocks.length > 0 && mounted) {
      const top = stocks[0];
      logMarketBehaviorSignal(top, 0, 1);
    }
  }, [stocks]);

  // Load market intelligence and premarket once on mount
  useEffect(() => {
    if (mounted) {
      fetchMarketIntel();
      fetchPremarket();
    }
  }, [mounted]);

  // Fetch ATR for a ticker only when needed — not on every 30s refresh.
  // Returns the ATR data directly so callers don't read stale state.
  // Also updates the cache for future use.
  const fetchATRIfNeeded = async (ticker: string): Promise<{
    atr14: number; support: number; resistance: number; volatility20d: number; fetchedAt: number;
  } | null> => {
    if (!ticker) return null;
    const cached = atrCache[ticker];
    const ONE_HOUR = 60 * 60 * 1000;
    if (cached && Date.now() - cached.fetchedAt < ONE_HOUR) return cached;

    try {
      const res = await fetch(`/api/trade-framework?ticker=${ticker}`);
      if (!res.ok) return cached ?? null;
      const data = await res.json();
      if (data.error || !data.atr14) return cached ?? null;

      const entry = {
        atr14: data.atr14,
        support: data.support,
        resistance: data.resistance,
        volatility20d: data.volatility20d,
        fetchedAt: Date.now(),
      };

      setAtrCache(prev => ({ ...prev, [ticker]: entry }));
      return entry;
    } catch (e) {
      console.warn(`[ATR] fetch failed for ${ticker}:`, e);
      return cached ?? null;
    }
  };


  // so watchlist changes are always seen without the dep causing a double-fetch.
  const fetchStocksRef = useRef(fetchStocks);
  useEffect(() => { fetchStocksRef.current = fetchStocks; });

  useEffect(() => {
    fetchStocksRef.current();

    const interval = setInterval(() => {
      fetchStocksRef.current();
    }, 30000);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps



  // ATR is cached per ticker (1hr TTL) — not refetched every 30s.
  const smSymbol = resolvedBeforeCrowdTarget?.symbol ?? "";
  const btcSymbol = resolvedBeforeTheCrowdTarget?.symbol ?? "";

  // Log top picks to ht_scan_log with full engine data whenever active picks change.
  useEffect(() => {
    if (!mounted || !lastUpdated) return;

    const logPick = (stock: Stock, engine: "spot_momentum" | "before_the_crowd", fw: typeof smFramework) => {
      try {
        const score = getHTScore(stock);
        const stack = buildPressureStack(stock);
        const isDual = isDualEngineConfirmation;
        const isBTC = engine === "before_the_crowd";
        const conv = isBTC ? beforeTheCrowdConviction : 0;
        const saturation = getBackgroundOpportunityEngine(stock).crowdSaturationScore;
        const hce = isHighConvictionEvent(stock);
        const hceCat = getHCECategory(stock);
        const reasonSentence = isBTC
          ? (getThesisEnduranceReason(stock)[0] ?? "")
          : (hce && hceCat
              ? `${hceCat} identified — positioned before the event resolves.`
              : saturation < 45
              ? "Momentum is building before widespread participation arrives."
              : "Momentum is expanding as more traders take notice.");

        supabase.from("ht_scan_log").insert({
          ticker: stock.symbol,
          price: stock.price,
          rank: 1,
          ht_confidence: score,
          ht_score: score,
          state: isBTC ? getThesisEnduranceLabel(conv) : getMomentumEnduranceLabel(evaluateMomentumEndurance(stock), score),
          engine,
          dual_engine: isDual,
          source: "top_pick",
          change_percent: stock.change,
          relative_volume: getRelativeVolume(stock),
          catalyst_score: stock.catalystScore ?? 0,
          pattern: detectPatternSignal(stock).name,
          signal_state: stock.signalState ?? null,
          crowd_score: saturation,
          trap_score: stack.trapRiskScore,
          decision: getHTStance(stock).label,
          reasoning: reasonSentence,
          upside_min: fw?.uptideMin ?? null,
          upside_max: fw?.uptideMax ?? null,
          risk_zone: fw?.riskZone ?? null,
          rr_ratio: fw?.rr ?? null,
        }).then(({ error }) => {
          if (error) console.warn(`[${engine} log]:`, error.message);
        });
      } catch (e) {
        console.warn(`[${engine} log] error:`, e);
      }
    };

    if (resolvedBeforeCrowdTarget) logPick(resolvedBeforeCrowdTarget, "spot_momentum", smFramework);
    if (resolvedBeforeTheCrowdTarget) logPick(resolvedBeforeTheCrowdTarget, "before_the_crowd", btcFramework);
  }, [smSymbol, btcSymbol, lastUpdated, mounted]); // eslint-disable-line react-hooks/exhaustive-deps



  useEffect(() => {
    if (!mounted) return;
    const isLive = marketSession === "live";

    const recompute = async () => {
      if (resolvedBeforeCrowdTarget) {
        const atr = await fetchATRIfNeeded(smSymbol);
        setSMFramework(buildTradeFramework(resolvedBeforeCrowdTarget, atr, isLive));
        setSMTrace(buildDecisionTrace(resolvedBeforeCrowdTarget, stocks, "spot_momentum"));
      } else {
        setSMFramework(null);
        setSMTrace(null);
      }
      if (resolvedBeforeTheCrowdTarget) {
        const atr = await fetchATRIfNeeded(btcSymbol);
        setBTCFramework(buildTradeFramework(resolvedBeforeTheCrowdTarget, atr, isLive));
        setBTCTrace(buildDecisionTrace(resolvedBeforeTheCrowdTarget, stocks, "before_the_crowd"));
      } else {
        setBTCFramework(null);
        setBTCTrace(null);
      }
    };

    recompute();
  }, [smSymbol, btcSymbol, stocks, marketSession, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // HT Change Log — detect what changed between scans
  useEffect(() => {
    if (!mounted || !liveHeroTarget) return;

    const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const currentState = getSimpleConvictionRead(liveHeroTarget).state;
    const currentScore = getHTScore(liveHeroTarget);
    const currentPattern = detectPatternSignal(liveHeroTarget).name;
    const currentCrowd = getCrowdPhase(liveHeroTarget);

    const prev = prevConvictionState.current;

    if (!prev || prev.symbol !== liveHeroTarget.symbol) {
      // New ticker — start fresh log
      setChangeLog([{
        time: now,
        type: "state",
        message: `HT surfaced ${liveHeroTarget.symbol} · ${currentState}`,
      }]);
      prevConvictionState.current = { symbol: liveHeroTarget.symbol, state: currentState, htScore: currentScore, pattern: currentPattern, crowdPhase: currentCrowd };
      return;
    }

    const newEntries: ChangeLogEntry[] = [];

    if (prev.state !== currentState) {
      newEntries.push({ time: now, type: "state", message: `${prev.state.replace(/[^\w\s]/g, "").trim()} → ${currentState}` });
    }
    if (Math.abs(prev.htScore - currentScore) >= 3) {
      const dir = currentScore > prev.htScore ? "↑" : "↓";
      newEntries.push({ time: now, type: "score", message: `Confidence ${dir} ${prev.htScore}% → ${currentScore}%` });
    }
    if (prev.pattern !== currentPattern) {
      newEntries.push({ time: now, type: "pattern", message: `Pattern shift: ${currentPattern}` });
    }
    if (prev.crowdPhase !== currentCrowd) {
      newEntries.push({ time: now, type: "crowd", message: `Crowd phase: ${currentCrowd}` });
    }

    if (newEntries.length > 0) {
      setChangeLog((prev) => [...newEntries, ...prev].slice(0, 8));
      prevConvictionState.current = { symbol: liveHeroTarget.symbol, state: currentState, htScore: currentScore, pattern: currentPattern, crowdPhase: currentCrowd };

      // Persist each change to ht_change_log in Supabase
      try {
        const changePayload = newEntries.map((entry) => ({
          ticker: liveHeroTarget.symbol,
          prev_state: entry.type === "state" ? prev?.state ?? null : null,
          new_state: entry.type === "state" ? currentState : null,
          prev_confidence: entry.type === "score" ? prev?.htScore ?? null : null,
          new_confidence: entry.type === "score" ? currentScore : null,
          prev_rank: null,
          new_rank: null,
          trigger: entry.message,
          user_id: session?.user?.id ?? null,
        }));
        supabase.from("ht_change_log").insert(changePayload).then(({ error }) => {
          if (error) console.warn("Change log error:", error.message);
        });
      } catch (e) {
        console.warn("Change log write failed:", e);
      }
    }
  }, [liveHeroTarget?.symbol, stocks]);

  const handleAuth = async (mode: "signin" | "signup") => {
    const email = authEmail.trim().toLowerCase();
    const password = authPassword;

    if (!email || !password) {
      setAuthMessage("Enter an email and password first.");
      return;
    }

    if (password.length < 6) {
      setAuthMessage("Password must be at least 6 characters.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthMessage(mode === "signin" ? "Signing in..." : "Creating account...");

      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setAuthMessage(error.message);
          return;
        }

        // onAuthStateChange handles setSession automatically — no double-set
        setAuthPassword("");
        setAuthMessage("Signed in successfully.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setAuthMessage(error.message);
        return;
      }

      if (data.session) {
        // onAuthStateChange handles setSession automatically
        setAuthMessage("Account created. Your HT workspace is live.");
      } else {
        setAuthMessage("Account created. Check your email to confirm, then log in.");
      }

      setAuthPassword("");
    } catch (error) {
      console.error("AUTH ERROR:", error);
      setAuthMessage("Auth request failed. Check Supabase settings or try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setAuthMessage("Signed out.");
  };

  const syncWatchlistToCloud = async (symbols: string[]) => {
    if (!session?.user?.id) return;

    try {
      await supabase.from("ht_labs_watchlist").delete().eq("user_id", session.user.id);

      if (symbols.length === 0) return;

      const payload = symbols.map((symbol) => ({
        user_id: session.user.id,
        symbol,
      }));

      await supabase.from("ht_labs_watchlist").insert(payload);

      setCloudSyncMessage("Cloud watchlist synced.");
    } catch (error) {
      console.error("WATCHLIST SYNC ERROR:", error);
      setCloudSyncMessage("Cloud sync failed.");
    }
  };

  const loadCloudWatchlist = async () => {
    if (!session?.user?.id) return;

    try {
      const { data, error } = await supabase
        .from("ht_labs_watchlist")
        .select("symbol")
        .eq("user_id", session.user.id);

      if (error) {
        console.error(error);
        return;
      }

      if (data) {
        const symbols = data.map((item: any) => item.symbol);
        setWatchlist(symbols);
      }
    } catch (error) {
      console.error("LOAD WATCHLIST ERROR:", error);
    }
  };

  const handleTickerSearch = async () => {
    const cleanTicker = ticker.toUpperCase().trim();

    if (!cleanTicker) {
      setSearchStatus("Enter a ticker first.");
      return;
    }

    setSearchStatus(`Searching ${cleanTicker}...`);

    try {
      const searchRes = await fetch(`/api/quote?symbol=${cleanTicker}`);
      const searchData = await searchRes.json();
      const searchedStock: Stock = {
        symbol: cleanTicker,
        price: Number(searchData.c || 0),
        change: Number(searchData.dp || 0),
      };

      setStocks((prev) => {
        const filtered = prev.filter((stock) => stock.symbol !== cleanTicker);
        const updated = [searchedStock, ...filtered];

        return updated.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      });

      setSelectedStock(searchedStock);
      setViewedTickers((prev) => {
        const updated = [...new Set([searchedStock.symbol, ...prev])].slice(0, 12);
        localStorage.setItem("htlabs-viewed-tickers", JSON.stringify(updated));
        return updated;
      });

      setSearchStatus(`${cleanTicker} loaded into HT. Add it to watchlist if it deserves tracking.`);
      setTicker("");

      // On mobile the stock detail sheet is inside the mobile overlay —
      // scrolling to #premium-terminal does nothing. Only scroll on desktop.
      const isMobileView = window.innerWidth < 768;
      if (!isMobileView) {
        window.setTimeout(() => {
          document
            .getElementById("premium-terminal")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 150);
      }
    } catch (error) {
      console.error("SEARCH ERROR:", error);
      setSearchStatus(`Could not load ${cleanTicker}. Check the symbol and try again.`);
    }
  };

  const addTicker = async () => {
    if (!ticker) return;

    const cleanTicker = ticker.toUpperCase().trim();

    const addRes = await fetch(`/api/quote?symbol=${cleanTicker}`);
    const addData = await addRes.json();
    const newStock: Stock = {
      symbol: cleanTicker,
      price: Number(addData.c || 0),
      change: Number(addData.dp || 0),
    };

    setStocks((prev) => {
      const filtered = prev.filter((stock) => stock.symbol !== cleanTicker);
      const updated = [...filtered, newStock];

      return updated.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    });

    if (!watchlist.includes(cleanTicker)) {
      const updatedWatchlist = [...watchlist, cleanTicker];
      setWatchlist(updatedWatchlist);

      localStorage.setItem(
        "headtap-watchlist",
        JSON.stringify(updatedWatchlist),
      );

      if (session?.user?.id) {
        syncWatchlistToCloud(updatedWatchlist);
      }
    }

    setTicker("");
  };

  const toggleWatchlist = (symbol: string) => {
    let updatedWatchlist: string[];

    if (watchlist.includes(symbol)) {
      updatedWatchlist = watchlist.filter((item) => item !== symbol);
    } else {
      updatedWatchlist = [...watchlist, symbol];
    }

    setWatchlist(updatedWatchlist);
    localStorage.setItem("headtap-watchlist", JSON.stringify(updatedWatchlist));
  };

  const dismissAlert = (symbol: string) => {
    const updated = [...new Set([symbol, ...dismissedAlerts])].slice(0, 20);

    setDismissedAlerts(updated);
    localStorage.setItem("htlabs-dismissed-alerts", JSON.stringify(updated));
  };

  const toggleSavedSetup = (symbol: string) => {
    let updatedSetups: string[];

    if (savedSetups.includes(symbol)) {
      updatedSetups = savedSetups.filter((item) => item !== symbol);
    } else {
      updatedSetups = [...savedSetups, symbol];
    }

    setSavedSetups(updatedSetups);
    localStorage.setItem("htlabs-saved-setups", JSON.stringify(updatedSetups));
  };

  const getOnboardingStatus = () => {
    const savedCount = watchlist.length;
    const setupCount = savedSetups.length;

    if (session && savedCount > 0 && setupCount > 0) {
      return "Power User Mode";
    }

    if (session && savedCount > 0) {
      return "Cloud Watchlist Active";
    }

    if (session) {
      return "Account Connected";
    }

    return "Guest Mode";
  };

  const openAiModal = async (stock: Stock) => {
    setSelectedStock(stock);

    setViewedTickers((prev) => {
      const updated = [...new Set([stock.symbol, ...prev])].slice(0, 12);
      localStorage.setItem("htlabs-viewed-tickers", JSON.stringify(updated));
      return updated;
    });
    setAiLoading(true);
    setAiError("");
    setAiAnalysis("");

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: stock.symbol,
          price: stock.price,
          change: stock.change,
        }),
      });

      const data = await res.json();

      if (!data.analysis) {
        setAiError("No AI analysis returned.");
      } else {
        setAiAnalysis(data.analysis);
      }
    } catch (err) {
      console.error(err);
      setAiError("Failed to generate AI analysis.");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setDeskPulseIndex((prev) => prev + 1);
    }, 4500);

    return () => clearInterval(interval);
  }, []);

  // Frontend does not pick homepage winners anymore.
  // The backend/API owns Top Opportunity, Spot Momentum, and Before The Crowd decisions.
  // Keep these names temporarily because existing UI still references them;
  // they intentionally return null so local fallback logic cannot override the pipeline.
  const topMomentumOpportunity = useMemo(() => null as Stock | null, []);
  const topRecoveryOpportunity = useMemo(() => null as Stock | null, []);

  return (
    <main suppressHydrationWarning className="ht-simplified-ui min-h-screen overflow-hidden bg-[#050505] text-white">
      <style jsx global>{`
        /* HT Labs v69 production hierarchy: live tape, search/auth, top conviction hero, capital, portfolio, score/signals. Legacy OS block removed.

        HT Labs v68 TRUE top stack replacement: tape + auth header + global search are physically prioritized, legacy hero hidden.

        HT Labs v65 simplification pass: signal-first layout, calmer saturation, reduced visible overload.

        HT Labs v49 laptop layout repair: desktop split grids now wait until 2xl, preventing normal-width side dead space.
           No sections removed. No architecture rewrite.

           HT Labs full-file layout repair:
           Stop oversized terminal shells from creating dead empty zones. */
        section {
          padding-top: 2.25rem !important;
          padding-bottom: 2.25rem !important;
        }

        section > div,
        section [class*="max-w-7xl"],
        section [class*="max-w-6xl"] {
          align-items: start !important;
        }

        section [class*="grid"] {
          align-items: start !important;
        }

        section [class*="rounded-[1.5rem]"],
        section [class*="rounded-[2rem]"],
        section [class*="rounded-[34px]"] {
          min-height: 0 !important;
          height: auto !important;
        }

        section [class*="lg:grid-cols"] > * {
          min-height: 0 !important;
          height: auto !important;
          align-self: start !important;
        }

        section [class*="bg-[radial-gradient"],
        section [class*="bg-[linear-gradient"] {
          min-height: 0 !important;
        }

        .ht-compact-shell {
          display: block !important;
          height: auto !important;
          min-height: 0 !important;
        }


        .ht-premium-card {
          border-color: rgba(255,255,255,0.095) !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.045) !important;
        }

        .ht-soft-orange {
          box-shadow: 0 0 46px rgba(255,106,0,0.105) !important;
        }


        .ht-simplified-ui > .relative.z-10 {
          display: flex;
          flex-direction: column;
        }

        /* v68: every direct child defaults below the product stack so footer/old sections cannot jump above tape/search/auth. */
        .ht-simplified-ui > .relative.z-10 > * { order: 50; }

        .ht-simplified-ui #live-tape { order: 1; }
        .ht-simplified-ui #mode-switcher { order: 2; }
        .ht-simplified-ui #quick-search { order: 3; }
        .ht-simplified-ui #account { order: 4; }
        .ht-simplified-ui #conviction-engine { order: 5; }
        .ht-simplified-ui header { order: 98; }
        .ht-simplified-ui #capital-intelligence { order: 7; }
        .ht-simplified-ui #portfolio-intelligence { order: 8; }
        .ht-simplified-ui #mobile-command { order: 9; }
        .ht-simplified-ui #watchtower { order: 10; }
        .ht-simplified-ui #watchlist { order: 11; }
        .ht-simplified-ui #scanner { order: 12; }
        .ht-simplified-ui #premium-terminal { display: none !important; order: 80; }
        .ht-simplified-ui footer { order: 99; }

        /* Remove old marketing hero from the visible product flow. */
        .ht-simplified-ui #home { display: none !important; }

        .ht-simplified-ui #daily-brief,
        .ht-simplified-ui #interactive-intelligence,
        .ht-simplified-ui #living-intelligence,
        .ht-simplified-ui #priority-flow,
        .ht-simplified-ui #signal-proof,
        .ht-simplified-ui #signal-history,
        .ht-simplified-ui #live-ht-desk,
        .ht-simplified-ui #signal-timeline,
        .ht-simplified-ui #market-narrative,
        .ht-simplified-ui #features {
          order: 40;
        }


        /* v97 integrated command deck: live tape, modes, search, and account live inside the hero so the user lands directly on the money section without losing controls. */
        .ht-simplified-ui #conviction-engine {
          order: 1 !important;
          padding-top: 0.85rem !important;
          padding-bottom: 1rem !important;
        }

        .ht-simplified-ui #live-tape,
        .ht-simplified-ui #mode-switcher,
        .ht-simplified-ui #quick-search {
          display: none !important;
        }

        .ht-simplified-ui header {
          display: none !important;
        }

        /* Auth section always visible regardless of mode */
        .ht-simplified-ui #account { display: block !important; }

        .ht-simplified-ui #capital-intelligence { order: 2 !important; }
        .ht-simplified-ui #portfolio-intelligence { order: 3 !important; }
        .ht-simplified-ui #scanner { order: 4 !important; }
        .ht-simplified-ui #watchlist { order: 5 !important; }

        .ht-command-viewport {
          max-width: 1512px !important;
          padding-left: 1.5rem !important;
          padding-right: 1.5rem !important;
        }

        @media (min-width: 1024px) {
          .ht-simplified-ui #conviction-engine {
            padding-top: 0.65rem !important;
          }
        }

        @media (max-width: 767px) {
          .ht-command-viewport {
            padding-left: 1rem !important;
            padding-right: 1rem !important;
          }
        }

        .ht-simplified-ui .pointer-events-none.fixed.inset-0 {
          opacity: 0.58 !important;
        }

        .ht-simplified-ui section {
          scroll-margin-top: 96px;
        }

        .ht-simplified-ui .ht-premium-card,
        .ht-simplified-ui [class*="shadow-[0_0_"],
        .ht-simplified-ui [class*="shadow-[0_20px"],
        .ht-simplified-ui [class*="shadow-[0_30px"] {
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04) !important;
        }

        .ht-simplified-ui [class*="border-orange-500/30"],
        .ht-simplified-ui [class*="border-orange-500/40"],
        .ht-simplified-ui [class*="border-orange-400/30"] {
          border-color: rgba(255,255,255,0.12) !important;
        }

        .ht-simplified-ui [class*="bg-orange-500/20"],
        .ht-simplified-ui [class*="bg-orange-500/15"],
        .ht-simplified-ui [class*="bg-orange-500/10"] {
          background-color: rgba(255,106,0,0.075) !important;
        }

        .ht-simplified-ui #live-tape {
          position: sticky;
          top: 0;
          z-index: 70;
        }

        .ht-simplified-ui header {
          position: sticky !important;
          top: 44px !important;
          z-index: 65;
        }

        .ht-simplified-ui #quick-search {
          position: relative;
          top: auto;
          z-index: 55;
          padding-bottom: 0.9rem !important;
        }

        .ht-simplified-ui #conviction-engine,
        .ht-simplified-ui #capital-intelligence,
        .ht-simplified-ui #portfolio-intelligence,
        .ht-simplified-ui #watchtower,
        .ht-simplified-ui #watchlist,
        .ht-simplified-ui #scanner {
          padding-top: 1.35rem !important;
          padding-bottom: 1.35rem !important;
        }

        .ht-simplified-ui #daily-brief,
        .ht-simplified-ui #interactive-intelligence,
        .ht-simplified-ui #living-intelligence,
        .ht-simplified-ui #priority-flow,
        .ht-simplified-ui #signal-proof,
        .ht-simplified-ui #signal-history,
        .ht-simplified-ui #live-ht-desk,
        .ht-simplified-ui #signal-timeline,
        .ht-simplified-ui #market-narrative,
        .ht-simplified-ui #features {
          opacity: 0.78;
          filter: saturate(0.82);
        }

        @media (min-width: 768px) {
          .ht-simplified-ui #daily-brief,
          .ht-simplified-ui #interactive-intelligence,
          .ht-simplified-ui #living-intelligence,
          .ht-simplified-ui #priority-flow,
          .ht-simplified-ui #signal-proof,
          .ht-simplified-ui #signal-history,
          .ht-simplified-ui #live-ht-desk,
          .ht-simplified-ui #signal-timeline,
          .ht-simplified-ui #market-narrative,
          .ht-simplified-ui #features {
            max-width: 1120px;
          }
        }

        @media (max-width: 767px) {
          .ht-simplified-ui #capital-intelligence,
          .ht-simplified-ui #portfolio-intelligence,
          .ht-simplified-ui #watchtower,
          .ht-simplified-ui #daily-brief,
          .ht-simplified-ui #interactive-intelligence,
          .ht-simplified-ui #living-intelligence,
          .ht-simplified-ui #priority-flow,
          .ht-simplified-ui #signal-proof,
          .ht-simplified-ui #signal-history,
          .ht-simplified-ui #live-ht-desk,
          .ht-simplified-ui #signal-timeline,
          .ht-simplified-ui #market-narrative,
          .ht-simplified-ui #features {
            display: none !important;
          }

          .ht-simplified-ui header {
            top: 43px !important;
          }

          .ht-simplified-ui #quick-search {
            top: auto;
            z-index: 55;
          }

          .ht-simplified-ui #live-tape {
            z-index: 70;
          }

          .ht-simplified-ui #conviction-engine,
          .ht-simplified-ui #watchlist,
          .ht-simplified-ui #scanner,
          .ht-simplified-ui #account {
            padding-top: 0.85rem !important;
            padding-bottom: 0.85rem !important;
          }

          .ht-simplified-ui h1,
          .ht-simplified-ui h2 {
            letter-spacing: -0.05em !important;
          }

          .ht-simplified-ui [class*="text-7xl"],
          .ht-simplified-ui [class*="text-8xl"] {
            font-size: 3.25rem !important;
            line-height: 0.95 !important;
          }

          section {
            padding-top: 1rem !important;
            padding-bottom: 1rem !important;
          }

          .ht-mobile-calm-card {
            border-radius: 1.35rem !important;
            padding: 1rem !important;
          }

          .ht-mobile-tight-copy {
            line-height: 1.45 !important;
          }

          .ht-mobile-scroll-safe {
            max-height: none !important;
            overflow: visible !important;
          }
        }


        /* V86 scope fix: emotional signal panel inserted inside Top Conviction using topConviction alias. */
        .ht-mode-nav {
          position: relative;
          z-index: 30;
        }

        [data-active-mode="command"] #capital-intelligence,
        [data-active-mode="command"] #portfolio-intelligence,
        [data-active-mode="command"] #premium-terminal,
        [data-active-mode="command"] #interactive-intelligence,
        [data-active-mode="command"] #living-intelligence,
        [data-active-mode="command"] #priority-flow,
        [data-active-mode="command"] #signal-proof,
        [data-active-mode="command"] #signal-history,
        [data-active-mode="command"] #watchtower,
        [data-active-mode="command"] #daily-brief,
        [data-active-mode="command"] #live-ht-desk,
        [data-active-mode="command"] #signal-timeline,
        [data-active-mode="command"] #market-narrative,
        [data-active-mode="command"] #features { display: none !important; }

        [data-active-mode="capital"] #mobile-command,
        [data-active-mode="capital"] #conviction-engine,
        [data-active-mode="capital"] #portfolio-intelligence,
        [data-active-mode="capital"] #premium-terminal,
        [data-active-mode="capital"] #interactive-intelligence,
        [data-active-mode="capital"] #living-intelligence,
        [data-active-mode="capital"] #priority-flow,
        [data-active-mode="capital"] #signal-proof,
        [data-active-mode="capital"] #signal-history,
        [data-active-mode="capital"] #watchtower,
        [data-active-mode="capital"] #watchlist,
        [data-active-mode="capital"] #daily-brief,
        [data-active-mode="capital"] #live-ht-desk,
        [data-active-mode="capital"] #signal-timeline,
        [data-active-mode="capital"] #market-narrative,
        [data-active-mode="capital"] #features,
        [data-active-mode="capital"] #scanner { display: none !important; }

        [data-active-mode="portfolio"] #mobile-command,
        [data-active-mode="portfolio"] #conviction-engine,
        [data-active-mode="portfolio"] #capital-intelligence,
        [data-active-mode="portfolio"] #premium-terminal,
        [data-active-mode="portfolio"] #interactive-intelligence,
        [data-active-mode="portfolio"] #living-intelligence,
        [data-active-mode="portfolio"] #priority-flow,
        [data-active-mode="portfolio"] #signal-proof,
        [data-active-mode="portfolio"] #signal-history,
        [data-active-mode="portfolio"] #watchtower,
        [data-active-mode="portfolio"] #daily-brief,
        [data-active-mode="portfolio"] #live-ht-desk,
        [data-active-mode="portfolio"] #signal-timeline,
        [data-active-mode="portfolio"] #market-narrative,
        [data-active-mode="portfolio"] #features,
        [data-active-mode="portfolio"] #scanner { display: none !important; }

        [data-active-mode="signals"] #mobile-command,
        [data-active-mode="signals"] #account,
        [data-active-mode="signals"] #capital-intelligence,
        [data-active-mode="signals"] #portfolio-intelligence,
        [data-active-mode="signals"] #watchlist,
        [data-active-mode="signals"] #watchtower,
        [data-active-mode="signals"] #signal-proof,
        [data-active-mode="signals"] #signal-history,
        [data-active-mode="signals"] #daily-brief,
        [data-active-mode="signals"] #signal-timeline,
        [data-active-mode="signals"] #market-narrative,
        [data-active-mode="signals"] #features { display: none !important; }

        [data-active-mode="replay"] #mobile-command,
        [data-active-mode="replay"] #conviction-engine,
        [data-active-mode="replay"] #account,
        [data-active-mode="replay"] #capital-intelligence,
        [data-active-mode="replay"] #portfolio-intelligence,
        [data-active-mode="replay"] #watchlist,
        [data-active-mode="replay"] #premium-terminal,
        [data-active-mode="replay"] #interactive-intelligence,
        [data-active-mode="replay"] #living-intelligence,
        [data-active-mode="replay"] #priority-flow,
        [data-active-mode="replay"] #daily-brief,
        [data-active-mode="replay"] #market-narrative,
        [data-active-mode="replay"] #features,
        [data-active-mode="replay"] #scanner { display: none !important; }

        @media (max-width: 767px) {
          .ht-mode-nav { top: 132px; }
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,106,0,0.22),transparent_26%),radial-gradient(circle_at_85%_10%,rgba(255,140,26,0.12),transparent_28%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,auto,64px_64px,64px_64px]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,#050505_0%,rgba(5,5,5,0.88)_45%,rgba(5,5,5,0.65)_100%)]" />

      <div className="relative z-10" data-active-mode={activeMode}>
        <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-7xl items-center gap-5 px-5 py-4">
            <motion.div
              className="flex items-center gap-4"
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <img src="/logo.png" alt="HT Labs" className="h-12 w-auto" />
            </motion.div>

            <nav className="hidden flex-1 items-center gap-6 text-sm font-semibold text-zinc-500 md:flex">
              <a className="text-orange-400 hover:text-orange-300 transition" href="/">
                Before The Crowd
              </a>
              <a className="transition hover:text-orange-300" href="/">
                Dashboard
              </a>
              <a className="transition hover:text-orange-300" href="/scanner">
                Scanner
              </a>
              <a className="transition hover:text-orange-300" href="/signals">
                Signals
              </a>
              <a className="transition hover:text-orange-300" href="/news">
                News
              </a>
              <button onClick={() => document.getElementById("watchlist")?.scrollIntoView({ behavior: "smooth" })} className="transition hover:text-orange-300">
                Watchlist
              </button>
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-3">
              {session?.user ? (
                <div className="hidden items-center gap-2 rounded-2xl border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300 sm:flex">
                  <span className="h-2 w-2 rounded-full bg-green-400" />
                  <span className="max-w-[150px] truncate">
                    {mounted ? (session.user.email || "HT Account") : ""}
                  </span>
                </div>
              ) : (
                <>
                  <button
                    onClick={() =>
                      document
                        .getElementById("account")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-zinc-200 transition hover:border-orange-500/40 hover:text-orange-300 sm:inline-flex"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() =>
                      document
                        .getElementById("account")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="hidden rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-black text-orange-300 transition hover:bg-orange-500/20 lg:inline-flex"
                  >
                    Sign Up
                  </button>
                </>
              )}

              <motion.button
                onClick={() =>
                  document
                    .getElementById(session?.user ? "capital-intelligence" : "account")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white shadow-[0_0_18px_rgba(255,106,0,0.18)] transition hover:shadow-[0_0_28px_rgba(255,106,0,0.28)]"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                {session?.user ? "Launch Terminal →" : "Create Profile →"}
              </motion.button>
            </div>
          </div>
        </header>

        <section id="live-tape" className="border-b border-white/5 bg-black/55 px-4 py-1.5 backdrop-blur-2xl md:px-5 md:py-2">
          <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-green-500/10 bg-green-500/[0.045] px-2.5 py-1.5 text-[10px] font-black text-green-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
              LIVE TAPE
            </div>

            <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto whitespace-nowrap pb-1 text-sm [scrollbar-width:none]">
              {tickerTape.map((stock) => (
                <div
                  key={`tape-${stock.symbol}`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.018] px-3 py-1.5"
                >
                  <span className="font-black text-white">{stock.symbol}</span>
                  <span className="text-zinc-500">
                    ${Number(stock.price || 0).toFixed(2)}
                  </span>
                  <span
                    className={`font-black ${
                      stock.change >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {stock.change >= 0 ? "+" : ""}
                    {Number(stock.change || 0).toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>


        <section id="mode-switcher" className="ht-mode-nav border-b border-white/5 bg-black/60 px-4 py-1.5 backdrop-blur-2xl md:px-5">
          <div className="mx-auto max-w-7xl">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-300">Workspace</p>
                <p className="mt-1 text-xs font-bold text-zinc-500">Search or switch workspace without leaving the command center.</p>
              </div>
              <div className="hidden rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 sm:block">
                {activeMode === "command" ? "Top read" : activeMode === "capital" ? "Sizing" : activeMode === "portfolio" ? "Account" : activeMode === "signals" ? "Deep read" : "History"}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5 rounded-[1.1rem] border border-white/10 bg-zinc-950/80 p-1.5 shadow-[0_0_24px_rgba(255,106,0,0.07)] md:gap-2 md:p-2">
              {[
                ["command", "Command", "Top read"],
                ["capital", "Capital", "Sizing"],
                ["portfolio", "Portfolio", "Profile"],
                ["signals", "Signals", "Scores"],
                ["replay", "Replay", "History"],
              ].map(([mode, label, note]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setActiveMode(mode as CommandMode)}
                  className={`rounded-xl px-2 py-2.5 text-center transition md:rounded-2xl md:px-4 md:py-3 ${
                    activeMode === mode
                      ? "bg-orange-500 text-white shadow-[0_0_22px_rgba(255,106,0,0.25)]"
                      : "bg-white/[0.035] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                  }`}
                >
                  <span className="block text-[11px] font-black uppercase tracking-[0.12em] md:text-xs">{label}</span>
                  <span className={`mt-1 hidden text-[9px] font-bold uppercase tracking-[0.14em] md:block ${activeMode === mode ? "text-orange-100" : "text-zinc-600"}`}>{note}</span>
                </button>
              ))}
            </div>
          </div>
        </section>



        <section id="quick-search" className="border-b border-white/5 bg-black/60 px-4 py-1.5 backdrop-blur-2xl md:px-5 md:py-3">
          <div className="mx-auto grid max-w-7xl gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <img src="/logo.png" alt="HT Labs" className="h-9 w-auto md:h-10" />
                <div className="hidden sm:block">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-400">
                    Global Search
                  </p>
                  <p className="text-xs font-semibold text-zinc-500">
                    Find any ticker first. Let HT explain the setup next.
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {session?.user ? (
                  <button
                    onClick={() =>
                      document
                        .getElementById("account")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="inline-flex max-w-[190px] items-center gap-2 rounded-2xl border border-green-500/25 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300 transition hover:border-green-400/50"
                  >
                    <span className="h-2 w-2 rounded-full bg-green-400" />
                    <span className="truncate">{mounted ? (session.user.email || "HT Account") : ""}</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        document
                          .getElementById("account")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-orange-500/40 hover:text-orange-300 md:px-4"
                    >
                      Login
                    </button>
                    <button
                      onClick={() =>
                        document
                          .getElementById("account")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                      className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-300 transition hover:bg-orange-500/20 md:px-4"
                    >
                      Sign Up
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="group grid gap-2 rounded-[1.35rem] border border-white/10 bg-zinc-950/95 p-2 shadow-[0_0_28px_rgba(255,106,0,0.10)] transition focus-within:border-orange-500/45 focus-within:shadow-[0_0_38px_rgba(255,106,0,0.18)] md:grid-cols-[1fr_auto]">
              <input
                type="text"
                placeholder="Search ticker or company..."
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleTickerSearch();
                  }
                }}
                className="min-w-0 bg-transparent px-3 py-3 text-base font-black uppercase tracking-[-0.02em] text-white outline-none placeholder:normal-case placeholder:font-bold placeholder:text-zinc-600 md:text-sm"
              />
              <button
                onClick={handleTickerSearch}
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-xs font-black text-white shadow-[0_0_18px_rgba(255,106,0,0.22)] transition hover:scale-[1.02] hover:opacity-95"
              >
                Search
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-400 sm:hidden">
                Fast Ticker Access
              </span>
              <span className="truncate">{searchStatus}</span>
            </div>
          </div>
        </section>

        <section id="account" className="mx-auto max-w-7xl px-5 py-1">
          <motion.div
            className="backdrop-blur-xl"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            viewport={{ once: true }}
          >
            {session ? (
              <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-[1.1rem] border border-green-500/15 bg-black/55 px-4 py-3 shadow-[0_0_22px_rgba(34,197,94,0.055)] md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-green-500/20 bg-green-500/10 text-sm font-black text-green-300">
                    HT
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-green-400">
                        Trader Profile
                      </p>
                      <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-[9px] font-black text-green-300">
                        Cloud Sync Active
                      </span>
                    </div>
                    <h3 className="mt-1 truncate text-base font-black text-white md:text-lg">
                      {traderMode} trader · {mounted ? (session.user.email || "HT Account") : ""}
                    </h3>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 md:min-w-[300px]">
                  {[
                    ["Watchlist", watchlist.length],
                    ["Saved", savedSetups.length],
                    ["Viewed", viewedTickers.length],
                  ].map((item) => (
                    <div
                      key={`profile-chip-${item[0]}`}
                      className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-center"
                    >
                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-500">
                        {item[0]}
                      </p>
                      <p className="mt-0.5 text-base font-black text-white">{item[1]}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-4 rounded-[1.25rem] border border-orange-500/15 bg-zinc-950/70 p-4 shadow-[0_0_24px_rgba(255,106,0,0.07)] lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-400">
                    Create Your Trader Profile
                  </p>
                  <h3 className="mt-1 text-2xl font-black text-white">
                    Save the terminal around your trading style.
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Keep watchlists, saved AI reads, recent tickers, and your personal momentum workflow synced.
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-center">
                  <input
                    type="email"
                    placeholder="Email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm outline-none transition placeholder:text-zinc-700 focus:border-orange-500"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-sm outline-none transition placeholder:text-zinc-700 focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleAuth("signin")}
                    disabled={authLoading}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-black text-zinc-200 transition hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-50"
                  >
                    {authLoading ? "Loading..." : "Login"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAuth("signup")}
                    disabled={authLoading}
                    className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    Sign Up
                  </button>
                </div>

                {authMessage && (
                  <p className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-zinc-300 lg:col-span-2">
                    {authMessage}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </section>

        <section id="mobile-command" className="mx-auto max-w-7xl px-5 py-4 md:hidden">
          <div className="ht-mobile-calm-card rounded-[1.5rem] border border-orange-500/20 bg-[linear-gradient(135deg,rgba(255,106,0,0.12),rgba(255,255,255,0.03))] p-4 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">
                  Mobile Priority View
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.06em] text-white">
                  {priorityTarget?.symbol || "HT"}
                </h2>
              </div>

              {priorityTarget && (
                <div className="text-right">
                  <p className="font-mono text-xl font-black text-white">
                    ${Number(priorityTarget.price || 0).toFixed(2)}
                  </p>
                  <p className={`text-xs font-black ${priorityTarget.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {priorityTarget.change >= 0 ? "+" : ""}{Number(priorityTarget.change || 0).toFixed(2)}%
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-orange-400/15 bg-black/40 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300/80">
                Why This Matters
              </p>
              <p className="mt-2 text-base font-black leading-snug text-white">
                {priorityTarget ? getWhyThisMattersHeadline(priorityTarget) : "HT is waiting for one ticker to separate."}
              </p>
              <p className="ht-mobile-tight-copy mt-2 text-sm text-zinc-300">
                {priorityTarget ? getWhyThisMatters(priorityTarget) : "HT is waiting for one ticker to separate from the board."}
              </p>
              {priorityTarget && (
                <div className="mt-3 grid gap-2">
                  {getWhyThisMattersBullets(priorityTarget).map((item) => (
                    <div key={`mobile-why-${item}`} className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-300" />
                      <p className="text-xs font-bold leading-5 text-zinc-300">{item}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {priorityTarget && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ["HT", getHTScore(priorityTarget), getSignalEvolutionState(priorityTarget)],
                  ["Crowd", getAttentionScore(priorityTarget), getCrowdPhase(priorityTarget)],
                  ["Risk", getRiskProfile(priorityTarget), getDecisionClarity(priorityTarget)],
                ].map(([label, value, note]) => (
                  <div key={`mobile-${label}`} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</p>
                    <p className="mt-1 text-lg font-black text-white">{value}</p>
                    <p className="mt-1 truncate text-[10px] font-bold text-zinc-500">{note}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => setMobileTab("watchlist")}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black text-zinc-200"
              >
                Watchlist ⭐
              </button>
              <button
                onClick={() => setMobileTab("scanner")}
                className="rounded-2xl bg-orange-500 px-4 py-3 text-xs font-black text-white"
              >
                Scanner ⚡
              </button>
            </div>
          </div>
        </section>

        {/* ── MORNING MARKET CONTEXT ── */}
        <div className="mx-auto max-w-[1488px] px-3 md:px-6 pb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {marketCtx ? (
              <>
                <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${
                  marketCtx.moodColor === "green"
                    ? "border-green-400/20 bg-green-500/[0.05] text-green-400"
                    : marketCtx.moodColor === "red"
                    ? "border-red-400/20 bg-red-500/[0.05] text-red-400"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    marketCtx.moodColor === "green" ? "bg-green-400" :
                    marketCtx.moodColor === "red" ? "bg-red-400" : "bg-zinc-600"
                  }`} />
                  <span className="text-[9px] font-black uppercase tracking-[0.18em]">{marketCtx.mood}</span>
                </div>
                {[
                  { label: "SPY", val: marketCtx.spy },
                  { label: "QQQ", val: marketCtx.qqq },
                  { label: "IWM", val: marketCtx.iwm },
                ].map(({ label, val }) => (
                  <div key={label} className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-black/40 px-3 py-1">
                    <span className="text-[9px] font-black text-zinc-600">{label}</span>
                    <span className={`text-[9px] font-black ${val.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {val.change >= 0 ? "+" : ""}{val.change.toFixed(2)}%
                    </span>
                  </div>
                ))}
                {marketCtx.vix && (
                  <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-black/40 px-3 py-1">
                    <span className="text-[9px] font-black text-zinc-600">VIX</span>
                    <span className={`text-[9px] font-black ${
                      marketCtx.vix.price > 20 ? "text-red-400" :
                      marketCtx.vix.price > 15 ? "text-orange-400" : "text-green-400"
                    }`}>{marketCtx.vix.price.toFixed(1)}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-black/40 px-3 py-1">
                  <span className="text-[9px] font-black text-zinc-600">VOL</span>
                  <span className={`text-[9px] font-black ${
                    marketCtx.volumeEnv === "Heavy" ? "text-orange-400" :
                    marketCtx.volumeEnv === "Normal" ? "text-zinc-400" : "text-zinc-600"
                  }`}>{marketCtx.volumeEnv}</span>
                </div>
                <span className="text-[8px] font-semibold text-zinc-800 ml-1">Market context · updates every 5 min</span>
              </>
            ) : (
              // Loading state — visible while API fetches
              <div className="flex items-center gap-1.5 animate-pulse">
                {["","","","",""].map((_, i) => (
                  <div key={i} className="h-5 w-16 rounded-full bg-white/[0.03] border border-white/[0.04]" />
                ))}
              </div>
            )}
          </div>
        </div>

        <section id="conviction-engine" className="mx-auto max-w-[1488px] px-3 pt-3 pb-3 md:px-6 md:pt-4 md:pb-4">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="relative overflow-hidden rounded-[1.65rem] border border-white/10 bg-[#04080b] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.52)] md:p-4"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,106,0,0.11),transparent_28%),radial-gradient(circle_at_76%_28%,rgba(34,211,238,0.055),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.018),transparent_42%)]" />

            <div className="relative space-y-4">
              <div className="flex flex-col gap-3 border-b border-white/10 pb-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-7">
                  <div className="flex items-center gap-2">
                    <img src="/logo.png" alt="HT Labs" className="h-8 w-auto" />
                  </div>
                  <nav className="hidden items-center gap-7 text-xs font-bold text-zinc-500 lg:flex">
                    {[
                      ["Dashboard", "command"],
                      ["Top Convictions", "command"],
                      ["Scanner", "signals"],
                      ["News", "signals"],
                      ["Watchlist", "portfolio"],
                    ].map(([label, mode]) => (
                      <button
                        key={`mock-nav-${label}`}
                        type="button"
                        onClick={() => setActiveMode(mode as CommandMode)}
                        className={`transition hover:text-white ${label === "Top Convictions" ? "text-orange-400" : ""}`}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex min-w-[240px] items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5">
                    <span className="text-zinc-600">⌕</span>
                    <input
                      type="text"
                      placeholder="Search ticker..."
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTickerSearch();
                      }}
                      className="min-w-0 flex-1 bg-transparent text-xs font-black uppercase text-white outline-none placeholder:normal-case placeholder:text-zinc-600"
                    />
                  </div>
                  {session?.user ? (
                    <div className="flex items-center gap-2">
                      <span className="max-w-[180px] truncate rounded-full border border-green-400/20 bg-green-500/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-green-300">
                        {mounted ? (session.user.email || "HT Account") : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setAlertsOpen(true); setAlerts(prev => prev.map(a => ({ ...a, read: true }))); }}
                        className="relative rounded-full border border-white/10 bg-white/[0.04] px-3 py-2.5 text-zinc-300 hover:text-white transition"
                      >
                        <span className="text-base">🔔</span>
                        {alerts.filter(a => !a.read).length > 0 && (
                          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-black text-black">
                            {alerts.filter(a => !a.read).length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-300 hover:text-white"
                      >
                        Sign Out
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="email"
                          placeholder="Email"
                          value={authEmail}
                          onChange={(e) => setAuthEmail(e.target.value)}
                          className="w-36 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs font-bold text-white outline-none transition placeholder:text-zinc-600 focus:border-orange-500/60"
                        />
                        <input
                          type="password"
                          placeholder="Password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAuth("signin"); }}
                          className="w-32 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs font-bold text-white outline-none transition placeholder:text-zinc-600 focus:border-orange-500/60"
                        />
                        <button
                          type="button"
                          onClick={() => handleAuth("signin")}
                          disabled={authLoading}
                          className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-200 transition hover:border-orange-400/40 hover:text-orange-300 disabled:opacity-50"
                        >
                          {authLoading ? "..." : "Login"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAuth("signup")}
                          disabled={authLoading}
                          className="rounded-full bg-orange-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-black shadow-[0_0_22px_rgba(249,115,22,0.22)] disabled:opacity-50"
                        >
                          {authLoading ? "..." : "Sign Up"}
                        </button>
                      </div>
                      {authMessage && (
                        <p className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-bold text-zinc-300">
                          {authMessage}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ═══════════════════════════════════════════════════
                  INITIAL LOAD SKELETON
                  Shows only on first load before real Polygon data
                  arrives. lastUpdated is null until fetchStocks
                  completes. After that, skeletons never show again.
                  ═══════════════════════════════════════════════════ */}
              {!lastUpdated && (
                <div className="space-y-4">
                  {/* Spot Momentum skeleton */}
                  <div className="rounded-[1.65rem] border border-white/8 bg-black/40 overflow-hidden animate-pulse">
                    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr]">
                      <div className="p-5 space-y-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-violet-400/40" />
                          <div className="h-2.5 w-28 rounded-full bg-white/8" />
                        </div>
                        <div className="h-14 w-48 rounded-xl bg-white/6" />
                        <div className="flex gap-2">
                          <div className="h-6 w-24 rounded-full bg-white/6" />
                          <div className="h-6 w-32 rounded-full bg-white/6" />
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-4 space-y-2">
                          <div className="h-2 w-36 rounded-full bg-white/8" />
                          <div className="h-3 w-full rounded-full bg-white/6" />
                        </div>
                        <div className="space-y-2">
                          <div className="h-2.5 w-3/4 rounded-full bg-white/6" />
                          <div className="h-2.5 w-2/3 rounded-full bg-white/6" />
                          <div className="h-2.5 w-4/5 rounded-full bg-white/6" />
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-3 space-y-2">
                          <div className="h-2 w-32 rounded-full bg-white/8" />
                          <div className="flex gap-6">
                            <div className="h-6 w-16 rounded-full bg-white/6" />
                            <div className="h-6 w-16 rounded-full bg-white/6" />
                            <div className="h-6 w-16 rounded-full bg-white/6" />
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="h-8 w-40 rounded-xl bg-white/6" />
                          <div className="h-8 w-20 rounded-xl bg-white/6" />
                        </div>
                      </div>
                      <div className="p-5 bg-white/[0.01] border-l border-white/6 space-y-3">
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-4 space-y-2">
                          <div className="h-2 w-28 rounded-full bg-white/8" />
                          <div className="h-8 w-20 rounded-full bg-white/6" />
                          <div className="h-2 w-full rounded-full bg-white/6" />
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-3 space-y-2">
                          <div className="h-2 w-16 rounded-full bg-white/8" />
                          <div className="h-8 w-14 rounded-full bg-white/6" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="h-12 rounded-xl bg-white/6" />
                          <div className="h-12 rounded-xl bg-white/6" />
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-4 space-y-2">
                          <div className="h-2 w-24 rounded-full bg-white/8" />
                          <div className="h-3 w-full rounded-full bg-white/6" />
                          <div className="h-3 w-5/6 rounded-full bg-white/6" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Before The Crowd skeleton */}
                  <div className="rounded-[1.65rem] border border-white/8 bg-black/40 overflow-hidden animate-pulse">
                    <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.65fr]">
                      <div className="p-5 space-y-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-orange-400/40" />
                          <div className="h-2.5 w-32 rounded-full bg-white/8" />
                        </div>
                        <div className="h-14 w-36 rounded-xl bg-white/6" />
                        <div className="flex gap-2">
                          <div className="h-6 w-28 rounded-full bg-white/6" />
                          <div className="h-6 w-20 rounded-full bg-white/6" />
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-4 space-y-2">
                          <div className="h-2 w-40 rounded-full bg-white/8" />
                          <div className="space-y-1.5">
                            <div className="h-2.5 w-full rounded-full bg-white/6" />
                            <div className="h-2.5 w-4/5 rounded-full bg-white/6" />
                            <div className="h-2.5 w-3/4 rounded-full bg-white/6" />
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-3 space-y-2">
                          <div className="h-2 w-32 rounded-full bg-white/8" />
                          <div className="flex gap-6">
                            <div className="h-6 w-16 rounded-full bg-white/6" />
                            <div className="h-6 w-16 rounded-full bg-white/6" />
                            <div className="h-6 w-16 rounded-full bg-white/6" />
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="h-8 w-44 rounded-xl bg-white/6" />
                          <div className="h-8 w-20 rounded-xl bg-white/6" />
                        </div>
                      </div>
                      <div className="p-5 bg-white/[0.01] border-l border-white/6 space-y-3">
                        <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-4 space-y-3">
                          <div className="h-2 w-24 rounded-full bg-white/8" />
                          <div className="h-8 w-16 rounded-full bg-white/6" />
                          <div className="h-2 w-full rounded-full bg-white/6" />
                          <div className="h-[3px] w-full rounded-full bg-white/6" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="h-10 rounded-xl bg-white/6" />
                          <div className="h-10 rounded-xl bg-white/6" />
                          <div className="h-10 rounded-xl bg-white/6" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════════════
                  SPOT MOMENTUM — Primary Hero Experience
                  Powered by: opportunities API, social intel, news intel,
                  conviction engine, pressure stack
                  ═══════════════════════════════════════════════════ */}
              {lastUpdated && (() => {
                // ── Candidate resolution now happens once at component level
                // (resolvedBeforeCrowdTarget) so the bull/bear fetch and the
                // displayed ticker can never drift apart. Don't recompute here. ──
                const resolvedTarget = resolvedBeforeCrowdTarget;

                // Near-miss candidates for the empty state — highest score regardless
                // of stage, shown only when nothing qualifies, clearly unconfirmed.
                const nearMissCandidates = !resolvedTarget
                  ? [...stocks].sort((a, b) => getHTScore(b) - getHTScore(a)).slice(0, 3)
                  : [];

                // Safely resolve BTC target — always a full Stock object
                const btcTargetRaw = resolvedTarget;
                const btcTarget: Stock | null = btcTargetRaw && typeof btcTargetRaw.symbol === 'string' ? btcTargetRaw as Stock : null;

                // Hero truth source:
                // If the verified opportunities API returned a pick, the hero story uses that API object.
                // Local Stock helpers are fallback-only for visual compatibility and must not override the backend score/story.
                const apiHero = apiMomentum && btcTarget?.symbol === apiMomentum.ticker ? apiMomentum : null;
                const btcEngine = btcTarget && !apiHero ? getBackgroundOpportunityEngine(btcTarget as Stock) : null;
                const btcNews = btcTarget ? newsIntel[btcTarget.symbol] : null;
                const btcRvol = Number(apiHero?.relativeVolume ?? (btcTarget ? getRelativeVolume(btcTarget as Stock) : 0));
                const btcAttention = Number(apiHero?.attentionScore ?? (btcTarget ? getAttentionScore(btcTarget as Stock) : 0));
                const btcScore = Number(apiHero?.opportunityScore ?? apiHero?.confidence ?? (btcTarget ? getHTScore(btcTarget as Stock) : 0));
                const backendConfidence = Number(apiHero?.confidence ?? btcScore);
                const backendRiskScore = Number(apiHero?.riskScore ?? 0);
                const btcTier = apiHero?._convictionTier ?? apiHero?.stage ?? (btcScore >= 80 ? "Top Opportunity" : btcScore >= 65 ? "Developing Opportunity" : "Early Setup");
                const btcStageScore = Number(apiHero?.attentionScore ?? (btcTarget ? getBackgroundOpportunityEngine(btcTarget as Stock).crowdSaturationScore : 0));
                const btcStage = apiHero?.freshnessLabel === "Last Verified Signal"
                  ? "Last Verified Signal"
                  : btcStageScore <= 35 ? "Early" : btcStageScore <= 60 ? "Developing" : btcStageScore <= 80 ? "Crowded" : "Exhausted";
                const isApiCatalyst = Boolean(apiHero && (apiHero.catalystScore ?? 0) >= 20);
                const btcDiscovery = apiHero ? Math.min(99, (apiHero.momentumScore ?? 0) + 20) : btcEngine?.discoveryScore || 0;
                const btcSaturation = Number(apiHero?.attentionScore ?? btcEngine?.crowdSaturationScore ?? 0);
                const isBeforeCrowd = Boolean(apiHero?.isBeforeCrowd ?? (btcSaturation < 45 && btcDiscovery >= 60));

                // Build signal evidence bullets
                const signalEvidence = isApiCatalyst ? [
                  { icon: "⚡", label: "FDA Catalyst Detected", detail: `${apiMomentum?.stage ?? "Catalyst active"} — binary outcome could drive significant move`, strength: "high" },
                  (apiMomentum?.relativeVolume ?? 0) >= 2 ? { icon: "📊", label: "Volume Surge Detected", detail: `${(apiMomentum?.relativeVolume ?? 0).toFixed(1)}x above normal — unusual buying activity`, strength: "high" } : null,
                  { icon: "📰", label: "News Velocity Increasing", detail: `${apiMomentum?.signals?.length ?? 0} signals — Fresh catalyst activity`, strength: "medium" } ,
                  apiMomentum?.isBeforeCrowd ? { icon: "🌱", label: "Crowd Has Not Reacted Yet", detail: `Early window still open — before crowd saturation`, strength: "high" } : null,
                  { icon: "👁", label: "Attention Shift Detected", detail: `${apiMomentum?.attentionScore ?? 0}/99 attention score — traders are noticing`, strength: "medium" },
                ].filter(Boolean).slice(0, 5) as { icon: string; label: string; detail: string; strength: string }[]
                : [
                  btcRvol >= 2 ? { icon: "📊", label: "Volume Surge Detected", detail: `${btcRvol.toFixed(1)}x above normal — unusual buying activity`, strength: "high" } : null,
                  btcNews && btcNews.newsVelocity >= 55 ? { icon: "📰", label: "News Velocity Increasing", detail: `${btcNews.articles?.length || 0} articles — ${btcNews.catalystStrength || "Fresh catalyst activity"}`, strength: "medium" } : null,
                  btcSaturation < 45 ? { icon: "⚡", label: "Crowd Has Not Reacted Yet", detail: `Saturation at ${btcSaturation}% — early window still open`, strength: "high" } : null,
                  btcAttention >= 65 ? { icon: "👁", label: "Attention Shift Detected", detail: `${btcAttention}/99 attention score — traders are noticing`, strength: "medium" } : null,
                  btcEngine?.pattern === "Quiet Accumulation" ? { icon: "🤫", label: "Quiet Accumulation Pattern", detail: "Smart money moving before retail notices", strength: "high" } : null,
                  btcEngine?.pattern === "Pressure Coil" ? { icon: "🌀", label: "Pressure Coil Forming", detail: "Volume building while price stays compressed", strength: "high" } : null,
                  btcEngine?.accelerationLabel === "Accelerating Fast" ? { icon: "🚀", label: "Momentum Conviction Rising", detail: "Acceleration above baseline — move is strengthening", strength: "high" } : null,
                ].filter(Boolean).slice(0, 5) as { icon: string; label: string; detail: string; strength: string }[];

                // What HT Is Watching radar items
                const radarItems = [
                  ...stocks.filter(s => getRelativeVolume(s) >= 3 && s.change > 0).slice(0, 2).map(s => ({
                    symbol: s.symbol, signal: "Unusual Volume", desc: `${getRelativeVolume(s).toFixed(1)}x flow detected`, color: "orange", stock: s
                  })),
                  ...stocks.filter(s => detectPatternSignal(s).name === "Quiet Accumulation").slice(0, 2).map(s => ({
                    symbol: s.symbol, signal: "Quiet Accumulation", desc: "Building before the crowd arrives", color: "cyan", stock: s
                  })),
                  ...stocks.filter(s => detectPatternSignal(s).name === "Pressure Coil" && s.change > 0).slice(0, 2).map(s => ({
                    symbol: s.symbol, signal: "Pressure Coil", desc: "Compression before potential breakout", color: "purple", stock: s
                  })),
                  ...stocks.filter(s => getRecoveryScore(s) >= 60).slice(0, 1).map(s => ({
                    symbol: s.symbol, signal: "Potential Reversal", desc: "Selling exhaustion signals forming", color: "green", stock: s
                  })),
                  ...emergingRadarCandidates.slice(0, 2).map(c => ({
                    symbol: c.stock.symbol, signal: "Early Breakout Conditions", desc: c.reason.slice(0, 50), color: "yellow", stock: c.stock
                  })),
                ].filter(Boolean).slice(0, 6);

                return (
                  <div className="space-y-4">

                    {/* ── BEFORE THE CROWD — 3 Column Intelligence Layout ── */}
                    {(() => {
                      // ── No qualifying setup — stay minimal, do not force a hero ──
                      if (!btcTarget) {
                        return (
                          <div className="rounded-[1.65rem] border border-white/10 bg-black/40 p-8 text-center">
                            <div className="flex items-center justify-center gap-2 mb-4">
                              <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-500">Top Opportunity</p>
                            </div>
                            <p className="text-2xl font-black text-white mb-1.5">No Signal Confirmed</p>
                            <p className="text-sm font-semibold text-zinc-500 max-w-md mx-auto">No stock currently clears the HT Labs momentum threshold. Monitoring continues.</p>

                            {nearMissCandidates.length > 0 && (
                              <div className="max-w-sm mx-auto mt-6 space-y-2">
                                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600 mb-2">Watching, Not Confirmed</p>
                                {nearMissCandidates.map((s) => {
                                  const sc = getHTScore(s);
                                  const stageScore = getBackgroundOpportunityEngine(s).crowdSaturationScore;
                                  const stage = stageScore <= 35 ? "Early" : stageScore <= 60 ? "Developing" : stageScore <= 80 ? "Crowded" : "Exhausted";
                                  return (
                                    <button
                                      key={s.symbol}
                                      onClick={() => setSelectedStock(s)}
                                      className="w-full flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2.5 hover:border-white/15 transition"
                                    >
                                      <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm font-black text-zinc-300">{s.symbol}</span>
                                        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-zinc-600">Stage {stageScore} · {stage}</span>
                                      </div>
                                      <span className="font-mono text-xs font-black text-zinc-500">HT {sc}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }

                      const convTier = apiHero?._convictionTier ?? apiHero?.stage ?? (isBeforeCrowd ? "Early Watch" : "Watchlist");
                      const heroTicker = btcTarget?.symbol || apiHero?.ticker || "—";
                      const heroChange = Number(apiHero?.change ?? btcTarget?.change ?? 0);
                      const heroPrice = Number(apiHero?.price ?? btcTarget?.price ?? 0);

                      const hceCategory = apiHero?.catalystTags?.[0] ?? (btcTarget ? getHCECategory(btcTarget as Stock) : null);
                      const isCatalystPlay = Boolean((apiHero?.catalystScore ?? 0) >= 20 || hceCategory);
                      const isMomentumPlay = !isCatalystPlay && heroChange >= 3;

                      const selectionLabel = apiHero?.freshnessLabel === "Last Verified Signal"
                        ? "Last Trading Session"
                        : isCatalystPlay
                        ? (hceCategory ?? "Catalyst Watch")
                        : isMomentumPlay
                        ? "Momentum Leader"
                        : (apiHero?.stage ?? "Verified Setup");

                      const retailBullish = Math.min(90, Math.max(10, 100 - btcSaturation));
                      const retailBearish = 100 - retailBullish;
                      const riskLabel = backendRiskScore >= 70 ? "HIGH" : backendRiskScore >= 45 ? "MEDIUM" : "LOW";
                      const confidenceLabel = backendConfidence >= 80 ? "HIGH" : backendConfidence >= 65 ? "MEDIUM" : "LOW";
                      const positionLabel = apiHero?.freshnessLabel === "Last Verified Signal"
                        ? "VERIFIED"
                        : btcSaturation < 40 ? "EARLY" : btcSaturation < 65 ? "BUILDING" : "LATE";

                      const whyBullets = (() => {
                        if (apiHero?.signals?.length) return apiHero.signals.slice(0, 4);
                        if (!btcTarget) return [];
                        const s = btcTarget as Stock;
                        const rvol = getRelativeVolume(s);
                        const bullets: string[] = [];
                        if (rvol >= 2) bullets.push(`Volume running ${rvol.toFixed(1)}× above normal.`);
                        else if (rvol >= 1.3) bullets.push("Volume expanding above baseline.");
                        if (s.change > 0) bullets.push("Bullish pressure outweighing selling.");
                        if (btcScore >= 80) bullets.push("Setup above HT Labs high-conviction threshold.");
                        else if (btcScore >= 65) bullets.push("Setup clears HT Labs minimum threshold.");
                        return bullets.slice(0, 4);
                      })();

                      return (
                        <div className="relative overflow-hidden rounded-[1.65rem] border border-violet-400/15 bg-gradient-to-br from-black via-black to-violet-500/[0.03]">

                          {/* Header strip */}
                          <div className="flex items-center justify-between px-5 pt-4 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.9)] animate-pulse" />
                              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-violet-400">Spot Momentum</p>
                            </div>
                            <span className="text-[10px] font-black text-zinc-600">{mounted && lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live"}</span>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] divide-y lg:divide-y-0 lg:divide-x divide-white/[0.06]">

                            {/* ══ LEFT — The Story ══ */}
                            <div className="p-5 flex flex-col gap-4">

                              {/* 1. IDENTITY */}
                              <div>
                                <div className="flex items-baseline gap-3 flex-wrap mb-2">
                                  <p className="font-mono text-[3.6rem] font-black uppercase leading-none tracking-[-0.08em] text-white">
                                    {heroTicker}
                                  </p>
                                  <div className="flex items-center gap-2 pb-1">
                                    <span className="font-mono text-xl font-black text-white">${heroPrice.toFixed(2)}</span>
                                    <span className={`font-mono text-sm font-black ${heroChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                                      {heroChange >= 0 ? "+" : ""}{heroChange.toFixed(2)}%
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-black text-zinc-500">
                                    {selectionLabel}
                                  </span>
                                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black ${
                                    btcStage === "Early" ? "border-green-400/20 text-green-500" : "border-zinc-800 text-zinc-600"
                                  }`}>
                                    {btcStage === "Last Verified Signal" ? "Last Verified" : btcStage === "Early" ? "Pre-Crowd" : btcStage === "Developing" ? "Crowd Building" : btcStage === "Crowded" ? "Crowd Arrived" : "Late Stage"}
                                  </span>
                                  {isCatalystPlay && (
                                    <span className="rounded-full border border-orange-400/30 bg-orange-500/[0.07] px-2.5 py-0.5 text-[10px] font-black text-orange-300">
                                      ⚡ {hceCategory}
                                    </span>
                                  )}
                                  {isDualEngineConfirmation && (
                                    <span className="rounded-full border border-amber-400/20 bg-amber-500/[0.05] px-2.5 py-0.5 text-[10px] font-black text-amber-400">
                                      ⚡ Dual Engine Confirmation
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* 2. EMOTIONAL HOOK — one line, bare, confident */}
                              <p className="text-sm font-semibold text-zinc-400 leading-5">
                                {apiHero?.whyItMatters
                                  ?? (isCatalystPlay
                                  ? `${hceCategory} identified — positioned before the event resolves.`
                                  : btcSaturation < 45
                                  ? "Momentum is building before widespread participation arrives."
                                  : "Momentum is expanding as more traders take notice.")}
                              </p>

                              {/* 3. OPPORTUNITY WINDOW — the hero, big numbers, in your face */}
                              {smFramework && (
                                <div className="rounded-xl border border-white/8 bg-black/60 overflow-hidden">
                                  {/* Header strip */}
                                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/6">
                                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-400">Opportunity Window</p>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                        smFramework.confidence === "High" ? "border-green-400/25 text-green-400" :
                                        smFramework.confidence === "Moderate" ? "border-violet-400/20 text-violet-400" :
                                        "border-zinc-800 text-zinc-600"
                                      }`}>{smFramework.confidence}</span>
                                      <span className="text-[8px] font-semibold text-zinc-700">{smFramework.horizon}</span>
                                      {!smFramework.isLive && <span className="text-[8px] text-zinc-800">· Last session</span>}
                                    </div>
                                  </div>

                                  {/* Big numbers — the centrepiece */}
                                  <div className="grid grid-cols-3 divide-x divide-white/6">
                                    <div className="px-4 py-4">
                                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-600 mb-2">Upside</p>
                                      <p className="font-mono text-[2.4rem] font-black text-green-400 leading-none">+{smFramework.uptideMin}%</p>
                                      <p className="font-mono text-xs font-black text-green-400/40 mt-1.5">to +{smFramework.uptideMax}%</p>
                                    </div>
                                    <div className="px-4 py-4">
                                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-600 mb-2">Risk</p>
                                      <p className="font-mono text-[2.4rem] font-black text-red-400 leading-none">-{smFramework.riskZone}%</p>
                                    </div>
                                    <div className="px-4 py-4">
                                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-600 mb-2">R/R Ratio</p>
                                      <p className="font-mono text-[2.4rem] font-black text-violet-400 leading-none">{smFramework.rr}:1</p>
                                    </div>
                                  </div>

                                  {/* Sentence — anchored below numbers */}
                                  <div className="px-4 py-2.5 border-t border-white/6 bg-white/[0.01]">
                                    <p className="text-[10px] font-semibold text-zinc-600 italic">{smFramework.sentence}</p>
                                  </div>
                                </div>
                              )}

                              {/* 4. EVIDENCE — supporting, not leading */}
                              {whyBullets.length > 0 && (
                                <div className="flex flex-col gap-1.5">
                                  {whyBullets.map((b, i) => (
                                    <div key={i} className="flex gap-2">
                                      <span className="text-violet-400/40 text-xs shrink-0 mt-0.5">▸</span>
                                      <p className="text-[11px] font-semibold text-zinc-600 leading-4">{b}</p>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* 5. CTAs */}
                              <div className="flex items-center gap-2.5 mt-auto pt-1">
                                <button
                                  onClick={() => btcTarget && setSelectedStock(btcTarget as Stock)}
                                  className="rounded-xl border border-violet-400/30 bg-violet-500/[0.07] px-4 py-2.5 text-xs font-black text-violet-300 hover:bg-violet-500/12 transition"
                                >
                                  Full Signal Breakdown →
                                </button>
                                <button
                                  onClick={() => btcTarget && toggleWatchlist(heroTicker)}
                                  className={`rounded-xl border px-4 py-2.5 text-xs font-black transition ${watchlist.includes(heroTicker) ? "border-violet-400/25 bg-violet-500/[0.07] text-violet-300" : "border-white/8 text-zinc-600 hover:text-zinc-400"}`}
                                >
                                  {watchlist.includes(heroTicker) ? "★ Watching" : "☆ Watch"}
                                </button>
                              </div>
                              <p className="text-[9px] text-zinc-800 font-semibold -mt-2">Signals are for research only, not financial advice.</p>
                            </div>

                            {/* ══ RIGHT — Advanced Data ══ */}
                            <div className="p-5 flex flex-col gap-4 bg-white/[0.01]">

                              {/* HT Score */}
                              <div>
                                <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-700 mb-2">Opportunity Score</p>
                                <div className="flex items-end gap-3">
                                  <p className={`font-mono text-[3rem] font-black leading-none ${
                                    btcScore >= 80 ? "text-green-400" : btcScore >= 65 ? "text-violet-400" : "text-orange-400"
                                  }`}>{btcScore}</p>
                                  <div className="pb-0.5">
                                    <p className="text-sm font-black text-white leading-tight">
                                      {apiHero?.stage ?? (btcTarget ? getMomentumEnduranceLabel(evaluateMomentumEndurance(btcTarget as Stock), btcScore) : "—")}
                                    </p>
                                    <p className="text-[10px] font-semibold text-zinc-600 mt-0.5">
                                      {apiHero?.whatChanged ?? (btcScore >= 80 ? "Momentum continues to strengthen." : btcScore >= 65 ? "Buying pressure remains intact." : "Momentum is holding its structure.")}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              {/* Metrics */}
                              <div className="grid grid-cols-5 gap-1">
                                {[
                                  { label: "Bullish", value: `${retailBullish}%`, color: "text-violet-400" },
                                  { label: "Bearish", value: `${retailBearish}%`, color: "text-orange-400" },
                                  { label: "Confidence", value: confidenceLabel, color: confidenceLabel === "HIGH" ? "text-violet-400" : confidenceLabel === "MEDIUM" ? "text-orange-400" : "text-zinc-500" },
                                  { label: "Risk", value: riskLabel, color: riskLabel === "HIGH" ? "text-red-400" : riskLabel === "MEDIUM" ? "text-orange-400" : "text-green-400" },
                                  { label: "Position", value: positionLabel, color: "text-violet-400" },
                                ].map(({ label, value, color }) => (
                                  <div key={label} className="rounded-lg border border-white/5 bg-black/30 px-1.5 py-2 text-center">
                                    <p className={`font-mono text-[11px] font-black leading-none ${color}`}>{value}</p>
                                    <p className="text-[6px] font-black uppercase tracking-[0.05em] text-zinc-700 mt-1.5">{label}</p>
                                  </div>
                                ))}
                              </div>

                              {/* HT Read */}
                              <div className="flex flex-col">
                                <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-700 mb-2">HT Labs Read</p>
                                {bullBearLoading ? (
                                  <div className="space-y-1.5 animate-pulse">
                                    <div className="h-2.5 bg-zinc-900 rounded w-full" />
                                    <div className="h-2.5 bg-zinc-900 rounded w-3/4" />
                                  </div>
                                ) : bullBearData?.ticker === heroTicker && bullBearData?.htRead ? (
                                  <p className="text-sm font-semibold text-zinc-300 leading-5">"{bullBearData.htRead}"</p>
                                ) : (
                                  <p className="text-sm font-semibold text-zinc-400 leading-5">
                                    {apiHero?.whyItMatters
                                      ?? (btcSaturation < 45
                                      ? `${heroTicker} is building before widespread participation. Volume ${btcRvol >= 1.3 ? "is above average" : "remains moderate"}.`
                                      : `${heroTicker} is showing ${retailBullish >= 60 ? "bullish" : "mixed"} momentum with ${positionLabel.toLowerCase()} crowd positioning.`)}
                                  </p>
                                )}
                                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5 mt-3">
                                  {[
                                    { label: "Sentiment", value: retailBullish >= 60 ? "Bullish" : retailBullish >= 40 ? "Mixed" : "Bearish", color: retailBullish >= 60 ? "text-green-400" : retailBullish >= 40 ? "text-violet-400" : "text-orange-400" },
                                    { label: "Momentum", value: btcScore >= 75 ? "Strengthening" : btcScore >= 60 ? "Stable" : "Fading", color: btcScore >= 75 ? "text-green-400" : btcScore >= 60 ? "text-violet-400" : "text-zinc-500" },
                                    { label: "Crowd", value: btcSaturation < 35 ? "Early" : btcSaturation < 65 ? "Building" : "Crowded", color: btcSaturation < 35 ? "text-green-400" : btcSaturation < 65 ? "text-violet-400" : "text-red-400" },
                                  ].map(({ label, value, color }) => (
                                    <div key={label} className="text-center">
                                      <p className="text-[7px] font-black uppercase tracking-[0.1em] text-zinc-700 mb-1">{label}</p>
                                      <p className={`text-[11px] font-black ${color}`}>{value}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Decision Trace — right panel, fills dead space */}
                              {smTrace && smTrace.primaryDrivers.length > 0 && (
                                <div className="rounded-xl border border-white/[0.05] bg-black/40 overflow-hidden mt-auto">
                                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                                    <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700">Decision Trace</p>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-full border ${
                                        smTrace.confidence === "High" ? "border-green-400/20 text-green-500" :
                                        smTrace.confidence === "Moderate" ? "border-violet-400/15 text-violet-500" :
                                        "border-zinc-800 text-zinc-700"
                                      }`}>{smTrace.confidence}</span>
                                      <span className="text-[7px] font-semibold text-zinc-800">
                                        Opp {smTrace.opportunityScore} · {smTrace.candidatesEvaluated} evaluated
                                      </span>
                                    </div>
                                  </div>
                                  <div className="px-3 py-2.5 space-y-1.5">
                                    <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1">Why This Stock</p>
                                    {smTrace.primaryDrivers.map((d, i) => (
                                      <div key={i} className="flex gap-1.5 items-start">
                                        <span className="text-violet-400/30 text-[8px] shrink-0 mt-0.5">▸</span>
                                        <p className="text-[9px] font-semibold text-zinc-600 leading-[1.3]">{d}</p>
                                      </div>
                                    ))}
                                  </div>
                                  {smTrace.rejectedAlternatives.length > 0 && (
                                    <div className="px-3 pb-2.5 border-t border-white/[0.04] pt-2">
                                      <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1.5">Why Not Others</p>
                                      <div className="space-y-1.5">
                                        {smTrace.rejectedAlternatives.map((r, i) => (
                                          <div key={i} className="flex gap-1.5 items-start">
                                            <span className="font-mono text-[9px] font-black text-zinc-500 shrink-0">{r.symbol}</span>
                                            <p className="text-[8px] font-semibold text-zinc-700 leading-[1.3]">— {r.reason}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* ── Bottom strip — 4 quick stats ── */}
                          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-white/8 border-t border-white/8">
                            <div className="flex items-center gap-2.5 p-3">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-sm shrink-0">🔥</span>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">Market Mood</p>
                                <p className="text-sm font-black text-white">{heroChange >= 0 ? "Risk On" : "Risk Off"}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 p-3">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-sm shrink-0">👥</span>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">Retail Attention</p>
                                <p className="text-sm font-black text-white">{btcSaturation < 40 ? "Rising" : btcSaturation < 65 ? "Building" : "Peaked"}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 p-3">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-sm shrink-0">📊</span>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">Volume</p>
                                <p className="text-sm font-black text-white">{btcRvol.toFixed(1)}x avg</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 p-3">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-sm shrink-0">🎯</span>
                              <div>
                                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500">Opportunity</p>
                                <p className="text-sm font-black text-violet-400">{positionLabel === "VERIFIED" ? "Verified" : positionLabel === "EARLY" ? "Early" : positionLabel === "BUILDING" ? "Developing" : "Late"}</p>
                              </div>
                            </div>
                          </div>

                          {/* ── Catalyst signal footer strip ── */}
                          <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/8 bg-violet-500/[0.03]">
                            <div className="flex items-center gap-2">
                              <span className="text-violet-400 text-sm">⚡</span>
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400">
                                {isCatalystPlay ? "Catalyst Signal" : "Momentum Signal"} — Before The Move
                              </p>
                            </div>
                            <p className="font-mono text-lg font-black text-violet-400">{btcScore}</p>
                          </div>

                          {/* ── Bull / Bear — full width below ── */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/8 border-t border-white/8">
                            <div className="p-4 bg-green-500/[0.02]">
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-green-400 mb-2">🐂 Bull Case</p>
                              {bullBearLoading ? (
                                <div className="space-y-2 animate-pulse">
                                  <div className="h-2.5 bg-green-900/40 rounded w-full" />
                                  <div className="h-2.5 bg-green-900/40 rounded w-4/5" />
                                  <div className="h-2.5 bg-green-900/40 rounded w-3/5" />
                                </div>
                              ) : bullBearData?.ticker === heroTicker && bullBearData?.bullCase ? (
                                <ul className="space-y-2">
                                  {bullBearData.bullCase.slice(0, 3).map((pt: string, i: number) => (
                                    <li key={i} className="flex gap-2 text-xs font-semibold text-zinc-300 leading-4">
                                      <span className="text-green-500 font-black shrink-0">+</span><span>{pt}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-[10px] text-zinc-600">Analyzing {heroTicker}...</p>
                              )}
                            </div>
                            <div className="p-4 bg-red-500/[0.02]">
                              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-400 mb-2">🐻 Bear Case</p>
                              {bullBearLoading ? (
                                <div className="space-y-2 animate-pulse">
                                  <div className="h-2.5 bg-red-900/40 rounded w-full" />
                                  <div className="h-2.5 bg-red-900/40 rounded w-4/5" />
                                  <div className="h-2.5 bg-red-900/40 rounded w-3/5" />
                                </div>
                              ) : bullBearData?.ticker === heroTicker && bullBearData?.bearCase ? (
                                <ul className="space-y-2">
                                  {bullBearData.bearCase.slice(0, 3).map((pt: string, i: number) => (
                                    <li key={i} className="flex gap-2 text-xs font-semibold text-zinc-300 leading-4">
                                      <span className="text-red-500 font-black shrink-0">−</span><span>{pt}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-[10px] text-zinc-600">Analyzing {heroTicker}...</p>
                              )}
                            </div>
                          </div>

                          {/* ── Full Intelligence expandable ── */}
                          <div className="px-5 py-2.5 border-t border-white/8">
                            <button onClick={() => setBullBearExpanded(v => !v)} className="w-full flex items-center justify-between group">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Full Intelligence Breakdown</span>
                                {bullBearData?.ticker === heroTicker && bullBearData && (
                                  <span className="rounded-full border border-green-400/20 bg-green-500/10 px-2 py-0.5 text-[8px] font-black text-green-400">
                                    {bullBearData.newsCount > 0 ? `${bullBearData.newsCount} sources` : "AI Analysis"}
                                  </span>
                                )}
                              </div>
                              <span className="text-zinc-600 group-hover:text-zinc-300 transition text-sm">{bullBearExpanded ? "▲" : "▼"}</span>
                            </button>
                            {bullBearExpanded && bullBearData?.ticker === heroTicker && bullBearData && (
                              <div className="mt-4 space-y-3 pb-2">
                                <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
                                  <p className="text-[9px] font-black uppercase tracking-[0.14em] text-zinc-500 mb-1">🚨 Why It's On Our Radar</p>
                                  <p className="text-xs font-semibold text-zinc-200 leading-5">{bullBearData.onRadar}</p>
                                </div>
                                <p className="text-[9px] text-zinc-700 text-center">Not financial advice. HT Labs surfaces information — you make the call.</p>
                              </div>
                            )}
                          </div>

                        </div>
                      );
                    })()}

                    {/* ══════════════════════════════════════════════════════
                        BEFORE THE CROWD — Thesis Endurance Engine
                        ══════════════════════════════════════════════════════ */}
                    {resolvedBeforeTheCrowdTarget && (() => {
                      const btcE = resolvedBeforeTheCrowdTarget;
                      const conv = beforeTheCrowdConviction;
                      const convLabel = getThesisEnduranceLabel(conv);
                      const btcScore = getHTScore(btcE);
                      const reasons = getThesisEnduranceReason(btcE);
                      const hceCat = getHCECategory(btcE);
                      const btcRvol = getRelativeVolume(btcE);
                      const btcSat = getBackgroundOpportunityEngine(btcE).crowdSaturationScore;
                      const borderColor = conv >= 80 ? "border-green-400/20 bg-green-500/[0.03]" :
                        conv >= 65 ? "border-violet-400/20 bg-violet-500/[0.03]" :
                        conv >= 50 ? "border-orange-400/20 bg-orange-500/[0.03]" :
                        "border-red-400/20 bg-red-500/[0.03]";
                      const accentColor = conv >= 80 ? "text-green-400" : conv >= 65 ? "text-violet-400" :
                        conv >= 50 ? "text-orange-400" : "text-red-400";
                      const accentBorder = conv >= 80 ? "border-green-400/30 bg-green-500/10" :
                        conv >= 65 ? "border-violet-400/30 bg-violet-500/10" :
                        conv >= 50 ? "border-orange-400/30 bg-orange-500/10" : "border-red-400/30 bg-red-500/10";

                      return (
                        <div className={`rounded-[1.65rem] border overflow-hidden ${borderColor}`}>
                          <div className="flex items-center justify-between px-5 pt-4 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-2 w-2 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.9)] animate-pulse" />
                              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-orange-400">Before The Crowd</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {isDualEngineConfirmation && (
                                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[9px] font-black text-amber-400">⚡ Dual Engine Confirmation</span>
                              )}
                              {mounted && lastUpdated && (
                                <span className="text-[10px] font-black text-zinc-600">{lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] divide-y lg:divide-y-0 lg:divide-x divide-white/10">
                            <div className="p-5 pt-1">
                              <div className="flex items-baseline gap-3 flex-wrap mb-2">
                                <p className="font-mono text-[3.4rem] font-black uppercase leading-[0.85] tracking-[-0.1em] text-white">{btcE.symbol}</p>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xl font-black text-white">${btcE.price.toFixed(2)}</span>
                                  <span className={`font-mono text-sm font-black ${btcE.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                                    {btcE.change >= 0 ? "+" : ""}{btcE.change.toFixed(2)}%
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mb-3 flex-wrap">
                                {hceCat && (
                                  <span className="rounded-full border border-orange-400/40 bg-orange-500/10 px-3 py-1 text-[10px] font-black text-orange-300">⚡ {hceCat}</span>
                                )}
                                <span className={`rounded-full border px-3 py-1 text-[10px] font-black ${accentBorder} ${accentColor}`}>{convLabel}</span>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-black text-zinc-500">HT {btcScore}</span>
                              </div>
                              <div className="rounded-2xl border border-orange-400/10 bg-orange-500/[0.03] px-4 py-2.5 mb-3">
                                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-400 mb-1.5">Why HT Labs Selected This</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                  {reasons.map((b, i) => (
                                    <div key={i} className="flex gap-2">
                                      <span className="text-orange-400 font-black text-xs shrink-0">✓</span>
                                      <p className="text-xs font-semibold text-zinc-200 leading-4">{b}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {/* ── Opportunity Window — Before The Crowd ── */}
                              {btcFramework && (
                                <div className="rounded-2xl border border-orange-400/15 bg-orange-500/[0.03] px-4 py-3 mb-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-orange-400">Opportunity Window</p>
                                    {!btcFramework.isLive && (
                                      <span className="text-[8px] font-semibold text-zinc-600">Last session</span>
                                    )}
                                  </div>
                                  <div className="flex items-end gap-4 mb-1.5">
                                    <div>
                                      <p className="text-[8px] font-black uppercase text-zinc-600 mb-0.5">Upside</p>
                                      <p className="font-mono text-xl font-black text-green-400 leading-none">
                                        +{btcFramework.uptideMin}% <span className="text-zinc-600 text-sm">→</span> +{btcFramework.uptideMax}%
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-[8px] font-black uppercase text-zinc-600 mb-0.5">Risk</p>
                                      <p className="font-mono text-xl font-black text-red-400 leading-none">-{btcFramework.riskZone}%</p>
                                    </div>
                                    <div className="ml-auto text-right">
                                      <p className="text-[8px] font-black uppercase text-zinc-600 mb-0.5">R/R</p>
                                      <p className="font-mono text-xl font-black text-orange-400 leading-none">{btcFramework.rr}:1</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-semibold text-zinc-500 italic leading-4 flex-1 mr-3">{btcFramework.sentence}</p>
                                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                                      <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                        btcFramework.confidence === "High" ? "border-green-400/30 bg-green-500/10 text-green-400" :
                                        btcFramework.confidence === "Moderate" ? "border-orange-400/30 bg-orange-500/10 text-orange-400" :
                                        "border-zinc-600/30 bg-zinc-800 text-zinc-500"
                                      }`}>{btcFramework.confidence}</span>
                                      <p className="text-[8px] font-semibold text-zinc-600">{btcFramework.horizon}</p>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center gap-3">
                                <button onClick={() => setSelectedStock(btcE)} className="rounded-xl border border-orange-400/40 bg-transparent px-4 py-2 text-xs font-black text-orange-300 hover:bg-orange-500/10 transition">
                                  See Why HT Labs Picked This →
                                </button>
                                <button onClick={() => toggleWatchlist(btcE.symbol)} className={`rounded-xl border px-4 py-2 text-xs font-black transition flex items-center gap-1.5 ${watchlist.includes(btcE.symbol) ? "border-orange-400/30 bg-orange-500/10 text-orange-300" : "border-white/15 bg-white/[0.04] text-zinc-400 hover:text-white"}`}>
                                  ★ {watchlist.includes(btcE.symbol) ? "Watching" : "Watch"}
                                </button>
                              </div>
                              <p className="mt-2.5 text-[9px] text-zinc-700 font-semibold">Signals are for research only, not financial advice.</p>
                            </div>

                            <div className="p-5 pt-4 flex flex-col bg-white/[0.01]">
                              <div className={`rounded-2xl border px-4 py-3 mb-3 flex items-center justify-between gap-3 ${borderColor}`}>
                                <div>
                                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-500 mb-0.5">Thesis Score</p>
                                  <p className={`font-mono text-[3rem] font-black leading-none ${accentColor}`}>{conv}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[8px] font-black uppercase tracking-[0.14em] text-zinc-500 mb-1">Thesis Endurance</p>
                                  <p className={`text-sm font-black ${accentColor} mb-1`}>{convLabel}</p>
                                  <div className="w-24 bg-zinc-900 rounded-full h-[3px] overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-700 ease-out ${accentColor.replace("text-", "bg-")}`} style={{ width: `${conv}%` }} />
                                  </div>
                                  <p className="text-[9px] font-semibold text-zinc-600 mt-1">
                                    {conv >= 80 ? "Buyers continue building positions before wider participation arrives." : conv >= 65 ? "The setup continues building before broad market participation." : conv >= 50 ? "Early positioning remains active despite limited crowd presence." : "Conviction is fading as the thesis faces structural pressure."}
                                  </p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { label: "Crowd", value: btcSat <= 35 ? "Early" : btcSat <= 60 ? "Building" : "Crowded", color: btcSat <= 35 ? "text-green-400" : btcSat <= 60 ? "text-violet-400" : "text-red-400" },
                                  { label: "Volume", value: btcRvol >= 1.5 ? `${btcRvol.toFixed(1)}×` : "Normal", color: btcRvol >= 1.5 ? "text-orange-400" : "text-zinc-400" },
                                  { label: "HT", value: `${btcScore}`, color: btcScore >= 65 ? "text-violet-400" : "text-zinc-400" },
                                ].map(({ label, value, color }) => (
                                  <div key={label} className="rounded-xl border border-white/8 bg-black/20 px-2 py-2 text-center">
                                    <p className="text-[7px] font-black uppercase text-zinc-600 mb-1">{label}</p>
                                    <p className={`font-mono text-xs font-black ${color}`}>{value}</p>
                                  </div>
                                ))}
                              </div>

                              {/* BTC Decision Trace — right panel */}
                              {btcTrace && btcTrace.primaryDrivers.length > 0 && (
                                <div className="rounded-xl border border-white/[0.05] bg-black/40 overflow-hidden mt-3">
                                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                                    <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700">Decision Trace</p>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded-full border ${
                                        btcTrace.confidence === "High" ? "border-green-400/20 text-green-500" :
                                        btcTrace.confidence === "Moderate" ? "border-orange-400/15 text-orange-500" :
                                        "border-zinc-800 text-zinc-700"
                                      }`}>{btcTrace.confidence}</span>
                                      <span className="text-[7px] font-semibold text-zinc-800">
                                        Opp {btcTrace.opportunityScore} · {btcTrace.candidatesEvaluated} evaluated
                                      </span>
                                    </div>
                                  </div>
                                  <div className="px-3 py-2.5 space-y-1.5">
                                    <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1">Why This Stock</p>
                                    {btcTrace.primaryDrivers.map((d, i) => (
                                      <div key={i} className="flex gap-1.5 items-start">
                                        <span className="text-orange-400/30 text-[8px] shrink-0 mt-0.5">▸</span>
                                        <p className="text-[9px] font-semibold text-zinc-600 leading-[1.3]">{d}</p>
                                      </div>
                                    ))}
                                  </div>
                                  {btcTrace.rejectedAlternatives.length > 0 && (
                                    <div className="px-3 pb-2.5 border-t border-white/[0.04] pt-2">
                                      <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1.5">Why Not Others</p>
                                      <div className="space-y-1.5">
                                        {btcTrace.rejectedAlternatives.map((r, i) => (
                                          <div key={i} className="flex gap-1.5 items-start">
                                            <span className="font-mono text-[9px] font-black text-zinc-500 shrink-0">{r.symbol}</span>
                                            <p className="text-[8px] font-semibold text-zinc-700 leading-[1.3]">— {r.reason}</p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── WHAT HT IS WATCHING — Radar ── */}
                    {radarItems.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-zinc-400">What HT Labs Is Watching</p>
                            <p className="mt-0.5 text-xs font-semibold text-zinc-600">Early signals across the market. Each one is a thread worth pulling.</p>
                          </div>
                          <span className="flex items-center gap-1.5 rounded-full border border-green-400/20 bg-green-500/[0.06] px-3 py-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-green-400">Radar Active</span>
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {radarItems.map((item, i) => (
                            <button
                              key={`radar-${item.symbol}-${i}`}
                              onClick={() => item.stock && setSelectedStock(item.stock)}
                              className="group text-left rounded-2xl border border-white/8 bg-white/[0.02] p-4 hover:border-orange-400/25 hover:bg-orange-500/[0.03] transition"
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <p className="font-mono text-xl font-black text-white">{item.symbol}</p>
                                <span className={`text-[9px] font-black uppercase tracking-[0.1em] rounded-full px-2.5 py-1 ${
                                  item.color === "orange" ? "bg-orange-500/10 text-orange-300" :
                                  item.color === "cyan" ? "bg-cyan-500/10 text-cyan-300" :
                                  item.color === "purple" ? "bg-purple-500/10 text-purple-300" :
                                  item.color === "green" ? "bg-green-500/10 text-green-300" :
                                  "bg-yellow-500/10 text-yellow-300"
                                }`}>{item.signal}</span>
                              </div>
                              <p className="text-xs font-semibold text-zinc-500 leading-4">{item.desc}</p>
                              <p className="mt-2 text-[10px] font-black text-zinc-700 group-hover:text-orange-400 transition">Pull the thread →</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── STAT BAR ── */}
                    {(() => {
                      const hasLiveData = marketScanStats.gainers > 0 || marketScanStats.losers > 0 || marketScanStats.highVolume > 0;
                      const showLastSession = !hasLiveData && lastSessionStats !== null;
                      const gainers = hasLiveData ? marketScanStats.gainers : (lastSessionStats?.gainers ?? null);
                      const losers = hasLiveData ? marketScanStats.losers : (lastSessionStats?.losers ?? null);
                      const highVolume = hasLiveData ? marketScanStats.highVolume : (lastSessionStats?.highVolume ?? null);
                      const sessionNote = showLastSession ? "Last Session" : null;
                      const cards: [string, string | number | null, string, string][] = [
                        ["Market Sweep", "Active", "Broad scan running", "text-white"],
                        ...(gainers !== null ? [["Green", gainers, sessionNote ?? "Names Positive", "text-green-300"] as [string, number, string, string]] : []),
                        ...(losers !== null ? [["Red", losers, sessionNote ?? "Names Negative", "text-red-300"] as [string, number, string, string]] : []),
                        ...(highVolume !== null ? [["Unusual Flow", highVolume, sessionNote ?? "3x+ Relative Volume", "text-orange-300"] as [string, number, string, string]] : []),
                        ["Updated", mounted && lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live", "Live Scan", "text-white"],
                      ];
                      return (
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 opacity-60 hover:opacity-100 transition-opacity">
                          {cards.map(([label, value, note, tone]) => (
                            <div key={`stat-${label}`} className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">{label}</p>
                              <p className={`mt-1 font-mono text-lg font-black ${tone}`}>{value}</p>
                              <p className={`mt-0.5 text-[10px] font-semibold ${showLastSession && label !== "Market Sweep" && label !== "Updated" ? "text-orange-500/60" : "text-zinc-600"}`}>{note}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                  </div>
                );
              })()}

              {/* Dual Opportunity Engine — powered by /api/opportunities */}
              {/* Catalyst Signal Card — shows OTLK type tickers before the crowd */}
              {apiCatalyst && (
                <button
                  onClick={() => { const s = stocks.find(st => st.symbol === apiCatalyst.ticker); if (s) setSelectedStock(s); }}
                  className="mb-3 w-full rounded-2xl border border-violet-400/20 bg-violet-500/[0.05] p-4 text-left hover:border-violet-400/40 transition flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">⚡ Catalyst Signal — Before The Move</p>
                      <p className="mt-2 font-mono text-4xl font-black tracking-[-0.08em] text-white">{apiCatalyst.ticker}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-2xl font-black text-violet-300">{apiCatalyst.confidence}</p>
                      <p className="text-[9px] font-black uppercase text-violet-400">{apiCatalyst.stage}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {(apiCatalyst.signals ?? []).map((sig: string) => (
                      <span key={sig} className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2.5 py-1 text-[10px] font-black text-violet-300">{sig}</span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs font-semibold leading-5 text-zinc-200">{apiCatalyst.whyItMatters}</p>
                  <div className="mt-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2">
                    <p className="text-[9px] font-black uppercase text-violet-400">Risk Note</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-zinc-400">{apiCatalyst.riskNote}</p>
                  </div>
                </button>
              )}
              {(apiMomentum || apiRecovery || topMomentumOpportunity || topRecoveryOpportunity) && (
                <div className="grid gap-3 sm:grid-cols-2 sm:items-stretch">

                  {/* Momentum Card — API first, local fallback */}
                  {(() => {
                    const api = apiMomentum;
                    const local = topMomentumOpportunity;
                    if (!api && !local) return null;

                    if (api) return (
                      <button
                        onClick={() => {
                          const s = stocks.find(st => st.symbol === api.ticker);
                          if (s) setSelectedStock(s);
                        }}
                        className="rounded-2xl border border-orange-400/20 bg-orange-500/[0.05] p-4 text-left hover:border-orange-400/40 transition h-full flex flex-col"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">🔥 #1 Momentum Opportunity</p>
                            <p className="mt-2 font-mono text-4xl font-black tracking-[-0.08em] text-white">{api.ticker}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-2xl font-black text-orange-300">{api.confidence}</p>
                            <p className={`text-[9px] font-black uppercase ${api.confidence >= 95 ? "text-orange-300" : api.confidence >= 85 ? "text-green-300" : api.confidence >= 70 ? "text-yellow-300" : "text-zinc-500"}`}>{api.confidence >= 95 ? "Elite" : api.confidence >= 85 ? "Strong" : api.confidence >= 70 ? "Developing" : "Watchlist"}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-black text-orange-300">
                            {api.stageEmoji} {api.stage}
                          </span>
                          {api.isBeforeCrowd && (
                            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-black text-cyan-300">
                              ⚡ Before Crowd
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-xs font-semibold leading-5 text-zinc-200">{api.whyItMatters}</p>
                        <p className="mt-2 text-[10px] font-semibold text-zinc-500">{api.whatChanged}</p>
                        <div className="mt-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2">
                          <p className="text-[9px] font-black uppercase text-orange-400">Risk Note</p>
                          <p className="mt-0.5 text-[10px] font-semibold text-zinc-400">{api.riskNote}</p>
                        </div>
                      </button>
                    );

                    // Local fallback
                    const mo = local!;
                    const stage = getMomentumStage(mo);
                    return (
                      <button onClick={() => setSelectedStock(mo)} className="rounded-2xl border border-orange-400/20 bg-orange-500/[0.05] p-4 text-left hover:border-orange-400/40 transition h-full flex flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">🔥 #1 Momentum Opportunity</p>
                            <p className="mt-2 font-mono text-4xl font-black tracking-[-0.08em] text-white">{mo.symbol}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-2xl font-black text-orange-300">{getHTScore(mo)}</p>
                            <p className={`text-[9px] font-black uppercase ${getHTScore(mo) >= 95 ? "text-orange-300" : getHTScore(mo) >= 85 ? "text-green-300" : "text-yellow-300"}`}>{getHTScore(mo) >= 95 ? "Elite" : getHTScore(mo) >= 85 ? "Strong" : "Developing"}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-black text-orange-300">{stage.emoji} {stage.stage}</span>
                          <span className={`font-mono text-sm font-black ${mo.change >= 0 ? "text-green-300" : "text-red-300"}`}>{mo.change >= 0 ? "+" : ""}{mo.change.toFixed(2)}%</span>
                        </div>
                        <p className="mt-3 text-xs font-semibold leading-5 text-zinc-300">{getMomentumWhy(mo)}</p>
                      </button>
                    );
                  })()}

                  {/* Recovery Card — API first, local fallback */}
                  {(() => {
                    const api = apiRecovery;
                    const local = topRecoveryOpportunity;
                    if (!api && !local) return null;

                    if (api) return (
                      <button
                        onClick={() => {
                          const s = stocks.find(st => st.symbol === api.ticker);
                          if (s) setSelectedStock(s);
                        }}
                        className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.04] p-4 text-left hover:border-cyan-400/30 transition h-full flex flex-col"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">📉 #1 Recovery Opportunity</p>
                            <p className="mt-2 font-mono text-4xl font-black tracking-[-0.08em] text-white">{api.ticker}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-2xl font-black text-cyan-300">{api.confidence}</p>
                            <p className={`text-[9px] font-black uppercase ${api.confidence >= 95 ? "text-orange-300" : api.confidence >= 85 ? "text-green-300" : "text-yellow-300"}`}>{api.confidence >= 95 ? "Elite" : api.confidence >= 85 ? "Strong" : "Developing"}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-cyan-400/15 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-black text-cyan-300">
                            {api.stageEmoji} {api.stage}
                          </span>
                          {api.isBeforeCrowd && (
                            <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-black text-orange-300">
                              Early Position
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-xs font-semibold leading-5 text-zinc-200">{api.whyItMatters}</p>
                        <p className="mt-2 text-[10px] font-semibold text-zinc-500">{api.whatChanged}</p>
                        <div className="mt-3 rounded-xl border border-white/8 bg-black/30 px-3 py-2">
                          <p className="text-[9px] font-black uppercase text-red-400">Risk Note</p>
                          <p className="mt-0.5 text-[10px] font-semibold text-zinc-400">{api.riskNote}</p>
                        </div>
                      </button>
                    );

                    // Local fallback
                    const ro = local!;
                    const stage = getRecoveryStage(ro);
                    return (
                      <button onClick={() => setSelectedStock(ro)} className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.04] p-4 text-left hover:border-cyan-400/30 transition h-full flex flex-col">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">📉 #1 Recovery Opportunity</p>
                            <p className="mt-2 font-mono text-4xl font-black tracking-[-0.08em] text-white">{ro.symbol}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-2xl font-black text-cyan-300">{getRecoveryScore(ro)}</p>
                            <p className="text-[9px] font-black uppercase text-zinc-500">Recovery Score</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-cyan-400/15 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-black text-cyan-300">{stage.emoji} {stage.stage}</span>
                          <span className={`font-mono text-sm font-black ${ro.change >= 0 ? "text-green-300" : "text-red-300"}`}>{ro.change >= 0 ? "+" : ""}{ro.change.toFixed(2)}%</span>
                        </div>
                        <p className="mt-3 text-xs font-semibold leading-5 text-zinc-300">{getRecoveryWhy(ro)}</p>
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* TODAY'S TOP OPPORTUNITIES — Ranked List */}
              {(() => {
                const momentumList = convictionLeaders.filter(s => {
                  if (s.change <= 0) return false;
                  const pat = detectPatternSignal(s).name;
                  if (pat.includes("Exhaustion")) return false;
                  const crowd = getBackgroundOpportunityEngine(s).crowdSaturationScore;
                  return crowd < 80;
                }).slice(0, 3);
                const recoveryList = convictionLeaders
                  .filter(s => s.change < 0 && getRecoveryScore(s) >= 40)
                  .sort((a, b) => getRecoveryScore(b) - getRecoveryScore(a))
                  .slice(0, 3);
                const hasRecovery = recoveryList.length > 0;
                return (
                  <div className={`grid gap-3 ${hasRecovery ? "lg:grid-cols-2" : ""}`}>
                    <div className="rounded-2xl border border-orange-400/15 bg-orange-500/[0.03] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300 mb-3">🔥 Momentum Opportunities</p>
                      <div className="space-y-2">
                        {momentumList.map((stock) => (
                          <button
                            key={`mom-rank-${stock.symbol}`}
                            onClick={() => setSelectedStock(stock)}
                            className="w-full flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-4 py-3 text-left hover:border-orange-400/30 transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <p className="font-mono text-lg font-black text-white shrink-0">{stock.symbol}</p>
                              <p className="text-xs font-semibold text-zinc-400 truncate">{getSimpleConvictionRead(stock).opinion}</p>
                            </div>
                            <div className="shrink-0 flex items-center gap-2">
                              <span className="font-mono text-sm font-black text-green-300">+{stock.change.toFixed(1)}%</span>
                              <span className={`rounded-full px-2 py-1 text-[9px] font-black ${getHTScore(stock) >= 95 ? "bg-orange-500/15 text-orange-300" : getHTScore(stock) >= 85 ? "bg-green-500/10 text-green-300" : "bg-white/[0.06] text-zinc-400"}`}>{getHTScore(stock) >= 95 ? "Elite" : getHTScore(stock) >= 85 ? "Strong" : "Developing"} · {getHTScore(stock)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {hasRecovery && (
                      <div className="rounded-2xl border border-cyan-400/12 bg-cyan-500/[0.03] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300 mb-3">📉 Recovery Opportunities</p>
                        <div className="space-y-2">
                          {recoveryList.map((stock) => (
                            <button
                              key={`rec-rank-${stock.symbol}`}
                              onClick={() => setSelectedStock(stock)}
                              className="w-full flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/30 px-4 py-3 text-left hover:border-cyan-400/25 transition"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <p className="font-mono text-lg font-black text-white shrink-0">{stock.symbol}</p>
                                <p className="text-xs font-semibold text-zinc-400 truncate">{getRecoveryWhy(stock).slice(0, 60)}{getRecoveryWhy(stock).length > 60 ? "..." : ""}</p>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                <span className="font-mono text-sm font-black text-red-300">{stock.change.toFixed(1)}%</span>
                                <span className="rounded-full bg-cyan-500/10 px-2 py-1 text-[9px] font-black text-cyan-300">{getRecoveryScore(stock)}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="rounded-[1.35rem] border border-orange-400/18 bg-[radial-gradient(circle_at_top_left,rgba(255,106,0,0.16),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))] p-5">
                <div className="min-w-0">
                  {/* 1. THE VERDICT - impossible to miss */}
                  <div className="inline-flex items-center rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-3">
                    <p className="text-xl font-black tracking-[-0.02em] text-white">
                      {liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).state : "⚡ Scanning Market"}
                    </p>
                  </div>

                  {/* 2. What is the ticker */}
                  <h1 className="mt-4 font-mono text-[3.7rem] font-black uppercase leading-[0.82] tracking-[-0.12em] text-white md:text-[5.4rem]">
                    {liveHeroTarget ? liveHeroTarget.symbol : "Scanning"}
                  </h1>

                  {/* 3. One sentence why */}
                  <p className="mt-4 text-xl font-black leading-7 tracking-[-0.02em] text-zinc-100">
                    {liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).opinion : "HT is scanning for the next clean setup."}
                  </p>

                  {/* 4. Confidence breakdown + meta cards side by side */}
                  <div className="mt-5 grid gap-3 md:grid-cols-[1fr_260px]">
                    {/* Left — confidence breakdown */}
                    <div className="rounded-2xl border border-orange-400/20 bg-black/30 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">HT Confidence Breakdown</p>
                          <p className="mt-1 text-[10px] font-semibold text-zinc-600">How this score is earned — not just displayed</p>
                        </div>
                        <p className="font-mono text-4xl font-black text-orange-300">{liveHeroTarget ? getHTScore(liveHeroTarget) : "--"}</p>
                          {liveHeroTarget && <p className={`mt-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${getHTScore(liveHeroTarget) >= 95 ? "text-orange-300" : getHTScore(liveHeroTarget) >= 85 ? "text-green-300" : getHTScore(liveHeroTarget) >= 70 ? "text-yellow-300" : "text-zinc-500"}`}>{getHTScore(liveHeroTarget) >= 95 ? "Elite" : getHTScore(liveHeroTarget) >= 85 ? "Strong" : getHTScore(liveHeroTarget) >= 70 ? "Developing" : "Watchlist"}</p>}
                      </div>
                      {liveHeroTarget && (
                        <div className="mt-3 space-y-2">
                          {getConfidenceBreakdown(liveHeroTarget).map(({ label, value, desc, positive }) => (
                            <div key={label} className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-semibold ${positive ? "text-zinc-200" : "text-zinc-600"}`}>{desc}</p>
                                <p className="text-[9px] font-black uppercase tracking-[0.1em] text-zinc-600 mt-0.5">{label}</p>
                              </div>
                              <div className="w-24 shrink-0 h-1 rounded-full bg-white/10">
                                <div className={`h-full rounded-full ${positive ? "bg-orange-400" : "bg-zinc-700"}`} style={{ width: `${Math.min(100, value)}%` }} />
                              </div>
                              <p className={`w-7 shrink-0 text-right text-[10px] font-black ${positive ? "text-orange-300" : "text-zinc-600"}`}>+{value}</p>
                            </div>
                          ))}
                          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Total Confidence</p>
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-sm font-black text-orange-300">{getHTScore(liveHeroTarget)}</p>
                              <p className={`text-[10px] font-black uppercase ${getHTScore(liveHeroTarget) >= 95 ? "text-orange-300" : getHTScore(liveHeroTarget) >= 85 ? "text-green-300" : getHTScore(liveHeroTarget) >= 70 ? "text-yellow-300" : "text-zinc-500"}`}>
                                {getHTScore(liveHeroTarget) >= 95 ? "Elite" : getHTScore(liveHeroTarget) >= 85 ? "Strong" : getHTScore(liveHeroTarget) >= 70 ? "Developing" : "Watchlist"}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right — Potential, Risk, Thesis stacked */}
                    <div className="flex flex-col gap-3 md:w-[260px]">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Potential</p>
                          <p className="mt-2 font-mono text-2xl font-black text-green-300">{liveHeroTarget ? getContinuationWindows(liveHeroTarget).conservative : "--"}</p>
                          <p className="mt-1 text-[10px] font-bold text-zinc-600">conservative</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Risk</p>
                          <p className="mt-2 text-base font-black text-white leading-tight">{liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).risk : "--"}</p>
                          <p className="mt-1 text-[10px] font-bold text-zinc-600">current read</p>
                        </div>
                      </div>
                      <div className="flex-1 rounded-2xl border border-orange-400/20 bg-orange-500/[0.06] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-400 mb-1.5">Thesis Break</p>
                        <p className="text-[9px] font-semibold text-zinc-600 mb-2">HT loses confidence if:</p>
                        {liveHeroTarget && [
                          `Volume falls below ${Math.max(1.2, getRelativeVolume(liveHeroTarget) - 1.5).toFixed(1)}x normal`,
                          getRiskGuardrailShort(liveHeroTarget),
                          "Attention momentum fades without follow-through",
                        ].map((t, i) => (
                          <div key={i} className="flex items-start gap-2 mt-1">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                            <p className="text-[10px] font-semibold text-zinc-300">{t}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 5. HT Decision — the most important card */}
                  {liveHeroTarget && (() => {
                    const stance = getHTStance(liveHeroTarget);
                    const read = getSimpleConvictionRead(liveHeroTarget);
                    const trapRisk = getTrapRiskScore(liveHeroTarget);
                    const crowdScore = getBackgroundOpportunityEngine(liveHeroTarget).crowdSaturationScore;
                    const reasons = stance.label === "ACCUMULATE" ? [
                      "HT believes buyers remain in control.",
                      "Volume is supporting the move.",
                      crowdScore < 45 ? "The crowd has not fully arrived yet." : "Crowd participation is building but not saturated.",
                      `Current risk profile remains ${trapRisk < 40 ? "favorable." : "manageable."}`,
                    ] : stance.label === "BREAKOUT WATCH" ? [
                      "The setup is approaching a key trigger.",
                      "Pressure is compressing before a potential move.",
                      "HT wants volume confirmation before calling it clean.",
                      "This is where the opportunity forms — before it becomes obvious.",
                    ] : stance.label === "MOMENTUM ACTIVE" ? [
                      "Confirmation already happened.",
                      "Buyers are staying in control after the first move.",
                      "The move has legs — let it work while participation holds.",
                      "Watch for volume to stay elevated as the signal for continuation.",
                    ] : stance.label === "WATCH CLOSELY" || stance.label === "WATCH" ? [
                      "The setup is improving but not ready yet.",
                      "HT wants one more confirmation before calling it actionable.",
                      "Do not force an entry — let the trade come to you.",
                    ] : stance.label === "WAIT FOR PULLBACK" ? [
                      "This has already moved significantly from its base.",
                      "Chasing here means buying what others are selling.",
                      "A cleaner entry will come after it pulls back and stabilizes.",
                    ] : [
                      crowdScore >= 65 ? "The crowd has already arrived — the early edge is gone." : "Risk conditions are not favorable right now.",
                      "Buying here means entering after the easy move is done.",
                      "Wait for a full reset before reconsidering this setup.",
                    ];
                    return (
                      <div className={`mt-4 rounded-2xl border p-5 ${stance.bg}`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">HT Decision</p>
                        <p className={`mt-2 text-4xl font-black tracking-[-0.03em] leading-none ${stance.color}`}>{stance.label}</p>
                        <div className="mt-3 space-y-1.5">
                          {reasons.map((r) => (
                            <div key={r} className="flex items-start gap-2">
                              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${stance.color.replace("text-", "bg-")}`} />
                              <p className="text-sm font-semibold leading-5 text-zinc-200">{r}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 6. HT Next Move */}
                  {liveHeroTarget && (() => {
                    const next = getHTNextMove(liveHeroTarget);
                    return (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">HT Next Move</p>
                        <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-3">
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-400">Watch for</p>
                            <ul className="mt-2 space-y-1.5">
                              {next.watch.map((item) => (
                                <li key={item} className="flex items-start gap-2">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
                                  <p className="text-xs font-semibold leading-4 text-zinc-300">{item}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-red-400">Avoid</p>
                            <ul className="mt-2 space-y-1.5">
                              {next.avoid.map((item) => (
                                <li key={item} className="flex items-start gap-2">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                                  <p className="text-xs font-semibold leading-4 text-zinc-300">{item}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-xl border border-orange-400/20 bg-orange-500/[0.06] p-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-orange-300">Trigger</p>
                            <p className="mt-2 text-xs font-semibold leading-5 text-zinc-200">{next.trigger}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 7. Exit Strategy */}
                  {liveHeroTarget && (() => {
                    const exits = getContinuationWindows(liveHeroTarget);
                    const trapRisk = getTrapRiskScore(liveHeroTarget);
                    return (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Exit Plan</p>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div className="rounded-xl border border-green-400/15 bg-green-500/[0.06] p-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-400">Conservative</p>
                            <p className="mt-2 font-mono text-xl font-black text-green-300">{exits.conservative}</p>
                            <p className="mt-1 text-[10px] font-semibold text-zinc-500">Take profits here first</p>
                          </div>
                          <div className="rounded-xl border border-purple-400/15 bg-purple-500/[0.06] p-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-purple-300">Aggressive</p>
                            <p className="mt-2 font-mono text-xl font-black text-purple-300">{exits.aggressive}</p>
                            <p className="mt-1 text-[10px] font-semibold text-zinc-500">Let it run to here</p>
                          </div>
                          <div className="rounded-xl border border-red-400/15 bg-red-500/[0.06] p-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-red-400">Exit Warning</p>
                            <p className="mt-2 text-sm font-black text-red-300">{trapRisk >= 60 ? "Volume fading fast" : "Volume drops below normal"}</p>
                            <p className="mt-1 text-[10px] font-semibold text-zinc-500">get out if this happens</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 8. Recent Similar Reads */}
                  {liveHeroTarget && (() => {
                    const reads = getRecentSimilarReads(liveHeroTarget);
                    if (!reads.length) return null;
                    return (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Other Active Reads Right Now</p>
                            <p className="mt-0.5 text-[10px] font-semibold text-zinc-600">These are real names from today's live scan — not historical examples</p>
                          </div>
                          <span className="rounded-full border border-green-400/20 bg-green-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-green-300">Live</span>
                        </div>
                        <div className="mt-3 grid gap-2 grid-cols-2 lg:grid-cols-5">
                          {reads.map(({ symbol, change, htScore, pattern }) => (
                            <button
                              key={symbol}
                              onClick={() => {
                                const s = stocks.find((st) => st.symbol === symbol);
                                if (s) setSelectedStock(s);
                              }}
                              className="rounded-xl border border-white/10 bg-black/30 p-3 text-left hover:border-orange-400/30 transition"
                            >
                              <div className="flex items-start justify-between gap-1">
                                <p className="font-mono text-base font-black text-white">{symbol}</p>
                                <p className={`font-mono text-xs font-black ${change >= 0 ? "text-green-300" : "text-red-300"}`}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</p>
                              </div>
                              <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-orange-300">{htScore}% conf</p>
                              <p className="mt-1 text-[9px] font-semibold text-zinc-600 truncate">{
                                change < 0 ? "Buyers needed" :
                                pattern === "Quiet Accumulation" ? "Building quietly" :
                                pattern === "Pressure Coil" ? "Coiling for move" :
                                pattern === "Crowd Ignition" ? "Crowd igniting" :
                                pattern === "Continuation Stack" ? "Momentum holding" :
                                pattern === "Reclaim Setup" ? "Reclaim attempt" :
                                pattern === "Exhaustion Risk" ? "Exhaustion risk" :
                                htScore >= 88 ? "Clean breakout" :
                                htScore >= 78 ? "Attention building" :
                                change >= 4 ? "Strong mover" :
                                change >= 2 ? "Moving up" :
                                "On watch"
                              }</p>
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-[10px] font-semibold text-zinc-600">Click any ticker to see its full HT read. Signal memory builds as you track these over time.</p>
                      </div>
                    );
                  })()}

                  {/* 9. Why HT Picked This + What Changed */}
                  {liveHeroTarget && (() => {
                    const rvol = getRelativeVolume(liveHeroTarget);
                    const attention = getAttentionScore(liveHeroTarget);
                    const trap = getTrapRiskScore(liveHeroTarget);
                          const read = getSimpleConvictionRead(liveHeroTarget);

                    const whyBullets = [
                      rvol >= 2 ? `Volume is ${rvol.toFixed(1)}x normal — unusual buying activity` : rvol >= 1.2 ? `Volume is steady — consistent participation` : null,
                      attention >= 70 ? `Crowd attention is elevated — traders are noticing` : attention >= 55 ? `Trader interest is building quietly` : null,
                      trap < 40 ? `Low reversal risk — structure is clean` : trap < 60 ? `Manageable risk — structure holds` : null,
                      read.state.includes("Accumulation") ? `Early accumulation detected before crowd arrives` : null,
                      read.state.includes("Igniting") ? `Crowd is arriving but setup is not yet saturated` : null,
                      liveHeroTarget.change > 0 ? `Price up ${liveHeroTarget.change.toFixed(1)}% — buyers are in control` : null,
                      getHTScore(liveHeroTarget) >= 60 ? `HT confidence at ${getHTScore(liveHeroTarget)} — setup meets quality threshold` : null,
                    ].filter(Boolean).slice(0, 5);

                    const whatChanged = [
                      rvol >= 3 ? `Volume surged to ${rvol.toFixed(1)}x above normal` : rvol >= 2 ? `Volume elevated at ${rvol.toFixed(1)}x normal` : null,
                      liveHeroTarget.change >= 3 ? `Price up ${liveHeroTarget.change.toFixed(1)}% with structure intact` : null,
                      attention >= 75 ? `Market participation expanding` : null,
                    ].filter(Boolean);

                    return (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-2xl border border-orange-400/20 bg-black/30 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300 mb-3">Why HT Picked This</p>
                          <div className="space-y-2">
                            {whyBullets.length > 0 ? whyBullets.map((b, i) => (
                              <div key={i} className="flex items-start gap-2.5">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" />
                                <p className="text-sm font-semibold text-zinc-200">{b}</p>
                              </div>
                            )) : (
                              <p className="text-sm font-semibold text-zinc-400">{read.operatorRead}</p>
                            )}
                          </div>
                        </div>

                        {whatChanged.length > 0 && (
                          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300 mb-3">What Changed</p>
                            <div className="space-y-2">
                              {whatChanged.map((w, i) => (
                                <div key={i} className="flex items-start gap-2.5">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                                  <p className="text-sm font-semibold text-zinc-200">{w}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {liveHeroTarget && (
                    <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2.5">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Technical Detail · {getSimpleConvictionRead(liveHeroTarget).discoveryRead}</p>
                    </div>
                  )}

                  {/* Advanced Analysis */}
                  {liveHeroTarget && (
                    <div className="mt-3 space-y-3">
                  {/* Social Momentum Signal */}
                  {liveHeroTarget && false && (() => {
                    const s: any = null;
                    return (
                      <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.04] p-4">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Social Momentum</p>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-[9px] font-black text-cyan-300">
                              {s.crowdStageEmoji} {s.crowdStageLabel}
                            </span>
                            <span className="text-[10px] font-black text-zinc-500">Score: <span className="text-cyan-300">{s.socialScore}</span></span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          {(s.stocktwits?.mentions ?? 0) > 0 && (
                            <div className="rounded-xl bg-black/30 p-2 text-center">
                              <p className="font-mono text-lg font-black text-white">{s.stocktwits?.mentions}</p>
                              <p className="text-[9px] font-black uppercase text-zinc-600">Stocktwits</p>
                            </div>
                          )}
                          {(s.reddit?.posts ?? 0) > 0 && (
                            <div className="rounded-xl bg-black/30 p-2 text-center">
                              <p className="font-mono text-lg font-black text-white">{s.reddit?.posts}</p>
                              <p className="text-[9px] font-black uppercase text-zinc-600">Reddit Posts</p>
                            </div>
                          )}
                          {(s.news?.articles ?? 0) > 0 && (
                            <div className="rounded-xl bg-black/30 p-2 text-center">
                              <p className="font-mono text-lg font-black text-white">{s.news?.articles}</p>
                              <p className="text-[9px] font-black uppercase text-zinc-600">News</p>
                            </div>
                          )}
                          {(s.stocktwits?.mentions ?? 0) === 0 && (s.reddit?.posts ?? 0) === 0 && (s.news?.articles ?? 0) === 0 && (
                            <div className="col-span-3 rounded-xl bg-black/30 p-2 text-center">
                              <p className="text-[10px] font-semibold text-zinc-600">Social data updating — signals based on price and volume activity.</p>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          {s.signals.slice(0, 3).map((sig: string) => (
                            <p key={sig} className="text-[10px] font-semibold text-cyan-300">· {sig}</p>
                          ))}
                        </div>
                        {s.beforeCrowdScore >= 50 && (
                          <div className="mt-3 rounded-xl border border-orange-400/20 bg-orange-500/[0.06] px-3 py-2">
                            <p className="text-[10px] font-black text-orange-300">Before Crowd Score: {s.beforeCrowdScore} — Attention arriving early.</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* HT Change Log */}
                  {changeLog.length > 0 && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">HT Change Log</p>
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                          <span className="text-[9px] font-black uppercase tracking-[0.12em] text-green-400">Live</span>
                        </span>
                      </div>
                      <div className="space-y-2">
                        {changeLog.map((entry, i) => (
                          <div key={i} className="flex items-start gap-3">
                            <span className="shrink-0 text-[9px] font-black text-zinc-600 mt-0.5 w-14">{entry.time}</span>
                            <div className={`flex-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${
                              entry.type === "state" ? "bg-orange-500/10 text-orange-200" :
                              entry.type === "score" ? "bg-green-500/10 text-green-200" :
                              entry.type === "pattern" ? "bg-cyan-500/10 text-cyan-200" :
                              "bg-purple-500/10 text-purple-200"
                            }`}>
                              {entry.message}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[9px] font-semibold text-zinc-600">Updates every 30 seconds as the market moves.</p>
                    </div>
                  )}

                  {signalMemoryInsight && signalMemoryInsight.tracked >= 5 ? (
                    <div className="mt-3 rounded-2xl border border-green-400/15 bg-green-500/[0.04] p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-green-300">Signal Memory</p>
                        <span className="text-[10px] font-black text-green-300">{signalMemoryInsight.tracked} Signals Tracked</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
                          <p className="font-mono text-xl font-black text-green-300">{signalMemoryInsight.winners}</p>
                          <p className="mt-1 text-[9px] font-black uppercase text-green-500">Winners</p>
                        </div>
                        <div className="rounded-xl border border-orange-400/20 bg-orange-500/[0.06] p-3 text-center">
                          <p className="font-mono text-xl font-black text-orange-300">{signalMemoryInsight.successRate ?? "--"}%</p>
                          <p className="mt-1 text-[9px] font-black uppercase text-orange-400">Win Rate</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-center">
                          <p className="font-mono text-xl font-black text-white">{signalMemoryInsight.failures}</p>
                          <p className="mt-1 text-[9px] font-black uppercase text-red-400">Failed</p>
                        </div>
                      </div>
                      {signalMemoryInsight.confidenceLabel && (
                        <p className="mt-2 text-[10px] font-semibold text-green-400">{signalMemoryInsight.confidenceLabel}</p>
                      )}
                    </div>
                  ) : session && (signalMemoryInsight?.tracked ?? 0) > 0 ? (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-300">Signal Memory</p>
                      <span className="text-zinc-500">·</span>
                      <span className="text-[10px] font-bold text-zinc-400">Track signals to build your win rate</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-[10px] font-bold text-zinc-300">{signalMemoryInsight?.tracked} / 5 needed</span>
                    </div>
                  ) : null}
                    </div>
                  )}
                </div>


              </div>

              <div className="grid gap-3 lg:grid-cols-[1.15fr_0.55fr_0.85fr] lg:items-stretch mt-4">
                <div className="grid gap-0 overflow-hidden rounded-2xl border border-orange-400/20 bg-white/[0.025] lg:grid-cols-[0.82fr_1fr]">
                  <div className="p-4">
                    <span className="rounded-lg border border-orange-300/35 bg-orange-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200">#{liveHeroTarget ? getMarketRank(liveHeroTarget) : "--"} on active board</span>
                    <p className="mt-6 font-mono text-[4.9rem] font-black uppercase leading-[0.8] tracking-[-0.12em] text-white md:text-[6.2rem]">{liveHeroTarget?.symbol || "--"}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-orange-300/25 bg-orange-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-200">
                        {liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).state : "Scanning"}
                      </span>
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100">
                        Entry {liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).entryQuality : "--"}/99
                      </span>
                    </div>
                    <p className="mt-4 text-sm font-black leading-6 text-zinc-100">{liveHeroTarget ? getSelectionTrustLine(liveHeroTarget) : "HT is filtering for the cleanest active read."}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1.5 font-mono text-sm font-black ${liveHeroIsGreen ? "border-green-400/20 bg-green-500/10 text-green-300" : "border-red-400/20 bg-red-500/10 text-red-300"}`}>{liveHeroChangeDisplay}</span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-300">{liveHeroTarget ? getTimingQualityLabel(liveHeroTarget) : "Scanning"}</span>
                    </div>
                    <p className="mt-5 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600">Live Price</p>
                    <p className="mt-1 font-mono text-4xl font-black text-white md:text-5xl">{liveHeroPriceDisplay}</p>
                    {liveHeroTarget && <p className={`mt-2 font-mono text-lg font-black ${liveHeroIsGreen ? "text-green-300" : "text-red-300"}`}>{liveHeroIsGreen ? "+" : ""}{(liveHeroPrice * (liveHeroChange / 100)).toFixed(2)} ({liveHeroChangeDisplay})</p>}
                    <button onClick={() => liveHeroTarget && openAiModal(liveHeroTarget)} disabled={!liveHeroTarget} className="mt-5 w-full rounded-xl bg-orange-500 px-5 py-4 text-xs font-black uppercase tracking-[0.08em] text-black disabled:opacity-50">View {liveHeroTarget?.symbol || "Ticker"} Analysis →</button>
                    <button onClick={() => liveHeroTarget && toggleWatchlist(liveHeroTarget.symbol)} disabled={!liveHeroTarget} className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-5 py-3 text-xs font-black uppercase tracking-[0.08em] text-zinc-200 disabled:opacity-50">{liveHeroTarget && watchlist.includes(liveHeroTarget.symbol) ? "Remove from watchlist" : "Add to watchlist ☆"}</button>
                  </div>
                  <div className="border-t border-white/10 p-4 lg:border-l lg:border-t-0">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Intraday Price · {mounted && lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live"} ET</p>
                      <span className="rounded-full border border-green-400/20 bg-green-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-green-300">{liveHeroTarget ? getLivePressureCue(liveHeroTarget) : "Scanning"}</span>
                    </div>
                    <div className="h-[245px] rounded-2xl border border-white/10 bg-black/28 p-3">
                      {liveHeroTarget ? <MiniStockChart symbol={liveHeroTarget.symbol} price={liveHeroTarget.price} change={liveHeroTarget.change} /> : <div className="grid h-full place-items-center text-xs font-bold text-zinc-600">Waiting for live ticker</div>}
                    </div>
                    <div className="mt-3 hidden rounded-xl border border-white/10 bg-black/32 p-1 md:flex">
                      {["1D", "5D", "1M", "3M", "YTD", "1Y"].map((range, index) => <span key={range} className={`flex-1 rounded-lg px-3 py-2 text-center text-[10px] font-black ${index === 0 ? "bg-orange-500/12 text-orange-200" : "text-zinc-500"}`}>{range}</span>)}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Why it's moving</p>
                  <div className="mt-4 space-y-3">
                    {liveHeroTarget ? [
                      [`${getRelativeVolume(liveHeroTarget)}x`, "More volume than usual", getRelativeVolume(liveHeroTarget) >= 3 ? "Unusual activity" : "Elevated activity", "text-green-300"],
                      [getAttentionScore(liveHeroTarget) >= 80 ? "High" : getAttentionScore(liveHeroTarget) >= 65 ? "Building" : "Low", "Crowd interest", getAttentionScore(liveHeroTarget) >= 75 ? "Traders are noticing" : "Still under the radar", "text-purple-300"],
                      [getSignalQuality(liveHeroTarget) >= 80 ? "Strong" : "Developing", "Setup quality", getSignalQuality(liveHeroTarget) >= 80 ? "Clean structure" : "Still forming", "text-sky-300"],
                      [getHTScore(liveHeroTarget), "HT Confidence", "Overall conviction score", "text-orange-300"],
                    ].map(([value, label, note, tone]) => (
                      <div key={`proof-${label}`} className="flex items-center gap-4 border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
                        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/30 font-mono text-lg font-black ${tone}`}>{value}</span>
                        <div><p className="text-xs font-black text-white">{label}</p><p className="mt-0.5 text-[10px] font-medium text-zinc-400">{note}</p></div>
                      </div>
                    )) : (
                      <p className="text-xs font-bold text-zinc-600">Waiting for live data...</p>
                    )}
                  </div>
                </div>

                <div id="why-ht-likes-this" className="rounded-2xl border border-cyan-300/12 bg-cyan-400/[0.035] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">HT's reasoning</p>
                    <span className="rounded-full border border-cyan-300/15 bg-cyan-400/[0.08] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100">Plain English</span>
                  </div>
                  <h3 className="mt-3 text-xl font-black leading-tight text-white">
                    {liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).opinion : "Scanning for the next setup."}
                  </h3>
                  <div className="mt-4 space-y-2">
                    {(liveHeroTarget ? [
                      "More buyers than normal are showing up.",
                      "The crowd has not fully arrived yet — this is still early.",
                      "Volume and price are confirming each other.",
                      getTrapRiskScore(liveHeroTarget) < 45 ? "Low chance of a sudden reversal right now." : "Stay disciplined — a reversal is possible.",
                      getSimpleConvictionRead(liveHeroTarget).operatorRead,
                    ] : ["Waiting for HT to surface a clean setup."]).map((reason) => (
                      <div key={reason} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/26 px-3 py-2.5">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-500/18 text-[10px] font-black text-green-300">✓</span>
                        <p className="text-sm font-semibold leading-5 text-zinc-200">{reason}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-xl border border-orange-400/16 bg-orange-500/[0.045] p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Bottom line</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-zinc-200">{liveHeroTarget ? getSimpleConvictionRead(liveHeroTarget).operatorRead : "HT summary activates once a top read is available."}</p>
                  </div>
                </div>
              </div>

              {emergingRadarCandidates.length > 0 && (
                <div id="emerging-radar" className="rounded-2xl border border-cyan-300/12 bg-cyan-400/[0.025] p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">⚡ Before The Crowd</p>
                      <p className="mt-1 text-base font-black text-white">Names HT is watching before the crowd shows up.</p>
                      <p className="mt-0.5 text-xs font-semibold text-zinc-500">This is where the next big move starts.</p>
                    </div>
                    <span className="rounded-full border border-cyan-300/15 bg-cyan-400/[0.06] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-100">Watching Early</span>
                  </div>
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
                    {emergingRadarCandidates.slice(0, 4).map(({ stock, engine, radarScore, status }) => {
                      const humanReason = engine.pattern === "Quiet Accumulation" ? "Volume building quietly before the move." :
                        engine.pattern === "Pressure Coil" ? "Pressure coiling before breakout." :
                        engine.pattern === "Crowd Ignition" ? "Crowd attention accelerating." :
                        engine.pattern === "Continuation Stack" ? "Momentum holding with participation." :
                        engine.pattern === "Reclaim Setup" ? "Buyers returning after weakness." :
                        engine.accelerationScore >= 70 ? "Acceleration detected early." :
                        engine.discoveryScore >= 80 ? "HT detected this before the crowd." :
                        "Early pressure forming.";
                      const isEarly = engine.opportunityWindow === "EARLY WINDOW OPEN" || engine.opportunityWindow === "EARLY WINDOW BUILDING";
                      return (
                        <button key={`emerging-${stock.symbol}`} onClick={() => { setSelectedStock(stock); }} className="rounded-2xl border border-white/10 bg-black/30 p-4 text-left hover:border-cyan-300/30 transition">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-mono text-2xl font-black tracking-[-0.05em] text-white">{stock.symbol}</p>
                              <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.12em] ${isEarly ? "text-cyan-300" : "text-zinc-400"}`}>{isEarly ? "⚡ Before The Crowd" : status}</p>
                            </div>
                            <span className={`font-mono text-lg font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>{stock.change >= 0 ? "+" : ""}{stock.change.toFixed(1)}%</span>
                          </div>
                          <p className="mt-3 text-xs font-semibold leading-5 text-zinc-300">{humanReason}</p>
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[9px] font-black text-zinc-400">HT {radarScore}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Premarket Intelligence */}
              {premarketMovers.length === 0 && premarketLoaded && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center gap-3">
                  <span className="text-zinc-600">🌙</span>
                  <p className="text-xs font-semibold text-zinc-600">Pre/after market data appears outside regular trading hours. Check back before 9:30 AM or after 4:00 PM ET.</p>
                </div>
              )}
              {premarketMovers.length > 0 && (
                <div className="rounded-2xl border border-purple-400/15 bg-purple-500/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-purple-300">
                        {sessionLabel}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-zinc-500">
                        {marketStatus === "premarket" ? "Gap ups, gap downs, and reversals before the open" : marketStatus === "after_hours" ? "After-hours movers setting up for tomorrow" : "Today's significant movers ranked by HT"}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${marketStatus === "premarket" ? "border-purple-400/20 bg-purple-500/10 text-purple-300" : marketStatus === "after_hours" ? "border-blue-400/20 bg-blue-500/10 text-blue-300" : "border-white/10 bg-white/[0.04] text-zinc-400"}`}>
                      {marketStatus === "premarket" ? "Pre-Market" : marketStatus === "after_hours" ? "After Hours" : "Session"}
                    </span>
                  </div>
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                    {premarketMovers.slice(0, 10).map((mover) => (
                      <button
                        key={mover.symbol}
                        onClick={() => {
                          const s = stocks.find(st => st.symbol === mover.symbol);
                          if (s) setSelectedStock(s);
                        }}
                        className={`rounded-2xl border p-3 text-left transition hover:border-purple-400/30 ${
                          mover.opportunityType === "gap_up" ? "border-green-400/15 bg-green-500/[0.04]" :
                          mover.opportunityType === "gap_down" ? "border-red-400/15 bg-red-500/[0.04]" :
                          "border-white/10 bg-black/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="font-mono text-base font-black text-white">{mover.symbol}</p>
                          <p className={`font-mono text-xs font-black ${mover.extendedChangePercent >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {mover.extendedChangePercent >= 0 ? "+" : ""}{mover.extendedChangePercent.toFixed(1)}%
                          </p>
                        </div>
                        <p className={`mt-1.5 text-[9px] font-black uppercase tracking-[0.1em] ${
                          mover.opportunityType === "gap_up" || (mover.extendedChangePercent >= 3) ? "text-green-400" :
                          mover.opportunityType === "gap_down" || (mover.extendedChangePercent <= -3) ? "text-red-400" :
                          mover.opportunityType === "reversal" ? "text-yellow-400" :
                          mover.extendedChangePercent > 0 ? "text-green-300" : "text-red-300"
                        }`}>
                          {mover.opportunityType === "gap_up" || mover.extendedChangePercent >= 3 ? "⬆ Gap Up" :
                           mover.opportunityType === "gap_down" || mover.extendedChangePercent <= -3 ? "⬇ Gap Down" :
                           mover.opportunityType === "reversal" ? "↩ Reversal" :
                           mover.extendedChangePercent > 1 ? "↗ Moving Up" :
                           mover.extendedChangePercent < -1 ? "↘ Pulling Back" :
                           "→ Flat"}
                        </p>
                        <p className="mt-1 text-[9px] font-black text-orange-300">{mover.htPremarketScore}% HT</p>
                      </button>
                    ))}
                  </div>
                  {premarketMovers[0] && (
                    <div className="mt-3 rounded-xl border border-purple-400/15 bg-black/30 p-3">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-purple-300">Top Setup — {premarketMovers[0].symbol}</p>
                      <p className="mt-1 text-xs font-semibold text-zinc-300">{premarketMovers[0].whyItMatters}</p>
                      <p className="mt-1.5 text-[10px] font-semibold text-zinc-500">{premarketMovers[0].riskNote}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-orange-300">Today's Battlefield</p>
                    <p className="mt-0.5 text-xs font-semibold text-zinc-500">Every name HT is watching right now — each one has a story.</p>
                  </div>
                  <a href="/scanner" className="text-xs font-black uppercase tracking-[0.14em] text-sky-300 hover:text-sky-200">Full Scanner →</a>
                </div>
                <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
                  {(convictionLeaders.length > 0 ? convictionLeaders : [...stocks].sort((a, b) => getHTScore(b) - getHTScore(a))).slice(0, 10).map((stock) => {
                    const htScore = getHTScore(stock);
                    const pattern = detectPatternSignal(stock).name;
                    const trapRisk = getTrapRiskScore(stock);
                    const isTop = liveHeroTarget?.symbol === stock.symbol;

                    const story =
                      stock.change < 0 ? { emoji: "📉", label: "Buyers Needed", color: "text-red-300" } :
                      trapRisk >= 65 ? { emoji: "💣", label: "Volatility Trap", color: "text-red-300" } :
                      pattern === "Exhaustion Risk" ? { emoji: "⚠️", label: "Exhaustion Risk", color: "text-orange-300" } :
                      pattern === "Quiet Accumulation" ? { emoji: "👀", label: "Quiet Accumulation", color: "text-cyan-300" } :
                      pattern === "Pressure Coil" ? { emoji: "⚡", label: "Pressure Coiling", color: "text-cyan-300" } :
                      pattern === "Crowd Ignition" ? { emoji: "🔥", label: "Crowd Igniting", color: "text-orange-300" } :
                      pattern === "Continuation Stack" ? { emoji: "🌊", label: "Momentum Wave", color: "text-green-300" } :
                      pattern === "Reclaim Setup" ? { emoji: "↩️", label: "Reclaim Attempt", color: "text-yellow-300" } :
                      stock.change >= 15 ? { emoji: "🚀", label: "Parabolic Move", color: "text-orange-300" } :
                      stock.change >= 8 ? { emoji: "🔥", label: "Hot Mover", color: "text-orange-300" } :
                      htScore >= 88 ? { emoji: "🎯", label: "Clean Breakout", color: "text-green-300" } :
                      htScore >= 78 ? { emoji: "🧲", label: "Attention Magnet", color: "text-orange-300" } :
                      htScore >= 65 ? { emoji: "👀", label: "Watch Closely", color: "text-yellow-300" } :
                      stock.change >= 2 ? { emoji: "📈", label: "Active", color: "text-green-300" } :
                      stock.change >= 0.5 ? { emoji: "🔎", label: "On Watch", color: "text-zinc-300" } :
                      { emoji: "🌱", label: "Early Stage", color: "text-zinc-400" };

                    return (
                      <button
                        key={stock.symbol}
                        onClick={() => setSelectedStock(stock)}
                        className={`rounded-xl border p-3 text-left transition ${isTop ? "border-orange-400/60 bg-orange-500/10" : "border-white/10 bg-white/[0.025] hover:border-orange-400/30"}`}
                      >
                        <p className="text-sm font-black text-white">{stock.symbol}</p>
                        <p className={`mt-1.5 text-[10px] font-black ${story.color}`}>{story.emoji} {story.label}</p>
                        <p className={`mt-1.5 font-mono text-xs font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>{stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%</p>
                        <p className="mt-1 font-mono text-[10px] text-zinc-600">{htScore}% conf</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Market Intelligence Section */}
            <div className="mx-auto max-w-[1488px] px-3 pb-4 md:px-6">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-300">Market Intelligence</p>
                    <p className="mt-0.5 text-xs font-semibold text-zinc-500">
                      {marketIntel ? `Patterns discovered from ${marketIntel.totalSignals} tracked signals` : "Learning from signal history..."}
                    </p>
                  </div>
                  <button
                    onClick={() => fetchMarketIntel(true)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-400 hover:text-white transition"
                  >
                    Refresh
                  </button>
                </div>

                {!marketIntel || marketIntel.totalSignals < 5 ? (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 text-center">
                    <p className="text-2xl mb-2">🧠</p>
                    <p className="text-sm font-black text-white">Building Pattern Database</p>
                    <p className="mt-1 text-xs font-semibold text-zinc-500">HT needs {Math.max(0, 5 - (marketIntel?.totalSignals ?? 0))} more signals to start discovering patterns.</p>
                    <p className="mt-2 text-[10px] font-semibold text-zinc-600">Signals are logged automatically every 30 seconds.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {marketIntel.insights.map((insight, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/26 px-3 py-2.5">
                          <span className="text-orange-400 mt-0.5 shrink-0">→</span>
                          <p className="text-sm font-semibold text-zinc-200">{insight}</p>
                        </div>
                      ))}
                    </div>
                    {marketIntel.dayStats && marketIntel.dayStats.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 mb-2">Win Rate by Day</p>
                        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
                          {marketIntel.dayStats.filter(Boolean).map((day: any) => (
                            <div key={day.day} className={`rounded-xl border p-2.5 text-center ${day.winRate >= 65 ? "border-green-400/20 bg-green-500/[0.06]" : day.winRate >= 50 ? "border-white/10 bg-white/[0.025]" : "border-red-400/15 bg-red-500/[0.04]"}`}>
                              <p className="text-[9px] font-black uppercase text-zinc-500">{day.day.slice(0, 3)}</p>
                              <p className={`mt-1 font-mono text-lg font-black ${day.winRate >= 65 ? "text-green-300" : day.winRate >= 50 ? "text-white" : "text-red-300"}`}>{day.winRate}%</p>
                              <p className="text-[8px] text-zinc-600">{day.signals} sig</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {marketIntel.patterns && marketIntel.patterns.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 mb-2">Best Performing Patterns</p>
                        <div className="space-y-1.5">
                          {marketIntel.patterns.slice(0, 3).map((p: any) => (
                            <div key={p.pattern} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/26 px-3 py-2">
                              <p className="text-xs font-black text-zinc-300">{p.pattern}</p>
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-black text-green-300">{p.winRate}% wins</span>
                                <span className="text-[10px] font-semibold text-zinc-500">{p.avgGain > 0 ? "+" : ""}{p.avgGain}% avg</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </section>


        <section id="capital-intelligence" className="mx-auto max-w-7xl px-5 pt-3 md:pt-4">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_12%_0%,rgba(255,106,0,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.018))] p-5 backdrop-blur-2xl md:p-6 ht-premium-card"
          >
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,106,0,0.08),transparent_42%,rgba(255,255,255,0.025))]" />
            <div className="relative grid gap-5 xl:grid-cols-[0.9fr_1.1fr] xl:items-stretch">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-300">
                      Capital Allocation
                    </p>
                    <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-white md:text-4xl">
                      Size the opportunity to the account.
                    </h2>
                  </div>
                  <span className="rounded-full border border-green-400/20 bg-green-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-green-300">
                    allocation
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  Tell HT how much capital you are working with, your time horizon, and your risk level. HT turns the live market read into a smarter deployment plan instead of a random ticker pick.
                </p>

                <div className="mt-5 grid gap-4">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Capital available</span>
                    <div className="mt-2 flex items-center rounded-2xl border border-white/10 bg-black/45 px-4 py-3">
                      <span className="font-mono text-xl font-black text-zinc-500">$</span>
                      <input
                        value={capitalInput}
                        onChange={(event) => setCapitalInput(event.target.value)}
                        inputMode="decimal"
                        className="ml-2 w-full bg-transparent font-mono text-2xl font-black text-white outline-none placeholder:text-zinc-700"
                        placeholder="500"
                      />
                    </div>
                  </label>

                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Style</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {[
                        ["short", "Quick In / Out"],
                        ["swing", "Swing"],
                        ["long", "Long-Term"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setAllocationStyle(value as AllocationStyle)}
                          className={`rounded-2xl border px-4 py-3 text-xs font-black uppercase tracking-[0.12em] transition ${
                            allocationStyle === value
                              ? "border-orange-400/45 bg-orange-500/15 text-orange-200"
                              : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Risk</p>
                      <div className="mt-2 grid gap-2">
                        {[
                          ["conservative", "Conservative"],
                          ["moderate", "Moderate"],
                          ["aggressive", "Aggressive"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setAllocationRisk(value as AllocationRisk)}
                            className={`rounded-2xl border px-4 py-3 text-left text-xs font-black uppercase tracking-[0.12em] transition ${
                              allocationRisk === value
                                ? "border-green-400/35 bg-green-500/10 text-green-200"
                                : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Experience</p>
                      <div className="mt-2 grid gap-2">
                        {[
                          ["beginner", "Beginner"],
                          ["intermediate", "Intermediate"],
                          ["advanced", "Advanced"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            onClick={() => setExperienceLevel(value as ExperienceLevel)}
                            className={`rounded-2xl border px-4 py-3 text-left text-xs font-black uppercase tracking-[0.12em] transition ${
                              experienceLevel === value
                                ? "border-orange-400/35 bg-orange-500/10 text-orange-200"
                                : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-zinc-500">Suggested Deployment</p>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <h3 className="font-mono text-4xl font-black tracking-[-0.06em] text-white md:text-5xl">
                        {mounted ? capitalAvailable.toLocaleString() : capitalAvailable}
                      </h3>
                      <span className="mb-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                        {riskProfileLabel} · {allocationProfileLabel} · {experienceLabel}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-right">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">Max single position</p>
                    <p className="mt-1 font-mono text-2xl font-black text-white">{adaptiveAllocationPlan.maxSinglePct}%</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {adaptiveAllocationPlan.items.map((item) => (
                    <div key={`${item.label}-${item.symbol}`} className="rounded-[1.2rem] border border-white/10 bg-white/[0.035] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{item.label}</p>
                          <p className="mt-1 text-2xl font-black tracking-[-0.04em] text-white">{item.symbol}</p>
                        </div>
                        <div className="text-right font-mono">
                          <p className="text-xl font-black text-white">${mounted ? item.amount.toLocaleString() : item.amount}</p>
                          <p className="text-xs font-black text-orange-300">{item.pct}%</p>
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-green-400" style={{ width: `${Math.min(100, item.pct)}%` }} />
                      </div>
                      <p className="mt-3 text-xs font-black uppercase tracking-[0.12em] text-green-300">{item.state}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{item.note}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                  <div className="rounded-2xl border border-green-400/15 bg-green-500/[0.06] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">HT Read</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{adaptiveAllocationPlan.summary}</p>
                  </div>
                  <div className="rounded-2xl border border-orange-400/15 bg-orange-500/[0.06] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-300">Risk Guardrail</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{adaptiveRiskMessage}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-[1.35rem] border border-orange-400/20 bg-[radial-gradient(circle_at_12%_0%,rgba(249,115,22,0.16),transparent_32%),rgba(0,0,0,0.35)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">HT Exit Assist™</p>
                      <h4 className="mt-1 text-xl font-black tracking-[-0.04em] text-white">Profit plan before the emotions hit.</h4>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{profitProtectionPlan.headline}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">Protect zone</p>
                      <p className="mt-1 text-sm font-black text-orange-200">{profitProtectionPlan.protectZone}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {profitProtectionPlan.tiers.map((tier) => (
                      <div key={tier.label} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{tier.label}</p>
                        <p className="mt-2 font-mono text-2xl font-black tracking-[-0.04em] text-white">{tier.range}</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{tier.action}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-2xl border border-green-400/15 bg-green-500/[0.06] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-green-300">Scaling style</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">{profitProtectionPlan.trimStyle}</p>
                    </div>
                    <div className="rounded-2xl border border-red-400/15 bg-red-500/[0.05] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-red-300">Invalidation rule</p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">{profitProtectionPlan.stopRule}</p>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-[11px] leading-5 text-zinc-600">
                  HT provides adaptive market intelligence and sizing logic, not financial advice. Execution still belongs to the user.
                </p>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="portfolio-intelligence" className="mx-auto max-w-7xl px-5 pt-4 md:pt-5">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_82%_0%,rgba(34,197,94,0.14),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))] p-5 backdrop-blur-2xl md:p-6 ht-premium-card"
          >
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(34,197,94,0.07),transparent_45%,rgba(255,106,0,0.06))]" />
            <div className="relative grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-green-300">
                      HT Portfolio Intelligence™
                    </p>
                    <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-white md:text-4xl">
                      Manage the money already in motion.
                    </h2>
                  </div>
                  <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">
                    manual portfolio v1
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  Add your holdings and cash. HT checks concentration, momentum exposure, cash flexibility, and which position deserves attention first.
                </p>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Holdings</p>
                    <button
                      onClick={addPortfolioHolding}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-orange-400/30 hover:text-orange-200"
                    >
                      Add ticker
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2">
                    {portfolioHoldings.map((holding) => (
                      <div key={holding.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          value={holding.symbol}
                          onChange={(event) => updatePortfolioHolding(holding.id, "symbol", event.target.value)}
                          placeholder="Ticker"
                          className="rounded-xl border border-white/10 bg-black/55 px-3 py-2 font-mono text-sm font-black uppercase text-white outline-none placeholder:text-zinc-700"
                        />
                        <div className="flex items-center rounded-xl border border-white/10 bg-black/55 px-3 py-2">
                          <span className="font-mono text-sm font-black text-zinc-600">$</span>
                          <input
                            value={holding.amount}
                            onChange={(event) => updatePortfolioHolding(holding.id, "amount", event.target.value)}
                            inputMode="decimal"
                            placeholder="Amount"
                            className="ml-1 w-full bg-transparent font-mono text-sm font-black text-white outline-none placeholder:text-zinc-700"
                          />
                        </div>
                        <button
                          onClick={() => removePortfolioHolding(holding.id)}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-black text-zinc-500 transition hover:border-red-400/30 hover:text-red-300"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <label className="mt-4 block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Cash reserve</span>
                    <div className="mt-2 flex items-center rounded-2xl border border-white/10 bg-black/55 px-4 py-3">
                      <span className="font-mono text-lg font-black text-zinc-600">$</span>
                      <input
                        value={cashInput}
                        onChange={(event) => setCashInput(event.target.value)}
                        inputMode="decimal"
                        className="ml-2 w-full bg-transparent font-mono text-xl font-black text-white outline-none placeholder:text-zinc-700"
                        placeholder="180"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-zinc-500">Portfolio Read</p>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <h3 className="font-mono text-4xl font-black tracking-[-0.06em] text-white md:text-5xl">
                        {mounted ? portfolioIntelligence.total.toLocaleString() : portfolioIntelligence.total}
                      </h3>
                      <span className="mb-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                        {portfolioIntelligence.riskLevel} Risk · {portfolioIntelligence.cashHealth} Cash
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-right">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-300">Cash flexibility</p>
                    <p className="mt-1 font-mono text-2xl font-black text-white">{portfolioIntelligence.cashPct}%</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Invested", mounted ? `$${portfolioIntelligence.invested.toLocaleString()}` : `$${portfolioIntelligence.invested}`, "market exposure"],
                    ["Momentum Exposure", `${portfolioIntelligence.momentumPct}%`, "fast names"],
                    ["Concentration", `${portfolioIntelligence.concentrationPct}%`, portfolioIntelligence.largestHolding?.symbol || "largest holding"],
                  ].map(([label, value, note]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</p>
                      <p className="mt-2 font-mono text-2xl font-black text-white">{value}</p>
                      <p className="mt-1 text-xs font-bold text-zinc-500">{note}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-orange-400/15 bg-orange-500/[0.06] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-300">Strongest Position</p>
                    <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
                      {portfolioIntelligence.strongest?.symbol || "--"}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      {portfolioIntelligence.strongest
                        ? `${portfolioIntelligence.strongest.htScore}/99 HT Score · ${portfolioIntelligence.strongest.phase}`
                        : "Add holdings to let HT rank the portfolio."}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-red-400/15 bg-red-500/[0.055] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">First Review / Trim Candidate</p>
                    <p className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">
                      {portfolioIntelligence.weakest?.symbol || "--"}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      {portfolioIntelligence.weakest
                        ? `${portfolioIntelligence.weakest.htScore}/99 HT Score · review if capital needs freeing.`
                        : "No weak position detected yet."}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                  <div className="rounded-2xl border border-green-400/15 bg-green-500/[0.06] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-green-300">Suggested Rebalance</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{portfolioIntelligence.rebalance}</p>
                  </div>
                  <div className="rounded-2xl border border-orange-400/15 bg-orange-500/[0.06] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-300">Emotional Risk Warning</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{portfolioIntelligence.warning}</p>
                  </div>
                </div>

                <p className="mt-4 text-[11px] leading-5 text-zinc-600">
                  Portfolio Intelligence is a planning layer. HT can help detect risk, exposure, and sizing pressure, but it is not a licensed financial advisor.
                </p>
              </div>
            </div>
          </motion.div>
        </section>


        <section id="watchtower" className="mx-auto max-w-7xl px-5 pt-8">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_15%_0%,rgba(255,106,0,0.16),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))] p-5 backdrop-blur-2xl md:p-6 ht-premium-card"
          >
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,106,0,0.09),transparent_44%,rgba(255,255,255,0.025))]" />
            <div className="relative space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.26em] text-orange-300">
                    HT Watchtower™
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-white md:text-4xl">
                    Smart alerts that tell you what changed.
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                    Watchtower turns HT signals, rotation, portfolio risk, and crowd behavior into contextual alerts instead of dumb price pings.
                  </p>
                </div>
                <div className="rounded-2xl border border-green-400/20 bg-green-500/10 px-4 py-3 text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-300">Active Alerts</p>
                  <p className="mt-1 font-mono text-3xl font-black text-white">{watchtowerAlerts.length}</p>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-5">
                {watchtowerAlerts.map((alert) => {
                  const toneClass =
                    alert.tone === "green"
                      ? "border-green-400/20 bg-green-500/[0.07] text-green-300"
                      : alert.tone === "red"
                        ? "border-red-400/20 bg-red-500/[0.07] text-red-300"
                        : alert.tone === "orange"
                          ? "border-orange-400/20 bg-orange-500/[0.08] text-orange-300"
                          : "border-white/10 bg-white/[0.035] text-zinc-300";

                  return (
                    <div key={`${alert.severity}-${alert.symbol}`} className={`rounded-[1.35rem] border p-4 ${toneClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-current">
                          {alert.severity}
                        </span>
                        <span className="font-mono text-sm font-black text-white">{alert.symbol}</span>
                      </div>
                      <h3 className="mt-3 text-lg font-black tracking-[-0.03em] text-white">{alert.title}</h3>
                      <p className="mt-2 text-xs leading-5 text-zinc-400">{alert.message}</p>
                      <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">HT Action</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-300">{alert.action}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Primary Watch</p>
                  <p className="mt-2 text-2xl font-black text-white">{liveHeroTarget?.symbol || "--"}</p>
                  <p className="mt-1 text-xs text-zinc-500">{liveHeroTarget ? getSignalEvolutionState(liveHeroTarget) : "Scanning"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Rotation Watch</p>
                  <p className="mt-2 text-2xl font-black text-white">{emergingNextSetup?.symbol || "None"}</p>
                  <p className="mt-1 text-xs text-zinc-500">{emergingNextSetup ? getEmergingRead(emergingNextSetup) : "No forced secondary setup."}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Personalized Risk</p>
                  <p className="mt-2 text-2xl font-black text-white">{riskProfileLabel}</p>
                  <p className="mt-1 text-xs text-zinc-500">Alerts adapt to capital, style, risk, and portfolio exposure.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section
          id="home"
          className="hidden"
        >
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">
              <span className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_18px_rgba(255,106,0,0.9)]" />
              Attention Spike-Trader Operating System
            </div>

            <h1 className="max-w-3xl text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
              HT Labs Reads{" "}
              <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-orange-700 bg-clip-text text-transparent">
                Attention Spike
              </span>{" "}
              Before The Crowd Moves.
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
              HT Labs compresses attention pressure, crowd rotation, signal quality, and trader psychology into one living operating system. Check the Top Conviction first, then use the scanner as support — not noise.
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <motion.button
                onClick={() =>
                  document
                    .getElementById("conviction-engine")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white shadow-[0_0_30px_rgba(255,106,0,0.30)] transition"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Check Attention Spike →
              </motion.button>

              <motion.button
                onClick={() =>
                  document
                    .getElementById("watchlist")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded-xl border border-orange-500/30 bg-white/[0.03] px-5 py-3 text-sm font-black text-white transition hover:border-orange-400 hover:bg-orange-500/10"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Build My Terminal
              </motion.button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["⚡", "Live Pressure", "Attention flow updating"],
                ["🧠", "AI War Room", "Crowd psychology reads"],
                ["🎯", "Attention Spike Edge", "One focus before the noise."],
              ].map((item, index) => (
                <motion.div
                  key={item[1]}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.25 + index * 0.12 }}
                >
                  <div className="rounded-xl bg-orange-500/10 p-2.5 text-lg text-orange-400">
                    {item[0]}
                  </div>
                  <div>
                    <p className="font-black">{item[1]}</p>
                    <p className="text-sm text-zinc-500">{item[2]}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {marketBadges.map((badge) => (
                <div
                  key={badge.symbol}
                  className="rounded-xl border border-white/10 bg-black/35 p-3"
                >
                  <div className="flex items-center justify-start">
                    <p className="font-black">{badge.symbol}</p>
                    <p
                      className={`text-sm font-black ${
                        badge.change >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {badge.change >= 0 ? "+" : ""}
                      {badge.change.toFixed(2)}%
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{badge.label}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 35, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="rounded-[1.5rem] border border-orange-500/15 bg-zinc-950/65 p-4 shadow-[0_0_45px_rgba(255,106,0,0.10)] backdrop-blur-xl ht-compact-shell"
          >
            <div className="mb-4 flex items-center justify-start">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-orange-500/20 bg-black p-2">
                  <img src="/logo.png" alt="HT Labs" className="h-10 w-auto" />
                </div>
                <div>
                  <h2 className="text-xl font-black">HT Command Snapshot</h2>
                  <p className="text-sm text-zinc-500">
                    The quick-read layer for market pressure, rotation, and live signal context.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-400">
                {!mounted || isRefreshing ? "SCANNING" : "LIVE"}
              </div>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                <p className="text-xs text-zinc-500">Market Pulse</p>
                <p className="mt-2 text-2xl font-black">{marketPulse}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                <p className="text-xs text-zinc-500">Bullish / Bearish</p>
                <p className="mt-2 text-2xl font-black">
                  {bullishCount}/{bearishCount}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                <p className="text-xs text-zinc-500">Last Updated</p>
                <p className="mt-2 text-lg font-black">
                  {mounted && lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Total Scanned", stocks.length || 0, "+ Live"],
                ["High Attention Spike", hotStocks.length || 0, "±4% movers"],
                ["Watchlist Hits", watchlist.length || 0, "saved"],
                [
                  "Top Mover",
                  topStock?.symbol || "--",
                  topStock
                    ? `${topStock.change >= 0 ? "+" : ""}${topStock.change.toFixed(2)}%`
                    : "--",
                ],
              ].map((stat, index) => (
                <motion.div
                  key={stat[0]}
                  className="rounded-2xl border border-white/10 bg-black/40 p-4"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.35 + index * 0.08 }}
                >
                  <p className="text-xs text-zinc-500">{stat[0]}</p>
                  <p className="mt-2 text-2xl font-black">{stat[1]}</p>
                  <p className="mt-1 text-xs font-bold text-green-400">
                    {stat[2]}
                  </p>
                </motion.div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/45 p-4">
              <div className="mb-4 flex items-center justify-start">
                <p className="font-black">Pressure Quality</p>
                <span className="rounded-lg border border-orange-500/20 px-2 py-1 text-xs text-orange-400">
                  1D
                </span>
              </div>

              <div className="flex h-28 items-end gap-2 rounded-xl bg-gradient-to-t from-orange-500/10 to-transparent p-3">
                {[28, 34, 48, 42, 64, 55, 72, 46, 52, 68, 61, 84].map(
                  (height, index) => (
                    <motion.div
                      key={index}
                      className="flex-1 rounded-t bg-gradient-to-t from-orange-700 to-orange-400 shadow-[0_0_20px_rgba(255,106,0,0.25)]"
                      initial={{ height: "8%" }}
                      animate={{ height: `${height}%` }}
                      transition={{ duration: 0.7, delay: 0.25 + index * 0.04 }}
                    />
                  ),
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/45 p-4">
              <div className="mb-4 flex items-center justify-start">
                <p className="font-black">Top Attention Spike Picks</p>
                <button
                  onClick={() =>
                    document
                      .getElementById("scanner")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="text-xs font-black text-orange-400"
                >
                  Open Scanner →
                </button>
              </div>

              <div className="space-y-3">
                {htScoreLeaders.slice(0, 5).map((stock, index) => (
                  <motion.div
                    key={stock.symbol}
                    className="grid grid-cols-[28px_1fr_82px_72px] items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-sm"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: index * 0.05 }}
                  >
                    <span className="text-zinc-500">#{index + 1}</span>
                    <span className="font-black">{stock.symbol}</span>
                    <span className="font-bold">
                      ${Number(stock.price || 0).toFixed(2)}
                    </span>
                    <span
                      className={`text-right font-black ${
                        stock.change >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {stock.change >= 0 ? "+" : ""}
                      {stock.change.toFixed(2)}%
                    </span>
                  </motion.div>
                ))}

                {htScoreLeaders.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-500">
                    HT score engine warming up. Pressure reads will populate automatically.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </section>

        <section id="daily-brief" className="mx-auto max-w-7xl px-5 py-4">
          <div className="grid gap-3 rounded-[1.75rem] border border-white/[0.07] bg-black/20 p-4 backdrop-blur-xl md:grid-cols-4">
            {[
              ["Market Mood", dailyBriefing.mood],
              ["First Watch", dailyBriefing.attentionSymbol],
              [
                "Risk Read",
                hotStocks.length ? "Attention Spike active" : "Wait for confirmation",
              ],
              ["Workflow", getOnboardingStatus()],
            ].map((item) => (
              <div
                key={item[0]}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                  {item[0]}
                </p>
                <p className="mt-2 text-lg font-black text-white">{item[1]}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="premium-terminal" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_20%_15%,rgba(255,106,0,0.18),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.10),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.045),rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.96))] p-4 shadow-[0_0_80px_rgba(255,106,0,0.10)] backdrop-blur-2xl md:p-5 ht-compact-shell"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="pointer-events-none absolute right-[-120px] top-[-140px] h-80 w-80 rounded-full bg-orange-500/15 blur-3xl" />
            <div className="relative grid gap-4 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.32em] text-orange-300">
                  HT Command Center
                </p>
                <h3 className="mt-2 max-w-3xl text-3xl font-black leading-none tracking-tight md:text-5xl">
                  One clear read. No dashboard noise.
                </h3>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-zinc-400">
                  HT Labs now behaves like a momentum-trader operating system: one Top Conviction, one rotation map, one noise filter, and one live signal integrity read built to be checked all day.
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {premiumCommandMetrics.map((metric) => (
                    <div key={metric[0]} className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{metric[0]}</p>
                      <p className="mt-2 text-3xl font-black text-white">{metric[1]}</p>
                      <p className="mt-1 text-xs font-bold text-orange-200">{metric[2]}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-orange-500/20 bg-black/45 p-5 shadow-[inset_0_0_45px_rgba(255,106,0,0.06)] ht-compact-shell">
                <div className="mb-4 flex items-center justify-start gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.26em] text-zinc-500">Signal Strength</p>
                    <p className="mt-1 text-xl font-black text-white">Operating focus stack</p>
                  </div>
                  <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300">
                    LIVE
                  </span>
                </div>

                <div className="space-y-3">
                  {premiumSignalBars.map(([label, value]) => (
                    <div key={label}>
                      <div className="mb-2 flex items-center justify-start text-xs font-black uppercase tracking-[0.18em]">
                        <span className="text-zinc-500">{label}</span>
                        <span className="text-white">{value}/99</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-orange-600 via-orange-400 to-green-300" style={{ width: `${Math.min(99, Number(value))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-3">
                  {premiumFocusStack.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">{item.label}</p>
                      <p className="mt-2 text-sm font-black text-white">{item.title}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-zinc-500">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </section>



        <section id="interactive-intelligence" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55 }}
            className="rounded-[34px] border border-white/10 bg-white/[0.025] p-6 md:p-5 ht-compact-shell"
          >
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-start">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-orange-300/70">
                  Interactive Intelligence
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-4xl">
                  Hover the read. Expand the reasoning.
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">
                  HT now explains why a state matters, what changed, and what would invalidate the read — without dumping more noise on the screen.
                </p>
              </div>

              <div className="rounded-full border border-green-400/20 bg-green-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-green-300">
                live behavior layer
              </div>
            </div>

            <div className="grid gap-4 2xl:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {interactiveInsightCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onMouseEnter={() => setHoveredInsight(card.id)}
                      onMouseLeave={() => setHoveredInsight(null)}
                      onClick={() =>
                        setExpandedInsight((current) =>
                          current === card.id ? null : card.id,
                        )
                      }
                      className={`group rounded-2xl border p-5 text-left transition ${
                        expandedInsight === card.id || hoveredInsight === card.id
                          ? "border-orange-300/40 bg-orange-500/10"
                          : "border-white/10 bg-white/[0.025] hover:border-orange-300/25 hover:bg-white/[0.045]"
                      }`}
                    >
                      <div className="flex items-start justify-start gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                            {card.label}
                          </p>
                          <p className="mt-2 text-2xl font-black text-white">
                            {card.value}
                          </p>
                        </div>

                        <motion.span
                          className="mt-1 h-2.5 w-2.5 rounded-full bg-orange-300"
                          animate={{
                            scale:
                              expandedInsight === card.id || hoveredInsight === card.id
                                ? [1, 1.35, 1]
                                : 1,
                            opacity:
                              expandedInsight === card.id || hoveredInsight === card.id
                                ? [0.55, 1, 0.55]
                                : 0.45,
                          }}
                          transition={{
                            duration: 1.6,
                            repeat:
                              expandedInsight === card.id || hoveredInsight === card.id
                                ? Infinity
                                : 0,
                            ease: "easeInOut",
                          }}
                        />
                      </div>

                      <p className="mt-4 text-sm leading-6 text-zinc-400 group-hover:text-zinc-200">
                        {expandedInsight === card.id || hoveredInsight === card.id
                          ? card.note
                          : "Hover or tap to reveal HT reasoning."}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-orange-400/15 bg-orange-500/[0.06] p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-300/70">
                    Expanded Desk Read
                  </p>
                  <p className="mt-3 text-sm leading-7 text-zinc-300">
                    {
                      interactiveInsightCards.find(
                        (card) => card.id === expandedInsight,
                      )?.note || getInteractiveReasoning("why", convictionEngineTarget)
                    }
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <div className="mb-4 flex items-center justify-start">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">
                      Live Status Shifts
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Small changes that make the terminal feel aware.
                    </p>
                  </div>

                  <p className="text-xs font-bold text-zinc-500">
                    {mounted ? `updated ${8 + (terminalPulse % 11)}s ago` : "updating..."}
                  </p>
                </div>

                <div className="space-y-3">
                  {liveStatusShifts.map((shift, index) => (
                    <motion.div
                      key={shift.label}
                      whileHover={{ x: 4 }}
                      className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                    >
                      <div className="flex items-center justify-start gap-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                          {shift.label}
                        </p>
                        <p className="text-sm font-black uppercase tracking-[0.16em] text-orange-300">
                          {shift.value}
                        </p>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        {shift.detail}
                      </p>

                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-green-400"
                          animate={{
                            width: [`${38 + index * 11}%`, `${62 + index * 8}%`, `${38 + index * 11}%`],
                          }}
                          transition={{
                            duration: 4 + index * 0.45,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                        />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="living-intelligence" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="relative rounded-[2rem] border border-orange-500/20 bg-[radial-gradient(circle_at_18%_18%,rgba(255,106,0,0.20),transparent_28%),radial-gradient(circle_at_78%_38%,rgba(34,197,94,0.10),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(0,0,0,0.86)_46%,rgba(0,0,0,0.98))] p-5 shadow-[0_0_110px_rgba(255,106,0,0.13)] backdrop-blur-2xl md:p-6 ht-compact-shell"
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <motion.div
              className="pointer-events-none absolute right-[-140px] top-[-140px] h-96 w-96 rounded-full bg-orange-500/15 blur-3xl"
              animate={{ scale: [1, 1.12, 1], opacity: [0.55, 0.9, 0.55] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="pointer-events-none absolute bottom-[-160px] left-[-120px] h-80 w-80 rounded-full bg-green-500/10 blur-3xl"
              animate={{ scale: [1.05, 0.92, 1.05], opacity: [0.35, 0.75, 0.35] }}
              transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
            />

            <div className="relative grid gap-6 2xl:grid-cols-[1.05fr_0.95fr] 2xl:items-start">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5 shadow-[inset_0_0_45px_rgba(255,106,0,0.05)] ht-compact-shell">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-start">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.32em] text-orange-300">
                      Live Market Intelligence
                    </p>
                    <h3 className="mt-2 text-4xl font-black leading-none tracking-tight md:text-6xl">
                      The market breathes through Attention Spike.
                    </h3>
                    <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-zinc-400">
                      HT Labs reads the tape as a living pressure system: the directive changes mood, the desk remembers previous pressure, and the pressure map shows where attention is concentrating before the crowd fully understands it.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-orange-400/25 bg-orange-500/10 px-4 py-3 text-right">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">Atmosphere</p>
                    <p className="mt-1 text-lg font-black text-white">{getPriorityFlowMode()}</p>
                  </div>
                </div>

                <div className="mt-6 rounded-[1.6rem] border border-orange-500/15 bg-black/40 p-5">
                  <div className="mb-4 flex items-center justify-start gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.26em] text-zinc-500">Current desk state</p>
                      <p className="mt-1 text-xl font-black text-white">{activeDeskPulse?.state || "Scanning"}</p>
                    </div>
                    <span className="rounded-full border border-green-500/25 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300">
                      BREATHING LIVE
                    </span>
                  </div>
                  <p className="text-sm font-semibold leading-6 text-zinc-300">{getPriorityFlowAtmosphere()}</p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {livingPressureMap.map((zone) => (
                      <motion.div
                        key={zone.zone}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                        whileHover={{ y: -2 }}
                      >
                        <div className="flex items-start justify-start gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{zone.zone}</p>
                            <p className="mt-2 text-2xl font-black text-white">{zone.label}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-black text-orange-300">{zone.score || "--"}</p>
                            <p className="text-[8px] font-black uppercase tracking-[0.15em] text-zinc-600">HT Pressure</p>
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-orange-600 via-orange-400 to-green-300"
                            initial={{ width: "8%" }}
                            whileInView={{ width: `${Math.min(99, Number(zone.score || 0))}%` }}
                            transition={{ duration: 0.8 }}
                            viewport={{ once: true }}
                          />
                        </div>
                        <p className="mt-3 text-xs font-black uppercase tracking-[0.18em] text-orange-200">{zone.state}</p>
                        <p className="mt-2 text-xs font-semibold leading-5 text-zinc-500">{zone.note}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[1.5rem] border border-green-500/15 bg-black/45 p-5 ht-compact-shell">
                  <div className="mb-4 flex items-center justify-start">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.26em] text-green-300">AI Desk Memory</p>
                      <p className="mt-1 text-xl font-black text-white">Continuity, not random commentary.</p>
                    </div>
                    <span className="h-3 w-3 animate-pulse rounded-full bg-green-400 shadow-[0_0_18px_rgba(74,222,128,0.9)]" />
                  </div>
                  <div className="space-y-3">
                    {aiDeskMemory.map((line, index) => (
                      <motion.div
                        key={line}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                        initial={{ opacity: 0, x: 12 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.35, delay: index * 0.08 }}
                        viewport={{ once: true }}
                      >
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Memory {index + 1}</p>
                        <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">{line}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-orange-500/15 bg-black/40 p-5 ht-compact-shell">
                  <p className="text-xs font-black uppercase tracking-[0.26em] text-orange-300">Why this matters</p>
                  <h4 className="mt-2 text-2xl font-black text-white">HT is not just ranking movers. It is interpreting pressure.</h4>
                  <p className="mt-3 text-sm font-semibold leading-6 text-zinc-400">
                    Price movement is obvious. Attention Spike is the behavioral layer underneath: who is noticing, whether participation is improving, where rotation is forming, and when the crowd is getting late.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="priority-flow" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="relative overflow-hidden rounded-[2.35rem] border border-orange-500/35 bg-[radial-gradient(circle_at_25%_20%,rgba(255,106,0,0.24),transparent_30%),linear-gradient(135deg,rgba(255,106,0,0.10),rgba(0,0,0,0.72)_45%,rgba(0,0,0,0.92))] p-5 shadow-[0_0_95px_rgba(255,106,0,0.20)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 30, scale: 0.985 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.65 }}
            viewport={{ once: true }}
          >
            <div className="pointer-events-none absolute right-[-120px] top-[-120px] h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" />
            <div className="pointer-events-none absolute bottom-[-160px] left-[-120px] h-80 w-80 rounded-full bg-green-500/10 blur-3xl" />

            <div className="relative mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-start">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.26em] text-orange-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400 shadow-[0_0_18px_rgba(255,106,0,0.9)]" />
                  HT Top Conviction™
                </div>

                <h3 className="text-4xl font-black tracking-tight md:text-6xl">
                  HT Top Conviction
                </h3>

                <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-zinc-400 md:text-base">
                  The heartbeat of HT Labs: one live read built from attention pressure, conviction quality, participation, and crowd phase. This is where the operating system tells traders where to look first.
                </p>
              </div>

              <div className="rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-xs font-black text-green-300">
                {firstSignal?.status || "SIGNAL ENGINE LIVE"}
              </div>
            </div>

            <div className="relative grid gap-4 2xl:grid-cols-[1.15fr_0.85fr]">
              <div className="overflow-hidden rounded-[1.5rem] border border-orange-400/25 bg-black/45 p-5 shadow-[inset_0_0_45px_rgba(255,106,0,0.06)] ht-compact-shell">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-start">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-orange-300">
                      Live Focus Ticker
                    </p>

                    <div className="mt-3 flex flex-wrap items-end gap-4">
                      <h3 className="text-7xl font-black leading-none tracking-tight text-white md:text-8xl">
                        {firstSignal?.stock.symbol || "--"}
                      </h3>

                      <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                          Move
                        </p>
                        <p
                          className={`mt-1 text-2xl font-black ${
                            firstSignal?.stock.change && firstSignal.stock.change >= 0
                              ? "text-green-300"
                              : "text-red-300"
                          }`}
                        >
                          {firstSignal?.stock.change !== undefined
                            ? `${firstSignal.stock.change >= 0 ? "+" : ""}${firstSignal.stock.change.toFixed(2)}%`
                            : "--"}
                        </p>
                      </div>
                    </div>

                    <p className="mt-5 max-w-3xl text-lg font-black leading-7 text-white">
                      {firstSignal?.language || "HT is scanning for the first clean pressure shift."}
                    </p>

                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-orange-500/20 bg-orange-500/10 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-300">
                          Before-Crowd
                        </p>
                        <p className="mt-2 text-3xl font-black text-white">
                          {firstSignal ? firstSignal.beforeCrowdScore : "--"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                          Crowd Status
                        </p>
                        <p className="mt-2 text-sm font-black text-green-300">
                          {firstSignal?.crowdPhase || "Scanning"}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                          Detected
                        </p>
                        <p className="mt-2 text-sm font-black text-white">
                          {firstSignal?.timestamp || "Live"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid min-w-[220px] gap-3 sm:grid-cols-3 md:grid-cols-1">
                    <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                        Conviction
                      </p>
                      <p className="mt-2 text-4xl font-black text-orange-300">
                        {firstSignal?.stock ? getConvictionScore(firstSignal.stock) : "--"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                        Attention
                      </p>
                      <p className="mt-2 text-4xl font-black text-white">
                        {firstSignal?.stock ? getAttentionScore(firstSignal.stock) : "--"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                        Decision
                      </p>
                      <p className="mt-2 text-sm font-black text-green-300">
                        {firstSignal?.stock ? getDecisionClarity(firstSignal.stock) : "--"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-green-300">
                    HT Signal Rule
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6 text-zinc-200">
                    {firstSignal?.stock
                      ? getConfirmationTrigger(firstSignal.stock)
                      : "Wait for attention, conviction, and participation to align."}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-[1.75rem] border border-white/10 bg-black/40 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-zinc-500">
                    Why It Triggered
                  </p>
                  <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">
                    {firstSignal?.stock
                      ? getConvictionReason(firstSignal.stock)
                      : "HT is waiting for one ticker to separate from the board."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-zinc-500">
                      Participation Quality
                    </p>
                    <p className="mt-2 text-sm font-black text-white">
                      {firstSignal?.stock ? getVolumeAcceleration(firstSignal.stock) : "--"}
                    </p>
                  </div>

                  <div className="rounded-[1.5rem] border border-red-500/15 bg-red-500/5 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-red-300">
                      Invalidation
                    </p>
                    <p className="mt-2 text-xs font-bold leading-5 text-zinc-300">
                      {firstSignal?.stock
                        ? getInvalidationRule(firstSignal.stock)
                        : "No signal to invalidate yet."}
                    </p>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-orange-500/15 bg-orange-500/5 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-300">
                    Secondary Watch
                  </p>
                  <div className="mt-3 flex items-center justify-start gap-3">
                    <div>
                      <h4 className="text-3xl font-black text-white">
                        {secondaryTarget?.symbol || "--"}
                      </h4>
                      <p className="mt-1 text-xs leading-5 text-zinc-400">
                        {secondaryTarget
                          ? "Potential rotation if Top Conviction pressure fades."
                          : "No secondary setup yet."}
                      </p>
                    </div>
                    <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-300">
                      NEXT
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="signal-proof" className="mx-auto max-w-7xl px-5 py-4">
          <div className="grid gap-3 rounded-[1.75rem] border border-white/10 bg-black/30 p-4 backdrop-blur-xl md:grid-cols-4">
            {firstSignalProofLoop.map((item, index) => (
              <motion.div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.06 }}
                viewport={{ once: true }}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-black text-white">{item.value}</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-zinc-500">
                  {item.note}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="signal-history" className="mx-auto max-w-7xl px-5 py-4">
          <motion.div
            className="overflow-hidden rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 shadow-[0_0_70px_rgba(255,106,0,0.09)] backdrop-blur-xl ht-compact-shell"
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-300">
                  Proof of Edge
                </p>
                <h3 className="mt-1 text-3xl font-black md:text-4xl">
                  Top Conviction History
                </h3>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-zinc-500">
                  The trust layer: every HT signal gets framed as pressure detected,
                  status tracked, and outcome watched — so users feel the system learning in real time.
                </p>
              </div>

              <div className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-300">
                PROOF LOOP ACTIVE
              </div>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-4">
              {proofMetrics.map((metric) => (
                <div
                  key={metric[0]}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                    {metric[0]}
                  </p>
                  <p className="mt-2 text-xl font-black text-white">{metric[1]}</p>
                  <p className="mt-1 text-xs font-bold text-orange-300">{metric[2]}</p>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {signalHistory.map((item, index) => (
                <motion.div
                  key={`${item.event}-${item.symbol}`}
                  className="grid gap-3 rounded-2xl border border-white/10 bg-black/35 p-4 transition hover:border-orange-500/25 hover:bg-orange-500/[0.035] md:grid-cols-[110px_1fr_150px_170px] md:items-center"
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: index * 0.05 }}
                  viewport={{ once: true }}
                >
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                      Ticker
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">{item.symbol}</p>
                  </div>

                  <div>
                    <p className="text-sm font-black text-orange-200">{item.event}</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-zinc-500">
                      {item.note}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                      Result
                    </p>
                    <p className="mt-1 text-sm font-black text-white">{item.result}</p>
                  </div>

                  <div className="flex justify-start md:justify-end">
                    <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-200">
                      {item.status}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        <section id="live-ht-desk" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="relative overflow-hidden rounded-[2.25rem] border border-green-500/20 bg-[radial-gradient(circle_at_18%_18%,rgba(34,197,94,0.18),transparent_28%),radial-gradient(circle_at_88%_10%,rgba(255,106,0,0.14),transparent_26%),linear-gradient(135deg,rgba(5,5,5,0.72),rgba(0,0,0,0.94))] p-5 shadow-[0_0_90px_rgba(34,197,94,0.08)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="pointer-events-none absolute left-[-120px] top-[-120px] h-72 w-72 rounded-full bg-green-500/12 blur-3xl" />
            <div className="pointer-events-none absolute bottom-[-140px] right-[-120px] h-80 w-80 rounded-full bg-orange-500/12 blur-3xl" />

            <div className="relative mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-green-300">
                  Live HT Desk
                </p>
                <h3 className="mt-1 text-3xl font-black md:text-5xl">
                  Live HT Desk
                </h3>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-zinc-500">
                  A rotating desk feed that turns signals into a live habit loop: what HT sees, how the signal is evolving, and where attention is rotating next.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                DESK PULSE LIVE
              </div>
            </div>

            <div className="relative grid gap-4 2xl:grid-cols-[1.05fr_0.95fr]">
              <motion.div
                key={mounted ? `${activeDeskPulse?.tag}-${activeDeskPulse?.symbol}-${deskPulseIndex}` : "desk-pulse-init"}
                className="rounded-[1.85rem] border border-green-500/20 bg-black/45 p-5"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                <div className="mb-5 flex items-start justify-start gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-green-300">
                      {activeDeskPulse?.tag || "HT Desk"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <h4 className="text-6xl font-black leading-none tracking-tight text-white md:text-7xl">
                        {activeDeskPulse?.symbol || "--"}
                      </h4>
                      <span className="mb-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-200">
                        {activeDeskPulse?.state || "Scanning"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-right">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                      HT Score™
                    </p>
                    <p className="mt-2 text-4xl font-black text-green-300">
                      {activeDeskPulse?.score || "--"}
                    </p>
                  </div>
                </div>

                <p className={`text-lg font-black leading-8 ${activeDeskPulse?.tone || "text-zinc-200"}`}>
                  {activeDeskPulse?.message || "HT Desk is scanning for a clean pressure shift."}
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Top Conviction", firstSignal?.stock.symbol || "--", firstSignal?.status || "Scanning"],
                    ["Lifecycle", firstSignal?.stock ? getSignalEvolutionState(firstSignal.stock) : "Waiting", "live state"],
                    ["Next Rotation", secondaryTarget?.symbol || "--", secondaryTarget ? `${getHTScore(secondaryTarget)}/99` : "No read"],
                  ].map((item) => (
                    <div key={item[0]} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                        {item[0]}
                      </p>
                      <p className="mt-2 text-lg font-black text-white">{item[1]}</p>
                      <p className="mt-1 text-xs font-bold text-zinc-500">{item[2]}</p>
                    </div>
                  ))}
                </div>
              </motion.div>

              <div className="space-y-3">
                {liveIntelligenceFeed.map((item, index) => (
                  <motion.div
                    key={`${item.tag}-${item.symbol}`}
                    className="grid grid-cols-[88px_1fr_72px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-green-500/25 hover:bg-green-500/[0.035]"
                    initial={{ opacity: 0, x: 14 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: index * 0.05 }}
                    viewport={{ once: true }}
                  >
                    <div>
                      <p className="text-[8px] font-black uppercase tracking-[0.15em] text-zinc-600">
                        {item.tag}
                      </p>
                      <p className="mt-1 text-xl font-black text-white">{item.symbol}</p>
                    </div>

                    <div className="min-w-0">
                      <p className={`text-sm font-black ${item.tone}`}>{item.state}</p>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-zinc-500">
                        {item.message}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                        Score
                      </p>
                      <p className="mt-1 text-xl font-black text-green-300">{item.score}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="relative mt-4 grid gap-3 md:grid-cols-5">
              {htScoreLeaders.map((stock, index) => (
                <motion.div
                  key={`ht-score-${stock.symbol}`}
                  className="rounded-xl border border-white/10 bg-black/35 p-3"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: index * 0.04 }}
                  viewport={{ once: true }}
                >
                  <div className="flex items-center justify-start gap-3">
                    <p className="font-black text-white">{stock.symbol}</p>
                    <p className="text-sm font-black text-green-300">{getHTScore(stock)}</p>
                  </div>
                  <p className="mt-2 text-xs font-black text-orange-200">
                    {getSignalEvolutionState(stock)}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold leading-4 text-zinc-500">
                    {getCrowdPhase(stock)}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>


        <section id="signal-timeline" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="relative overflow-hidden rounded-[2.25rem] border border-orange-500/20 bg-[radial-gradient(circle_at_20%_20%,rgba(255,106,0,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(34,197,94,0.12),transparent_26%),linear-gradient(135deg,rgba(5,5,5,0.72),rgba(0,0,0,0.95))] p-5 shadow-[0_0_90px_rgba(255,106,0,0.10)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="pointer-events-none absolute right-[-140px] top-[-120px] h-80 w-80 rounded-full bg-orange-500/14 blur-3xl" />
            <div className="pointer-events-none absolute bottom-[-140px] left-[-120px] h-72 w-72 rounded-full bg-green-500/10 blur-3xl" />

            <div className="relative mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-300">
                  Premium Signal Core
                </p>
                <h3 className="mt-1 text-3xl font-black md:text-5xl">
                  Signal Timeline Pro
                </h3>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-zinc-500">
                  A cleaner replay-style signal path: early detection, attention pressure, crowd arrival, expansion, and risk filter — built to make HT feel like a premium live terminal.
                </p>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-xs font-black text-orange-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />
                SIGNAL STORY LIVE
              </div>
            </div>

            <div className="relative grid gap-4 2xl:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[1.85rem] border border-white/10 bg-black/40 p-5">
                <div className="space-y-3">
                  {signalTimeline.map((event, index) => (
                    <motion.div
                      key={`${event.phase}-${event.time}`}
                      className="relative grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[92px_1fr_82px] md:items-center"
                      initial={{ opacity: 0, x: -12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: index * 0.05 }}
                      viewport={{ once: true }}
                    >
                      <div className="absolute left-[25px] top-0 hidden h-full w-px bg-gradient-to-b from-orange-500/0 via-orange-500/25 to-orange-500/0 md:block" />
                      <div className="relative z-10 flex items-center gap-3 md:block">
                        <span className="inline-flex h-3 w-3 rounded-full bg-orange-400 shadow-[0_0_18px_rgba(255,106,0,0.9)]" />
                        <p className="text-xs font-black text-zinc-400 md:mt-2">{event.time}</p>
                      </div>

                      <div>
                        <p className="text-sm font-black text-orange-200">{event.phase}</p>
                        <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-green-300">
                          {event.status}
                        </p>
                        <p className="mt-2 text-xs font-semibold leading-5 text-zinc-500">
                          {event.detail}
                        </p>
                      </div>

                      <div className="text-left md:text-right">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                          Intensity
                        </p>
                        <p className="mt-1 text-2xl font-black text-white">{event.intensity}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[1.85rem] border border-green-500/15 bg-green-500/[0.035] p-5">
                  <p className="text-xs font-black uppercase tracking-[0.26em] text-green-300">
                    HT Heatmap Pro
                  </p>
                  <h4 className="mt-2 text-2xl font-black text-white">
                    Attention Radar
                  </h4>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {attentionHeatmap.map((item) => (
                      <div key={item.theme} className="rounded-xl border border-white/10 bg-black/35 p-3">
                        <div className="flex items-center justify-start gap-3">
                          <p className="text-sm font-black text-white">{item.theme}</p>
                          <p className="text-lg font-black text-green-300">{item.score}</p>
                        </div>
                        <p className="mt-2 text-xs font-black text-orange-200">{item.state}</p>
                        <p className="mt-1 text-[11px] font-semibold leading-4 text-zinc-500">
                          {item.identity} · lead: {item.leader}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.85rem] border border-orange-500/15 bg-orange-500/[0.035] p-5">
                  <p className="text-xs font-black uppercase tracking-[0.26em] text-orange-300">
                    Alert Personalities
                  </p>
                  <div className="mt-4 space-y-3">
                    {smartAlertPersonalities.map((alert) => (
                      <div key={alert.title} className="rounded-xl border border-white/10 bg-black/35 p-3">
                        <div className="flex items-center justify-start gap-3">
                          <p className={`text-sm font-black ${alert.tone}`}>{alert.title}</p>
                          <p className="text-sm font-black text-white">{alert.symbol}</p>
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-5 text-zinc-500">{alert.copy}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="market-narrative" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="rounded-[1.5rem] border border-green-500/20 bg-zinc-950/75 p-5 shadow-[0_0_70px_rgba(34,197,94,0.07)] backdrop-blur-xl ht-compact-shell"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
                  {signalReplaySpotlight.symbol} Live Read Feed
                </p>
                <h3 className="mt-1 text-4xl font-black">
                  Live Desk Read
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  A tighter trading-desk style feed that explains what changed,
                  what matters, and where attention is rotating.
                </p>
              </div>

              <div className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                DESK LIVE
              </div>
            </div>

            <div className="grid gap-4 2xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[1.75rem] border border-white/10 bg-black/35 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-green-400">
                  AI Market Read
                </p>

                <h4 className="mt-3 text-3xl font-black leading-tight text-white">
                  {getMarketNarrativeHeadline()}
                </h4>

                <p className="mt-4 text-sm font-bold leading-7 text-zinc-300">
                  {getMarketNarrativeBody()}
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Priority", priorityTarget?.symbol || "--", "text-orange-300"],
                    ["Pulse", marketPulse, "text-white"],
                    ["Hot", hotStocks.length, "text-white"],
                  ].map((item) => (
                    <div
                      key={item[0]}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        {item[0]}
                      </p>
                      <p className={`mt-2 text-2xl font-black ${item[2]}`}>
                        {item[1]}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-black/35 p-5">
                <div className="mb-4 flex items-center justify-start gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                      Live AI Commentary
                    </p>
                    <h4 className="mt-1 text-2xl font-black text-white">
                      Trading Desk Feed
                    </h4>
                  </div>
                  <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300">
                    UPDATING
                  </span>
                </div>

                <div className="space-y-3">
                  {liveDeskFeed.map((item, index) => (
                    <motion.div
                      key={`${item.tag}-${index}`}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                      initial={{ opacity: 0, x: 12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.35, delay: index * 0.06 }}
                      viewport={{ once: true }}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-400" />
                        <div>
                          <p className={`text-xs font-black uppercase tracking-[0.2em] ${item.tone}`}>
                            {item.tag}
                          </p>
                          <p className="mt-1 text-sm font-bold leading-6 text-zinc-200">
                            {item.message}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-5 py-6">
          <div className="mb-5 text-center">
            <p className="text-sm font-black uppercase tracking-[0.25em] text-orange-500">
              Why Traders Choose HT Labs
            </p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">
              Built for Traders. Backed by AI.
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-5">
            {[
              [
                "⚡",
                "Daily Trader OS",
                "Open with a clear briefing on focus, risk, and strongest setups.",
              ],
              [
                "🧠",
                "Pressure Quality",
                "Grade momentum setups by confidence, crowd strength, risk, and AI bias.",
              ],
              [
                "🎯",
                "Smart Ranking",
                "Rank tickers by momentum, volatility, and attention pressure.",
              ],
              [
                "🔔",
                "Cloud Watchlists",
                "Sync favorite tickers and setup context across your workflow.",
              ],
              [
                "🛡️",
                "Risk Labels",
                "Quickly spot volatility, crowding, and chase risk before entering.",
              ],
            ].map((feature, index) => (
              <motion.div
                key={feature[1]}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                viewport={{ once: true }}
                whileHover={{ y: -6, scale: 1.02 }}
                className="rounded-[1.75rem] border border-white/10 bg-zinc-950/70 p-5 transition hover:border-orange-500/35 hover:shadow-[0_0_40px_rgba(255,106,0,0.12)]"
              >
                <div className="mb-5 inline-flex rounded-2xl bg-orange-500/10 p-4 text-2xl text-orange-400">
                  {feature[0]}
                </div>
                <h3 className="font-black">{feature[1]}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-500">
                  {feature[2]}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-5">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-start">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                Market Psychology Layer
              </p>
              <h3 className="text-3xl font-black">Catalyst Intelligence</h3>
              <p className="mt-2 text-sm text-zinc-500">
                Catalyst, sentiment, and setup intelligence built to help
                traders spot attention before the move gets crowded.
              </p>
            </div>
            <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-xs font-black text-orange-300">
              Product Mode: HT Labs Operating System
            </div>
          </div>

          <div className="grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
            <motion.div
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true }}
              className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 ht-compact-shell"
            >
              <div className="mb-4 flex items-center justify-start">
                <p className="font-black">Catalyst Radar</p>
                <span className="rounded-full border border-orange-500/20 px-3 py-1 text-xs font-black text-orange-400">
                  LIVE CATALYSTS
                </span>
              </div>

              <div className="space-y-3">
                {(() => {
                  const liveCatalysts = stocks
                    .filter(s => Math.abs(s.change) >= 1)
                    .sort((a, b) => getHTScore(b) - getHTScore(a))
                    .slice(0, 3)
                    .map(s => {
                      const rvol = getRelativeVolume(s);
                      const ht = getHTScore(s);
                      const pattern = detectPatternSignal(s).name;
                      const isDown = s.change < 0;
                      const impact: "High" | "Medium" | "Watch" =
                        ht >= 85 && rvol >= 3 ? "High" :
                        ht >= 70 && rvol >= 2 ? "Medium" : "Watch";
                      const title =
                        pattern === "Quiet Accumulation" ? "Early Accumulation Signal" :
                        pattern === "Crowd Ignition" ? "Crowd Attention Spike" :
                        pattern === "Continuation Stack" ? "Momentum Continuation" :
                        pattern === "Exhaustion Risk" ? "Exhaustion Watch" :
                        pattern === "Pressure Coil" ? "Pressure Building" :
                        isDown ? "Recovery Watch" :
                        rvol >= 4 ? "Unusual Volume Activity" :
                        s.change >= 5 ? "Strong Momentum Day" : "Active Setup Watch";
                      const note = getCatalystStrength(s) + ". " + (getNewsArticles(s.symbol)[0]?.headline || `${s.symbol} is showing ${rvol.toFixed(1)}x relative volume. HT is monitoring whether crowd interest becomes durable participation.`);
                      return { symbol: s.symbol, title, impact, note };
                    });
                  return liveCatalysts.map((item) => (
                    <div
                      key={`${item.symbol}-${item.title}`}
                      className="rounded-xl border border-white/10 bg-black/35 p-3"
                    >
                      <div className="flex items-start justify-start gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-orange-400">{item.symbol}</p>
                          <h4 className="mt-1 font-black">{item.title}</h4>
                          <p className="mt-2 text-sm leading-6 text-zinc-500">{item.note}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${
                          item.impact === "High" ? "bg-orange-500 text-white" :
                          item.impact === "Medium" ? "bg-orange-500/15 text-orange-300" :
                          "bg-white/10 text-zinc-300"
                        }`}>
                          {item.impact}
                        </span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08 }}
              viewport={{ once: true }}
              className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 ht-compact-shell"
            >
              <div className="mb-4 flex items-center justify-start">
                <p className="font-black">Social Heat</p>
                <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-black text-green-400">
                  ATTENTION FLOW
                </span>
              </div>

              <div className="space-y-3">
                {(() => {
                  const liveHeat = stocks
                    .filter(s => s.change > 0)
                    .sort((a, b) => getRelativeVolume(b) - getRelativeVolume(a))
                    .slice(0, 4)
                    .map(s => {
                      const rvol = getRelativeVolume(s);
                      const attention = getAttentionScore(s);
                      const sentiment =
                        rvol >= 5 ? "Explosive" :
                        rvol >= 3.5 ? "Surging" :
                        rvol >= 2.5 ? "Accelerating" :
                        attention >= 80 ? "Accumulating" :
                        attention >= 65 ? "Building" :
                        "Watching";
                      const mentionPct = `+${Math.round(rvol * 45 + attention * 0.8)}%`;
                      return { symbol: s.symbol, sentiment, mentions: mentionPct, score: Math.min(99, Math.round(attention * 0.6 + rvol * 8)) };
                    });
                  return liveHeat.map((signal) => (
                    <div
                      key={signal.symbol}
                      className="rounded-xl border border-white/10 bg-black/35 p-3"
                    >
                      <div className="flex items-center justify-start">
                        <div>
                          <p className="text-lg font-black">{signal.symbol}</p>
                          <p className="text-xs text-zinc-500">{signal.sentiment}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-green-400">{signal.mentions}</p>
                          <p className="text-xs text-zinc-500">mentions</p>
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-orange-600 to-orange-400"
                          style={{ width: `${signal.score}%` }}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 ht-compact-shell">
              <div className="flex items-center justify-start gap-3">
                <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                  Top Movers
                </p>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Live Rank
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {topMovers.map((stock, index) => (
                  <motion.button
                    key={`mover-${stock.symbol}`}
                    onClick={() => openAiModal(stock)}
                    className="group flex w-full items-center justify-start rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-left transition hover:border-orange-500/30 hover:bg-orange-500/10"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-zinc-500">#{index + 1}</span>
                      <div>
                        <span className="font-black text-white">{stock.symbol}</span>
                        <p className="text-xs font-bold text-zinc-500">
                          {getRiskLabel(stock)} · Score {getConvictionScore(stock)}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`font-black ${
                          stock.change >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {stock.change >= 0 ? "+" : ""}
                        {stock.change.toFixed(2)}%
                      </span>
                      <p className="text-xs text-zinc-500">${Number(stock.price || 0).toFixed(2)}</p>
                    </div>
                  </motion.button>
                ))}

                {topMovers.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-500">
                    Scanner warming up. Movers will populate automatically.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 ht-compact-shell">
              <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                Trade Discipline
              </p>
              <div className="mt-4 space-y-3">
                {[
                  "No chase entries on vertical candles",
                  "Wait for VWAP reclaim or higher-low setup",
                  "Small size on extreme volatility names",
                ].map((rule, index) => (
                  <div
                    key={rule}
                    className="flex gap-3 rounded-2xl bg-white/[0.03] p-4 text-sm text-zinc-300"
                  >
                    <span className="font-black text-orange-400">
                      0{index + 1}
                    </span>
                    <span>{rule}</span>
                  </div>
                ))}
                {topLosers[0] && (
                  <div className="rounded-2xl border border-red-500/10 bg-red-500/5 p-4 text-sm text-zinc-300">
                    Weakest tape:{" "}
                    <span className="font-black text-red-400">
                      {topLosers[0].symbol}
                    </span>{" "}
                    {topLosers[0].change.toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-5 px-5 py-8 2xl:grid-cols-3">
          <motion.div
            className="rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl 2xl:col-span-2 ht-compact-shell"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-4 flex items-center justify-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  Pressure Alert Feed
                </p>
                <h3 className="mt-1 text-2xl font-black">Live Setup Alerts</h3>
              </div>
              <span className="rounded-full bg-green-500/15 px-3 py-2 text-xs font-black text-green-400">
                ACTIVE
              </span>
            </div>

            <div className="space-y-3">
              {alertFeed.map((alert) => (
                <div
                  key={`${alert.symbol}-${alert.time}`}
                  className="flex items-center justify-start gap-4 rounded-2xl border border-white/10 bg-black/35 p-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-400">
                        {alert.symbol}
                      </p>
                      <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-1 text-[10px] font-black text-green-400">
                        {alert.trend}
                      </span>
                    </div>
                    <p className="mt-2 font-black text-white">
                      {alert.message}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <p className="text-xs text-zinc-500">{alert.time}</p>

                      <button
                        onClick={() => dismissAlert(alert.symbol)}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-black text-zinc-400 transition hover:border-orange-500/30 hover:text-orange-300"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                      {alert.level}
                    </span>
                    <p className="mt-2 text-xs font-black text-zinc-400">
                      {alert.score}/99 · {alert.grade}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            className="rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl ht-compact-shell"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            viewport={{ once: true }}
          >
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                Sector Heat
              </p>
              <h3 className="mt-1 text-2xl font-black">Hot Themes</h3>
            </div>

            <div className="space-y-4">
              {[
                ["AI / Semis", 92],
                ["Quantum", 86],
                ["Crypto Beta", 74],
                ["Small-Cap Attention Spike", 88],
              ].map((sector) => (
                <div key={sector[0]}>
                  <div className="mb-2 flex items-center justify-start text-sm">
                    <span className="font-black text-white">{sector[0]}</span>
                    <span className="font-black text-orange-300">
                      {sector[1]}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-700 to-orange-400"
                      style={{ width: `${sector[1]}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-5">
          <div className="grid gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
            <motion.div
              className="rounded-[1.5rem] border border-green-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl ht-compact-shell"
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              viewport={{ once: true }}
            >
              <div className="mb-5 flex items-center justify-start gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
                    Smart Pressure Alerts
                  </p>
                  <h3 className="mt-1 text-3xl font-black">AI Alert Engine</h3>
                  <p className="mt-2 text-sm text-zinc-500">
                    Alerts generated from pressure score, catalyst presence,
                    momentum pressure, and risk profile.
                  </p>
                </div>

                <span className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                  LIVE
                </span>
              </div>

              <div className="space-y-3">
                {alertFeed.slice(0, 4).map((alert) => (
                  <div
                    key={`engine-${alert.symbol}-${alert.time}`}
                    className="rounded-xl border border-white/10 bg-black/35 p-3"
                  >
                    <div className="flex items-start justify-start gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-black uppercase tracking-[0.25em] text-green-400">
                            {alert.symbol}
                          </p>
                          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-zinc-300">
                            {alert.trend}
                          </span>
                        </div>

                        <p className="mt-2 text-sm font-black leading-6 text-white">
                          {alert.message}
                        </p>
                      </div>

                      <div className="shrink-0 rounded-2xl border border-green-500/15 bg-green-500/10 px-4 py-3 text-right">
                        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                          Score
                        </p>
                        <p className="mt-1 text-2xl font-black text-green-300">
                          {alert.score}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl ht-compact-shell"
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              viewport={{ once: true }}
            >
              <div className="mb-5">
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  Watchlist Intelligence
                </p>
                <h3 className="mt-1 text-2xl font-black">
                  Saved Setup Monitor
                </h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Your saved symbols become the personal alert layer.
                </p>
              </div>

              <div className="space-y-3">
                {(watchlist.length ? watchlist : ["Add tickers"]).map(
                  (symbol) => {
                    const savedStock = stocks.find(
                      (stock) => stock.symbol === symbol,
                    );

                    return (
                      <div
                        key={`watch-intel-${symbol}`}
                        className="rounded-xl border border-white/10 bg-black/35 p-3"
                      >
                        {savedStock ? (
                          <div className="flex items-center justify-start gap-3">
                            <div>
                              <p className="font-black text-white">
                                {savedStock.symbol}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {getAlertMessage(savedStock)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-orange-300">
                                {getSetupScore(savedStock)}/99
                              </p>
                              <p className="text-xs text-zinc-500">
                                {getScoreTrend(savedStock)}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-zinc-500">
                            Star tickers in the scanner to activate personal
                            alerts.
                          </p>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </motion.div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl ht-compact-shell"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  Real News Engine
                </p>
                <h3 className="mt-1 text-3xl font-black">Latest Catalysts</h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Headlines, volume shifts, and attention signals translated into watchable context.
                </p>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {topMovers.slice(0, 6).map((stock) => (
                    <div key={`catalyst-read-${stock.symbol}`} className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.28em] text-orange-300">{stock.symbol}</p>
                        <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200">
                          {getCatalystBadge(stock)}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-white">{getCatalystFallbackTitle(stock)}</h3>
                      <p className="mt-2 text-sm font-semibold leading-6 text-zinc-400">{getCatalystFallbackBody(stock)}</p>
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs font-bold text-zinc-300">
                        Next: {getCatalystWatchNext(stock)}
                      </div>
                    </div>
                  ))}
                </div>

              </div>

              <span className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                LIVE + HT READ
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {stocks.slice(0, 6).map((stock) => {
                const item = getTopNews(stock.symbol);

                return (
                  <div
                    key={`news-${stock.symbol}`}
                    className="rounded-xl border border-white/10 bg-black/35 p-3"
                  >
                    <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-400">
                      {stock.symbol}
                    </p>

                    {item ? (
                      <>
                        <h4 className="mt-2 text-sm font-black leading-5 text-white">
                          {item.headline}
                        </h4>
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-500">
                          {item.summary || "No summary available yet."}
                        </p>
                        <p className="mt-3 text-xs text-zinc-600">
                          {item.source || "News source"}
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-zinc-500">
                        No recent catalyst found yet. HT Labs will keep
                        scanning.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </section>

        <section id="watchlist" className="mx-auto max-w-7xl px-5 py-5">
          <motion.div
            className="rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl ht-compact-shell"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-4 flex items-center justify-start">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                  Watchlist
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Logged-in traders can sync watchlists across devices with
                  Supabase cloud storage.
                </p>

                {session && (
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.2em] text-green-400">
                    Cloud Session Active
                  </p>
                )}

                {cloudSyncMessage && (
                  <p className="mt-2 text-xs text-orange-300">
                    {cloudSyncMessage}
                  </p>
                )}
              </div>

              <p className="rounded-full bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-400">
                {watchlist.length} saved
              </p>
            </div>

            {watchlist.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-500">
                No saved tickers yet. Add one below or tap a star on any card.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {watchlist.map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => toggleWatchlist(symbol)}
                    className="rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-sm font-black text-orange-300 transition hover:bg-orange-500/20"
                  >
                    ⭐ {symbol}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        </section>

        <section id="scanner" className="mx-auto max-w-7xl px-5 py-5 pb-16">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-start">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                Scanner
              </p>
              <h3 className="text-3xl font-black">Ranked Attention Spike Feed</h3>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-green-500/15 bg-green-500/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-green-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                Premium scan mode
              </div>
              <p className="mt-2 text-sm text-zinc-500">
                Auto-refreshes every 8 seconds.
              </p>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Add ticker, ex: PLTR"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addTicker();
                  }
                }}
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-4 text-sm outline-none transition placeholder:text-zinc-700 focus:border-orange-500 focus:shadow-[0_0_25px_rgba(255,106,0,0.18)] md:w-80"
              />

              <motion.button
                onClick={addTicker}
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 text-sm font-black text-white shadow-[0_0_25px_rgba(255,106,0,0.25)] transition"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Add
              </motion.button>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {scannerFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setScannerFilter(filter.value)}
                className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                  scannerFilter === filter.value
                    ? "border-orange-500 bg-orange-500 text-white"
                    : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-orange-500/40 hover:text-orange-300"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredStocks.map((stock, index) => {
              const isBullish = stock.change >= 0;
              const isHot = Math.abs(stock.change) > 4;
              const score = getHTScore(stock);
              const confidence = getConfidence(stock);
              const riskLabel = getRiskLabel(stock);

              return (
                <motion.div
                  key={stock.symbol}
                  initial={{ opacity: 0, y: 25 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: index * 0.05 }}
                  viewport={{ once: true }}
                  whileHover={{ y: -6, scale: 1.015 }}
                  className="group relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 shadow-xl shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-orange-500/35 hover:bg-zinc-950/90 hover:shadow-[0_0_40px_rgba(255,106,0,0.12)] ht-compact-shell"
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/80 to-transparent" />

                  <div className="mb-5 flex items-start justify-start">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 text-sm font-black text-orange-400">
                        #{index + 1}
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                          Attention Spike
                        </p>

                        <h2 className="text-3xl font-black">{stock.symbol}</h2>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleWatchlist(stock.symbol)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:bg-orange-500/10"
                    >
                      {watchlist.includes(stock.symbol) ? "⭐" : "☆"}
                    </button>
                  </div>

                  <div className="mb-5 flex flex-wrap gap-2">
                    <div
                      className={`rounded-full px-3 py-1 text-xs font-black ${
                        isBullish
                          ? "bg-green-500/15 text-green-400"
                          : "bg-red-500/15 text-red-400"
                      }`}
                    >
                      {isBullish ? "BULLISH" : "BEARISH"}
                    </div>

                    {isHot && (
                      <div className="rounded-full bg-orange-500 px-3 py-1 text-xs font-black text-white shadow-lg shadow-orange-500/30">
                        HOT MOVER
                      </div>
                    )}

                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-zinc-400">
                      {riskLabel}
                    </div>

                    <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                      SCORE {score}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-zinc-500">Current Price</p>

                    <h3 className="mt-1 text-4xl font-black">
                      ${Number(stock.price || 0).toFixed(2)}
                    </h3>

                    <p
                      className={`mt-2 text-xl font-black ${
                        isBullish ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {isBullish ? "+" : ""}
                      {Number(stock.change || 0).toFixed(2)}%
                    </p>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center justify-start">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                        Crowd Pressure
                      </p>
                      <p className="text-sm font-black text-orange-300">
                        {confidence}%
                      </p>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-700 to-orange-400"
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-gradient-to-r from-orange-500/5 to-orange-900/5 p-3">
                    <MiniStockChart
                      symbol={stock.symbol}
                      price={stock.price}
                      change={stock.change}
                    />
                  </div>

                  <div className="mt-4 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                    <div className="flex items-center justify-start gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                        Signal Strength
                      </p>
                      <p className="text-xs font-black text-green-300">
                        {getSignalGrade(stock)}
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          RVOL
                        </p>
                        <p className="mt-1 text-sm font-black text-white">
                          {getRelativeVolume(stock)}x
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          Gap
                        </p>
                        <p className="mt-1 text-sm font-black text-white">
                          {getGapSignal(stock)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          Flow
                        </p>
                        <p className="mt-1 text-sm font-black text-white">
                          {getVolumeAcceleration(stock)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-orange-500/10 bg-orange-500/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                      Why It&apos;s Moving
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {getWhyMoving(stock)}
                    </p>
                  </div>

                  {getTopNews(stock.symbol) && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="mb-2 flex items-center justify-start gap-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                          Live Catalyst
                        </p>
                        <span className="rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-black uppercase text-green-400">
                          News
                        </span>
                      </div>

                      <h4 className="text-sm font-black leading-5 text-white">
                        {getTopNews(stock.symbol)?.headline}
                      </h4>

                      {getTopNews(stock.symbol)?.summary && (
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">
                          {getTopNews(stock.symbol)?.summary}
                        </p>
                      )}

                      <p className="mt-2 text-xs text-zinc-600">
                        {getTopNews(stock.symbol)?.source || "Market news"}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 rounded-2xl border border-green-500/10 bg-green-500/[0.03] p-4">
                    <div className="flex items-center justify-start gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                        Setup Snapshot
                      </p>

                      <div className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-black text-green-300">
                        {getSetupGrade(getSetupScore(stock))} · {getSetupScore(stock)}/99
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                          Crowd
                        </p>
                        <p className="mt-1 text-xs font-black text-white">
                          {getCrowdStrength(stock)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                          Risk
                        </p>
                        <p className="mt-1 text-xs font-black text-white">
                          {getRiskProfile(stock)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                          Bias
                        </p>
                        <p className="mt-1 text-xs font-black text-white">
                          {getMomentumConfidence(getSetupScore(stock))}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                      AI Trade Plan
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {getTradePlan(stock)}
                    </p>
                  </div>

                  <button
                    onClick={() => toggleSavedSetup(stock.symbol)}
                    className={`mt-6 w-full rounded-2xl border px-4 py-3 text-sm font-black transition ${
                      savedSetups.includes(stock.symbol)
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
                    }`}
                  >
                    {savedSetups.includes(stock.symbol)
                      ? "Saved Setup ✓"
                      : "Save Setup"}
                  </button>

                  <motion.button
                    onClick={() => openAiModal(stock)}
                    disabled={aiLoading}
                    className="mt-3 w-full rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 py-4 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition disabled:opacity-50"
                    whileHover={{ scale: aiLoading ? 1 : 1.02 }}
                    whileTap={{ scale: aiLoading ? 1 : 0.97 }}
                  >
                    {aiLoading && selectedStock?.symbol === stock.symbol
                      ? "Analyzing..."
                      : "View AI Setup"}
                  </motion.button>
                </motion.div>
              );
            })}

            {stocks.length === 0 &&
              [1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="rounded-[1.5rem] border border-white/10 bg-zinc-950/70 p-5 ht-compact-shell"
                >
                  <div className="h-5 w-24 animate-pulse rounded bg-white/10" />
                  <div className="mt-4 h-10 w-32 animate-pulse rounded bg-white/10" />
                  <div className="mt-6 h-28 animate-pulse rounded-2xl bg-white/10" />
                </div>
              ))}
          </div>
        </section>

        <footer className="border-t border-orange-500/10 bg-black/60 px-5 py-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-start">
            <img src="/logo.png" alt="HT Labs" className="h-12 w-auto" />

            <p className="text-sm text-zinc-500">
              Track live momentum, catalysts, daily briefings, relative volume,
              signal quality, attention flow, saved AI setups, smart alerts, and
              cloud watchlists in real time. Signals are educational research tools, not financial advice.
            </p>
          </div>
        </footer>

        {selectedStock && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-6 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-orange-500/25 bg-zinc-950/95 shadow-2xl shadow-orange-500/15 ht-compact-shell"
              initial={{ opacity: 0, scale: 0.94, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="border-b border-white/10 bg-gradient-to-r from-orange-500/10 via-white/[0.03] to-transparent p-5">
                <div className="flex items-center justify-start">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                      HT LABS AI SETUP
                    </p>

                    <h2 className="mt-1 text-3xl font-black text-white">
                      {selectedStock.symbol}
                    </h2>
                  </div>

                  <button
                    onClick={() => setSelectedStock(null)}
                    className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/70 transition hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="max-h-[78vh] overflow-y-auto p-5">
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-zinc-500">Price</p>

                    <p className="mt-1 text-2xl font-black text-white">
                      ${Number(selectedStock.price || 0).toFixed(2)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-zinc-500">Attention Spike</p>

                    <p
                      className={`mt-1 text-2xl font-black ${
                        selectedStock.change >= 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {selectedStock.change >= 0 ? "+" : ""}
                      {Number(selectedStock.change || 0).toFixed(2)}%
                    </p>
                  </div>
                </div>

                <div className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-4">
                  <div className="flex items-center justify-start">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                        Attention Spike Score
                      </p>
                      <p className="mt-2 text-4xl font-black text-orange-300">
                        {getMomentumScore(selectedStock)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Confidence
                      </p>
                      <p className="mt-2 text-3xl font-black text-white">
                        {getConfidence(selectedStock)}%
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-bold text-zinc-400">
                    {selectedStock.change >= 0
                      ? "Bullish setup"
                      : "Bearish setup"}{" "}
                    • {getRiskLabel(selectedStock)}
                  </p>
                </div>

                <div className="mb-4 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                  <div className="flex items-center justify-start gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-green-400">
                        AI Setup Intelligence
                      </p>
                      <p className="mt-2 text-4xl font-black text-green-300">
                        {getSetupScore(selectedStock)}/99
                      </p>
                    </div>

                    <div className="rounded-2xl border border-green-500/15 bg-black/30 px-4 py-3 text-right">
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Grade
                      </p>
                      <p className="mt-1 text-3xl font-black text-white">
                        {getSetupGrade(getSetupScore(selectedStock))}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Confidence
                      </p>
                      <p className="mt-2 text-sm font-black text-white">
                        {getMomentumConfidence(getSetupScore(selectedStock))}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Crowd
                      </p>
                      <p className="mt-2 text-sm font-black text-white">
                        {getCrowdStrength(selectedStock)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Risk
                      </p>
                      <p className="mt-2 text-sm font-black text-white">
                        {getRiskProfile(selectedStock)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        AI Bias
                      </p>
                      <p className="mt-2 text-sm font-black leading-5 text-white">
                        {getAIBias(selectedStock)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                    Why It&apos;s Moving
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {getWhyMoving(selectedStock)}
                  </p>
                </div>

                {getTopNews(selectedStock.symbol) && (
                  <div className="mb-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                      Selected Live Catalyst
                    </p>
                    <h4 className="mt-2 text-sm font-black text-white">
                      {getTopNews(selectedStock.symbol)?.headline}
                    </h4>
                    {getTopNews(selectedStock.symbol)?.summary && (
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        {getTopNews(selectedStock.symbol)?.summary}
                      </p>
                    )}
                  </div>
                )}

                <div className="mb-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                    Suggested Trade Plan
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {getTradePlan(selectedStock)}
                  </p>
                </div>

                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Confirmation", getConfirmationTrigger(selectedStock)],
                    ["Invalidation", getInvalidationRule(selectedStock)],
                    ["Trader Fit", getBestTraderFit(selectedStock)],
                  ].map((item) => (
                    <div
                      key={item[0]}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        {item[0]}
                      </p>
                      <p className="mt-2 text-xs font-bold leading-5 text-white">
                        {item[1]}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-orange-500/15 bg-orange-500/[0.03] p-4">
                  {aiLoading && (
                    <div className="space-y-3">
                      <div className="h-4 w-32 animate-pulse rounded bg-orange-400/20"></div>
                      <div className="h-3 w-full animate-pulse rounded bg-white/10"></div>
                      <div className="h-3 w-5/6 animate-pulse rounded bg-white/10"></div>
                      <div className="h-3 w-2/3 animate-pulse rounded bg-white/10"></div>

                      <p className="pt-2 text-sm font-semibold text-orange-300">
                        HT Labs AI is analyzing this setup...
                      </p>
                    </div>
                  )}

                  {!aiLoading && aiError && (
                    <div>
                      <p className="text-sm font-black text-red-400">
                        AI Error
                      </p>

                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        {aiError}
                      </p>
                    </div>
                  )}

                  {!aiLoading && !aiError && aiAnalysis && (
                    <div>
                      <p className="mb-3 text-xs uppercase tracking-[0.25em] text-orange-400">
                        HT Labs Analysis
                      </p>

                      <div className="max-h-[420px] overflow-y-auto pr-1">
                        <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">
                          {aiAnalysis}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-start border-t border-white/10 pt-4">
                  <p className="text-xs text-zinc-500">Powered by HT Labs AI</p>

                  <motion.button
                    onClick={() => setSelectedStock(null)}
                    className="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-black text-white transition"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    Done
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </div>

      {/* HT ALERT DRAWER */}
      {alertsOpen && (
        <div className="fixed inset-0 z-[300] flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setAlertsOpen(false)} />

          {/* Drawer */}
          <div className="w-full max-w-md bg-[#04080b] border-l border-white/10 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-sm font-black text-white">HT Alerts</p>
                <p className="text-[10px] font-semibold text-zinc-500 mt-0.5">
                  {alerts.length === 0 ? "No alerts yet — HT is scanning" : `${alerts.length} signal${alerts.length !== 1 ? "s" : ""} detected`}
                </p>
              </div>
              <button onClick={() => setAlertsOpen(false)} className="text-zinc-500 hover:text-white text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                  <p className="text-4xl">🔍</p>
                  <p className="text-sm font-black text-white">HT is scanning</p>
                  <p className="text-xs font-semibold text-zinc-500">Alerts fire automatically when HT detects early momentum, high conviction setups, or recovery signals.</p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <button
                    key={alert.id}
                    onClick={() => {
                      const s = stocks.find(st => st.symbol === alert.ticker);
                      if (s) setSelectedStock(s);
                      setAlertsOpen(false);
                    }}
                    className={`w-full rounded-2xl border p-4 text-left transition hover:border-orange-400/30 ${
                      alert.type === "before_crowd" ? "border-cyan-400/20 bg-cyan-500/[0.04]" :
                      alert.type === "momentum" ? "border-orange-400/20 bg-orange-500/[0.04]" :
                      alert.type === "recovery" ? "border-green-400/15 bg-green-500/[0.04]" :
                      "border-purple-400/20 bg-purple-500/[0.04]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-black text-white">{alert.title}</p>
                      <span className="shrink-0 text-[10px] font-black text-zinc-500">
                        {alert.timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300">{alert.message}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${
                        alert.type === "before_crowd" ? "bg-cyan-500/10 text-cyan-300" :
                        alert.type === "momentum" ? "bg-orange-500/10 text-orange-300" :
                        alert.type === "recovery" ? "bg-green-500/10 text-green-300" :
                        "bg-purple-500/10 text-purple-300"
                      }`}>
                        {alert.confidence}% confidence
                      </span>
                      <span className="text-[10px] font-semibold text-zinc-600">Tap to view full read →</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-white/10 px-5 py-3">
              <p className="text-[10px] font-semibold text-zinc-600">Alerts update every 30 seconds as HT scans the market.</p>
            </div>
          </div>
        </div>
      )}

      {/* ============================================
          MOBILE EXPERIENCE — completely separate UI
          Hidden on desktop, full screen on mobile
          ============================================ */}
      <div className="md:hidden fixed inset-0 bg-[#050505] text-white flex flex-col z-[200]">

          {/* Mobile Header */}
          <div className="flex-shrink-0 border-b border-white/10 bg-black/80 backdrop-blur-xl px-4 pt-safe">
            <div className="flex items-center justify-between gap-3 py-3">
              <img src="/logo.png" alt="HT Labs" className="h-8 w-auto" />
              <div className="flex-1 mx-3">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2">
                  <span className="text-zinc-600 text-sm">⌕</span>
                  <input
                    type="text"
                    placeholder="Search ticker..."
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter") { handleTickerSearch(); setMobileTab("home"); } }}
                    className="flex-1 bg-transparent text-sm font-black uppercase text-white outline-none placeholder:normal-case placeholder:font-normal placeholder:text-zinc-600"
                  />
                  {ticker.length > 0 && (
                    <button
                      onClick={() => { handleTickerSearch(); setMobileTab("home"); }}
                      className="shrink-0 rounded-lg bg-violet-500/20 border border-violet-400/30 px-2.5 py-1 text-[10px] font-black text-violet-300"
                    >
                      GO
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-green-400">Live</span>
              </div>
            </div>
          </div>

          {/* Mobile content area */}
          <div className="flex-1 overflow-hidden relative">

            {/* HOME TAB — Before The Crowd + Swipeable conviction cards */}
            {mobileTab === "home" && (() => {
              // Show mobile skeleton on first load — same gate as desktop
              if (!lastUpdated) return (
                <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4 animate-pulse">
                  <div className="rounded-2xl border border-white/8 bg-black overflow-hidden">
                    <div className="px-5 pt-4 pb-0 flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-violet-400/40" />
                      <div className="h-2 w-28 rounded-full bg-white/8" />
                    </div>
                    <div className="px-5 pt-3 pb-2">
                      <div className="h-12 w-32 rounded-xl bg-white/6" />
                    </div>
                    <div className="px-5 pb-4 border-b border-white/8">
                      <div className="h-7 w-48 rounded-xl bg-white/6 mb-1.5" />
                      <div className="h-3 w-56 rounded-full bg-white/6" />
                    </div>
                    <div className="px-5 py-5 border-b border-white/8 space-y-3">
                      <div className="h-2 w-32 rounded-full bg-white/8" />
                      <div className="h-[3px] w-full rounded-full bg-white/6" />
                      <div className="flex justify-between">
                        <div className="h-8 w-12 rounded-lg bg-white/6" />
                        <div className="flex gap-4">
                          <div className="h-8 w-12 rounded-lg bg-white/6" />
                          <div className="h-8 w-12 rounded-lg bg-white/6" />
                          <div className="h-8 w-12 rounded-lg bg-white/6" />
                        </div>
                      </div>
                    </div>
                    <div className="px-5 py-4 border-b border-white/8 space-y-2">
                      <div className="h-2 w-40 rounded-full bg-white/8" />
                      <div className="h-3 w-full rounded-full bg-white/6" />
                      <div className="h-3 w-4/5 rounded-full bg-white/6" />
                      <div className="h-3 w-3/4 rounded-full bg-white/6" />
                    </div>
                    <div className="px-5 py-4 flex gap-2">
                      <div className="flex-1 h-10 rounded-xl bg-white/6" />
                      <div className="h-10 w-12 rounded-xl bg-white/6" />
                    </div>
                  </div>
                </div>
              );

              const mobileCards = convictionLeaders.slice(0, 8).filter(Boolean);
              const current = mobileCards[mobileCardIndex];
              if (!current) return (
                <div className="flex h-full items-center justify-center">
                  <p className="text-zinc-500 font-bold">Scanning market...</p>
                </div>
              );
              // Before The Crowd data
              // stocks[] is now fully enriched with Polygon data from ht_signals
              // ── Mobile Before The Crowd — same data source as desktop.
              // Uses resolvedBeforeCrowdTarget (the same HT Score + Stage
              // eligible candidate the desktop shows) so both surfaces always
              // show the same ticker, same score, same conviction tier.
              const mobileBtcTarget = resolvedBeforeCrowdTarget;
              const mobileApiHero = apiMomentum && mobileBtcTarget?.symbol === apiMomentum.ticker ? apiMomentum : null;
              const mobileBtcEngine = mobileBtcTarget && !mobileApiHero ? getBackgroundOpportunityEngine(mobileBtcTarget) : null;
              const mobileBtcScore = Number(mobileApiHero?.opportunityScore ?? mobileApiHero?.confidence ?? (mobileBtcTarget ? getHTScore(mobileBtcTarget) : 0));
              const mobileMomentumEndurance = mobileBtcTarget ? evaluateMomentumEndurance(mobileBtcTarget) : 75;
              const mobileBtcTier = mobileApiHero?._convictionTier ?? mobileApiHero?.stage ?? getMomentumEnduranceLabel(mobileMomentumEndurance, mobileBtcScore);
              const mobileBtcStageScore = Number(mobileApiHero?.attentionScore ?? mobileBtcEngine?.crowdSaturationScore ?? 0);
              const mobileBtcStageLabel = mobileApiHero?.freshnessLabel === "Last Verified Signal"
                ? "Last Verified Signal"
                : mobileBtcStageScore <= 35 ? "Early" : mobileBtcStageScore <= 60 ? "Developing" : mobileBtcStageScore <= 80 ? "Crowded" : "Exhausted";
              const mobileSaturation = mobileBtcStageScore;
              const mobileRvol = Number(mobileApiHero?.relativeVolume ?? (mobileBtcTarget ? getRelativeVolume(mobileBtcTarget) : 0));
              const mobileHceCategory = mobileApiHero?.catalystTags?.[0] ?? (mobileBtcTarget ? getHCECategory(mobileBtcTarget) : null);
              const mobileIsCatalyst = Boolean((mobileApiHero?.catalystScore ?? 0) >= 20 || mobileHceCategory);
              const mobileSelectionLabel = mobileApiHero?.freshnessLabel === "Last Verified Signal"
                ? "Last Trading Session"
                : mobileHceCategory ?? ((mobileBtcTarget?.change ?? 0) >= 3 ? "Momentum Leader" : mobileApiHero?.stage ?? "Verified Setup");
              const mobileHeroTicker = mobileApiHero?.ticker ?? mobileBtcTarget?.symbol ?? "";
              const mobileHeroPrice = Number(mobileApiHero?.price ?? mobileBtcTarget?.price ?? 0);
              const mobileHeroChange = Number(mobileApiHero?.change ?? mobileBtcTarget?.change ?? 0);
              const mobileRetailBullish = Math.min(90, Math.max(10, 100 - mobileSaturation));
              const mobileRetailBearish = 100 - mobileRetailBullish;
              const mobileRiskScore = Number(mobileApiHero?.riskScore ?? 0);
              const mobileRiskLabel = mobileRiskScore >= 70 ? "HIGH" : mobileRiskScore >= 45 ? "MEDIUM" : "LOW";
              const mobilePositionLabel = mobileApiHero?.freshnessLabel === "Last Verified Signal"
                ? "VERIFIED"
                : mobileSaturation < 40 ? "EARLY" : mobileSaturation < 65 ? "BUILDING" : "LATE";
              const mobileWhyBullets = mobileApiHero?.signals?.length
                ? mobileApiHero.signals.slice(0, 4)
                : mobileBtcTarget
                ? getBeforeCrowdReason(mobileBtcTarget)
                : [];
              const mobileNearMiss: Stock[] = [];



              return (
                <div
                  className="h-full flex flex-col overflow-y-auto"
                  onTouchStart={(e) => setMobileTouchStart(e.touches[0].clientX)}
                  onTouchEnd={(e) => {
                    if (mobileTouchStart === null) return;
                    const diff = mobileTouchStart - e.changedTouches[0].clientX;
                    if (Math.abs(diff) > 50) {
                      if (diff > 0 && mobileCardIndex < mobileCards.length - 1) setMobileCardIndex(i => i + 1);
                      if (diff < 0 && mobileCardIndex > 0) setMobileCardIndex(i => i - 1);
                    }
                    setMobileTouchStart(null);
                  }}
                >
                  {/* Hero Card */}
                  {/* BEFORE THE CROWD — Mobile Hero */}
                  {/* Mirrors desktop: same resolvedBeforeCrowdTarget, same HT Score, same Stage, same eligibility gate */}

                  {!mobileBtcTarget ? (
                    <div className="mx-4 mt-4 mb-3 rounded-2xl border border-white/8 bg-black/60 p-6 flex-shrink-0">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                        <p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-600">Top Opportunity</p>
                      </div>
                      <p className="text-2xl font-black text-white mb-1">No Signal Confirmed</p>
                      <p className="text-xs font-semibold text-zinc-600 leading-5 mb-4">Nothing clears the HT Labs qualification threshold right now. Monitoring continues.</p>
                      {mobileNearMiss.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-2">Watching, Not Confirmed</p>
                          {mobileNearMiss.map(s => (
                            <button key={s.symbol} onClick={() => setSelectedStock(s)}
                              className="w-full flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 hover:border-white/15 transition">
                              <span className="font-mono text-sm font-black text-zinc-300">{s.symbol}</span>
                              <span className="font-mono text-xs font-black text-zinc-600">HT {getHTScore(s)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    // ── SPOT MOMENTUM — Mobile Mission Briefing ──────────────
                    // Same story as desktop: Identity → Hook → Window → Evidence → Actions
                    <div className="mx-4 mt-4 mb-3 rounded-2xl border border-violet-400/15 bg-black flex-shrink-0 overflow-hidden">

                      {/* Engine label + dual signal */}
                      <div className="flex items-center justify-between px-5 pt-4 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse shadow-[0_0_8px_rgba(167,139,250,0.8)]" />
                          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-violet-400">Top Opportunity</p>
                        </div>
                        {isDualEngineConfirmation && (
                          <span className="text-[8px] font-black text-amber-400">⚡ Dual Signal</span>
                        )}
                      </div>

                      {/* 1. IDENTITY — ticker + price + status */}
                      <div className="px-5 pb-4 border-b border-white/8">
                        <div className="flex items-end gap-3 mb-2">
                          <p className="font-mono text-[3.2rem] font-black text-white leading-none tracking-[-0.06em]">{mobileHeroTicker}</p>
                          <div className="pb-1">
                            <span className="font-mono text-base font-black text-white">${mobileHeroPrice.toFixed(2)}</span>
                            <span className={`font-mono text-xs font-black ml-2 ${mobileHeroChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {mobileHeroChange >= 0 ? "+" : ""}{mobileHeroChange.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[9px] font-black text-zinc-400">{mobileBtcTier}</span>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black ${
                            mobileBtcStageLabel === "Early" ? "border-green-400/20 bg-green-500/[0.06] text-green-400" : "border-zinc-700 text-zinc-600"
                          }`}>{mobileBtcStageLabel === "Last Verified Signal" ? "Last Verified" : mobileBtcStageLabel === "Early" ? "Pre-Crowd" : mobileBtcStageLabel === "Developing" ? "Crowd Building" : mobileBtcStageLabel === "Crowded" ? "Crowd Arrived" : "Late Stage"}</span>
                          {mobileIsCatalyst && (
                            <span className="rounded-full border border-orange-400/25 bg-orange-500/[0.06] px-2.5 py-0.5 text-[9px] font-black text-orange-300">⚡ {mobileHceCategory}</span>
                          )}
                        </div>
                      </div>

                      {/* 2. EMOTIONAL HOOK — one sentence, no box */}
                      <div className="px-5 py-4 border-b border-white/8">
                        <p className="text-sm font-bold text-zinc-200 leading-5">
                          {mobileApiHero?.whyItMatters
                            ?? (mobileIsCatalyst
                            ? `${mobileHceCategory} identified — positioned before the event resolves.`
                            : mobileSaturation < 45
                            ? "Momentum is building before widespread participation arrives."
                            : "Momentum is expanding as more traders take notice.")}
                        </p>
                      </div>

                      {/* 3. OPPORTUNITY WINDOW — the decision hero */}
                      {smFramework && (
                        <div className="px-5 py-4 border-b border-white/8">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-violet-400">Opportunity Window</p>
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                smFramework.confidence === "High" ? "border-green-400/25 text-green-400" :
                                smFramework.confidence === "Moderate" ? "border-violet-400/25 text-violet-400" :
                                "border-zinc-700 text-zinc-600"
                              }`}>{smFramework.confidence}</span>
                              <span className="text-[8px] font-semibold text-zinc-600">{smFramework.horizon}</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <div>
                              <p className="text-[8px] font-black uppercase text-zinc-600 mb-1">Upside</p>
                              <p className="font-mono text-lg font-black text-green-400 leading-none">+{smFramework.uptideMin}%</p>
                              <p className="font-mono text-xs font-black text-green-400/50 mt-0.5">→ +{smFramework.uptideMax}%</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black uppercase text-zinc-600 mb-1">Risk</p>
                              <p className="font-mono text-lg font-black text-red-400 leading-none">-{smFramework.riskZone}%</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-black uppercase text-zinc-600 mb-1">R/R</p>
                              <p className="font-mono text-lg font-black text-violet-400 leading-none">{smFramework.rr}:1</p>
                            </div>
                          </div>
                          <p className="text-[10px] font-semibold text-zinc-600 italic leading-4">{smFramework.sentence}</p>
                          {!smFramework.isLive && <p className="text-[8px] text-zinc-700 mt-1">Based on last session</p>}
                        </div>
                      )}

                      {/* 4. ENGINE EVIDENCE */}
                      {mobileWhyBullets.length > 0 && (
                        <div className="px-5 py-3 border-b border-white/8">
                          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-2">Evidence</p>
                          <div className="space-y-1.5">
                            {mobileWhyBullets.map((b, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="text-violet-400/60 font-black text-[10px] shrink-0 mt-0.5">▸</span>
                                <p className="text-[11px] font-semibold text-zinc-500 leading-4">{b}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 5. ADVANCED — HT Score + metrics (power user) */}
                      <div className="px-5 py-3 border-b border-white/8">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[7px] font-black uppercase tracking-[0.18em] text-zinc-700 mb-0.5">HT Score</p>
                            <p className={`font-mono text-2xl font-black leading-none ${mobileBtcScore >= 80 ? "text-green-400" : mobileBtcScore >= 65 ? "text-violet-400" : "text-orange-400"}`}>{mobileBtcScore}</p>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-center">
                            {[
                              { label: "Crowd", value: mobileSaturation <= 35 ? "Early" : mobileSaturation <= 60 ? "Building" : "Crowded", color: mobileSaturation <= 35 ? "text-green-400" : mobileSaturation <= 60 ? "text-violet-400" : "text-red-400" },
                              { label: "Volume", value: mobileRvol >= 1.5 ? `${mobileRvol.toFixed(1)}×` : "Normal", color: mobileRvol >= 1.5 ? "text-orange-400" : "text-zinc-600" },
                              { label: "Position", value: mobilePositionLabel, color: mobilePositionLabel === "EARLY" ? "text-green-400" : mobilePositionLabel === "BUILDING" ? "text-violet-400" : "text-zinc-500" },
                            ].map(({ label, value, color }) => (
                              <div key={label}>
                                <p className="text-[7px] font-black uppercase text-zinc-700 mb-0.5">{label}</p>
                                <p className={`text-[10px] font-black ${color}`}>{value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* HT Read if available */}
                      {bullBearData?.ticker === mobileHeroTicker && bullBearData?.htRead && (
                        <div className="px-5 py-3 border-b border-white/8">
                          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-1.5">HT Read</p>
                          <p className="text-xs font-semibold text-zinc-500 leading-5 italic">"{bullBearData.htRead}"</p>
                        </div>
                      )}

                      {/* Decision Trace — mobile compact */}
                      {smTrace && smTrace.primaryDrivers.length > 0 && (
                        <div className="border-b border-white/8">
                          <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.04]">
                            <p className="text-[7px] font-black uppercase tracking-[0.2em] text-zinc-700">Decision Trace</p>
                            <span className="text-[7px] font-semibold text-zinc-800">Opp {smTrace.opportunityScore} · {smTrace.candidatesEvaluated} evaluated</span>
                          </div>
                          <div className="px-5 py-3 space-y-1.5">
                            <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1">Why This Stock</p>
                            {smTrace.primaryDrivers.slice(0, 3).map((d, i) => (
                              <div key={i} className="flex gap-1.5">
                                <span className="text-violet-400/30 text-[8px] shrink-0">▸</span>
                                <p className="text-[9px] font-semibold text-zinc-600 leading-[1.3]">{d}</p>
                              </div>
                            ))}
                            {smTrace.rejectedAlternatives.length > 0 && (
                              <>
                                <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mt-2.5 mb-1">Why Not Others</p>
                                {smTrace.rejectedAlternatives.slice(0, 2).map((r, i) => (
                                  <div key={i} className="flex gap-1.5">
                                    <span className="font-mono text-[9px] font-black text-zinc-600 shrink-0">{r.symbol}</span>
                                    <p className="text-[9px] font-semibold text-zinc-700 leading-[1.3]">— {r.reason}</p>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 6. ACTIONS */}
                      <div className="px-5 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => mobileBtcTarget && setSelectedStock(mobileBtcTarget)}
                            className="flex-1 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] py-3 text-xs font-black text-violet-300"
                          >
                            Full Signal Breakdown →
                          </button>
                          <button
                            onClick={() => mobileBtcTarget && toggleWatchlist(mobileHeroTicker)}
                            className={`rounded-xl border px-4 py-3 text-xs font-black transition ${watchlist.includes(mobileHeroTicker) ? "border-violet-400/30 bg-violet-500/10 text-violet-300" : "border-white/8 bg-white/[0.02] text-zinc-600"}`}
                          >
                            {watchlist.includes(mobileHeroTicker) ? "★" : "☆"}
                          </button>
                        </div>
                        <p className="mt-2.5 text-center text-[8px] text-zinc-700 font-semibold">Signals are for research only, not financial advice.</p>
                      </div>
                    </div>
                  )}

                  {/* ── BEFORE THE CROWD — Mission Briefing (mobile) ── */}
                  {resolvedBeforeTheCrowdTarget && (() => {
                    const btcM = resolvedBeforeTheCrowdTarget;
                    const btcMConv = beforeTheCrowdConviction;
                    const btcMLabel = getThesisEnduranceLabel(btcMConv);
                    const btcMScore = getHTScore(btcM);
                    const btcMReasons = getThesisEnduranceReason(btcM);
                    const btcMHce = getHCECategory(btcM);
                    const btcMRvol = getRelativeVolume(btcM);
                    const btcMSat = getBackgroundOpportunityEngine(btcM).crowdSaturationScore;
                    const accentColor = btcMConv >= 80 ? "text-green-400" : btcMConv >= 65 ? "text-violet-400" : btcMConv >= 50 ? "text-orange-400" : "text-red-400";
                    const borderAccent = btcMConv >= 80 ? "border-green-400/15" : btcMConv >= 65 ? "border-violet-400/15" : btcMConv >= 50 ? "border-orange-400/15" : "border-red-400/15";

                    return (
                      <div className={`mx-4 mb-3 rounded-2xl border ${borderAccent} bg-black flex-shrink-0 overflow-hidden`}>

                        {/* 1. Engine label */}
                        <div className="flex items-center justify-between px-5 pt-4 pb-0">
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse shadow-[0_0_8px_rgba(251,146,60,0.8)]" />
                            <p className="text-[9px] font-black uppercase tracking-[0.28em] text-orange-400">Before The Crowd</p>
                          </div>
                          {isDualEngineConfirmation && (
                            <span className="text-[8px] font-black text-amber-400">⚡ Dual Signal</span>
                          )}
                        </div>

                        {/* 2. Ticker + Price */}
                        <div className="px-5 pt-3 pb-2">
                          <div className="flex items-end gap-3">
                            <p className="font-mono text-[3.2rem] font-black text-white leading-none tracking-[-0.06em]">{btcM.symbol}</p>
                            <div className="pb-1.5">
                              <span className="font-mono text-base font-black text-white">${btcM.price.toFixed(2)}</span>
                              <span className={`font-mono text-xs font-black ml-2 ${btcM.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {btcM.change >= 0 ? "+" : ""}{btcM.change.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* 3. Status — thesis label is the hero */}
                        <div className="px-5 pb-4 border-b border-white/8">
                          <p className={`text-2xl font-black leading-tight ${accentColor}`}>{btcMLabel}</p>
                          <p className="text-xs font-semibold text-zinc-600 mt-1 mb-1.5">
                            {btcMConv >= 80 ? "Buyers continue building positions before wider participation arrives." : btcMConv >= 65 ? "The setup continues building before broad market participation." : btcMConv >= 50 ? "Early positioning remains active despite limited crowd presence." : "Conviction is fading as the thesis faces structural pressure."}
                          </p>
                          {btcMHce && (
                            <span className="inline-flex rounded-full border border-orange-400/30 bg-orange-500/10 px-2.5 py-0.5 text-[9px] font-black text-orange-300">⚡ {btcMHce}</span>
                          )}
                        </div>

                        {/* 4. Thesis Score meter */}
                        <div className="px-5 py-5 border-b border-white/8">
                          <p className="text-[8px] font-black uppercase tracking-[0.22em] text-zinc-600 mb-3">Thesis Score</p>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex-1 bg-zinc-900 rounded-full h-[3px] overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ease-out ${accentColor.replace("text-", "bg-")}`} style={{ width: `${btcMConv}%` }} />
                            </div>
                            <p className={`font-mono text-sm font-black shrink-0 ${accentColor}`}>{btcMConv}</p>
                          </div>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[7px] font-black uppercase tracking-[0.18em] text-zinc-700 mb-0.5">Thesis Score</p>
                              <p className={`font-mono text-[2rem] font-black leading-none ${accentColor}`}>{btcMConv}</p>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                              {[
                                { label: "Crowd", value: btcMSat <= 35 ? "Early" : btcMSat <= 60 ? "Building" : "Crowded", color: btcMSat <= 35 ? "text-green-400" : btcMSat <= 60 ? "text-violet-400" : "text-red-400" },
                                { label: "Volume", value: btcMRvol >= 1.5 ? `${btcMRvol.toFixed(1)}×` : "Normal", color: btcMRvol >= 1.5 ? "text-orange-400" : "text-zinc-500" },
                                { label: "HT Score", value: `${btcMScore}`, color: btcMScore >= 65 ? "text-violet-400" : "text-zinc-500" },
                              ].map(({ label, value, color }) => (
                                <div key={label}>
                                  <p className="text-[7px] font-black uppercase text-zinc-700 mb-0.5">{label}</p>
                                  <p className={`text-[9px] font-black ${color}`}>{value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* 5. Why HT Labs Selected This */}
                        <div className="px-5 py-4 border-b border-white/8">
                          <p className="text-[8px] font-black uppercase tracking-[0.22em] text-orange-400 mb-2.5">Why HT Labs Selected This</p>
                          <div className="space-y-2">
                            {btcMReasons.map((b, i) => (
                              <div key={i} className="flex gap-2.5">
                                <span className="text-orange-400 font-black text-[10px] shrink-0 mt-0.5">✓</span>
                                <p className="text-xs font-semibold text-zinc-200 leading-5">{b}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 5.5 Opportunity Window */}
                        {btcFramework && (
                          <div className="px-5 pb-4 border-b border-white/8">
                            <p className="text-[8px] font-black uppercase tracking-[0.22em] text-orange-400 mb-2">Opportunity Window</p>
                            <div className="flex items-center gap-3 mb-1.5">
                              <div className="flex-1">
                                <p className="text-[7px] font-black uppercase text-zinc-700 mb-0.5">Upside</p>
                                <p className="font-mono text-base font-black text-green-400">+{btcFramework.uptideMin}% → +{btcFramework.uptideMax}%</p>
                              </div>
                              <div>
                                <p className="text-[7px] font-black uppercase text-zinc-700 mb-0.5">Risk</p>
                                <p className="font-mono text-base font-black text-red-400">-{btcFramework.riskZone}%</p>
                              </div>
                              <div>
                                <p className="text-[7px] font-black uppercase text-zinc-700 mb-0.5">R/R</p>
                                <p className="font-mono text-base font-black text-orange-400">{btcFramework.rr}:1</p>
                              </div>
                            </div>
                            <p className="text-[10px] font-semibold text-zinc-600 italic">{btcFramework.sentence}</p>
                            {!btcFramework.isLive && <p className="text-[8px] text-zinc-700 mt-0.5">Based on last session</p>}
                          </div>
                        )}

                        {/* 5.5 Decision Trace — mobile BTC */}
                        {btcTrace && btcTrace.primaryDrivers.length > 0 && (
                          <div className="border-b border-white/8">
                            <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.04]">
                              <p className="text-[7px] font-black uppercase tracking-[0.2em] text-zinc-700">Decision Trace</p>
                              <span className="text-[7px] font-semibold text-zinc-800">Opp {btcTrace.opportunityScore} · {btcTrace.candidatesEvaluated} evaluated</span>
                            </div>
                            <div className="px-5 py-3 space-y-1.5">
                              <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mb-1">Why This Stock</p>
                              {btcTrace.primaryDrivers.slice(0, 3).map((d, i) => (
                                <div key={i} className="flex gap-1.5">
                                  <span className="text-orange-400/30 text-[8px] shrink-0">▸</span>
                                  <p className="text-[9px] font-semibold text-zinc-600 leading-[1.3]">{d}</p>
                                </div>
                              ))}
                              {btcTrace.rejectedAlternatives.length > 0 && (
                                <>
                                  <p className="text-[7px] font-black uppercase tracking-[0.16em] text-zinc-800 mt-2.5 mb-1">Why Not Others</p>
                                  {btcTrace.rejectedAlternatives.slice(0, 2).map((r, i) => (
                                    <div key={i} className="flex gap-1.5">
                                      <span className="font-mono text-[9px] font-black text-zinc-600 shrink-0">{r.symbol}</span>
                                      <p className="text-[9px] font-semibold text-zinc-700 leading-[1.3]">— {r.reason}</p>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 6. Actions */}
                        <div className="px-5 py-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedStock(btcM)}
                              className="flex-1 rounded-xl border border-orange-400/30 bg-orange-500/10 py-2.5 text-xs font-black text-orange-300"
                            >
                              See Why HT Labs Picked This →
                            </button>
                            <button
                              onClick={() => toggleWatchlist(btcM.symbol)}
                              className={`rounded-xl border px-4 py-2.5 text-xs font-black transition ${watchlist.includes(btcM.symbol) ? "border-orange-400/30 bg-orange-500/10 text-orange-300" : "border-white/10 bg-white/[0.03] text-zinc-500"}`}
                            >
                              {watchlist.includes(btcM.symbol) ? "★" : "☆"}
                            </button>
                          </div>
                          <p className="mt-2.5 text-center text-[8px] text-zinc-700 font-semibold">Signals are for research only, not financial advice.</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── swipeable conviction leaders (unchanged) ── */}
                  {false && (
                    <div className="hidden">
                      {/* placeholder to close old card block */}
                    </div>
                  )}

                  <MobileCardDetail
                    current={current}
                    mobileCards={mobileCards}
                    mobileCardIndex={mobileCardIndex}
                    isHeroCard={mobileBtcTarget?.symbol === current.symbol}
                    convictionLeaders={convictionLeaders}
                    emergingRadarCandidates={emergingRadarCandidates}
                    watchlist={watchlist}
                    setMobileCardIndex={setMobileCardIndex}
                    setSelectedStock={setSelectedStock}
                    toggleWatchlist={toggleWatchlist}
                    getHTScore={getHTScore}
                    getRelativeVolume={getRelativeVolume}
                    getAttentionScore={getAttentionScore}
                    getContinuationStrengthScore={getContinuationStrengthScore}
                    getTrapRiskScore={getTrapRiskScore}
                    getEntryQualityScore={getEntryQualityScore}
                    detectPatternSignal={detectPatternSignal}
                    getSimpleConvictionRead={getSimpleConvictionRead}
                    getHTStance={getHTStance}
                    getContinuationWindows={getContinuationWindows}
                    getBackgroundOpportunityEngine={getBackgroundOpportunityEngine}
                  />
                </div>
              );
            })()}

            {/* CONVICTIONS TAB */}
            {mobileTab === "convictions" && (
              <div className="h-full overflow-y-auto px-4 pt-12 pb-24">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300 mb-4">Top Convictions</p>
                <div className="space-y-3">
                  {convictionLeaders.slice(0, 15).map((stock) => {
                    const read = getSimpleConvictionRead(stock);
                    const stance = getHTStance(stock);
                    return (
                      <button
                        key={stock.symbol}
                        onClick={() => { setSelectedStock(stock); setMobileTab("home"); }}
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-2xl font-black text-white">{stock.symbol}</p>
                            <p className="mt-1 text-xs font-semibold text-zinc-400">{read.state}</p>
                          </div>
                          <div className="text-right">
                            <p className={`font-mono text-lg font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                              {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%
                            </p>
                            <p className="mt-0.5 text-xs font-black text-orange-300">{getHTScore(stock)}% conf</p>
                          </div>
                        </div>
                        <div className={`mt-3 inline-flex rounded-xl border px-3 py-1.5 text-[10px] font-black ${stance.bg} ${stance.color}`}>
                          {stance.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SCANNER TAB */}
            {mobileTab === "scanner" && (
              <div className="h-full overflow-y-auto px-4 pt-12 pb-24">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300 mb-2">Live Scanner</p>
                <p className="text-xs font-semibold text-zinc-500 mb-4">Every name HT is watching right now</p>
                <div className="mb-4">
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
                    <span className="text-zinc-600">⌕</span>
                    <input
                      type="text"
                      placeholder="Search ticker..."
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === "Enter") handleTickerSearch(); }}
                      className="flex-1 bg-transparent text-sm font-black uppercase text-white outline-none placeholder:normal-case placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  {stocks.slice(0, 30).map((stock) => {
                    const pattern = detectPatternSignal(stock).name;
                    const htScore = getHTScore(stock);
                    const story =
                      stock.change < 0 ? { emoji: "📉", label: "Buyers Needed" } :
                      pattern === "Exhaustion Risk" ? { emoji: "⚠️", label: "Exhaustion Risk" } :
                      pattern === "Quiet Accumulation" ? { emoji: "👀", label: "Quiet Accumulation" } :
                      pattern === "Pressure Coil" ? { emoji: "⚡", label: "Pressure Coiling" } :
                      pattern === "Crowd Ignition" ? { emoji: "🔥", label: "Crowd Igniting" } :
                      pattern === "Continuation Stack" ? { emoji: "🌊", label: "Momentum Wave" } :
                      pattern === "Reclaim Setup" ? { emoji: "↩️", label: "Reclaim Attempt" } :
                      stock.change >= 15 ? { emoji: "🚀", label: "Parabolic Move" } :
                      stock.change >= 8 ? { emoji: "🔥", label: "Hot Mover" } :
                      htScore >= 85 ? { emoji: "🎯", label: "Clean Breakout" } :
                      htScore >= 75 ? { emoji: "🧲", label: "Attention Magnet" } :
                      stock.change >= 2 ? { emoji: "📈", label: "Active" } :
                      { emoji: "🔎", label: "On Watch" };
                    return (
                      <button
                        key={stock.symbol}
                        onClick={() => { setSelectedStock(stock); }}
                        className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{story.emoji}</span>
                          <div>
                            <p className="font-mono text-base font-black text-white">{stock.symbol}</p>
                            <p className="text-[10px] font-semibold text-zinc-500">{story.label}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-mono text-sm font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%
                          </p>
                          <p className="text-[10px] font-black text-orange-300">{htScore}%</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WATCHLIST TAB */}
            {mobileTab === "watchlist" && (
              <div className="h-full overflow-y-auto px-4 pt-12 pb-24">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300 mb-4">My Watchlist</p>
                {watchlist.length === 0 ? (
                  <div className="flex flex-col items-center justify-center pt-16 gap-4">
                    <p className="text-5xl">⭐</p>
                    <p className="text-base font-black text-white">No tickers yet</p>
                    <p className="text-sm font-semibold text-zinc-500 text-center">Go to Scanner and add names you want to track</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {watchlistStocks.map((stock) => {
                      if (!stock) return null;
                      const read = getSimpleConvictionRead(stock);
                      return (
                        <button
                          key={stock.symbol}
                          onClick={() => setSelectedStock(stock)}
                          className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3"
                        >
                          <div>
                            <p className="font-mono text-lg font-black text-white">{stock.symbol}</p>
                            <p className="text-[10px] font-semibold text-zinc-500">{read.state}</p>
                          </div>
                          <div className="text-right">
                            <p className={`font-mono text-base font-black ${stock.change >= 0 ? "text-green-300" : "text-red-300"}`}>
                              {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%
                            </p>
                            <p className="text-[10px] font-black text-orange-300">{getHTScore(stock)}%</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* PROFILE TAB */}
            {mobileTab === "profile" && (
              <div className="h-full overflow-y-auto px-4 pt-12 pb-24">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-300 mb-4">Profile</p>
                {session ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-green-400/20 bg-green-500/[0.06] p-5">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-400">Signed In</p>
                      <p className="mt-2 text-base font-black text-white">{session.user.email}</p>
                      <button
                        onClick={handleSignOut}
                        className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 text-sm font-black text-zinc-300"
                      >
                        Sign Out
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[["Watchlist", watchlist.length], ["Saved", savedSetups.length], ["Tracked", signalMemoryInsight?.tracked ?? 0]].map(([label, val]) => (
                        <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-center">
                          <p className="font-mono text-2xl font-black text-white">{val}</p>
                          <p className="mt-1 text-[9px] font-black uppercase text-zinc-500">{label}</p>
                        </div>
                      ))}
                    </div>
                    {signalMemoryInsight && signalMemoryInsight.tracked >= 5 && (
                      <div className="rounded-2xl border border-orange-400/20 bg-orange-500/[0.06] p-4">
                        <p className="text-[10px] font-black uppercase text-orange-300 mb-2">Signal Memory</p>
                        <p className="text-3xl font-black text-orange-300">{signalMemoryInsight.successRate ?? "--"}%</p>
                        <p className="text-xs font-semibold text-zinc-500">Win rate from {signalMemoryInsight.tracked} signals</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-zinc-400 mb-4">Sign in to save your watchlist and track your win rate.</p>
                    <input
                      type="email"
                      placeholder="Email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm outline-none placeholder:text-zinc-600 focus:border-orange-500"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAuth("signin"); }}
                      className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-4 text-sm outline-none placeholder:text-zinc-600 focus:border-orange-500"
                    />
                    <button
                      onClick={() => handleAuth("signup")}
                      disabled={authLoading}
                      className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-black uppercase text-black disabled:opacity-50"
                    >
                      {authLoading ? "..." : "Create Account"}
                    </button>
                    <button
                      onClick={() => handleAuth("signin")}
                      disabled={authLoading}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-4 text-sm font-black uppercase text-zinc-300 disabled:opacity-50"
                    >
                      {authLoading ? "..." : "Sign In"}
                    </button>
                    {authMessage && <p className="text-xs font-semibold text-zinc-400 text-center">{authMessage}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile Stock Detail Sheet — z-[300] sits above mobile overlay (z-200) */}
          {selectedStock && (
            <div
              className="fixed inset-0 z-[300] flex items-end justify-center bg-black/85 backdrop-blur-md"
              onClick={() => setSelectedStock(null)}
            >
              <div
                className="w-full max-h-[90vh] overflow-y-auto rounded-t-[1.5rem] border-t border-x border-violet-400/20 bg-zinc-950 pb-8"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-center pt-3 pb-2">
                  <div className="h-1 w-10 rounded-full bg-white/20" />
                </div>
                <div className="flex items-center justify-between px-5 pb-3 border-b border-white/10">
                  <div>
                    <p className="font-mono text-3xl font-black text-white">{selectedStock.symbol}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-mono text-base font-black text-white">${selectedStock.price.toFixed(2)}</span>
                      <span className={`font-mono text-sm font-black ${selectedStock.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {selectedStock.change >= 0 ? "+" : ""}{selectedStock.change.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setSelectedStock(null)} className="text-zinc-500 text-2xl leading-none px-2">×</button>
                </div>

                {/* HT Score */}
                {(() => {
                  const sc = getHTScore(selectedStock);
                  const eng = getBackgroundOpportunityEngine(selectedStock);
                  const sat = eng.crowdSaturationScore;
                  const stageLabel = sat <= 35 ? "Early" : sat <= 60 ? "Developing" : sat <= 80 ? "Crowded" : "Exhausted";
                  const tier = sc >= 80 ? "Strong Before The Crowd" : sc >= 65 ? "Developing Opportunity" : "Early Setup";
                  return (
                    <div className="px-5 py-4 border-b border-white/10">
                      <div className={`rounded-2xl border px-4 py-3 flex items-center justify-between ${
                        sc >= 80 ? "border-green-400/25 bg-green-500/[0.06]" :
                        sc >= 65 ? "border-violet-400/25 bg-violet-500/[0.06]" :
                        "border-orange-400/20 bg-orange-500/[0.05]"
                      }`}>
                        <p className={`font-mono text-[2.8rem] font-black leading-none ${
                          sc >= 80 ? "text-green-400" : sc >= 65 ? "text-violet-400" : "text-orange-400"
                        }`}>{sc}</p>
                        <div className="text-right">
                          <p className="text-[8px] font-black uppercase tracking-[0.18em] text-zinc-500 mb-0.5">HT Score</p>
                          <p className="text-sm font-black text-white">{tier}</p>
                          <p className={`text-[9px] font-black mt-0.5 ${stageLabel === "Early" ? "text-green-400" : "text-violet-400"}`}>
                            Stage {sat} · {stageLabel}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Bull/Bear AI Read */}
                {bullBearLoading && bullBearTicker !== selectedStock.symbol ? (
                  <div className="px-5 py-4 border-b border-white/10">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-400 mb-2">HT Labs Read</p>
                    <div className="space-y-2 animate-pulse">
                      <div className="h-3 bg-zinc-800 rounded w-full" />
                      <div className="h-3 bg-zinc-800 rounded w-4/5" />
                      <div className="h-3 bg-zinc-800 rounded w-3/5" />
                    </div>
                  </div>
                ) : bullBearData?.ticker === selectedStock.symbol && (
                  <div className="px-5 py-4 border-b border-white/10">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-400 mb-2">HT Labs Read</p>
                    <p className="text-sm font-bold text-white leading-5 mb-4">"{bullBearData.htRead}"</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[8px] font-black uppercase text-green-400 mb-2">🐂 Bull Case</p>
                        <ul className="space-y-1.5">
                          {bullBearData.bullCase.slice(0, 3).map((pt: string, i: number) => (
                            <li key={i} className="flex gap-1.5 text-[11px] font-semibold text-zinc-300 leading-4">
                              <span className="text-green-500 shrink-0">+</span><span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[8px] font-black uppercase text-red-400 mb-2">🐻 Bear Case</p>
                        <ul className="space-y-1.5">
                          {bullBearData.bearCase.slice(0, 3).map((pt: string, i: number) => (
                            <li key={i} className="flex gap-1.5 text-[11px] font-semibold text-zinc-300 leading-4">
                              <span className="text-red-500 shrink-0">−</span><span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                <div className="px-5 py-4">
                  <button
                    onClick={() => setSelectedStock(null)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3.5 text-sm font-black text-zinc-400"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Navigation */}
          <div className="flex-shrink-0 border-t border-white/10 bg-black/90 backdrop-blur-2xl pb-safe">
            <div className="grid grid-cols-5">
              {[
                { tab: "home", icon: "🏠", label: "Home" },
                { tab: "convictions", icon: "🔥", label: "Top" },
                { tab: "scanner", icon: "⚡", label: "Scanner" },
                { tab: "watchlist", icon: "⭐", label: "Watchlist" },
                { tab: "profile", icon: "👤", label: "Profile" },
              ].map(({ tab, icon, label }) => (
                <button
                  key={tab}
                  onClick={() => setMobileTab(tab as typeof mobileTab)}
                  className={`flex flex-col items-center gap-1 py-3 transition ${mobileTab === tab ? "text-orange-400" : "text-zinc-600"}`}
                >
                  <span className="text-xl">{icon}</span>
                  <span className={`text-[9px] font-black uppercase tracking-[0.1em] ${mobileTab === tab ? "text-orange-400" : "text-zinc-600"}`}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
    </main>
  );
}
