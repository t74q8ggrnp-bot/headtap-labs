"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [stocks, setStocks] = useState<any[]>([]);
  const [ticker, setTicker] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selectedStock, setSelectedStock] = useState<any>(null);

  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const defaultTickers = ["AAPL", "TSLA", "NVDA", "AMD", "MSFT"];

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

  const openAiModal = async (stock: any) => {
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
    <main className="min-h-screen bg-black text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.16),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(37,99,235,0.18),_transparent_30%)]" />

      <div className="relative z-10">
        <div className="border-b border-cyan-500/20 bg-slate-950/80 px-5 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">
                HEADTAP LABS
              </p>

              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
                AI Momentum Scanner
              </h1>
            </div>

            <div className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-300 shadow-lg shadow-cyan-500/10 sm:text-sm">
              LIVE MARKET
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-5 py-6 pb-24">
          <div className="mb-5 flex gap-3">
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
              className="flex-1 rounded-2xl border border-white/10 bg-slate-950/90 px-4 py-4 text-sm outline-none"
            />

            <button
              onClick={addTicker}
              className="rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-black text-black"
            >
              Add
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stocks.map((stock, index) => {
              const isBullish = stock.change >= 0;

              return (
                <div
                  key={stock.symbol}
                  className="rounded-[2rem] border border-cyan-500/20 bg-slate-950/90 p-5"
                >
                  <div className="mb-5 flex items-start justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-cyan-400">
                        Momentum
                      </p>

                      <h2 className="text-3xl font-black">
                        {stock.symbol}
                      </h2>
                    </div>

                    <button
                      onClick={() => toggleWatchlist(stock.symbol)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm"
                    >
                      {watchlist.includes(stock.symbol) ? "⭐" : "☆"}
                    </button>
                  </div>

                  <div>
                    <p className="text-sm text-slate-400">
                      Current Price
                    </p>

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

                  <button
                    onClick={() => openAiModal(stock)}
                    disabled={aiLoading}
                    className="mt-6 w-full rounded-2xl bg-cyan-500 py-4 text-sm font-black text-black"
                  >
                    {aiLoading && selectedStock?.symbol === stock.symbol
                      ? "Analyzing..."
                      : "View AI Setup"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {selectedStock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4">
            <div className="w-full max-w-md rounded-[2rem] border border-cyan-400/30 bg-slate-950">
              <div className="border-b border-white/10 bg-cyan-500/10 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">
                      HEADTAP AI Setup
                    </p>

                    <h2 className="mt-1 text-3xl font-black text-white">
                      {selectedStock.symbol}
                    </h2>
                  </div>

                  <button
                    onClick={() => setSelectedStock(null)}
                    className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-white/70"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-slate-400">
                      Price
                    </p>

                    <p className="mt-1 text-2xl font-black text-white">
                      ${Number(selectedStock.price || 0).toFixed(2)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase text-slate-400">
                      Momentum
                    </p>

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

                <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  {aiLoading && (
                    <p className="text-sm font-semibold text-cyan-300">
                      HEADTAP AI is analyzing this setup...
                    </p>
                  )}

                  {!aiLoading && aiError && (
                    <div>
                      <p className="text-sm font-black text-red-400">
                        AI Error
                      </p>

                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {aiError}
                      </p>
                    </div>
                  )}

                  {!aiLoading && !aiError && aiAnalysis && (
                    <div>
                      <p className="mb-3 text-xs uppercase tracking-[0.25em] text-cyan-400">
                        HEADTAP Analysis
                      </p>

                      <div className="max-h-[420px] overflow-y-auto pr-1">
                        <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
                          {aiAnalysis}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
                  <p className="text-xs text-slate-500">
                    Powered by HEADTAP AI
                  </p>

                  <button
                    onClick={() => setSelectedStock(null)}
                    className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-black text-black"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}