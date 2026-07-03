"use client";

import { useState, useEffect } from "react";

const TOP_TICKERS = [
  "NVDA", "PLTR", "TSLA", "AAPL", "AMD", "MSFT", "MSTR", "HOOD",
  "LUNR", "RKLB", "IONQ", "QBTS", "RGTI", "SNAL", "QUBT", "ASTS",
  "COIN", "SOFI", "RDDT", "IOVA", "SMCI", "ACHR", "SOUN", "BBAI",
];

type Article = {
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number;
};

type TickerNews = {
  ticker: string;
  articles: Article[];
  newsVelocity: number;
  catalystStrength: string;
  narrativeSignal: string;
  sentimentBias: string;
  loading: boolean;
  error: boolean;
};

export default function NewsPage() {
  const [newsData, setNewsData] = useState<TickerNews[]>(
    TOP_TICKERS.slice(0, 8).map(t => ({
      ticker: t, articles: [], newsVelocity: 0,
      catalystStrength: "", narrativeSignal: "", sentimentBias: "",
      loading: true, error: false,
    }))
  );
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [searchTicker, setSearchTicker] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTickerNews = async (ticker: string): Promise<TickerNews> => {
    try {
      const res = await fetch(`/api/news-intel?symbol=${ticker}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      return {
        ticker,
        articles: data.articles || [],
        newsVelocity: data.newsVelocity || 0,
        catalystStrength: data.catalystStrength || "No fresh catalyst",
        narrativeSignal: data.narrativeSignal || "Quiet",
        sentimentBias: data.sentimentBias || "Neutral",
        loading: false,
        error: false,
      };
    } catch {
      return {
        ticker, articles: [], newsVelocity: 0,
        catalystStrength: "Error", narrativeSignal: "", sentimentBias: "",
        loading: false, error: true,
      };
    }
  };

  useEffect(() => {
    const tickers = TOP_TICKERS.slice(0, 8);
    Promise.all(tickers.map(fetchTickerNews)).then(results => {
      setNewsData(results.sort((a, b) => b.newsVelocity - a.newsVelocity));
      setLastUpdated(new Date());
    });
  }, []);

  const handleSearch = async () => {
    const t = searchTicker.toUpperCase().trim();
    if (!t) return;
    const existing = newsData.find(n => n.ticker === t);
    if (existing) { setSelectedTicker(t); return; }
    const result = await fetchTickerNews(t);
    setNewsData(prev => [result, ...prev.filter(n => n.ticker !== t)]);
    setSelectedTicker(t);
    setSearchTicker("");
  };

  const selectedData = newsData.find(n => n.ticker === selectedTicker);
  const topStories = newsData
    .flatMap(n => n.articles.slice(0, 2).map(a => ({ ...a, ticker: n.ticker, velocity: n.newsVelocity })))
    .filter(a => a.headline)
    .sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
    .slice(0, 10);

  const getVelocityColor = (v: number) =>
    v >= 80 ? "text-red-300" : v >= 60 ? "text-orange-300" : v >= 40 ? "text-yellow-300" : "text-zinc-500";

  const getVelocityLabel = (v: number) =>
    v >= 80 ? "High Velocity" : v >= 60 ? "Active" : v >= 40 ? "Light" : "Quiet";

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,106,0,0.08),transparent_40%)]" />

      <div className="relative mx-auto max-w-7xl px-5 py-6">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <a href="/" className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-400 transition">← Dashboard</a>
            <h1 className="mt-3 text-3xl font-black tracking-tight">News Intel</h1>
            <p className="mt-1 text-sm text-zinc-500">Live news velocity, catalyst strength, and narrative signals across the market.</p>
            {lastUpdated && (
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600">
                Updated: {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search ticker..."
              value={searchTicker}
              onChange={e => setSearchTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm font-black uppercase text-white outline-none placeholder:normal-case placeholder:font-normal placeholder:text-zinc-600 focus:border-orange-500/50 w-40"
            />
            <button
              onClick={handleSearch}
              className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-black text-black hover:bg-orange-400 transition"
            >
              Search
            </button>
            <a href="/scanner" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-zinc-300 hover:text-white transition">
              Scanner →
            </a>
          </div>
        </div>

        {/* Top Stories Feed */}
        <div className="mb-6 rounded-2xl border border-orange-400/15 bg-orange-500/[0.04] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-300">Top Stories Right Now</p>
            <span className="flex items-center gap-1.5 rounded-full border border-green-400/20 bg-green-500/[0.06] px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-[0.14em] text-green-400">Live</span>
            </span>
          </div>
          <div className="space-y-2">
            {topStories.length > 0 ? topStories.map((story, i) => (
              <div
                key={`story-${i}`}
                className="flex items-start gap-4 rounded-xl border border-white/8 bg-black/30 px-4 py-3 hover:border-orange-400/20 transition cursor-pointer"
                onClick={() => setSelectedTicker(story.ticker)}
              >
                <span className="rounded-lg border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-black text-orange-300 shrink-0 mt-0.5">{story.ticker}</span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-white leading-5 truncate">{story.headline}</p>
                  {story.summary && <p className="mt-1 text-xs text-zinc-500 line-clamp-1">{story.summary}</p>}
                  <p className="mt-1 text-[10px] text-zinc-700">{story.source} {story.datetime ? `· ${new Date(story.datetime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</p>
                </div>
              </div>
            )) : (
              <div className="text-sm text-zinc-600 py-4 text-center">Loading news...</div>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">

          {/* Ticker velocity sidebar */}
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-3">News Velocity Ranking</p>
            {newsData.map(n => (
              <button
                key={n.ticker}
                onClick={() => setSelectedTicker(n.ticker === selectedTicker ? null : n.ticker)}
                className={`w-full text-left rounded-xl border px-4 py-3 transition ${selectedTicker === n.ticker ? "border-orange-400/30 bg-orange-500/[0.06]" : "border-white/8 bg-white/[0.02] hover:border-white/15"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono font-black text-white">{n.ticker}</p>
                  {n.loading ? (
                    <span className="text-[10px] text-zinc-600">Loading...</span>
                  ) : (
                    <span className={`text-[10px] font-black ${getVelocityColor(n.newsVelocity)}`}>
                      {n.newsVelocity} · {getVelocityLabel(n.newsVelocity)}
                    </span>
                  )}
                </div>
                {!n.loading && !n.error && (
                  <p className="mt-1 text-[10px] font-semibold text-zinc-600 truncate">{n.catalystStrength}</p>
                )}
                {!n.loading && (
                  <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${n.newsVelocity >= 80 ? "bg-red-400" : n.newsVelocity >= 60 ? "bg-orange-400" : n.newsVelocity >= 40 ? "bg-yellow-400" : "bg-zinc-600"}`}
                      style={{ width: `${Math.min(100, n.newsVelocity)}%` }}
                    />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Article detail panel */}
          <div>
            {selectedData ? (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-3xl font-black text-white">{selectedData.ticker}</p>
                    <p className={`mt-1 text-sm font-black ${getVelocityColor(selectedData.newsVelocity)}`}>
                      {selectedData.catalystStrength} · {selectedData.sentimentBias}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ["Velocity", selectedData.newsVelocity],
                      ["Articles", selectedData.articles.length],
                      ["Signal", selectedData.narrativeSignal.split(" ")[0]],
                    ].map(([label, val]) => (
                      <div key={String(label)} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                        <p className="text-[9px] font-black uppercase text-zinc-600">{label}</p>
                        <p className="font-mono text-lg font-black text-white mt-0.5">{val}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedData.articles.length > 0 ? (
                  <div className="space-y-3">
                    {selectedData.articles.map((article, i) => (
                      <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-black text-white leading-5">{article.headline || "No headline"}</p>
                            {article.summary && (
                              <p className="mt-2 text-sm text-zinc-400 leading-5 line-clamp-3">{article.summary}</p>
                            )}
                            <div className="mt-2 flex items-center gap-3">
                              <p className="text-[10px] text-zinc-600">{article.source}</p>
                              {article.datetime && (
                                <p className="text-[10px] text-zinc-600">
                                  {new Date(article.datetime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                </p>
                              )}
                              {article.url && (
                                <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-orange-400 hover:text-orange-300 transition">
                                  Read →
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
                    <p className="text-sm text-zinc-500">No articles found for {selectedData.ticker}.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
                <p className="text-sm font-black text-zinc-400">Select a ticker to see full news feed</p>
                <p className="mt-2 text-xs text-zinc-600">Click any ticker on the left or search above</p>
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-[10px] text-zinc-700">HT Labs News Intel · {new Date().toLocaleDateString()} · For informational purposes only</p>
      </div>
    </div>
  );
}
