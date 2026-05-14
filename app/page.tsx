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

const scannerFilters: { label: string; value: ScannerFilter }[] = [
  { label: "All", value: "all" },
  { label: "Hot", value: "hot" },
  { label: "Bullish", value: "bullish" },
  { label: "Watchlist", value: "watchlist" },
];

export default function Home() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [ticker, setTicker] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [scannerFilter, setScannerFilter] = useState<ScannerFilter>("all");
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");

  const defaultTickers = [
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

  const marketBadges: MarketBadge[] = [
    { symbol: "SPY", label: "Broad Market", change: fallbackQuotes.SPY.change },
    { symbol: "QQQ", label: "Tech Strength", change: fallbackQuotes.QQQ.change },
    { symbol: "DIA", label: "Blue Chips", change: fallbackQuotes.DIA.change },
  ];

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

  const getConfidence = (stock: Stock) => {
    const base = getMomentumScore(stock);
    const momentumBonus = stock.change >= 0 ? 3 : -4;

    return Math.min(98, Math.max(45, base + momentumBonus));
  };

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

    if (savedWatchlist) {
      setWatchlist(JSON.parse(savedWatchlist));
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

  const openAiModal = async (stock: Stock) => {
    setSelectedStock(stock);
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

{/* V11 CLOUD SYNC */}
<div className="mb-6 rounded-2xl border border-orange-500/20 bg-black/40 p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
        V11 CLOUD SYNC
      </p>
      <h2 className="mt-1 text-xl font-black">
        Cross-Device Watchlist Engine
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
              hunting momentum before the crowd reacts.
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
                <p className="font-black">AI Momentum Score</p>
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
                "Real-Time Scanning",
                "Scan live stocks with fast quote refreshes.",
              ],
              [
                "🧠",
                "AI Momentum Score",
                "Use AI setup reads to understand bias, confidence, and risk.",
              ],
              [
                "🎯",
                "Smart Ranking",
                "Rank tickers by momentum, volatility, and attention pressure.",
              ],
              [
                "🔔",
                "Cloud Watchlists",
                "Save favorite tickers locally on your device.",
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
                V10 Intelligence Layer
              </p>
              <h3 className="text-3xl font-black">Catalysts & Social Heat</h3>
              <p className="mt-2 text-sm text-zinc-500">
                Catalyst, sentiment, and setup intelligence built to help traders spot attention before the move gets crowded.
              </p>
            </div>
            <div className="rounded-full border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-xs font-black text-orange-300">
              Product Mode: V11 Sync Engine
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
                  V10 Alert Feed
                </p>
                <h3 className="mt-1 text-2xl font-black">Live Setup Alerts</h3>
              </div>
              <span className="rounded-full bg-green-500/15 px-3 py-2 text-xs font-black text-green-400">
                ACTIVE
              </span>
            </div>

            <div className="space-y-3">
              {[
                ["SNAL", "Extreme attention spike detected", "High Risk", "Now"],
                ["QUBT", "Momentum holding above scanner average", "Watch", "2m ago"],
                ["NVDA", "Large-cap AI strength supporting tech tape", "Bullish", "5m ago"],
                ["MSTR", "Crypto-linked momentum expanding", "Volatile", "8m ago"],
              ].map((alert, index) => (
                <div
                  key={alert[0]}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/35 p-4"
                >
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-400">
                      {alert[0]}
                    </p>
                    <p className="mt-1 font-black text-white">{alert[1]}</p>
                    <p className="mt-1 text-xs text-zinc-500">{alert[3]}</p>
                  </div>
                  <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-black text-orange-300">
                    {alert[2]}
                  </span>
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
                V10 Account Layer
              </p>
              <h3 className="mt-2 text-3xl font-black">Cloud Trader Workspace</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-500">
                Sign in to prepare HT Labs for cloud watchlists, saved setups, alerts,
                and personalized trader intelligence.
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
                  Logged-in traders can now prepare for cloud watchlist syncing across devices.
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

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-orange-400">AI Trade Plan</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {getTradePlan(stock)}
                    </p>
                  </div>

                  <motion.button
                    onClick={() => openAiModal(stock)}
                    disabled={aiLoading}
                    className="mt-6 w-full rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 py-4 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition disabled:opacity-50"
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
              Track momentum, catalysts, trader attention, setup quality, and cloud watchlists in real time.
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
