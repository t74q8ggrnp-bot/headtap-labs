"use client";

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

      <div className="relative z-10">
        <header className="sticky top-0 z-40 border-b border-orange-500/20 bg-black/75 backdrop-blur-2xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
            <img
              src="/logo.png"
              alt="HT Labs"
              className="h-12 w-auto"
            />

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

            <button
              onClick={() =>
                document
                  .getElementById("scanner")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-3 text-sm font-black text-white shadow-[0_0_30px_rgba(255,106,0,0.35)] transition hover:scale-[1.02]"
            >
              Start Scanning →
            </button>
          </div>
        </header>

        <section
          id="home"
          className="mx-auto grid max-w-7xl gap-14 px-5 py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-16"
        >
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-orange-400">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
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
          </div>

          <div className="rounded-[2rem] border border-orange-500/20 bg-zinc-950/70 p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src="/logo.png"
                  alt="HT Labs"
                  className="h-10 w-auto"
                />

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
                ["Total Scanned", stocks.length || 0],
                ["High Momentum", hotStocks.length || 0],
                ["Watchlist Hits", watchlist.length || 0],
                ["Top Mover", topStock?.symbol || "--"],
              ].map((stat) => (
                <div
                  key={stat[0]}
                  className="rounded-2xl border border-white/10 bg-black/40 p-4"
                >
                  <p className="text-xs text-zinc-500">{stat[0]}</p>

                  <p className="mt-2 text-2xl font-black">{stat[1]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="border-t border-orange-500/10 bg-black/60 px-5 py-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <img
              src="/logo.png"
              alt="HT Labs"
              className="h-12 w-auto"
            />

            <p className="text-sm text-zinc-500">
              Spot momentum before the crowd.
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}