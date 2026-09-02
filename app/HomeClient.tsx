"use client";

declare global { interface Window { _htScannerLastFetch?: number } }

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import ScannerGrid from "./components/desktop/ScannerGrid";
import OpportunityStateCard from "./components/OpportunityStateCard";
import OpportunityWindow from "./components/opportunity/OpportunityWindow";
import BullBearPanel from "./components/opportunity/BullBearPanel";
import OpportunityStory from "./components/opportunity/OpportunityStory";
import OpportunityBottomStats from "./components/opportunity/OpportunityBottomStats";
import OpportunityScorePanel from "./components/opportunity/OpportunityScorePanel";
import MomentumContenders, {
  MomentumRadar,
} from "./components/opportunity/MomentumContenders";
import BeforeCrowdCard from "./components/opportunity/BeforeCrowdCard";
import MobileExperience from "./components/mobile/MobileExperience";
import { useMobileAppNavigation } from "./components/MobileAppNavigationContext";
import CryptoMomentumPreview from "./components/crypto/CryptoMomentumPreview";
import HomeTradePlan from "./components/agent/HomeTradePlan";
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
import { useCryptoOpportunityFeed } from "./hooks/useCryptoOpportunityFeed";
import type { CryptoOpportunityFeed } from "@/lib/crypto/contracts";
import {
  getOpportunityPresentation,
  normalizeOpportunity,
  opportunityToStock,
  tradeFrameworkToDisplay,
  type Opportunity as APIOpportunity,
} from "@/lib/opportunity-model";
import { getRelativeVolume } from "@/app/lib/legacy-stock-scoring";

type ScannerFilter = "all" | "hot" | "bullish" | "watchlist";

type HomeClientProps = {
  initialMomentumPayload: OpportunityPayload | null;
  initialBeforeCrowdPayload: OpportunityPayload | null;
  initialCryptoFeed: CryptoOpportunityFeed | null;
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

type ScannerExpansionTicker = {
  symbol: string;
  price: number;
  change?: number;
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

const scannerFilters: { label: string; value: ScannerFilter }[] = [
  { label: "All", value: "all" },
  { label: "Hot", value: "hot" },
  { label: "Bullish", value: "bullish" },
  { label: "Watchlist", value: "watchlist" },
];


export default function HomeClient({
  initialMomentumPayload,
  initialBeforeCrowdPayload,
  initialCryptoFeed,
}: HomeClientProps) {
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
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<APIOpportunity | null>(null);
  const [selectedOpportunityLoading, setSelectedOpportunityLoading] = useState(false);
  const [selectedOpportunityError, setSelectedOpportunityError] = useState("");
  // Deep-link support: Scanner's "Full Read ->" links to /?ticker=SYMBOL.
  // This opens that ticker's detail view on load, whether or not it's
  // already in the currently loaded `stocks` universe. Runs once per
  // page load — doesn't fight the user if they close the modal.
  const deepLinkHandledRef = useRef(false);
  // "Other Active Reads" in the detail modal — backend-driven, same
  // engine as Home/Scanner. Replaces the old convictionLeaders-based
  // list, which had no ETF exclusion and no real-activity requirement.
  // Mobile "Live Scanner" tab data — same backend source as Home,
  // Scanner, and Other Active Reads. Replaces raw stocks.slice(0,30),
  // which showed every ETF in the universe at flat 0% with fake labels.
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [, setIsRefreshing] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [scannerFilter, setScannerFilter] = useState<ScannerFilter>("all");
  const [news, setNews] = useState<Record<string, NewsItem[]>>({});
  const [newsIntel, setNewsIntel] = useState<Record<string, NewsIntel>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mobileCardIndex, setMobileCardIndex] = useState(0);

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

  // HT Alert System
  type HTAlert = {
    id: string;
    ticker: string;
    type: "before_crowd" | "momentum" | "catalyst";
    title: string;
    message: string;
    confidence: number;
    timestamp: Date;
    read: boolean;
  };
  const [alerts, setAlerts] = useState<HTAlert[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const prevAlertTickers = useRef<Set<string>>(new Set());

  const generateAlerts = (opportunities: APIOpportunity[]) => {
    if (!mounted || opportunities.length === 0) return;
    const newAlerts: HTAlert[] = [];
    const now = new Date();

    for (const opportunity of opportunities) {
      if (!opportunity.eligibility?.eligible) continue;
      if (opportunity.tier !== "hero" && opportunity.tier !== "feature") continue;
      if (opportunity.freshnessLabel !== "Live Scan") continue;

      const type: HTAlert["type"] = opportunity.catalystScore >= 20
        ? "catalyst"
        : opportunity.strategy === "before_the_crowd" || opportunity.isBeforeCrowd
          ? "before_crowd"
          : "momentum";
      // One notification per ticker/lane per browser session. A new five-minute
      // source run must not spam the same unchanged conviction repeatedly.
      const alertKey = `${type}-${opportunity.ticker}`;
      if (prevAlertTickers.current.has(alertKey)) continue;

      const title = type === "catalyst"
        ? `⚡ Verified Catalyst — ${opportunity.ticker}`
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
  const {
    feed: cryptoFeed,
    error: cryptoError,
    loading: cryptoLoading,
  } = useCryptoOpportunityFeed(initialCryptoFeed);

  // Bull/Bear case state — generated when top conviction ticker changes
  const [bullBearData, setBullBearData] = useState<BullBearAnalysis | null>(null);
  const [bullBearLoading, setBullBearLoading] = useState(false);
  const [bullBearTicker, setBullBearTicker] = useState<string>("");
  const [bullBearExpanded, setBullBearExpanded] = useState(false);

  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [, setSearchStatus] = useState("Search any ticker to pull it into HT instantly.");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");
  const signalMemoryInsight: { tracked: number; successRate: number | null } | null = null;
  const [savedSetups, setSavedSetups] = useState<string[]>([]);
  const [, setViewedTickers] = useState<string[]>([]);
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

  const filteredOpportunities = useMemo(() => {
    if (scannerFilter === "hot") {
      return apiFullRankedList.filter((opportunity) => Math.abs(opportunity.change) > 4);
    }

    if (scannerFilter === "bullish") {
      return apiFullRankedList.filter((opportunity) => opportunity.change >= 0);
    }

    if (scannerFilter === "watchlist") {
      return apiFullRankedList.filter((opportunity) => watchlist.includes(opportunity.ticker));
    }

    return apiFullRankedList;
  }, [scannerFilter, apiFullRankedList, watchlist]);

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
    const raw = apiMomentum?.displayQuoteAsOf ?? apiMomentum?.scannedAt;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }, [apiMomentum?.displayQuoteAsOf, apiMomentum?.scannedAt]);

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
    if (!btcTickerForAnalysis || btcTickerForAnalysis === bullBearTicker) return;
    let cancelled = false;
    setBullBearLoading(true);
    setBullBearExpanded(false);

    const attempt = (retriesLeft: number) => {
      fetch(`/api/bull-bear?ticker=${btcTickerForAnalysis}`)
        .then((response) => response.json())
        .then((data) => {
          if (cancelled) return;
          setBullBearData(data);
          setBullBearTicker(btcTickerForAnalysis);
          setBullBearLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          if (retriesLeft > 0) {
            window.setTimeout(() => attempt(retriesLeft - 1), 1500);
          } else {
            console.warn("[Bull-Bear] fetch failed after retry:", error);
            setBullBearLoading(false);
          }
        });
    };
    attempt(1);
    return () => {
      cancelled = true;
    };
  }, [btcTickerForAnalysis, bullBearTicker]);

  useEffect(() => {
    if (!selectedStock || selectedStock.symbol === bullBearTicker) return;
    let cancelled = false;
    setBullBearLoading(true);

    const attempt = (retriesLeft: number) => {
      fetch(`/api/bull-bear?ticker=${selectedStock.symbol}`)
        .then((response) => response.json())
        .then((data) => {
          if (cancelled) return;
          setBullBearData(data);
          setBullBearTicker(selectedStock.symbol);
          setBullBearLoading(false);
        })
        .catch((error) => {
          if (cancelled) return;
          if (retriesLeft > 0) {
            window.setTimeout(() => attempt(retriesLeft - 1), 1500);
          } else {
            console.warn("[Bull-Bear] selected ticker fetch failed after retry:", error);
            setBullBearLoading(false);
          }
        });
    };
    attempt(1);
    return () => {
      cancelled = true;
    };
  }, [selectedStock, bullBearTicker]);

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
          throw new Error(
            payload?.detail || payload?.error || "Ticker evaluation failed.",
          );
        }
        if (!payload?.opportunity) {
          throw new Error(
            payload?.message || "No current canonical evaluation is available.",
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
            error?.message || "No current canonical evaluation is available.",
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
    fetch(`/api/opportunity-ticker?ticker=${ticker}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const o = data?.opportunity;
        if (!o) return;
        setSelectedStock({
          symbol: o.ticker,
          price: Number(o.price || 0),
          change: Number(o.change || 0),
          relativeVolume: Number(o.relativeVolume || 0),
          catalystScore: Number(o.catalystScore || 0),
          htSignalScore: Number(o.confidence || o.opportunityScore || 0),
          momentumScore: Number(o.momentumScore || 0),
          crowdScore: Number(o.attentionScore || 0),
          trapScore: Number(o.riskScore || 0),
          signalState: o.stage,
          signalPattern: o.signals?.[2] ?? o.stage,
          changePercent: Number(o.change || 0),
        } as Stock);
      })
      .catch(() => {});
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



  const liveHeroTarget = resolvedSpotMomentumTarget;

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

    const savedWatchlist = localStorage.getItem("headtap-watchlist");
    const savedAiSetups = localStorage.getItem("htlabs-saved-setups");

    if (savedWatchlist) {
      setWatchlist(JSON.parse(savedWatchlist));
    }

    if (savedAiSetups) {
      setSavedSetups(JSON.parse(savedAiSetups));
    }

    const savedViewed = localStorage.getItem("htlabs-viewed-tickers");

    if (savedViewed) {
      setViewedTickers(JSON.parse(savedViewed));
    }

  }, []);

  // Market context — real-time Massive snapshots, refreshed once per minute.
  useEffect(() => {
    const fetchCtx = () => {
      fetch("/api/market-context")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data && !data.error) setMarketCtx(data); })
        .catch(() => {});
    };
    fetchCtx();
    const interval = setInterval(fetchCtx, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Deep-link: open /?ticker=SYMBOL directly, whether or not that ticker
  // is already in the currently loaded `stocks` universe. Scanner's
  // "Full Read ->" links relied on this existing — it never did.
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const ticker = searchParams?.get("ticker");
    if (!ticker) return;

    const symbol = ticker.toUpperCase();
    const existing = stocks.find(s => s.symbol === symbol);
    if (existing) {
      setSelectedStock(existing);
      deepLinkHandledRef.current = true;
      return;
    }

    // Not in the currently loaded universe (e.g. a fresh discovery from
    // the full-market scan). Fetch its real scored read directly instead
    // of silently doing nothing.
    if (stocks.length === 0) return; // wait for first load before deciding it's "missing"

    fetch(`/api/opportunity-ticker?ticker=${symbol}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const o = data?.opportunity;
        if (!o) { deepLinkHandledRef.current = true; return; }
        setSelectedStock({
          symbol: o.ticker,
          price: Number(o.price || 0),
          change: Number(o.change || 0),
          relativeVolume: Number(o.relativeVolume || 0),
          catalystScore: Number(o.catalystScore || 0),
          htSignalScore: Number(o.confidence || o.opportunityScore || 0),
          momentumScore: Number(o.momentumScore || 0),
          crowdScore: Number(o.attentionScore || 0),
          trapScore: Number(o.riskScore || 0),
          signalState: o.stage,
          signalPattern: o.signals?.[2] ?? o.stage,
          changePercent: Number(o.change || 0),
        } as Stock);
        deepLinkHandledRef.current = true;
      })
      .catch(() => { deepLinkHandledRef.current = true; });
  }, [searchParams, stocks]);



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
    // Fetch news for top stocks so hero card always has context. The canonical
    // opportunity hook owns its own immediate load/refresh lifecycle.
    const topStocksForFetch = stocks.slice(0, 12);
    if (liveHeroTarget && !topStocksForFetch.find(s => s.symbol === liveHeroTarget.symbol)) {
      topStocksForFetch.push(liveHeroTarget);
    }
    topStocksForFetch.forEach((stock) => {
      fetchNews(stock.symbol);
    });

    // Fetch expanded scanner universe every 5 minutes
    if (!window._htScannerLastFetch || Date.now() - window._htScannerLastFetch > 5 * 60 * 1000) {
      window._htScannerLastFetch = Date.now();
      fetch("/api/scanner_expansion?type=all")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.tickers?.length) return;
          const existing = new Set(stocks.map(s => s.symbol));
          const scannerTickers = data.tickers as ScannerExpansionTicker[];
          const newTickers: Stock[] = scannerTickers
            .filter((scannerTicker) => !existing.has(scannerTicker.symbol) && scannerTicker.price > 0)
            .map((scannerTicker) => ({ symbol: scannerTicker.symbol, price: scannerTicker.price, change: scannerTicker.change || 0, volume: 0, prevVolume: 0 }));
          if (newTickers.length > 0) {
            setStocks(prev => [...prev, ...newTickers].slice(0, 50));
          }
        })
        .catch(e => console.warn("Scanner expansion failed:", e));
    }

  }, [stocks]);

  const fetchStocksRef = useRef(fetchStocks);
  useEffect(() => {
    fetchStocksRef.current = fetchStocks;
  });

  useEffect(() => {
    void fetchStocksRef.current();
    const interval = window.setInterval(() => {
      void fetchStocksRef.current();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
        const symbols = (data as Array<{ symbol: string }>).map((item) => item.symbol);
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

  // Frontend does not pick homepage winners anymore.
  // The backend/API owns Top Opportunity, Spot Momentum, and Before The Crowd decisions.
  // Secondary opportunity surfaces consume the canonical feed below; there is
  // intentionally no local fallback selector.

  return (
    <main className="ht-simplified-ui min-h-screen overflow-hidden bg-[#050505] text-white">
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
            initial={false}
            className="relative overflow-hidden rounded-[1.65rem] border border-white/10 bg-[#04080b] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.52)] md:p-4"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,106,0,0.11),transparent_28%),radial-gradient(circle_at_76%_28%,rgba(34,211,238,0.055),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.018),transparent_42%)]" />

            <div className="relative space-y-4">
              <div className="flex flex-col gap-3 border-b border-white/10 pb-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-7">
                  <div className="flex items-center gap-2">
                    <Image src="/logo.png" alt="HT Labs" width={2909} height={1959} className="h-8 w-auto" />
                  </div>
                  <nav className="hidden items-center gap-7 text-xs font-bold text-zinc-500 lg:flex">
                    <button
                      type="button"
                      onClick={() => document.getElementById("conviction-engine")?.scrollIntoView({ behavior: "smooth" })}
                      className="transition hover:text-white"
                    >
                      Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => document.getElementById("conviction-engine")?.scrollIntoView({ behavior: "smooth" })}
                      className="text-orange-400 transition hover:text-white"
                    >
                      Top Convictions
                    </button>
                    <Link href="/scanner" className="transition hover:text-white">
                      Scanner
                    </Link>
                    <Link href="/news" className="transition hover:text-white">
                      News
                    </Link>
                    <Link href="/crypto" className="text-cyan-400 transition hover:text-white">
                      Crypto
                    </Link>
                    <Link href="/paper" className="transition hover:text-white">
                      Paper
                    </Link>
                    <button
                      type="button"
                      onClick={() => document.getElementById("watchlist")?.scrollIntoView({ behavior: "smooth" })}
                      className="transition hover:text-white"
                    >
                      Watchlist
                    </button>
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
                const btcScore = Number(apiHero?.opportunityScore ?? 0);

                // One stable first paint: the canonical opportunity feed owns
                // the loading state. Do not render quote-board stats or any
                // lower command modules underneath a still-loading decision.
                if (!btcTarget && apiOpportunitiesLoading) {
                  return <OpportunityStateCard loading />;
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
                      const isCatalystPlay = Boolean(
                        apiHero && (apiHero.catalystScore >= 20 || apiHero.catalystTags.length > 0),
                      );

                      return (
                        <div className="relative overflow-hidden rounded-[1.65rem] border border-violet-400/15 bg-gradient-to-br from-black via-black to-violet-500/[0.03]">

                          {/* Header strip */}
                          <div className="flex items-center justify-between px-5 pt-4 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.9)] animate-pulse" />
                              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-violet-400">Spot Momentum</p>
                            </div>
                            <span className="text-[10px] font-black text-zinc-600">{mounted && canonicalLastUpdated ? canonicalLastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live"}</span>
                          </div>

                          {apiHero && (
                            <div className="px-5 pb-4">
                              <HomeTradePlan symbol={apiHero.ticker} />
                            </div>
                          )}

                          <div className="ht-spot-momentum-columns grid grid-cols-1 divide-y divide-white/[0.06] xl:grid-cols-[0.92fr_0.92fr_1.08fr] xl:divide-x xl:divide-y-0">
                            {apiHero && (
                              <OpportunityStory
                                opportunity={apiHero}
                                framework={smFramework}
                                watched={watchlist.includes(apiHero.ticker)}
                                onOpen={() => setSelectedStock(opportunityToStock(apiHero))}
                                onWatch={() => toggleWatchlist(apiHero.ticker)}
                              />
                            )}
                            {apiHero && (
                              <OpportunityScorePanel
                                opportunity={apiHero}
                                dualEngine={isDualEngineConfirmation}
                                trace={smTrace}
                                narrative={bullBearData?.ticker === heroTicker ? bullBearData.htRead : null}
                                narrativeLoading={bullBearLoading}
                              />
                            )}
                            <MomentumContenders
                              candidates={apiMomentumRunnersUp}
                              onSelect={(opportunity) => setSelectedStock(opportunityToStock(opportunity))}
                            />
                          </div>
                          <MomentumRadar
                            candidates={apiMomentumRadar}
                            onSelect={(opportunity) => setSelectedStock(opportunityToStock(opportunity))}
                          />
                          {/* ── Bottom strip — 4 quick stats ── */}
                          {apiHero && <OpportunityBottomStats opportunity={apiHero} />}

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
                    {apiBeforeCrowdPick && (
                      <BeforeCrowdCard
                        opportunity={apiBeforeCrowdPick}
                        framework={btcFramework}
                        trace={btcTrace}
                        dualEngine={isDualEngineConfirmation}
                        watched={watchlist.includes(apiBeforeCrowdPick.ticker)}
                        updatedLabel={mounted && canonicalLastUpdated ? canonicalLastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live"}
                        onOpen={() => setSelectedStock(opportunityToStock(apiBeforeCrowdPick))}
                        onWatch={() => toggleWatchlist(apiBeforeCrowdPick.ticker)}
                      />
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





















        <section id="crypto-momentum" className="mx-auto hidden max-w-[1488px] px-3 py-3 md:block md:px-6">
          <CryptoMomentumPreview
            feed={cryptoFeed}
            loading={cryptoLoading}
            error={cryptoError}
          />
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

        <ScannerGrid
          ticker={ticker}
          setTicker={setTicker}
          addTicker={addTicker}
          scannerFilters={scannerFilters}
          scannerFilter={scannerFilter}
          setScannerFilter={setScannerFilter}
          filteredOpportunities={filteredOpportunities}
          watchlist={watchlist}
          toggleWatchlist={toggleWatchlist}
          getTopNews={getTopNews}
          toggleSavedSetup={toggleSavedSetup}
          savedSetups={savedSetups}
          openAiModal={openAiModal}
          aiLoading={aiLoading}
          selectedStock={selectedStock}
        />

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
                      {selectedOpportunity
                        ? `$${Number(selectedOpportunity.price).toFixed(2)}`
                        : "—"}
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
                      {selectedOpportunity
                        ? `${selectedOpportunity.change >= 0 ? "+" : ""}${Number(selectedOpportunity.change).toFixed(2)}%`
                        : "—"}
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
        setSelectedStock={setSelectedStock}
        toggleWatchlist={toggleWatchlist}
        opportunityToStock={opportunityToStock}
        apiBeforeCrowdPick={apiBeforeCrowdPick}
        btcFramework={btcFramework}
        btcTrace={btcTrace}
        cryptoFeed={cryptoFeed}
        cryptoLoading={cryptoLoading}
        cryptoError={cryptoError}
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
