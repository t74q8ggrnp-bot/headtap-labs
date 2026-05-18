"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import MiniStockChart from "./components/MiniStockChart";
import { supabase } from "@/lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

type Stock = {
  symbol: string;
  price: number;
  change: number;
};

type MarketBadge = {
  symbol: string;
  label: string;
  change: number;
};

type ScannerFilter = "all" | "hot" | "bullish" | "watchlist";

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
    title: "Retail Momentum Spike",
    impact: "High",
    note: "Unusual move with high trader attention. Watch volume fade risk.",
  },
  {
    symbol: "NVDA",
    title: "AI Leadership Tape",
    impact: "Medium",
    note: "Large-cap AI strength keeps the broader tech trade supported.",
  },
  {
    symbol: "QUBT",
    title: "Speculative Quantum Watch",
    impact: "Watch",
    note: "High beta name. Better after reclaim/hold confirmation.",
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

const scannerFilters: { label: string; value: ScannerFilter }[] = [
  { label: "All", value: "all" },
  { label: "Hot", value: "hot" },
  { label: "Bullish", value: "bullish" },
  { label: "Watchlist", value: "watchlist" },
];

export default function Home() {
  const initialStocks = Object.values(fallbackQuotes).filter((stock) => defaultStarterTickers.includes(stock.symbol));

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
  const [marketSession, setMarketSession] = useState<"live" | "premarket" | "afterhours">("live");
  const [news, setNews] = useState<Record<string, NewsItem[]>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");
  const [savedSetups, setSavedSetups] = useState<string[]>([]);
  const [traderMode, setTraderMode] = useState<"Scalper" | "Momentum" | "Swing" | "Conservative" | "Aggressive">("Momentum");
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [viewedTickers, setViewedTickers] = useState<string[]>([]);


  const defaultTickers = defaultStarterTickers;

  const marketBadges: MarketBadge[] = [
    { symbol: "SPY", label: "Broad Market", change: fallbackQuotes.SPY.change },
    { symbol: "QQQ", label: "Tech Strength", change: fallbackQuotes.QQQ.change },
    { symbol: "DIA", label: "Blue Chips", change: fallbackQuotes.DIA.change },
  ];

  const tickerTape = useMemo(
    () => (stocks.length ? stocks.slice(0, 8) : defaultTickers.slice(0, 8).map((symbol) => fallbackQuotes[symbol]).filter(Boolean)),
    [stocks]
  );

  const hotStocks = useMemo(
    () => stocks.filter((stock) => Math.abs(stock.change) > 4),
    [stocks]
  );

  const bullishCount = useMemo(
    () => stocks.filter((stock) => stock.change >= 0).length,
    [stocks]
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
    () => [...stocks].filter((stock) => stock.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    [stocks]
  );

  const topLosers = useMemo(
    () => [...stocks].filter((stock) => stock.change < 0).sort((a, b) => a.change - b.change).slice(0, 3),
    [stocks]
  );

  const getMomentumScore = (stock: Stock) => {
    const isBullish = stock.change >= 0;

    return Math.min(
      99,
      Math.max(
        52,
        Math.round(60 + Math.abs(stock.change) * 6 + (isBullish ? 8 : -2))
      )
    );
  };

  const getRiskLabel = (stock: Stock) => {
    const move = Math.abs(stock.change);

    if (move >= 10) return "Extreme Volatility";
    if (move >= 5) return "High Momentum";
    if (move >= 2) return "Active";
    return "Normal";
  };

  const getRelativeVolume = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const symbolBoosts: Record<string, number> = {
      SNAL: 6.8,
      QUBT: 4.4,
      MSTR: 3.2,
      PLTR: 2.6,
      NVDA: 2.1,
    };

    return Number((symbolBoosts[stock.symbol] || Math.max(0.8, 1 + move / 3)).toFixed(1));
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
    const rvol = getRelativeVolume(stock);
    const move = Math.abs(stock.change);
    const hasNews = Boolean(news[stock.symbol]?.[0]?.headline);
    const isSaved = watchlist.includes(stock.symbol) || savedSetups.includes(stock.symbol);

    let score = 45;

    score += Math.min(24, move * 2);
    score += Math.min(18, rvol * 3);

    if (hasNews) score += 8;
    if (isSaved) score += 5;
    if (stock.symbol === "SNAL" || stock.symbol === "QUBT") score += 6;

    return Math.min(99, Math.max(35, Math.round(score)));
  };

  const getAttentionTrend = (stock: Stock) => {
    const score = getAttentionScore(stock);

    if (score >= 90) return "Surging";
    if (score >= 80) return "Accelerating";
    if (score >= 68) return "Building";
    if (stock.change < 0) return "Fading";

    return "Watching";
  };

  const getNotificationTrigger = (stock: Stock) => {
    const attention = getAttentionScore(stock);
    const signal = getSignalQuality(stock);
    const rvol = getRelativeVolume(stock);

    if (attention >= 90 && signal >= 85) return "Push-worthy: attention + signal quality aligned.";
    if (attention >= 80 && rvol >= 3) return "Notify watchlist users if momentum holds.";
    if (signal >= 85) return "High-quality setup; monitor for breakout trigger.";
    if (stock.change < 0) return "No push. Wait for reclaim confirmation.";

    return "Monitor only. Not notification-worthy yet.";
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
    const hasNews = Boolean(news[stock.symbol]?.[0]?.headline);

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

    if (stock.change >= 6 && quality >= 80) return "Gap-and-go candidate if volume holds.";
    if (stock.change >= 3) return "Needs opening range confirmation.";
    if (stock.change < 0) return "Watch for reclaim before considering long bias.";

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
    if (news[stock.symbol]?.[0]?.headline) score += 5;

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
      return "Bullish but extended. Best if volume sustains after a pullback.";
    }

    if (stock.change >= 4) {
      return "Bullish continuation possible above intraday support.";
    }

    if (stock.change < 0) {
      return "Weak structure. Needs reclaim confirmation before bullish bias.";
    }

    return "Neutral setup. Wait for volume, news, or attention confirmation.";
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
    const topNews = news[stock.symbol]?.[0];

    if (topNews?.headline && score >= 82) {
      return `${stock.symbol} has a strong setup score with fresh catalyst activity. Watch for continuation confirmation.`;
    }

    if (stock.change >= 8) {
      return `${stock.symbol} is showing aggressive momentum. Avoid chasing vertical candles; wait for reclaim or pullback.`;
    }

    if (stock.change >= 4) {
      return `${stock.symbol} momentum is building above scanner threshold. Watch volume and higher-low structure.`;
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
      return "Momentum Risk-On";
    }

    if (marketPulse === "Defensive") {
      return "Defensive Tape";
    }

    if (hotStocks.length >= 3) {
      return "Selective Momentum";
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
    const extendedNames = stocks.filter((stock) => Math.abs(stock.change) >= 8).length;

    if (extendedNames >= 3) return "High chase risk. Focus on pullbacks, reclaims, and smaller size.";
    if (bearishCount > bullishCount) return "Defensive conditions. Avoid forcing longs until reclaim strength appears.";
    if (hotStocks.length > 0) return "Momentum active. Respect volatility and avoid vertical candle entries.";

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
  }, [stocks, news, watchlist, savedSetups, marketPulse, bullishCount, bearishCount]);

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

    return "Momentum-focused trader seeking attention and continuation setups.";
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
        return "Momentum strongest when attention and signal quality align.";
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
        ? "Swing continuation structure looks constructive."
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

    return "Momentum conditions are improving with trader attention.";
  };


  const getConvictionScore = (stock: Stock) => {
    const signal = getSignalQuality(stock);
    const attention = getAttentionScore(stock);
    const setup = getSetupScore(stock);
    const rvol = getRelativeVolume(stock);
    const hasNews = Boolean(news[stock.symbol]?.[0]?.headline);

    let conviction = Math.round(signal * 0.42 + attention * 0.34 + setup * 0.24);

    if (hasNews) conviction += 4;
    if (rvol >= 3) conviction += 3;
    if (Math.abs(stock.change) >= 12) conviction -= traderMode === "Aggressive" ? 2 : 7;
    if (traderMode === "Conservative" && getRiskProfile(stock).includes("HIGH")) conviction -= 8;
    if (traderMode === "Aggressive" && attention >= 80) conviction += 4;
    if (traderMode === "Swing" && signal >= 82) conviction += 3;

    return Math.min(99, Math.max(35, conviction));
  };

  const getConvictionLabel = (stock: Stock) => {
    const conviction = getConvictionScore(stock);

    if (conviction >= 90) return "High Conviction";
    if (conviction >= 82) return "Actionable Watch";
    if (conviction >= 72) return "Developing";
    if (conviction >= 62) return "Low Conviction";

    return "Avoid / Wait";
  };

  const getConvictionReason = (stock: Stock) => {
    const conviction = getConvictionScore(stock);
    const signal = getSignalQuality(stock);
    const attention = getAttentionScore(stock);

    if (conviction >= 90) {
      return `${stock.symbol} has strong alignment between signal quality, attention, setup score, and trader profile.`;
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
    if (conviction >= 72) return "Wait For Trigger";
    if (conviction >= 62) return "Monitor Only";

    return "Stand Down";
  };

  const convictionLeaders = useMemo(() => {
    return [...stocks]
      .sort((a, b) => getConvictionScore(b) - getConvictionScore(a))
      .slice(0, 6);
  }, [stocks, news, watchlist, savedSetups, traderMode]);


  const priorityTarget = convictionLeaders[0];
  const secondaryTarget = convictionLeaders[1];
  const dangerTarget = topLosers[0];

  const commandCenterLeaders = convictionLeaders.slice(0, 3);
  const v26ReadinessScore = priorityTarget
    ? Math.round(
        getConvictionScore(priorityTarget) * 0.45 +
          getAttentionScore(priorityTarget) * 0.3 +
          getSignalQuality(priorityTarget) * 0.25
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
        : "Momentum is tradable only if volume and structure continue confirming."
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
    if (priorityTarget?.symbol === "SNAL" || priorityTarget?.symbol === "QUBT") {
      return "Speculative momentum is leading trader attention.";
    }

    if (priorityTarget?.symbol === "NVDA" || priorityTarget?.symbol === "AMD" || priorityTarget?.symbol === "SMCI") {
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

  const getTradePlan = (stock: Stock) => {
    if (stock.change >= 8) {
      return "Momentum is hot. Wait for pullback/reclaim instead of chasing the biggest candle.";
    }

    if (stock.change >= 2) {
      return "Constructive setup. Watch volume, VWAP hold, and higher-low continuation.";
    }

    if (stock.change < 0) {
      return "Defensive tape. Needs reclaim confirmation before treating it as a long setup.";
    }

    return "Neutral setup. Keep it on watch until volume or news confirms direction.";
  };

  const fetchNews = async (symbol: string) => {
    if (news[symbol]) return;

    try {
      const response = await fetch(`/api/news?symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`News request failed for ${symbol}`);
      }

      const data = await response.json();

      setNews((prev) => ({
        ...prev,
        [symbol]: Array.isArray(data) ? data : [],
      }));
    } catch (error) {
      console.error("NEWS FETCH ERROR:", error);

      setNews((prev) => ({
        ...prev,
        [symbol]: [],
      }));
    }
  };

  const getTopNews = (symbol: string) => {
    return news[symbol]?.[0];
  };

  const getWhyMoving = (stock: Stock) => {
    const move = Math.abs(stock.change);
    const topNews = news[stock.symbol]?.[0];

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
      return "Momentum is above scanner threshold with enough movement to justify active watch.";
    }

    if (stock.change < 0) {
      return "Weak tape today. Needs reclaim confirmation before treating it as a long setup.";
    }

    return "Normal movement. Keep it on watch until volume, news, or attention confirms direction.";
  };

  const fetchSingleStock = async (symbol: string): Promise<Stock> => {
    try {
      const res = await fetch(`/api/quote?symbol=${symbol}`);

      if (!res.ok) {
        throw new Error(`Quote request failed for ${symbol}`);
      }

      const data = await res.json();
      const price = Number(data.c || 0);
      const change = Number(data.dp || 0);

      if (!price && !change) {
        throw new Error(`Empty quote returned for ${symbol}`);
      }

      return {
        symbol,
        price,
        change,
      };
    } catch (err) {
      console.warn(`Using fallback quote for ${symbol}`, err);

      return (
        fallbackQuotes[symbol] || {
          symbol,
          price: 0,
          change: 0,
        }
      );
    }
  };

  const fetchStocks = async () => {
    try {
      setIsRefreshing(true);

      const tickersToFetch = [...new Set([...defaultTickers, ...watchlist])];

      const stockData = await Promise.all(
        tickersToFetch.map((symbol) => fetchSingleStock(symbol))
      );

      const sortedStocks = stockData.sort(
        (a, b) => Math.abs(b.change) - Math.abs(a.change)
      );

      setStocks(sortedStocks);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Stock fetch error:", err);

      const fallbackData = defaultTickers
        .map((symbol) => fallbackQuotes[symbol])
        .filter(Boolean)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

      setStocks(fallbackData);
      setLastUpdated(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
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
  }, [session]);

  useEffect(() => {
    stocks.slice(0, 6).forEach((stock) => {
      fetchNews(stock.symbol);
    });
  }, [stocks]);

  useEffect(() => {
    fetchStocks();

    const interval = setInterval(() => {
      fetchStocks();
    }, 8000);

    return () => clearInterval(interval);
  }, [watchlist]);

  const handleAuth = async (mode: "signin" | "signup") => {
    if (!authEmail || !authPassword) {
      setAuthMessage("Enter an email and password first.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthMessage("");

      const result =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({
              email: authEmail,
              password: authPassword,
            })
          : await supabase.auth.signUp({
              email: authEmail,
              password: authPassword,
            });

      if (result.error) {
        setAuthMessage(result.error.message);
        return;
      }

      setAuthMessage(
        mode === "signin"
          ? "Signed in successfully."
          : "Account created. Check your email if confirmation is required."
      );
    } catch (error) {
      console.error("AUTH ERROR:", error);
      setAuthMessage("Auth request failed.");
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
      await supabase
        .from("HT Labs")
        .delete()
        .eq("user_id", session.user.id);

      if (symbols.length === 0) return;

      const payload = symbols.map((symbol) => ({
        user_id: session.user.id,
        symbol,
      }));

      await supabase.from("HT Labs").insert(payload);

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
        .from("HT Labs")
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

  const addTicker = async () => {
    if (!ticker) return;

    const cleanTicker = ticker.toUpperCase().trim();

    const newStock = await fetchSingleStock(cleanTicker);

    setStocks((prev) => {
      const filtered = prev.filter((stock) => stock.symbol !== cleanTicker);
      const updated = [...filtered, newStock];

      return updated.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    });

    if (!watchlist.includes(cleanTicker)) {
      const updatedWatchlist = [...watchlist, cleanTicker];
      setWatchlist(updatedWatchlist);

      localStorage.setItem("headtap-watchlist", JSON.stringify(updatedWatchlist));

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

  return (
    <main className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,106,0,0.22),transparent_26%),radial-gradient(circle_at_85%_10%,rgba(255,140,26,0.12),transparent_28%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:auto,auto,64px_64px,64px_64px]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,#050505_0%,rgba(5,5,5,0.88)_45%,rgba(5,5,5,0.65)_100%)]" />

      <div className="relative z-10">

{/* V26 COMMAND CENTER UPGRADE */}
<div className="mb-6 rounded-2xl border border-orange-500/20 bg-black/40 p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
        V26 COMMAND CENTER UPGRADE
      </p>
      <h2 className="mt-1 text-xl font-black">
        Command Center + Live Opportunity Routing
      </h2>
    </div>

    <div className="flex gap-2 text-xs font-black">
      <span className="rounded-full bg-green-500/15 px-3 py-2 text-green-400">
        MARKET LIVE
      </span>
      <span className="rounded-full bg-orange-500/15 px-3 py-2 text-orange-300">
        ALERT ENGINE ACTIVE
      </span>
    </div>
  </div>
</div>

        <header className="sticky top-0 z-40 border-b border-orange-500/20 bg-black/75 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
            <motion.div
              className="flex items-center gap-4"
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
            >
              <img src="/logo.png" alt="HT Labs" className="h-12 w-auto" />
            </motion.div>

            <nav className="hidden items-center gap-8 text-sm font-semibold text-zinc-400 md:flex">
              <a className="text-orange-500" href="#home">
                Home
              </a>
              <a className="transition hover:text-orange-400" href="#scanner">
                Scanner
              </a>
              <a className="transition hover:text-orange-400" href="#command-center">
                Command
              </a>
              <a className="transition hover:text-orange-400" href="#priority-flow">
                Priority
              </a>
              <a className="transition hover:text-orange-400" href="#market-narrative">
                Narrative
              </a>
              <a className="transition hover:text-orange-400" href="#watchlist">
                Watchlist
              </a>
              <a className="transition hover:text-orange-400" href="#account">
                Account
              </a>
              <a className="transition hover:text-orange-400" href="#features">
                Features
              </a>
            </nav>

            <motion.button
              onClick={() =>
                document
                  .getElementById("scanner")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white shadow-[0_0_30px_rgba(255,106,0,0.35)] transition"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Start Scanning →
            </motion.button>
          </div>
        </header>

        <section className="border-b border-orange-500/10 bg-black/60 px-5 py-3">
          <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-black text-green-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
              LIVE TAPE
            </div>

            <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto whitespace-nowrap pb-1 text-sm [scrollbar-width:none]">
              {tickerTape.map((stock) => (
                <div
                  key={`tape-${stock.symbol}`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2"
                >
                  <span className="font-black text-white">{stock.symbol}</span>
                  <span className="text-zinc-500">${Number(stock.price || 0).toFixed(2)}</span>
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

        <section
          id="home"
          className="mx-auto grid max-w-7xl gap-14 px-5 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-16"
        >
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-orange-400">
              <span className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_18px_rgba(255,106,0,0.9)]" />
              AI-Powered Stock Scanner
            </div>

            <h1 className="max-w-3xl text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl md:text-6xl xl:text-7xl">
              AI That Spots{" "}
              <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-orange-700 bg-clip-text text-transparent">
                Momentum
              </span>{" "}
              Before The Crowd.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
              Real-time market scanning, live momentum rankings, personal
              watchlists, and AI-powered setup analysis built for traders
              hunting momentum before the crowd reacts. V26 turns the page into a
              cleaner command center: one priority target, stronger confirmation
              logic, sharper risk language, and a premium dashboard flow.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <motion.button
                onClick={() =>
                  document
                    .getElementById("scanner")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-7 py-4 text-sm font-black text-white shadow-[0_0_35px_rgba(255,106,0,0.35)] transition"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Run AI Scan →
              </motion.button>

              <motion.button
                onClick={() =>
                  document
                    .getElementById("watchlist")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="rounded-2xl border border-orange-500/30 bg-white/[0.03] px-7 py-4 text-sm font-black text-white transition hover:border-orange-400 hover:bg-orange-500/10"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                View Watchlist
              </motion.button>
            </div>

            <div className="mt-9 grid gap-4 sm:grid-cols-3">
              {[
                ["⚡", "Real-Time Data", "Live market updates"],
                ["🧠", "AI-Powered", "Smarter analysis"],
                ["🎯", "Momentum Edge", "Ranked by strongest moves."],
              ].map((item, index) => (
                <motion.div
                  key={item[1]}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.25 + index * 0.12 }}
                >
                  <div className="rounded-2xl bg-orange-500/10 p-3 text-xl text-orange-400">
                    {item[0]}
                  </div>
                  <div>
                    <p className="font-black">{item[1]}</p>
                    <p className="text-sm text-zinc-500">{item[2]}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {marketBadges.map((badge) => (
                <div
                  key={badge.symbol}
                  className="rounded-2xl border border-white/10 bg-black/35 p-4"
                >
                  <div className="flex items-center justify-between">
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
            className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 shadow-[0_0_70px_rgba(255,106,0,0.12)] backdrop-blur-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-orange-500/20 bg-black p-2">
                  <img src="/logo.png" alt="HT Labs" className="h-10 w-auto" />
                </div>
                <div>
                  <h2 className="text-xl font-black">Market Overview</h2>
                  <p className="text-sm text-zinc-500">
                    Real-time market insights and scanner overview.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-400">
                {isRefreshing ? "SCANNING" : "LIVE"}
              </div>
            </div>

            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <p className="text-xs text-zinc-500">Market Pulse</p>
                <p className="mt-2 text-2xl font-black">{marketPulse}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <p className="text-xs text-zinc-500">Bullish / Bearish</p>
                <p className="mt-2 text-2xl font-black">
                  {bullishCount}/{bearishCount}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <p className="text-xs text-zinc-500">Last Updated</p>
                <p className="mt-2 text-lg font-black">
                  {lastUpdated ? lastUpdated.toLocaleTimeString() : "--"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Total Scanned", stocks.length || 0, "+ Live"],
                ["High Momentum", hotStocks.length || 0, "±4% movers"],
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

            <div className="mt-5 rounded-3xl border border-white/10 bg-black/45 p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-black">AI Setup Score</p>
                <span className="rounded-lg border border-orange-500/20 px-2 py-1 text-xs text-orange-400">
                  1D
                </span>
              </div>

              <div className="flex h-40 items-end gap-2 rounded-2xl bg-gradient-to-t from-orange-500/10 to-transparent p-3">
                {[28, 34, 48, 42, 64, 55, 72, 46, 52, 68, 61, 84].map(
                  (height, index) => (
                    <motion.div
                      key={index}
                      className="flex-1 rounded-t bg-gradient-to-t from-orange-700 to-orange-400 shadow-[0_0_20px_rgba(255,106,0,0.25)]"
                      initial={{ height: "8%" }}
                      animate={{ height: `${height}%` }}
                      transition={{ duration: 0.7, delay: 0.25 + index * 0.04 }}
                    />
                  )
                )}
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-black/45 p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-black">Top Momentum Picks</p>
                <button
                  onClick={() =>
                    document
                      .getElementById("scanner")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  className="text-xs font-black text-orange-400"
                >
                  Full Scanner →
                </button>
              </div>

              <div className="space-y-3">
                {stocks.slice(0, 5).map((stock, index) => (
                  <motion.div
                    key={stock.symbol}
                    className="grid grid-cols-[32px_1fr_90px_80px] items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-3 text-sm"
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

                {stocks.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-zinc-500">
                    Scanner warming up. Quotes will populate automatically.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </section>


        <section id="command-center" className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="overflow-hidden rounded-[2rem] border border-orange-500/25 bg-zinc-950/85 shadow-[0_0_90px_rgba(255,106,0,0.14)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="border-b border-white/10 bg-gradient-to-r from-orange-500/10 via-white/[0.03] to-transparent p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                    V26 Command Center
                  </p>
                  <h3 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                    One Screen. One Priority. Cleaner Decisions.
                  </h3>
                  <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-zinc-400">
                    V26 compresses the scanner into a tighter trader workflow: market mood, priority target, confirmation stack, and risk rule before the user starts clicking random tickers.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[520px]">
                  <div className="rounded-2xl border border-white/10 bg-black/45 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Readiness</p>
                    <p className="mt-2 text-3xl font-black text-orange-300">{v26ReadinessScore}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/45 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Status</p>
                    <p className="mt-2 text-sm font-black text-green-300">{v26CommandStatus}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/45 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Mode</p>
                    <p className="mt-2 text-sm font-black text-white">{traderMode}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/45 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Pulse</p>
                    <p className="mt-2 text-sm font-black text-white">{marketPulse}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 p-5 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[1.75rem] border border-orange-500/25 bg-orange-500/5 p-5">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-orange-400">Primary Target</p>
                    <h4 className="mt-2 text-7xl font-black tracking-tight text-white">
                      {priorityTarget?.symbol || "--"}
                    </h4>
                    <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-zinc-300">
                      {priorityTarget ? getConvictionReason(priorityTarget) : "Waiting for a clean priority target."}
                    </p>
                  </div>

                  <div className="min-w-[230px] rounded-3xl border border-white/10 bg-black/45 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Decision</p>
                    <p className="mt-2 text-2xl font-black text-green-300">
                      {priorityTarget ? getDecisionClarity(priorityTarget) : "Standby"}
                    </p>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-700 via-orange-500 to-green-400"
                        style={{ width: `${Math.min(100, Math.max(8, v26ReadinessScore))}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs font-bold leading-5 text-zinc-400">
                      Command center confidence blends conviction, attention, and signal quality.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {[
                    ["Conviction", priorityTarget ? getConvictionScore(priorityTarget) : "--"],
                    ["Attention", priorityTarget ? getAttentionScore(priorityTarget) : "--"],
                    ["Signal Quality", priorityTarget ? getSignalQuality(priorityTarget) : "--"],
                  ].map((item) => (
                    <div key={item[0]} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{item[0]}</p>
                      <p className="mt-2 text-3xl font-black text-white">{item[1]}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl border border-red-500/15 bg-red-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-red-300">Risk Rule</p>
                  <p className="mt-2 text-sm font-black leading-6 text-white">{v26RiskRule}</p>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[1.75rem] border border-white/10 bg-black/35 p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Top 3 Routing</p>
                      <h4 className="mt-1 text-2xl font-black">Priority Stack</h4>
                    </div>
                    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs font-black text-green-300">LIVE</span>
                  </div>

                  <div className="space-y-3">
                    {commandCenterLeaders.map((stock, index) => (
                      <button
                        key={`command-${stock.symbol}`}
                        onClick={() => openAiModal(stock)}
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-orange-500/40 hover:bg-orange-500/10"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/10 text-sm font-black text-orange-300">
                              #{index + 1}
                            </span>
                            <div>
                              <p className="text-lg font-black text-white">{stock.symbol}</p>
                              <p className="text-xs font-bold text-zinc-500">{getConvictionLabel(stock)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-black ${stock.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%
                            </p>
                            <p className="text-xs text-zinc-500">Score {getConvictionScore(stock)}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-white/10 bg-black/35 p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">V26 Product Polish</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      ["Cleaner Hierarchy", "The user sees the main opportunity before the full scanner."],
                      ["Sharper Risk Language", "Every target now comes with an action rule, not just a score."],
                      ["Premium Flow", "Dashboard feels more like an app and less like a long landing page."],
                      ["Conversion Ready", "The section gives people a reason to sign in and save setups."],
                    ].map((item) => (
                      <div key={item[0]} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="font-black text-white">{item[0]}</p>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">{item[1]}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>


        <section id="priority-flow" className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="rounded-[2rem] border border-orange-500/30 bg-zinc-950/80 p-5 shadow-[0_0_80px_rgba(255,106,0,0.16)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  V26 Command Center Upgrade
                </p>
                <h3 className="mt-1 text-4xl font-black">
                  Top Opportunity Right Now
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  The scanner is now routing attention toward the highest-conviction setup instead of making every signal feel equal.
                </p>
              </div>

              <div className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                FLOW ACTIVE
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[1.75rem] border border-orange-500/25 bg-orange-500/5 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                      Primary Focus
                    </p>

                    <h3 className="mt-2 text-6xl font-black tracking-tight text-white">
                      {priorityTarget?.symbol || "--"}
                    </h3>

                    <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-zinc-300">
                      {priorityTarget ? getPriorityReason(priorityTarget) : "Waiting for live opportunity."}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:w-[320px]">
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Conviction
                      </p>
                      <p className="mt-2 text-3xl font-black text-orange-300">
                        {priorityTarget ? getConvictionScore(priorityTarget) : "--"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Decision
                      </p>
                      <p className="mt-2 text-sm font-black text-green-300">
                        {priorityTarget ? getDecisionClarity(priorityTarget) : "--"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Attention
                      </p>
                      <p className="mt-2 text-3xl font-black text-white">
                        {priorityTarget ? getAttentionScore(priorityTarget) : "--"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        Signal
                      </p>
                      <p className="mt-2 text-3xl font-black text-white">
                        {priorityTarget ? getSignalQuality(priorityTarget) : "--"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                    AI Flow Directive
                  </p>

                  <p className="mt-2 text-sm font-black leading-6 text-white">
                    {getFlowDirective()}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Secondary Watch
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-3xl font-black text-white">
                        {secondaryTarget?.symbol || "--"}
                      </h4>

                      <p className="mt-2 text-xs leading-5 text-zinc-400">
                        {secondaryTarget ? getPriorityReason(secondaryTarget) : "Waiting for signal."}
                      </p>
                    </div>

                    <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-300">
                      WATCH
                    </span>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-red-500/15 bg-red-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-red-400">
                    Avoid / Danger
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-3xl font-black text-white">
                        {dangerTarget?.symbol || "--"}
                      </h4>

                      <p className="mt-2 text-xs leading-5 text-zinc-400">
                        {dangerTarget ? getPriorityReason(dangerTarget) : "No active danger setup."}
                      </p>
                    </div>

                    <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300">
                      AVOID
                    </span>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Attention Compression
                  </p>

                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    Lower-quality setups are visually deprioritized so the trader sees the strongest opportunity first.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>


        <section id="market-narrative" className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="rounded-[2rem] border border-green-500/20 bg-zinc-950/80 p-5 shadow-[0_0_80px_rgba(34,197,94,0.08)] backdrop-blur-xl"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
                  V26 Command Center Upgrade
                </p>
                <h3 className="mt-1 text-4xl font-black">
                  Live Tape Commentary
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  HT Labs now explains what the market is doing, why attention is shifting, and where trader focus is rotating.
                </p>
              </div>

              <div className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                NARRATIVE LIVE
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
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

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Priority
                    </p>
                    <p className="mt-2 text-2xl font-black text-orange-300">
                      {priorityTarget?.symbol || "--"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Market Pulse
                    </p>
                    <p className="mt-2 text-2xl font-black text-white">
                      {marketPulse}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                      Hot Movers
                    </p>
                    <p className="mt-2 text-2xl font-black text-white">
                      {hotStocks.length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {narrativeFeed.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[1.5rem] border border-white/10 bg-black/35 p-4"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                      {item.label}
                    </p>

                    <p className="mt-2 text-sm font-black leading-6 text-white">
                      {item.value}
                    </p>
                  </div>
                ))}

                <div className="rounded-[1.5rem] border border-orange-500/15 bg-orange-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-orange-400">
                    Keep The Tab Open
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    The narrative updates as the scanner refreshes, making HT Labs feel more like a live trading desk than a static dashboard.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-5 py-10">
          <div className="mb-8 text-center">
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
                "AI Setup Score",
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

        <section className="mx-auto max-w-7xl px-5 py-8">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                V25 Intelligence Layer
              </p>
              <h3 className="text-3xl font-black">Catalysts & Social Heat</h3>
              <p className="mt-2 text-sm text-zinc-500">
                Catalyst, sentiment, and setup intelligence built to help traders spot attention before the move gets crowded.
              </p>
            </div>
            <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-xs font-black text-orange-300">
              Product Mode: V26 Command Center Upgrade
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <motion.div
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true }}
              className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-black">Catalyst Radar</p>
                <span className="rounded-full border border-orange-500/20 px-3 py-1 text-xs font-black text-orange-400">
                  LIVE CATALYSTS
                </span>
              </div>

              <div className="space-y-3">
                {catalystRadar.map((item) => (
                  <div
                    key={`${item.symbol}-${item.title}`}
                    className="rounded-2xl border border-white/10 bg-black/35 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                          {item.symbol}
                        </p>
                        <h4 className="mt-1 font-black">{item.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-zinc-500">
                          {item.note}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${
                          item.impact === "High"
                            ? "bg-orange-500 text-white"
                            : item.impact === "Medium"
                              ? "bg-orange-500/15 text-orange-300"
                              : "bg-white/10 text-zinc-300"
                        }`}
                      >
                        {item.impact}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08 }}
              viewport={{ once: true }}
              className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-black">Social Heat</p>
                <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-black text-green-400">
                  ATTENTION FLOW
                </span>
              </div>

              <div className="space-y-3">
                {heatSignals.map((signal) => (
                  <div key={signal.symbol} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                    <div className="flex items-center justify-between">
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
                ))}
              </div>
            </motion.div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-orange-400">Top Gainers</p>
              <div className="mt-4 space-y-3">
                {topGainers.map((stock, index) => (
                  <div key={stock.symbol} className="flex items-center justify-between rounded-2xl bg-white/[0.03] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-zinc-500">#{index + 1}</span>
                      <span className="font-black">{stock.symbol}</span>
                    </div>
                    <span className="font-black text-green-400">+{stock.change.toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-orange-400">Trade Discipline</p>
              <div className="mt-4 space-y-3">
                {["No chase entries on vertical candles", "Wait for VWAP reclaim or higher-low setup", "Small size on extreme volatility names"].map((rule, index) => (
                  <div key={rule} className="flex gap-3 rounded-2xl bg-white/[0.03] p-4 text-sm text-zinc-300">
                    <span className="font-black text-orange-400">0{index + 1}</span>
                    <span>{rule}</span>
                  </div>
                ))}
                {topLosers[0] && (
                  <div className="rounded-2xl border border-red-500/10 bg-red-500/5 p-4 text-sm text-zinc-300">
                    Weakest tape: <span className="font-black text-red-400">{topLosers[0].symbol}</span> {topLosers[0].change.toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>


        <section className="mx-auto grid max-w-7xl gap-5 px-5 py-8 lg:grid-cols-3">
          <motion.div
            className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl lg:col-span-2"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  V25 Alert Feed
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
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/35 p-4"
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
                    <p className="mt-2 font-black text-white">{alert.message}</p>
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
            className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl"
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
                ["Small-Cap Momentum", 88],
              ].map((sector) => (
                <div key={sector[0]}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-black text-white">{sector[0]}</span>
                    <span className="font-black text-orange-300">{sector[1]}%</span>
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




        <section className="mx-auto max-w-7xl px-5 py-8">
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <motion.div
              className="rounded-[2rem] border border-green-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl"
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              viewport={{ once: true }}
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
                    V25 Smart Alerts
                  </p>
                  <h3 className="mt-1 text-3xl font-black">AI Alert Engine</h3>
                  <p className="mt-2 text-sm text-zinc-500">
                    Alerts generated from setup score, catalyst presence, momentum pressure, and risk profile.
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
                    className="rounded-2xl border border-white/10 bg-black/35 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
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
              className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl"
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              viewport={{ once: true }}
            >
              <div className="mb-5">
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  Watchlist Intelligence
                </p>
                <h3 className="mt-1 text-2xl font-black">Saved Setup Monitor</h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Your saved symbols become the personal alert layer.
                </p>
              </div>

              <div className="space-y-3">
                {(watchlist.length ? watchlist : ["Add tickers"]).map((symbol) => {
                  const savedStock = stocks.find((stock) => stock.symbol === symbol);

                  return (
                    <div
                      key={`watch-intel-${symbol}`}
                      className="rounded-2xl border border-white/10 bg-black/35 p-4"
                    >
                      {savedStock ? (
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-white">{savedStock.symbol}</p>
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
                          Star tickers in the scanner to activate personal alerts.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                  Real News Engine
                </p>
                <h3 className="mt-1 text-3xl font-black">Latest Catalysts</h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Pulling recent company headlines from the live news route.
                </p>
              </div>

              <span className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                FINNHUB NEWS
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {stocks.slice(0, 6).map((stock) => {
                const item = getTopNews(stock.symbol);

                return (
                  <div
                    key={`news-${stock.symbol}`}
                    className="rounded-2xl border border-white/10 bg-black/35 p-4"
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
                        No recent catalyst found yet. HT Labs will keep scanning.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </section>

        <section id="account" className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="grid gap-5 rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl lg:grid-cols-[0.9fr_1.1fr]"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                V23 Account Layer
              </p>
              <h3 className="mt-2 text-3xl font-black">Cloud Trader Workspace</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-500">
                Sign in to prepare HT Labs for cloud watchlists, saved setups, smart alerts,
                and AI-powered personalized trader intelligence.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                  ["Cloud Watchlists", session ? "Ready" : "Login Required"],
                  ["Saved Alerts", "Next"],
                  ["Personal Setups", "Next"],
                ].map((item) => (
                  <div
                    key={item[0]}
                    className="rounded-2xl border border-white/10 bg-black/35 p-4"
                  >
                    <p className="text-xs text-zinc-500">{item[0]}</p>
                    <p className="mt-2 font-black text-orange-300">{item[1]}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-black/40 p-5">
              {session ? (
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
                    Connected
                  </p>
                  <h4 className="mt-2 text-2xl font-black">Welcome Back</h4>
                  <p className="mt-2 break-all text-sm text-zinc-400">
                    {session.user.email}
                  </p>

                  <div className="mt-5 rounded-2xl border border-green-500/15 bg-green-500/10 p-4">
                    <p className="text-sm font-black text-green-300">
                      Auth is live. Cloud sync is ready to wire into Supabase tables next.
                    </p>
                  </div>

                  <button
                    onClick={handleSignOut}
                    className="mt-5 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white transition hover:opacity-90"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.3em] text-orange-400">
                    Sign In / Sign Up
                  </p>
                  <h4 className="mt-2 text-2xl font-black">Unlock Cloud Mode</h4>

                  <div className="mt-5 space-y-3">
                    <input
                      type="email"
                      placeholder="Email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-4 text-sm outline-none transition placeholder:text-zinc-700 focus:border-orange-500"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-4 text-sm outline-none transition placeholder:text-zinc-700 focus:border-orange-500"
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        onClick={() => handleAuth("signin")}
                        disabled={authLoading}
                        className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white transition disabled:opacity-50"
                      >
                        {authLoading ? "Loading..." : "Sign In"}
                      </button>
                      <button
                        onClick={() => handleAuth("signup")}
                        disabled={authLoading}
                        className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-5 py-3 text-sm font-black text-orange-300 transition hover:bg-orange-500/20 disabled:opacity-50"
                      >
                        Create Account
                      </button>
                    </div>

                    {authMessage && (
                      <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300">
                        {authMessage}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </section>


        <section className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="rounded-[2rem] border border-green-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-green-400">
                  Saved AI Setups
                </p>
                <h3 className="mt-1 text-3xl font-black">Setup History</h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Save interesting AI setups and revisit their score, bias, and alert state later.
                </p>
              </div>

              <span className="rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-xs font-black text-green-400">
                {savedSetups.length} Saved
              </span>
            </div>

            {savedSetups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/35 p-5 text-sm text-zinc-500">
                No saved AI setups yet. Use the “Save Setup” button inside scanner cards to build your setup history.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {savedSetups.map((symbol) => {
                  const stock = stocks.find((item) => item.symbol === symbol);

                  if (!stock) {
                    return (
                      <div
                        key={`saved-${symbol}`}
                        className="rounded-2xl border border-white/10 bg-black/35 p-4"
                      >
                        <p className="font-black text-white">{symbol}</p>
                        <p className="mt-2 text-sm text-zinc-500">
                          Waiting for quote refresh.
                        </p>
                      </div>
                    );
                  }

                  const setupScore = getSetupScore(stock);

                  return (
                    <div
                      key={`saved-${symbol}`}
                      className="rounded-2xl border border-white/10 bg-black/35 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.25em] text-green-400">
                            {stock.symbol}
                          </p>
                          <h4 className="mt-2 text-2xl font-black text-white">
                            {setupScore}/99 · {getSetupGrade(setupScore)}
                          </h4>
                        </div>

                        <button
                          onClick={() => toggleSavedSetup(stock.symbol)}
                          className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-black text-red-300"
                        >
                          Remove
                        </button>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-zinc-400">
                        {getAlertMessage(stock)}
                      </p>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                            Trend
                          </p>
                          <p className="mt-1 text-sm font-black text-white">
                            {getScoreTrend(stock)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                            Risk
                          </p>
                          <p className="mt-1 text-sm font-black text-white">
                            {getRiskProfile(stock)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </section>

        <section id="watchlist" className="mx-auto max-w-7xl px-5 py-8">
          <motion.div
            className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5 backdrop-blur-xl"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                  Watchlist
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Logged-in traders can sync watchlists across devices with Supabase cloud storage.
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

        <section id="scanner" className="mx-auto max-w-7xl px-5 py-8 pb-24">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-orange-400">
                Scanner
              </p>
              <h3 className="text-3xl font-black">Ranked Momentum Feed</h3>
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
              const score = getMomentumScore(stock);
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
                  className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/80 p-5 shadow-xl shadow-black/30 transition hover:border-orange-500/40 hover:shadow-[0_0_45px_rgba(255,106,0,0.14)]"
                >
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-700 via-orange-400 to-orange-700" />

                  <div className="mb-5 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-500/20 bg-orange-500/10 text-sm font-black text-orange-400">
                        #{index + 1}
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                          Momentum
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

                    <div className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-black text-green-300">
                      SIGNAL {getSignalQuality(stock)}
                    </div>

                    <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                      ATTENTION {getAttentionScore(stock)}
                    </div>

                    <div className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-black text-green-300">
                      CONVICTION {getConvictionScore(stock)}
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
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                        AI Confidence
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

                  <div className="mt-6 rounded-3xl border border-white/10 bg-gradient-to-r from-orange-500/10 to-orange-900/10 p-3">
                    <MiniStockChart
                      symbol={stock.symbol}
                      price={stock.price}
                      change={stock.change}
                    />
                  </div>

                  <div className="mt-4 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                        Signal Quality
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

                  <div className="mt-4 rounded-2xl border border-orange-500/15 bg-orange-500/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-orange-400">Why It&apos;s Moving</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {getWhyMoving(stock)}
                    </p>
                  </div>

                  {getTopNews(stock.symbol) && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
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

                  <div className="mt-4 rounded-2xl border border-green-500/15 bg-green-500/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-green-400">
                        AI Setup Intelligence
                      </p>

                      <div className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-black text-green-300">
                        {getSetupScore(stock)}/99 · {getSetupGrade(getSetupScore(stock))}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          Momentum Confidence
                        </p>
                        <p className="mt-2 text-sm font-black text-white">
                          {getMomentumConfidence(getSetupScore(stock))}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          Crowd Strength
                        </p>
                        <p className="mt-2 text-sm font-black text-white">
                          {getCrowdStrength(stock)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          Risk Profile
                        </p>
                        <p className="mt-2 text-sm font-black text-white">
                          {getRiskProfile(stock)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                          AI Bias
                        </p>
                        <p className="mt-2 text-sm font-black leading-5 text-white">
                          {getAIBias(stock)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-orange-400">AI Trade Plan</p>
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
                    {savedSetups.includes(stock.symbol) ? "Saved Setup ✓" : "Save Setup"}
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
                  className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5"
                >
                  <div className="h-5 w-24 animate-pulse rounded bg-white/10" />
                  <div className="mt-4 h-10 w-32 animate-pulse rounded bg-white/10" />
                  <div className="mt-6 h-28 animate-pulse rounded-3xl bg-white/10" />
                </div>
              ))}
          </div>
        </section>

        <footer className="border-t border-orange-500/10 bg-black/60 px-5 py-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <img src="/logo.png" alt="HT Labs" className="h-12 w-auto" />

            <p className="text-sm text-zinc-500">
              Track live momentum, catalysts, daily briefings, relative volume, signal quality, attention flow, saved AI setups, smart alerts, and cloud watchlists in real time.
            </p>
          </div>
        </footer>

        {selectedStock && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="w-full max-w-md overflow-hidden rounded-[2rem] border border-orange-500/30 bg-zinc-950 shadow-2xl shadow-orange-500/20"
              initial={{ opacity: 0, scale: 0.94, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="border-b border-white/10 bg-orange-500/10 p-5">
                <div className="flex items-center justify-between">
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

              <div className="p-5">
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-zinc-500">Price</p>

                    <p className="mt-1 text-2xl font-black text-white">
                      ${Number(selectedStock.price || 0).toFixed(2)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-zinc-500">Momentum</p>

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
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                        Momentum Score
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
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-green-400">
                        V15 AI Setup Intelligence
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
                  <p className="text-xs uppercase tracking-[0.25em] text-orange-400">Why It&apos;s Moving</p>
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
                  <p className="text-xs uppercase tracking-[0.25em] text-orange-400">Suggested Trade Plan</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {getTradePlan(selectedStock)}
                  </p>
                </div>

                <div className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-4">
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

                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                  <p className="text-xs text-zinc-500">
                    Powered by HT Labs AI
                  </p>

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
    </main>
  );
}
