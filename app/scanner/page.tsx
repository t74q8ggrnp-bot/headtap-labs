"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

const EXCLUDED = new Set(["SQQQ","TQQQ","SOXS","SOXL","UVXY","SVXY","SPXS","SPXL","LABD","LABU","TZA","TNA","FAZ","FAS","YANG","YINN","SDOW","UDOW","ERY","ERX","HIBL","HIBS","DRIP","GUSH"]);

const UNIVERSE = ["NVDA","PLTR","AMD","TSLA","QUBT","SNAL","SMCI","MSTR","HOOD","AAPL","MSFT","SPY","QQQ","IWM","XLK","XLF","XLE","SMH","ARKK","GOOGL","META","AMZN","NFLX","AVGO","ORCL","CRM","ADBE","NOW","UBER","SHOP","ARM","MU","TSM","INTC","MRVL","QCOM","CRWD","PANW","NET","DDOG","SNOW","AI","SOUN","BBAI","PATH","COIN","RIVN","SOFI","RDDT","DJT","GME","AMC","AFRM","UPST","CVNA","DKNG","RBLX","ROKU","PINS","NIO","XPEV","LI","LUNR","RKLB","ASTS","IONQ","RGTI","QBTS","ACHR","JOBY","KULR","SERV","IOVA","TEM","HIMS","RXRX","BEAM","CRSP","EDIT","NTLA","GERN","TGTX","SMMT","NVAX","MARA","RIOT","CLSK","HUT","WULF","JPM","BAC","GS","MS","WFC","PYPL","V","MA","AXP","SCHW","DIS","NKE","SBUX","CMG","COST","WMT","TGT","LULU","ELF","CELH","CAVA","RCL","CCL","DAL","UAL","AAL","XOM","CVX","OXY","FCX","NEM","CAT","GE","BA","LMT","RTX","LLY","NVO","MRNA","PFE","MRK","ABBV","UNH","ISRG"].filter(s => !EXCLUDED.has(s));

type Stock = { symbol: string; price: number; change: number; volume?: number; prevVolume?: number };
type ScannerFilter = "all" | "momentum" | "recovery" | "unusual" | "watchlist";

const FILTERS: { label: string; value: ScannerFilter }[] = [
  { label: "All Names", value: "all" },
  { label: "🔥 Momentum", value: "momentum" },
  { label: "📉 Recovery", value: "recovery" },
  { label: "⚡ Unusual Volume", value: "unusual" },
  { label: "⭐ Watchlist", value: "watchlist" },
];

const getRelVol = (s: Stock) => {
  if (s.volume && s.volume > 0 && s.prevVolume && s.prevVolume > 0) {
    return Number(Math.min(10, Math.max(0.1, s.volume / s.prevVolume)).toFixed(1));
  }
  const move = Math.abs(s.change);
  return Number(Math.max(0.8, 1 + move / 3).toFixed(1));
};

const getHTScore = (s: Stock) => {
  const rvol = getRelVol(s);
  const move = Math.abs(s.change);
  let score = 0;
  score += Math.min(50, rvol * 9);
  score += Math.min(30, move * 3.5);
  if (s.change > 0) score += 15;
  if (rvol >= 3) score += 8;
  return Math.min(99, Math.round(score));
};

const getLabel = (s: Stock) => {
  const score = getHTScore(s);
  const rvol = getRelVol(s);
  if (s.change < 0 && rvol >= 3) return { emoji: "📉", label: "Recovery Watch", color: "text-cyan-300" };
  if (s.change < 0) return { emoji: "📉", label: "Buyers Needed", color: "text-red-300" };
  if (rvol >= 5 && Math.abs(s.change) > 8) return { emoji: "🔥", label: "Crowd Igniting", color: "text-orange-300" };
  if (rvol >= 3 && Math.abs(s.change) < 5) return { emoji: "👀", label: "Quiet Accumulation", color: "text-cyan-300" };
  if (s.change >= 15) return { emoji: "🚀", label: "Parabolic Move", color: "text-orange-300" };
  if (s.change >= 8) return { emoji: "🔥", label: "Hot Mover", color: "text-orange-300" };
  if (score >= 88) return { emoji: "🎯", label: "Clean Breakout", color: "text-green-300" };
  if (score >= 78) return { emoji: "🧲", label: "Attention Magnet", color: "text-orange-300" };
  if (rvol >= 2) return { emoji: "📈", label: "Active", color: "text-green-300" };
  return { emoji: "🔎", label: "On Watch", color: "text-zinc-300" };
};

const getTier = (score: number) => {
  if (score >= 95) return { label: "Elite", color: "text-orange-300 bg-orange-500/15 border-orange-500/30" };
  if (score >= 85) return { label: "Strong", color: "text-green-300 bg-green-500/10 border-green-500/20" };
  if (score >= 70) return { label: "Developing", color: "text-yellow-300 bg-yellow-500/10 border-yellow-500/20" };
  return { label: "Watchlist", color: "text-zinc-400 bg-white/5 border-white/10" };
};

export default function ScannerPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<ScannerFilter>("all");
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"score" | "change" | "symbol">("score");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("htlabs-watchlist");
      if (saved) setWatchlist(JSON.parse(saved));
    } catch {}
  }, []);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      localStorage.setItem("htlabs-watchlist", JSON.stringify(next));
      return next;
    });
  };

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/bulk-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: UNIVERSE }),
      });
      const data = await res.json();
      const quotes: Record<string, { price: number; change: number; volume?: number; prevVolume?: number }> = data.quotes ?? {};
      const result: Stock[] = UNIVERSE.map(symbol => ({
        symbol,
        price: quotes[symbol]?.price ?? 0,
        change: quotes[symbol]?.change ?? 0,
        volume: quotes[symbol]?.volume ?? 0,
        prevVolume: quotes[symbol]?.prevVolume ?? 0,
      }));
      setStocks(result);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Scanner fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const filtered = useMemo(() => {
    let list = stocks.filter(s => !EXCLUDED.has(s.symbol));
    if (search) list = list.filter(s => s.symbol.includes(search.toUpperCase()));
    if (filter === "momentum") list = list.filter(s => s.change > 0 && getRelVol(s) >= 2);
    if (filter === "recovery") list = list.filter(s => s.change < 0 && getRelVol(s) >= 2);
    if (filter === "unusual") list = list.filter(s => getRelVol(s) >= 3);
    if (filter === "watchlist") list = list.filter(s => watchlist.includes(s.symbol));
    if (sortBy === "score") list = [...list].sort((a, b) => getHTScore(b) - getHTScore(a));
    if (sortBy === "change") list = [...list].sort((a, b) => b.change - a.change);
    if (sortBy === "symbol") list = [...list].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return list;
  }, [stocks, filter, search, sortBy, watchlist]);

  const gainers = stocks.filter(s => s.change > 0).length;
  const losers = stocks.filter(s => s.change < 0).length;
  const unusual = stocks.filter(s => getRelVol(s) >= 3).length;
  const isMarketClosed = stocks.length > 0 && stocks.every(s => s.price === 0 && s.change === 0);

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,106,0,0.12),transparent_40%)]" />
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#050505]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-6">
            <a href="/"><img src="/logo.png" alt="HT Labs" className="h-10 w-auto" /></a>
            <nav className="hidden items-center gap-5 text-sm font-semibold text-zinc-500 md:flex">
              <a href="/" className="transition hover:text-orange-300">Dashboard</a>
              <span className="text-orange-400">Scanner</span>
              <a href="/news" className="transition hover:text-orange-300">News</a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && <span className="hidden text-[10px] font-black uppercase tracking-[0.15em] text-zinc-600 sm:block">Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
            <button onClick={fetchAll} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black text-zinc-300 transition hover:border-orange-500/40 hover:text-orange-300">↻ Refresh</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-400">HT Labs</p>
          <h1 className="mt-1 text-4xl font-black tracking-tight">Full Scanner</h1>
          <p className="mt-2 text-sm text-zinc-500">Every name HT is watching — ranked by conviction. Auto-refreshes every 30s.</p>
        </div>
        {!loading && (
          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Scanned", value: stocks.length, color: "text-white" },
              { label: "Green", value: gainers, color: "text-green-300" },
              { label: "Red", value: losers, color: "text-red-300" },
              { label: "Unusual Flow", value: unusual, color: "text-orange-300" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">{label}</p>
                <p className={`mt-1 font-mono text-xl font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}
        {!loading && isMarketClosed && (
          <div className="mb-6 rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.05] px-5 py-3 flex items-center gap-3">
            <span className="text-lg">🌙</span>
            <div>
              <p className="text-sm font-black text-yellow-300">Market Closed</p>
              <p className="text-[10px] font-semibold text-zinc-500">Showing last session prices. Live data resumes at market open.</p>
            </div>
          </div>
        )}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button key={f.value} onClick={() => setFilter(f.value)} className={`rounded-full border px-4 py-2 text-xs font-black transition ${filter === f.value ? "border-orange-500 bg-orange-500 text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-orange-500/40 hover:text-orange-300"}`}>{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Search ticker..." value={search} onChange={e => setSearch(e.target.value)} className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-2 text-sm outline-none placeholder:text-zinc-700 focus:border-orange-500 w-40" />
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-400 outline-none focus:border-orange-500">
              <option value="score">Sort: Score</option>
              <option value="change">Sort: % Change</option>
              <option value="symbol">Sort: Symbol</option>
            </select>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              <p className="mt-4 text-sm font-semibold text-zinc-500">Scanning {UNIVERSE.length} tickers...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-32 text-center"><p className="text-zinc-500">No tickers match this filter right now.</p></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((stock, index) => {
              const score = getHTScore(stock);
              const tier = getTier(score);
              const { emoji, label, color } = getLabel(stock);
              const rvol = getRelVol(stock);
              const isBullish = stock.change >= 0;
              return (
                <div key={stock.symbol} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-5 transition hover:border-orange-500/30">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10 text-xs font-black text-orange-400">#{index + 1}</div>
                      <div>
                        <p className="text-2xl font-black">{stock.symbol}</p>
                        <p className={`text-[10px] font-black ${color}`}>{emoji} {label}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${tier.color}`}>{tier.label} · {score}</span>
                      <button onClick={() => toggleWatchlist(stock.symbol)} className="text-sm transition hover:scale-110">{watchlist.includes(stock.symbol) ? "⭐" : "☆"}</button>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-mono font-black">${stock.price.toFixed(2)}</p>
                      <p className={`text-sm font-black ${isBullish ? "text-green-300" : "text-red-300"}`}>{isBullish ? "+" : ""}{stock.change.toFixed(2)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-600">Rel. Volume</p>
                      <p className={`font-mono text-lg font-black ${rvol >= 3 ? "text-orange-300" : "text-zinc-300"}`}>{rvol.toFixed(1)}x</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <div className={`rounded-full px-3 py-1 text-[10px] font-black ${isBullish ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>{isBullish ? "↑ Bullish" : "↓ Bearish"}</div>
                    {rvol >= 3 && <div className="rounded-full bg-orange-500/10 px-3 py-1 text-[10px] font-black text-orange-300">⚡ Unusual Vol</div>}
                    <a href={`/?ticker=${stock.symbol}`} className="ml-auto rounded-full border border-orange-500/30 px-3 py-1 text-[10px] font-black text-orange-400 transition hover:bg-orange-500/10">Full Read →</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-8 text-center text-[10px] font-semibold text-zinc-700">{filtered.length} names shown · Scanning {UNIVERSE.length} total · Refreshes every 30s</p>
      </main>
    </div>
  );
}