"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PanelHeader, StatusState } from "@/app/components/ui/ApplicationPrimitives";

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
  const loading = newsData.some(n => n.loading);
  const failedCount = newsData.filter(n => n.error).length;
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
    <main className="ht-discovery-route ht-news-route min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-7xl px-5 py-8">

        {/* Header */}
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between lg:items-end">
          <PanelHeader
            headingLevel={1}
            eyebrow="Market intelligence"
            title="News"
            description="News velocity, catalyst context, and narrative signals across the market."
          />
          <form
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:w-auto lg:grid-cols-[12rem_auto_auto]"
            onSubmit={(event) => { event.preventDefault(); void handleSearch(); }}
            role="search"
          >
            <label htmlFor="news-ticker-search" className="sr-only">Search news by ticker</label>
            <input
              id="news-ticker-search"
              type="text"
              placeholder="Search ticker..."
              value={searchTicker}
              onChange={e => setSearchTicker(e.target.value.toUpperCase())}
              className="min-w-0 w-full rounded-xl ht-route-input uppercase placeholder:normal-case"
            />
            <button
              type="submit"
              className="ht-filter-control ht-filter-control--active"
            >
              Search
            </button>
            <Link href="/scanner" className="ht-filter-control col-span-2 text-center lg:col-span-1">
              Open scanner
            </Link>
          </form>
        </div>

        {/* Top Stories Feed */}
        <section className="ht-route-panel mb-6" aria-labelledby="top-stories-title">
          <div className="ht-route-panel__header">
            <div>
              <h2 id="top-stories-title">Top stories</h2>
              {lastUpdated && <p>Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
            </div>
            <span className="ht-inline-status" data-tone={failedCount > 0 ? "warning" : "positive"} role="status" aria-live="polite">
              <span aria-hidden="true" />
              {loading ? "Checking" : failedCount > 0 ? `${failedCount} sources unavailable` : "Current"}
            </span>
          </div>
          <ol className="ht-news-story-list">
            {topStories.length > 0 ? topStories.map((story, i) => (
              <li
                key={`story-${i}`}
              >
                <button type="button" onClick={() => setSelectedTicker(story.ticker)} className="ht-news-story-row">
                  <span className="ht-symbol-label">{story.ticker}</span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-bold text-white">{story.headline}</span>
                    {story.summary && <span className="mt-1 block line-clamp-1 text-xs text-zinc-500">{story.summary}</span>}
                    <span className="mt-1 block text-xs text-zinc-600">{story.source} {story.datetime ? `· ${new Date(story.datetime * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>
                  </span>
                </button>
              </li>
            )) : (
              <li><StatusState busy={loading} title={loading ? "Loading market news" : "No current stories"} description={loading ? "Checking the tracked ticker set." : "No headlines are available for the tracked ticker set."} /></li>
            )}
          </ol>
        </section>

        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">

          {/* Ticker velocity sidebar */}
          <section aria-labelledby="news-velocity-title">
            <h2 id="news-velocity-title" className="ht-section-label">News velocity</h2>
            <ol className="ht-ranked-list">
            {newsData.map(n => (
              <li key={n.ticker}>
                <button
                  type="button"
                  onClick={() => setSelectedTicker(n.ticker === selectedTicker ? null : n.ticker)}
                  aria-pressed={selectedTicker === n.ticker}
                  className="ht-ranked-list__row"
                >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono font-black text-white">{n.ticker}</p>
                  {n.loading ? (
                    <span className="text-xs text-zinc-500" role="status">Loading…</span>
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
                      className={`h-full ${n.newsVelocity >= 80 ? "bg-red-400" : n.newsVelocity >= 60 ? "bg-orange-400" : n.newsVelocity >= 40 ? "bg-yellow-400" : "bg-zinc-600"}`}
                      style={{ width: `${Math.min(100, n.newsVelocity)}%` }}
                    />
                  </div>
                )}
                </button>
              </li>
            ))}
            </ol>
          </section>

          {/* Article detail panel */}
          <section aria-live="polite" aria-label="Selected ticker news">
            {selectedData ? (
              <div>
                <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-mono text-3xl font-black text-white">{selectedData.ticker}</p>
                    <p className={`mt-1 text-sm font-black ${getVelocityColor(selectedData.newsVelocity)}`}>
                      {selectedData.catalystStrength} · {selectedData.sentimentBias}
                    </p>
                  </div>
                  <dl className="ht-compact-metrics grid grid-cols-3">
                    {[
                      ["Velocity", selectedData.newsVelocity],
                      ["Articles", selectedData.articles.length],
                      ["Signal", selectedData.narrativeSignal.split(" ")[0]],
                    ].map(([label, val]) => (
                      <div key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {selectedData.articles.length > 0 ? (
                  <ul className="ht-article-list">
                    {selectedData.articles.map((article, i) => (
                      <li key={i}>
                        <article className="ht-article-row">
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
                        </article>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <StatusState title={`No articles found for ${selectedData.ticker}`} />
                )}
              </div>
            ) : (
              <StatusState title="Select a ticker" description="Choose a ranked ticker or use search to inspect its full news feed." />
            )}
          </section>
        </div>

        <p className="mt-8 text-center text-[10px] text-zinc-700">HT Labs News Intel · {new Date().toLocaleDateString()} · For informational purposes only</p>
      </div>
    </main>
  );
}
