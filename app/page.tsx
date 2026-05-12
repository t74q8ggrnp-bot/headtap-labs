"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

type Stock = {
  symbol: string;
  price: number;
  change: number;
};

export default function Home() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [ticker, setTicker] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const defaultTickers = ["AAPL", "TSLA", "NVDA", "AMD", "MSFT", "PLTR"];

  const hotStocks = useMemo(
    () => stocks.filter((stock) => Math.abs(stock.change) > 2),
    [stocks]
  );

  const topStock = stocks[0];

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

  const fetchStocks = async () => {
    try {
      const tickersToFetch = [...new Set([...defaultTickers, ...watchlist])];

      const stockData = await Promise.all(
        tickersToFetch.map(async (symbol) => {
          const res = await fetch(`/api/quote?symbol=${symbol}`);
          const data = await res.json();

          return {
            symbol,
            price: Number(data.c || 0),
            change: Number(data.dp || 0),
          };
        })
      );

      const sortedStocks = stockData.sort(
        (a, b) => Math.abs(b.change) - Math.abs(a.change)
      );

      setStocks(sortedStocks);
    } catch (err) {
      console.error("Stock fetch error:", err);
    }
  };

  useEffect(() => {
    const savedWatchlist = localStorage.getItem("headtap-watchlist");

    if (savedWatchlist) {
      setWatchlist(JSON.parse(savedWatchlist));
    }
  }, []);

  useEffect(() => {
    fetchStocks();

    const interval = setInterval(() => {
      fetchStocks();
    }, 15000);

    return () => clearInterval(interval);
  }, [watchlist]);

  const addTicker = async () => {
    if (!ticker) return;

    const cleanTicker = ticker.toUpperCase().trim();

    try {
      const res = await fetch(`/api/quote?symbol=${cleanTicker}`);
      const data = await res.json();

      const newStock = {
        symbol: cleanTicker,
        price: Number(data.c || 0),
        change: Number(data.dp || 0),
      };

      setStocks((prev) => {
        const filtered = prev.filter((stock) => stock.symbol !== cleanTicker);
        const updated = [...filtered, newStock];

        return updated.sort(
          (a, b) => Math.abs(b.change) - Math.abs(a.change)
        );
      });

      if (!watchlist.includes(cleanTicker)) {
        const updatedWatchlist = [...watchlist, cleanTicker];
        setWatchlist(updatedWatchlist);

        localStorage.setItem(
          "headtap-watchlist",
          JSON.stringify(updatedWatchlist)
        );
      }

      setTicker("");
    } catch (err) {
      console.error(err);
    }
  };

  const toggleWatchlist = (symbol: string) => {
    let updatedWatchlist: string[];

    if (watchlist.includes(symbol)) {
      updatedWatchlist = watchlist.filter((item) => item !== symbol);
    } else {
      updatedWatchlist = [...watchlist, symbol];
    }

    setWatchlist(updatedWatchlist);

    localStorage.setItem(
      "headtap-watchlist",
      JSON.stringify(updatedWatchlist)
    );
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
              watchlists, and AI-powered setup analysis built for traders who
              move fast.
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
                ["🛡️", "Built for Traders", "Speed. Edge. Accuracy."],
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
                LIVE
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Total Scanned", stocks.length || 0, "+ Live"],
                ["High Momentum", hotStocks.length || 0, "±2% movers"],
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
              ["⚡", "Real-Time Scanning", "Scan live stocks with fast quote refreshes."],
              ["🧠", "AI Momentum Score", "Use AI setup reads to understand bias and risk."],
              ["🎯", "Smart Ranking", "Sort tickers by strongest absolute momentum."],
              ["🔔", "Watchlist Ready", "Save favorite tickers locally on your device."],
              ["🔒", "Clean & Reliable", "Simple signals, fast interface, focused workflow."],
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
                  Saved tickers stay on this device for now.
                </p>
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
                Auto-refreshes every 15 seconds.
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

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stocks.map((stock, index) => {
              const isBullish = stock.change >= 0;
              const isHot = Math.abs(stock.change) > 2;
              const score = getMomentumScore(stock);
              const chartBars = isBullish
                ? [22, 35, 30, 48, 44, 70, 62, 88]
                : [88, 62, 70, 44, 48, 30, 35, 22];

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
                      AI READY
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

                  <div className="mt-6 h-24 rounded-3xl border border-white/10 bg-gradient-to-r from-orange-500/10 to-orange-900/10 p-3">
                    <div className="flex h-full items-end gap-1">
                      {chartBars.map((height, i) => (
                        <motion.div
                          key={i}
                          className={`flex-1 rounded-t ${
                            isBullish ? "bg-orange-400/80" : "bg-red-400/70"
                          }`}
                          initial={{ height: "10%" }}
                          whileInView={{ height: `${height}%` }}
                          transition={{ duration: 0.55, delay: i * 0.035 }}
                          viewport={{ once: true }}
                        />
                      ))}
                    </div>
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
          </div>
        </section>

        <footer className="border-t border-orange-500/10 bg-black/60 px-5 py-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <img src="/logo.png" alt="HT Labs" className="h-12 w-auto" />

            <p className="text-sm text-zinc-500">
              Spot momentum before the crowd.
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
                      HEADTAP AI Setup
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
                  <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
                    Momentum Score
                  </p>
                  <p className="mt-2 text-4xl font-black text-orange-300">
                    {getMomentumScore(selectedStock)}
                  </p>
                  <p className="mt-1 text-sm font-bold text-zinc-400">
                    {selectedStock.change >= 0 ? "Bullish setup" : "Bearish setup"}
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
                        HEADTAP AI is analyzing this setup...
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
                        HEADTAP Analysis
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
                    Powered by HEADTAP AI
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