"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import LiveStockValue from "./components/market/LiveStockValue";
import OpportunityStateCard from "./components/OpportunityStateCard";
import OpportunityWindow from "./components/opportunity/OpportunityWindow";
import BullBearPanel from "./components/opportunity/BullBearPanel";
import DesktopSpotMomentumWorkspace from "./components/opportunity/DesktopSpotMomentumWorkspace";
import BeforeCrowdCard from "./components/opportunity/BeforeCrowdCard";
import MobileExperience from "./components/mobile/MobileExperience";
import { useMobileAppNavigation } from "./components/MobileAppNavigationContext";
import HomeReferenceSurface from "./components/home/HomeReferenceSurface";
import { supabase } from "@/lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";
import type {
  BullBearAnalysis,
  MarketStock as Stock,
} from "@/lib/contracts/market";
import {
  useOpportunityFeed,
  type OpportunityPayload,
} from "./hooks/useOpportunityFeed";
import { useWatchlist } from "./hooks/useWatchlist";
import { useRecentlyViewed } from "./hooks/useRecentlyViewed";
import {
  getOpportunityPresentation,
  normalizeOpportunity,
  opportunityToStock,
  tradeFrameworkToDisplay,
  type Opportunity as APIOpportunity,
} from "@/lib/opportunity-model";
import { getRelativeVolume } from "@/app/lib/legacy-stock-scoring";
import type { HomeAlert } from "@/lib/home-account";
import {
  marketWorkspaceHref,
  normalizeMarketWorkspaceSymbol,
} from "@/lib/market-workspace-route";

type HomeClientProps = {
  surface: "intelligence" | "market";
  initialMomentumPayload: OpportunityPayload | null;
  initialBeforeCrowdPayload: OpportunityPayload | null;
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

type MarketMoverSummary = { symbol: string };

type SignalFeedRow = {
  ticker: string;
  price?: number;
  change_percent?: number;
  relative_volume?: number;
  catalyst_score?: number;
  ht_score?: number;
  momentum_score?: number;
  crowd_score?: number;
  trap_score?: number;
  state?: string;
  pattern?: string;
};

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

export default function HomeClient({
  surface,
  initialMomentumPayload,
  initialBeforeCrowdPayload,
}: HomeClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { homeTab: mobileTab, setHomeTab: setMobileTab } = useMobileAppNavigation();
  // build: v150-canonical-frontend-authority
  // V70 command center cleanup: live tape/search/auth first, top conviction as hero, capital and portfolio below, old marketing hero hidden.
  // v106 pre-market stabilization pass: preserve identity, polish nav/search spacing, compress support metrics, and keep market-open usability stable.
  // Frontend starts empty.
  // No fake/local starter board. Real display data must come from the live pipeline.
  const initialStocks: Stock[] = [];

  const [stocks, setStocks] = useState<Stock[]>(initialStocks);
  const [ticker, setTicker] = useState("");
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<APIOpportunity | null>(null);
  const [selectedOpportunityLoading, setSelectedOpportunityLoading] = useState(false);
  const [selectedOpportunityError, setSelectedOpportunityError] = useState("");
  // "Other Active Reads" in the detail modal — backend-driven, same
  // engine as Home/Scanner. Replaces the old convictionLeaders-based
  // list, which had no ETF exclusion and no real-activity requirement.
  // Mobile "Live Scanner" tab data — same backend source as Home,
  // Scanner, and Other Active Reads. Replaces raw stocks.slice(0,30),
  // which showed every ETF in the universe at flat 0% with fake labels.
  const aiAnalysis = "";
  const aiLoading = false;
  const aiError = "";
  const [, setIsRefreshing] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [news, setNews] = useState<Record<string, NewsItem[]>>({});
  const [newsIntel, setNewsIntel] = useState<Record<string, NewsIntel>>({});
  const [session, setSession] = useState<Session | null>(null);
  const {
    symbols: watchlist,
    toggle: toggleWatchlistSymbol,
    loading: watchlistLoading,
    cloudEnabled: watchlistCloudEnabled,
    syncState: watchlistSyncState,
    error: watchlistSyncError,
  } = useWatchlist({ userId: session?.user?.id ?? null });
  const { symbols: recentlyViewed, record: recordRecentlyViewed } = useRecentlyViewed();
  const [mounted, setMounted] = useState(false);
  const [homeComposition, setHomeComposition] = useState<"pending" | "compact" | "desktop">("pending");
  const [mobileCardIndex, setMobileCardIndex] = useState(0);

  // Morning Market Context
  type MarketContext = {
    spy: { price: number; change: number; rvol: number | null; asOf?: string };
    qqq: { price: number; change: number; rvol: number | null; asOf?: string };
    iwm: { price: number; change: number; rvol: number | null; asOf?: string };
    vix: { price: number; change: number } | null;
    mood: string;
    moodColor: string;
    volumeEnv: string;
    avgRvol: number | null;
    sourceTimestamp?: string | null;
  };
  const [marketCtx, setMarketCtx] = useState<MarketContext | null>(null);

  // HT Alert System
  const [alerts, setAlerts] = useState<HomeAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const prevAlertTickers = useRef<Set<string>>(new Set());

  const generateAlerts = (opportunities: APIOpportunity[]) => {
    if (!mounted || opportunities.length === 0) return;
    const newAlerts: HomeAlert[] = [];
    const now = new Date();

    for (const opportunity of opportunities) {
      if (!opportunity.eligibility?.eligible) continue;
      if (opportunity.tier !== "hero" && opportunity.tier !== "feature") continue;
      if (opportunity.freshnessLabel !== "Live Scan") continue;

      const type: HomeAlert["type"] = opportunity.catalystScore >= 20
        ? "catalyst"
        : opportunity.strategy === "before_the_crowd" || opportunity.isBeforeCrowd
          ? "before_crowd"
          : "momentum";
      // One notification per ticker/lane per browser session. A new five-minute
      // source run must not spam the same unchanged conviction repeatedly.
      const alertKey = `${type}-${opportunity.ticker}`;
      if (prevAlertTickers.current.has(alertKey)) continue;

      const title = type === "catalyst"
        ? `⚡ Model-detected catalyst activity — ${opportunity.ticker}`
        : type === "before_crowd"
          ? `👀 Before The Crowd — ${opportunity.ticker}`
          : `🔥 Spot Momentum — ${opportunity.ticker}`;
      newAlerts.push({
        id: `${alertKey}-${now.getTime()}`,
        ticker: opportunity.ticker,
        type,
        title,
        message: `${opportunity.whyItMatters} ${opportunity.riskNote}`,
        confidence: opportunity.confidence,
        timestamp: now,
        read: false,
      });
      prevAlertTickers.current.add(alertKey);
    }

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, 20));
    }
  };
  const [mobileTouchStart, setMobileTouchStart] = useState<number | null>(null);

  const {
    spotMomentum: apiMomentum,
    spotMomentumRunnersUp: apiMomentumRunnersUp,
    spotMomentumRadar: apiMomentumRadar,
    beforeCrowd: apiBeforeCrowdList,
    fullRankedList: apiFullRankedList,
    loading: apiOpportunitiesLoading,
  } = useOpportunityFeed({
    momentum: initialMomentumPayload,
    beforeCrowd: initialBeforeCrowdPayload,
  });
  // Bull/Bear case state — generated when top conviction ticker changes
  const [bullBearData, setBullBearData] = useState<BullBearAnalysis | null>(null);
  const [bullBearLoading, setBullBearLoading] = useState(false);
  const [bullBearTicker, setBullBearTicker] = useState<string>("");
  const [bullBearExpanded, setBullBearExpanded] = useState(false);

  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const explicitSignOutRef = useRef(false);
  const [, setSearchStatus] = useState("Search any ticker to pull it into HT instantly.");
  const cloudSyncMessage = watchlistSyncError
    ? "Cloud synchronization is temporarily unavailable. Your device watchlist remains intact."
    : watchlistSyncState === "syncing"
      ? "Syncing cloud watchlist..."
      : watchlistCloudEnabled && watchlistSyncState === "synced"
        ? "Cloud watchlist synced."
        : "";
  const signalMemoryInsight: { tracked: number; successRate: number | null } | null = null;
  const [savedSetups, setSavedSetups] = useState<string[]>([]);
  const [marketScanStats, setMarketScanStats] = useState<MarketScanStats>({
    scanned: marketUniverse.length,
    gainers: 0,
    losers: 0,
    highVolume: 0,
    lastFullScan: null,
  });
  const [lastSessionStats, setLastSessionStats] = useState<{ gainers: number; losers: number; highVolume: number } | null>(null);

  const getNewsArticles = (symbol: string) => {
    return newsIntel[symbol]?.articles || news[symbol] || [];
  };

  const watchlistStocks = useMemo(
    () =>
      watchlist
        .map((symbol) => stocks.find((stock) => stock.symbol === symbol))
        .filter((stock): stock is Stock => Boolean(stock)),
    [stocks, watchlist],
  );



  const apiMomentumAsStock = useMemo<Stock | null>(
    () => (apiMomentum ? opportunityToStock(apiMomentum) : null),
    [apiMomentum],
  );

  // The backend's first Before The Crowd result is authoritative. If the same
  // ticker wins both strategies, the UI reports a real dual-engine confirmation.
  const apiBeforeCrowdPick = apiBeforeCrowdList[0] ?? null;
  const apiBeforeCrowdAsStock = useMemo<Stock | null>(
    () => (apiBeforeCrowdPick ? opportunityToStock(apiBeforeCrowdPick) : null),
    [apiBeforeCrowdPick],
  );

  const resolvedSpotMomentumTarget = apiMomentumAsStock;
  const resolvedBeforeTheCrowdTarget = apiBeforeCrowdAsStock;
  const smFramework = tradeFrameworkToDisplay(apiMomentum?.tradeFramework);
  const btcFramework = tradeFrameworkToDisplay(apiBeforeCrowdPick?.tradeFramework);
  const smTrace = null;
  const btcTrace = null;

  const canonicalMobileOpportunities = useMemo(
    () => apiFullRankedList.slice(0, 15),
    [apiFullRankedList],
  );
  const canonicalLastUpdated = useMemo(() => {
    const raw = apiMomentum?.scannedAt;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }, [apiMomentum?.scannedAt]);
  const beforeCrowdUpdated = apiBeforeCrowdPick?.scannedAt ? new Date(apiBeforeCrowdPick.scannedAt) : null;

  useEffect(() => {
    setMobileCardIndex((current) =>
      Math.min(current, Math.max(0, canonicalMobileOpportunities.length - 1)),
    );
  }, [canonicalMobileOpportunities.length]);

  useEffect(() => {
    generateAlerts(canonicalMobileOpportunities);
  }, [canonicalMobileOpportunities, mounted]);

  const isDualEngineConfirmation = Boolean(
    resolvedSpotMomentumTarget &&
      resolvedBeforeTheCrowdTarget &&
      resolvedSpotMomentumTarget.symbol === resolvedBeforeTheCrowdTarget.symbol,
  );

  const btcTickerForAnalysis = resolvedSpotMomentumTarget?.symbol ?? "";
  useEffect(() => {
    if (surface !== "intelligence") return;
    if (!btcTickerForAnalysis || btcTickerForAnalysis === bullBearTicker) return;
    let cancelled = false;
    setBullBearLoading(true);
    setBullBearExpanded(false);

    fetch(`/api/bull-bear?ticker=${btcTickerForAnalysis}`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || data?.status !== "available") {
            throw new Error("Bull/bear evidence is unavailable.");
          }
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          setBullBearData(data);
          setBullBearTicker(btcTickerForAnalysis);
          setBullBearLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[Bull-Bear] evidence unavailable:", error);
          setBullBearData(null);
          setBullBearLoading(false);
        });
    return () => {
      cancelled = true;
    };
  }, [btcTickerForAnalysis, bullBearTicker, surface]);

  useEffect(() => {
    if (surface !== "intelligence") return;
    if (!selectedStock || selectedStock.symbol === bullBearTicker) return;
    let cancelled = false;
    setBullBearLoading(true);

    fetch(`/api/bull-bear?ticker=${selectedStock.symbol}`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || data?.status !== "available") {
            throw new Error("Bull/bear evidence is unavailable.");
          }
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          setBullBearData(data);
          setBullBearTicker(selectedStock.symbol);
          setBullBearLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn("[Bull-Bear] selected ticker evidence unavailable:", error);
          setBullBearData(null);
          setBullBearLoading(false);
        });
    return () => {
      cancelled = true;
    };
  }, [selectedStock, bullBearTicker, surface]);

  useEffect(() => {
    if (!selectedStock?.symbol) {
      setSelectedOpportunity(null);
      setSelectedOpportunityError("");
      setSelectedOpportunityLoading(false);
      return;
    }

    const controller = new AbortController();
    setSelectedOpportunity(null);
    setSelectedOpportunityError("");
    setSelectedOpportunityLoading(true);
    const strategyParam = selectedStock.opportunityStrategy
      ? `&strategy=${encodeURIComponent(selectedStock.opportunityStrategy)}`
      : "";
    fetch(
      `/api/opportunity-ticker?ticker=${encodeURIComponent(selectedStock.symbol)}${strategyParam}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(`Canonical context is unavailable for ${selectedStock.symbol}.`);
        }
        if (!payload?.opportunity) {
          throw new Error(
            payload?.message || `No current Canonical decision exists for ${selectedStock.symbol}.`,
          );
        }
        return normalizeOpportunity({
          ...payload.opportunity,
          sourceRunId: payload.sourceRunId ?? undefined,
        });
      })
      .then(setSelectedOpportunity)
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setSelectedOpportunityError(
            error?.message || `No current Canonical decision exists for ${selectedStock.symbol}.`,
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSelectedOpportunityLoading(false);
      });

    return () => controller.abort();
  }, [selectedStock?.symbol, selectedStock?.opportunityStrategy]);

  const selectedOpportunityPresentation = selectedOpportunity
    ? getOpportunityPresentation(selectedOpportunity)
    : null;
  const selectedOpportunityFramework = tradeFrameworkToDisplay(selectedOpportunity?.tradeFramework);



  // RECENT SIMILAR READS — use real conviction leaders from the active scan
  // Opens a ticker from "Other Active Reads" even if it isn't in the
  // currently loaded `stocks` universe — same fallback pattern as the
  // Scanner deep-link fix, so this never silently does nothing.
  const openReadTicker = (ticker: string) => {
    const existing = stocks.find((st) => st.symbol === ticker);
    if (existing) { setSelectedStock(existing); return; }
    const href = marketWorkspaceHref(ticker);
    if (href) router.push(href);
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

      const newsVelocity = typeof data?.newsVelocity === "number"
        ? data.newsVelocity
        : 0;

      setNews((prev) => ({
        ...prev,
        [symbol]: articles,
      }));

      setNewsIntel((prev) => ({
        ...prev,
        [symbol]: {
          articles,
          newsVelocity,
          catalystStrength: data?.catalystStrength || "Catalyst analysis unavailable",
          narrativeSignal: data?.narrativeSignal || "Narrative analysis unavailable",
          sentimentBias: data?.sentimentBias || "Sentiment unavailable",
          sentimentScore: typeof data?.sentimentScore === "number" ? data.sentimentScore : 0,
          hypeScore: typeof data?.hypeScore === "number" ? data.hypeScore : 0,
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
          newsVelocity: 0,
          catalystStrength: "Catalyst analysis unavailable",
          narrativeSignal: "Narrative analysis unavailable",
          sentimentBias: "Sentiment unavailable",
          sentimentScore: 0,
          hypeScore: 0,
          sourceCount: 0,
        },
      }));
    }
  };

  const getTopNews = (symbol: string) => {
    return getNewsArticles(symbol)?.[0];
  };



  const liveHeroTarget = resolvedSpotMomentumTarget;

  const fetchStockUniverse = async (
    symbols: string[],
    signalRows: SignalFeedRow[],
  ): Promise<Stock[]> => {
    // The caller already owns the current signal frame. Reuse it here so one
    // browser refresh cannot download the identical feed twice.
    const bulkRes = await fetch("/api/bulk-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });

    // Parse the shared Massive quote response.
    let quotes: Record<string, { price: number; change: number; volume?: number; prevVolume?: number; avgVolume?: number }> = {};
    if (bulkRes.ok) {
      try {
        const data = await bulkRes.json();
        quotes = data.quotes ?? {};
      } catch { /* silent */ }
    }
    // Reuse the signal payload already fetched by fetchStocks.
    const signalsMap: Record<string, {
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
    for (const row of signalRows) {
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

    // Merge and normalize.
    return symbols.map((symbol) => {
      const q = quotes[symbol];
      const sig = signalsMap[symbol];

      const base: Stock = q && (q.price > 0 || Math.abs(q.change) > 0)
        ? { symbol, price: q.price, change: q.change, volume: q.volume ?? 0, prevVolume: q.prevVolume ?? 0 }
        : { symbol, price: 0, change: 0, volume: 0, prevVolume: 0 };

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
    // Product-integrity repair: the Canonical decision frame is the one shared
    // discovery controller. The former browser-side movers + signal + bulk
    // quote loop duplicated server work every 30 seconds and could reorder the
    // board independently of Canonical. Keep the legacy implementation below
    // isolated for rollback history, but do not execute it.
    const legacyDiscoveryHydrationEnabled = false;
    if (!legacyDiscoveryHydrationEnabled) {
      const canonicalStocks = [...apiFullRankedList, ...apiBeforeCrowdList]
        .filter((opportunity, index, rows) =>
          rows.findIndex((candidate) => candidate.ticker === opportunity.ticker) === index,
        )
        .map(opportunityToStock);
      setStocks(canonicalStocks);
      setMarketScanStats((current) => ({
        ...current,
        scanned: canonicalStocks.length,
        gainers: canonicalStocks.filter((stock) => stock.change > 0).length,
        losers: canonicalStocks.filter((stock) => stock.change < 0).length,
        highVolume: canonicalStocks.filter((stock) => getRelativeVolume(stock) >= 3).length,
        lastFullScan: canonicalLastUpdated,
      }));
      setLastUpdated(canonicalLastUpdated);
      setIsRefreshing(false);
      return;
    }
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
        ? ((moversRes.value.movers ?? []) as MarketMoverSummary[]).map((mover) => mover.symbol)
        : [];

      // Pull tickers from ht_signals that aren't in our universe
      // These are the real discoveries from the full market scan
      const signalsRaw: SignalFeedRow[] = signalsFeedRes.status === "fulfilled"
        ? ((signalsFeedRes.value.signals ?? []) as SignalFeedRow[])
        : [];
      const signalSymbols: string[] = signalsRaw.map((signal) => signal.ticker);

      // Build a map of signal data so new discoveries get proper enrichment
      // Include price and change so stocks with no bulk-quote data survive filtering
      const signalEnrichmentMap: Record<string, SignalFeedRow> = {};
      for (const s of signalsRaw) {
        signalEnrichmentMap[s.ticker] = s;
      }

      // Merge all sources — universe + movers + signal discoveries
      const tickersToFetch = [...new Set([
        ...marketUniverse,
        ...moverSymbols,
        ...signalSymbols,
        ...apiFullRankedList.map((opportunity) => opportunity.ticker),
        ...watchlist,
      ])];

      const stockData = await fetchStockUniverse(tickersToFetch, signalsRaw);

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
      const canonicalRank = new Map(
        apiFullRankedList.map((opportunity, index) => [opportunity.ticker, index]),
      );
      const sortedStocks = [...tradableData].sort((left, right) => {
        const leftRank = canonicalRank.get(left.symbol) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = canonicalRank.get(right.symbol) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || Math.abs(right.change) - Math.abs(left.change);
      });

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

      // NOTE: The old "log top 10 to ht_scan_log on every scan" (auto_scan)
      // insert was removed. It wrote 10 rows every 30s per open tab, was
      // never read anywhere (signals-history filters by engine, which these
      // rows never had), and duplicated what signal-writer already records
      // server-side across the full market every 5 minutes. ht_scan_log now
      // only receives meaningful rows: real SM/BTC top-pick events (logPick).
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

  useEffect(() => {
    setMounted(true);

    const savedAiSetups = localStorage.getItem("htlabs-saved-setups");

    if (savedAiSetups) {
      setSavedSetups(JSON.parse(savedAiSetups));
    }

  }, []);

  useEffect(() => {
    if (surface !== "intelligence") return;
    const query = window.matchMedia("(min-width: 1180px)");
    const apply = () => setHomeComposition(query.matches ? "desktop" : "compact");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [surface]);

  // Market context is a shared provider snapshot. The selected ticker itself
  // stays on the existing five-second display-frame path.
  useEffect(() => {
    const fetchCtx = () => {
      fetch("/api/market-context")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data && !data.error) setMarketCtx(data); })
        .catch(() => {});
    };
    fetchCtx();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchCtx();
    }, 15 * 1000);
    return () => clearInterval(interval);
  }, []);

  const requestedMarketTicker = surface === "market"
    ? normalizeMarketWorkspaceSymbol(searchParams?.get("ticker"))
    : null;

  // The URL is the universal workspace authority. Re-run on every URL change
  // so refresh and browser Back/Forward cannot retain a different ticker.
  useEffect(() => {
    if (!requestedMarketTicker) return;
    setSelectedStock((current) => current?.symbol === requestedMarketTicker
      ? current
      : { symbol: requestedMarketTicker, price: 0, change: 0 });
    recordRecentlyViewed(requestedMarketTicker);
  }, [recordRecentlyViewed, requestedMarketTicker]);



  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    }).catch(() => {
      setAuthReady(true);
      setAuthMessage("Your account session could not be verified. You can retry by reloading this page.");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession);
      setAuthReady(true);
      if (event === "SIGNED_OUT") {
        setAuthMessage(explicitSignOutRef.current
          ? "Signed out. Public research remains available."
          : "Your session expired. Sign in again to restore private account features.");
        explicitSignOutRef.current = false;
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setAuthMessage(event === "SIGNED_IN" ? "Signed in successfully." : "Session refreshed securely.");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // AUTH STABILITY PATCH v149:
  // Temporarily disable automatic Signal Memory Supabase writes after login/signup.
  // v120 auth worked because login only restored the user session + cloud watchlist.
  // These newer effects hit the ht_signal_memory table immediately after auth,
  // which can make onboarding feel broken if that table/RLS policy is not ready.


  useEffect(() => {
    if (surface !== "intelligence") return;
    // News enrichment is on-demand for the visible Canonical hero. It is no
    // longer multiplied across twelve hidden cards or coupled to Scanner.
    if (liveHeroTarget) void fetchNews(liveHeroTarget.symbol);
  }, [liveHeroTarget, surface]);

  const fetchStocksRef = useRef(fetchStocks);
  useEffect(() => {
    fetchStocksRef.current = fetchStocks;
  });

  useEffect(() => {
    if (surface !== "intelligence") return;
    void fetchStocksRef.current();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchStocksRef.current();
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [surface]);

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
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setAuthMessage("Sign-in could not be completed. Check your email and password, then try again.");
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
        setAuthMessage("Account creation could not be completed. Review your details or try again shortly.");
        return;
      }

      if (data.session) {
        // onAuthStateChange handles setSession automatically
        setAuthMessage("Account created. Your HT workspace is live.");
      } else {
        setAuthMessage("Account created. Check your email to confirm, then log in.");
      }

      setAuthPassword("");
    } catch {
      setAuthMessage("Authentication is temporarily unavailable. Check your connection and try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      explicitSignOutRef.current = true;
      setAuthLoading(true);
      setAuthMessage("Signing out…");
      const { error } = await supabase.auth.signOut();
      if (error) {
        explicitSignOutRef.current = false;
        setAuthMessage("Sign-out could not be completed. Try again shortly.");
      }
    } catch {
      explicitSignOutRef.current = false;
      setAuthMessage("Sign-out could not be completed. Check your connection and try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleTickerSearch = async () => {
    const cleanTicker = normalizeMarketWorkspaceSymbol(ticker);

    if (!cleanTicker) {
      setSearchStatus("Enter a valid stock or ETF ticker first.");
      return;
    }

    if (surface === "market") {
      const href = marketWorkspaceHref(cleanTicker);
      if (!href) return;
      setSelectedStock({ symbol: cleanTicker, price: 0, change: 0 });
      recordRecentlyViewed(cleanTicker);
      setTicker("");
      router.push(href);
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
      recordRecentlyViewed(searchedStock.symbol);

      setSearchStatus(`${cleanTicker} loaded into HT. Add it to watchlist if it deserves tracking.`);
      setTicker("");

    } catch (error) {
      console.error("SEARCH ERROR:", error);
      setSearchStatus(`Could not load ${cleanTicker}. Check the symbol and try again.`);
    }
  };

  const toggleWatchlist = (symbol: string) => {
    void toggleWatchlistSymbol(symbol);
  };

  // Frontend does not pick homepage winners anymore.
  // The backend/API owns Top Opportunity, Spot Momentum, and Before The Crowd decisions.
  // Secondary opportunity surfaces consume the canonical feed below; there is
  // intentionally no local fallback selector.

  const referenceSymbol = surface === "market"
    ? requestedMarketTicker ?? "SPY"
    : apiMomentum?.ticker ?? "SPY";
  const matchingSelectedOpportunity = selectedOpportunity?.ticker === referenceSymbol
    ? selectedOpportunity
    : null;
  const matchingFrameOpportunity = apiFullRankedList.find(
    (opportunity) => opportunity.ticker === referenceSymbol,
  ) ?? apiBeforeCrowdList.find(
    (opportunity) => opportunity.ticker === referenceSymbol,
  ) ?? null;
  const referenceOpportunity = surface === "intelligence"
    ? apiMomentum
    : matchingSelectedOpportunity ?? matchingFrameOpportunity;
  const referenceFramework = tradeFrameworkToDisplay(referenceOpportunity?.tradeFramework);
  const requestedAccountSurface = searchParams?.get("auth") === "signin"
    ? "signin"
    : searchParams?.get("account") === "profile" || searchParams?.get("tab") === "profile"
      ? "profile"
      : null;

  const navigateMarketSymbol = (symbol: string) => {
      const normalized = normalizeMarketWorkspaceSymbol(symbol);
      const href = marketWorkspaceHref(normalized);
      if (!normalized || !href) return;
      setSelectedStock({ symbol: normalized, price: 0, change: 0 });
      recordRecentlyViewed(normalized);
      router.push(href);
  };

  const terminalSurface = (experience: "market" | "spot-momentum") => (
      <HomeReferenceSurface
        experience={experience}
        symbol={referenceSymbol}
        opportunity={referenceOpportunity}
        spotMomentum={apiFullRankedList}
        beforeCrowd={apiBeforeCrowdList}
        framework={referenceFramework}
        marketContext={marketCtx}
        watchlist={watchlist}
        recents={recentlyViewed}
        watched={referenceSymbol ? watchlist.includes(referenceSymbol) : false}
        watchlistBusy={watchlistLoading}
        selectionLoading={experience === "market" ? selectedOpportunityLoading : false}
        selectionError={experience === "market" ? selectedOpportunityError : ""}
        authDestination={requestedAccountSurface}
        authReady={authReady}
        session={session}
        authEmail={authEmail}
        authPassword={authPassword}
        authLoading={authLoading}
        authMessage={authMessage}
        watchlistCloudEnabled={watchlistCloudEnabled}
        watchlistSyncState={watchlistSyncState}
        watchlistSyncError={watchlistSyncError}
        savedSetupCount={savedSetups.length}
        signalMemoryInsight={signalMemoryInsight}
        alerts={alerts}
        onAuthEmailChange={setAuthEmail}
        onAuthPasswordChange={setAuthPassword}
        onAuthenticate={(mode) => void handleAuth(mode)}
        onSignOut={() => void handleSignOut()}
        onSelectAlert={(alert) => {
          setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, read: true } : item));
          navigateMarketSymbol(alert.ticker);
        }}
        onSelect={(opportunity) => navigateMarketSymbol(opportunity.ticker)}
        onToggleWatchlist={() => {
          if (referenceSymbol) void toggleWatchlistSymbol(referenceSymbol);
        }}
      />
  );

  if (surface === "market") {
    return (
      terminalSurface("market")
    );
  }

  if (homeComposition === "pending" || (homeComposition === "desktop" && apiOpportunitiesLoading && !apiMomentum)) {
    return <OpportunityStateCard loading workspace />;
  }

  if (homeComposition === "desktop") {
    return terminalSurface("spot-momentum");
  }

  return (
    <main className="ht-simplified-ui ht-discovery-home min-h-screen overflow-hidden bg-[#050505] text-white">
      <h1 className="sr-only">HT Labs market intelligence</h1>
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

        section .ht-spot-momentum-columns {
          align-items: stretch !important;
        }

        section .ht-spot-momentum-columns > * {
          align-self: stretch !important;
          height: 100% !important;
          min-height: 0 !important;
        }

        section .ht-momentum-contender-rows {
          align-items: stretch !important;
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

        .ht-simplified-ui #conviction-engine {
          padding-top: 0.85rem !important;
          padding-bottom: 1rem !important;
        }

        .ht-simplified-ui #watchlist,
        .ht-simplified-ui #scanner {
          padding-top: 1.35rem !important;
          padding-bottom: 1.35rem !important;
        }


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


      `}</style>

      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,106,0,0.22),transparent_26%),radial-gradient(circle_at_85%_10%,rgba(255,140,26,0.12),transparent_28%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,auto,64px_64px,64px_64px]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,#050505_0%,rgba(5,5,5,0.88)_45%,rgba(5,5,5,0.65)_100%)]" />

      <div className="relative z-10">









        <section id="conviction-engine" className="ht-home-conviction w-full" aria-label="Top convictions">
          <motion.div
            initial={false}
            className="ht-home-conviction__frame relative overflow-hidden bg-[#04080b]"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,106,0,0.11),transparent_28%),radial-gradient(circle_at_76%_28%,rgba(34,211,238,0.055),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.018),transparent_42%)]" />

            <div className="relative">

              {/* ═══════════════════════════════════════════════════
                  SPOT MOMENTUM — Primary Hero Experience
                  The canonical feed owns first paint and live state so the
                  page never swaps between unrelated loading experiences.
                  ═══════════════════════════════════════════════════ */}
              {(() => {
                // ── Candidate resolution now happens once at component level
                // (resolvedSpotMomentumTarget) so the bull/bear fetch and the
                // displayed ticker can never drift apart. Don't recompute here. ──
                const resolvedTarget = resolvedSpotMomentumTarget;

                // Safely resolve BTC target — always a full Stock object
                const btcTargetRaw = resolvedTarget;
                const btcTarget: Stock | null = btcTargetRaw && typeof btcTargetRaw.symbol === 'string' ? btcTargetRaw as Stock : null;

                // Hero truth source: only the verified backend opportunity may
                // supply the displayed score and story.
                const apiHero = apiMomentum && btcTarget?.symbol === apiMomentum.ticker ? apiMomentum : null;
                // One stable first paint: the canonical opportunity feed owns
                // the loading state. Do not render quote-board stats or any
                // lower command modules underneath a still-loading decision.
                if (!btcTarget && apiOpportunitiesLoading) {
                  return <OpportunityStateCard loading workspace />;
                }

                return (
                  <div className="space-y-4">

                    {/* ── BEFORE THE CROWD — 3 Column Intelligence Layout ── */}
                    {(() => {
                      // ── No qualifying setup — stay minimal, do not force a hero ──
                      if (!btcTarget) {
                        return <OpportunityStateCard loading={false} />;
                      }

                      const heroTicker = btcTarget?.symbol || apiHero?.ticker || "—";
                      return (
                        <div className="relative overflow-hidden rounded-[1.65rem] border border-violet-400/15 bg-gradient-to-br from-black via-black to-violet-500/[0.03]">
                          {apiHero && (
                            <DesktopSpotMomentumWorkspace
                              opportunity={apiHero}
                              framework={smFramework}
                              trace={smTrace}
                              narrative={bullBearData?.ticker === heroTicker ? bullBearData.htRead : null}
                              narrativeLoading={bullBearLoading}
                              dualEngine={isDualEngineConfirmation}
                              watched={watchlist.includes(apiHero.ticker)}
                              decisionLabel={mounted && canonicalLastUpdated ? `Decision ${canonicalLastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Decision pending"}
                              marketContext={marketCtx}
                              contenders={apiMomentumRunnersUp}
                              radarCandidates={apiMomentumRadar}
                              onOpen={() => setSelectedStock(opportunityToStock(apiHero))}
                              onWatch={() => toggleWatchlist(apiHero.ticker)}
                              onSelectContender={(opportunity) => setSelectedStock(opportunityToStock(opportunity))}
                            />
                          )}
                          {/* ── Bull / Bear — full width below ── */}
                          <BullBearPanel
                            ticker={heroTicker}
                            data={bullBearData}
                            loading={bullBearLoading}
                            expanded={bullBearExpanded}
                            onToggle={() => setBullBearExpanded((value) => !value)}
                          />

                        </div>
                      );
                    })()}

                    {/* Before The Crowd uses the same canonical backend opportunity on every surface. */}
                    {apiBeforeCrowdPick ? (
                      <BeforeCrowdCard
                        opportunity={apiBeforeCrowdPick}
                        framework={btcFramework}
                        trace={btcTrace}
                        dualEngine={isDualEngineConfirmation}
                        watched={watchlist.includes(apiBeforeCrowdPick.ticker)}
                        updatedLabel={mounted && beforeCrowdUpdated && Number.isFinite(beforeCrowdUpdated.getTime()) ? `Decision ${beforeCrowdUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Decision pending"}
                        onOpen={() => setSelectedStock(opportunityToStock(apiBeforeCrowdPick))}
                        onWatch={() => toggleWatchlist(apiBeforeCrowdPick.ticker)}
                      />
                    ) : apiOpportunitiesLoading ? (
                      <section className="px-1 py-4" aria-labelledby="desktop-before-crowd-loading-title">
                        <p id="desktop-before-crowd-loading-title" className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Before the Crowd</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-500" role="status" aria-live="polite">Evaluating verified early setups…</p>
                      </section>
                    ) : (
                      <section className="px-1 py-4" aria-labelledby="desktop-before-crowd-empty-title">
                        <p id="desktop-before-crowd-empty-title" className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Before the Crowd</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-500" role="status">No early setup currently clears the Canonical qualification gate.</p>
                      </section>
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
                        ...(highVolume !== null ? [["Unusual Volume", highVolume, sessionNote ?? "3x+ Relative Volume", "text-orange-300"] as [string, number, string, string]] : []),
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

            </div>
          </motion.div>
        </section>





















        <section id="watchlist" className="ht-home-watchlist mx-auto max-w-7xl px-5 py-5" aria-labelledby="home-watchlist-title">
          <motion.div
            className="rounded-[1.5rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl ht-compact-shell"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-4 flex items-center justify-start">
              <div>
                <p className="text-xs font-bold text-zinc-500">
                  Watchlist
                </p>
                <h2 id="home-watchlist-title" className="sr-only">Watchlist</h2>
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

        <footer className="border-t border-orange-500/10 bg-black/60 px-5 py-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-5">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-start">
            <Image src="/logo.png" alt="HT Labs" width={2909} height={1959} className="h-12 w-auto" />

            <p className="text-sm text-zinc-500">
              Track live momentum, catalysts, daily briefings, relative volume,
              signal quality, attention flow, saved AI setups, smart alerts, and
              cloud watchlists in real time. Signals are educational research tools, not financial advice.
            </p>
            </div>
            <nav aria-label="Account and legal" className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-black uppercase tracking-[0.12em] text-zinc-500">
              <Link href="/account" className="transition hover:text-orange-300">Account &amp; Privacy</Link>
              <Link href="/paper" className="transition hover:text-orange-300">Paper Trading</Link>
              <Link href="/privacy" className="transition hover:text-orange-300">Privacy Policy</Link>
              <Link href="/terms" className="transition hover:text-orange-300">Terms of Use</Link>
            </nav>
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
                      HT LABS CANONICAL TICKER READ
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
                      <LiveStockValue symbol={selectedStock.symbol} fallback={selectedOpportunity?.price} />
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-zinc-500">Attention Spike</p>

                    <p
                      className={`mt-1 text-2xl font-black ${
                        !selectedOpportunity
                          ? "text-zinc-500"
                          : selectedOpportunity.change >= 0
                            ? "text-green-400"
                            : "text-red-400"
                      }`}
                    >
                      <LiveStockValue symbol={selectedStock.symbol} field="change" fallback={selectedOpportunity?.change} />
                    </p>
                  </div>
                </div>

                {selectedOpportunityLoading && (
                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-sm font-black text-zinc-300">Loading canonical HT evaluation…</p>
                  </div>
                )}

                {selectedOpportunityError && !selectedOpportunityLoading && (
                  <div className="mb-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.05] p-4">
                    <p className="text-sm font-black text-yellow-300">Not currently ranked</p>
                    <p className="mt-1 text-xs text-zinc-500">{selectedOpportunityError}</p>
                  </div>
                )}

                {selectedOpportunity && selectedOpportunityPresentation && (
                <div className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-4">
                  <div className="flex items-center justify-start">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                        Canonical Opportunity Score
                      </p>
                      <p className="mt-2 text-4xl font-black text-orange-300">
                        {selectedOpportunity.opportunityScore}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Confidence
                      </p>
                      <p className="mt-2 text-3xl font-black text-white">
                        {selectedOpportunity.confidence}%
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-bold text-zinc-400">
                    {selectedOpportunity.eligibility?.eligible
                      ? `${selectedOpportunity.tier ?? "watch"} opportunity`
                      : "Monitoring only"}{" "}
                    • {selectedOpportunityPresentation.riskLabel} risk
                  </p>
                </div>
                )}

                {selectedOpportunity && selectedOpportunityPresentation && (
                <div className="mb-4 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                  <div className="flex items-center justify-start gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-green-400">
                        Canonical Eligibility
                      </p>
                      <p className="mt-2 text-4xl font-black text-green-300">
                        {selectedOpportunity.opportunityScore}/100
                      </p>
                    </div>

                    <div className="rounded-2xl border border-green-500/15 bg-black/30 px-4 py-3 text-right">
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                        Grade
                      </p>
                      <p className="mt-1 text-3xl font-black text-white">
                        {(selectedOpportunity.tier ?? "scanner").toUpperCase()}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Confidence
                      </p>
                      <p className="mt-2 text-sm font-black text-white">
                        {selectedOpportunityPresentation.confidenceLabel}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Crowd
                      </p>
                      <p className="mt-2 text-sm font-black text-white">
                        {selectedOpportunityPresentation.crowdLabel}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Risk
                      </p>
                      <p className="mt-2 text-sm font-black text-white">
                        {selectedOpportunityPresentation.riskLabel}
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        AI Bias
                      </p>
                      <p className="mt-2 text-sm font-black leading-5 text-white">
                        {selectedOpportunity.eligibility?.eligible ? "QUALIFIED" : "REJECTED"}
                      </p>
                    </div>
                  </div>
                </div>
                )}

                <div className="mb-4 rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                    Why It&apos;s Moving
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {selectedOpportunity?.whyItMatters ?? "Waiting for the canonical backend evaluation."}
                  </p>
                </div>

                {selectedOpportunity && selectedOpportunity.catalystScore >= 20 && getTopNews(selectedStock.symbol) && (
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
                    Canonical Risk Control
                  </p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {selectedOpportunity?.riskNote ?? "No canonical trade plan is available for this ticker."}
                  </p>
                </div>

                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Status", selectedOpportunity?.eligibility?.eligible ? "Passed every canonical gate" : "Does not pass the complete gate"],
                    ["Primary Check", selectedOpportunity?.eligibility?.reasons?.[0] ?? selectedOpportunity?.signals?.[0] ?? "No verified signal"],
                    ["Engine", selectedOpportunity?.engineVersion ?? "Canonical evaluation pending"],
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

                {selectedOpportunityFramework && (
                  <div className="mb-4">
                    <OpportunityWindow framework={selectedOpportunityFramework} />
                  </div>
                )}

                {(aiLoading || aiError || aiAnalysis) && (
                <div className="rounded-2xl border border-orange-500/15 bg-orange-500/[0.03] p-4">
                  <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                    Supplemental narrative — does not override the canonical decision
                  </p>
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
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <p className="text-xs text-zinc-500">Powered by HT Labs AI</p>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/market?ticker=${encodeURIComponent(selectedStock.symbol)}`}
                      className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.05] px-4 py-2 text-sm font-black text-cyan-300 transition hover:border-cyan-400/40"
                    >
                      Open Market ↗
                    </Link>
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
                  <p className="text-xs font-semibold text-zinc-500">Alerts fire automatically when a live, backend-approved opportunity reaches feature or hero status.</p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <button
                    key={alert.id}
                    onClick={() => {
                      openReadTicker(alert.ticker);
                      setAlertsOpen(false);
                    }}
                    className={`w-full rounded-2xl border p-4 text-left transition hover:border-orange-400/30 ${
                      alert.type === "before_crowd" ? "border-cyan-400/20 bg-cyan-500/[0.04]" :
                      alert.type === "momentum" ? "border-orange-400/20 bg-orange-500/[0.04]" :
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

      {/* Mobile experience — extracted to app/components/mobile/MobileExperience.tsx */}
      <MobileExperience
        ticker={ticker}
        setTicker={setTicker}
        handleTickerSearch={handleTickerSearch}
        mobileTab={mobileTab}
        setMobileTab={setMobileTab}
        lastUpdated={canonicalLastUpdated}
        canonicalMobileOpportunities={canonicalMobileOpportunities}
        momentumRunnersUp={apiMomentumRunnersUp}
        momentumRadar={apiMomentumRadar}
        mobileCardIndex={mobileCardIndex}
        setMobileCardIndex={setMobileCardIndex}
        mobileTouchStart={mobileTouchStart}
        setMobileTouchStart={setMobileTouchStart}
        apiOpportunitiesLoading={apiOpportunitiesLoading}
        apiMomentum={apiMomentum}
        smFramework={smFramework}
        smTrace={smTrace}
        bullBearData={bullBearData}
        isDualEngineConfirmation={isDualEngineConfirmation}
        watchlist={watchlist}
        recentlyViewed={recentlyViewed}
        setSelectedStock={setSelectedStock}
        toggleWatchlist={toggleWatchlist}
        opportunityToStock={opportunityToStock}
        apiBeforeCrowdPick={apiBeforeCrowdPick}
        btcFramework={btcFramework}
        btcTrace={btcTrace}
        mobileScannerReads={apiFullRankedList}
        openReadTicker={openReadTicker}
        watchlistStocks={watchlistStocks}
        session={session}
        handleSignOut={handleSignOut}
        savedSetups={savedSetups}
        signalMemoryInsight={signalMemoryInsight}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        handleAuth={handleAuth}
        authLoading={authLoading}
        authMessage={authMessage}
        selectedStock={selectedStock}
        selectedOpportunity={selectedOpportunity}
        selectedOpportunityLoading={selectedOpportunityLoading}
        selectedOpportunityPresentation={selectedOpportunityPresentation}
        selectedOpportunityError={selectedOpportunityError}
        selectedOpportunityFramework={selectedOpportunityFramework}
        bullBearLoading={bullBearLoading}
        bullBearTicker={bullBearTicker}
      />
    </main>
  );
}
