import { NextResponse } from "next/server";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function getStocktwitsSentiment(ticker: string) {
  try {
    const res = await fetch(
      `https://api.stocktwits.com/api/2/streams/symbol/${ticker}.json`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "HTLabs/1.0" }
      }
    );
    if (!res.ok) throw new Error(`Stocktwits ${res.status}`);
    const data = await res.json();
    const messages = data?.messages || [];
    const symbol = data?.symbol;
    let bullish = 0, bearish = 0;
    for (const msg of messages) {
      if (msg?.entities?.sentiment?.basic === "Bullish") bullish++;
      if (msg?.entities?.sentiment?.basic === "Bearish") bearish++;
    }
    const total = messages.length;
    const sentiment = total > 0 ? bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral" : "neutral";
    return {
      mentions: total,
      sentiment: sentiment as "bullish" | "bearish" | "neutral",
      watchlistCount: symbol?.watchlist_count || 0,
      trending: total >= 20,
    };
  } catch {
    return { mentions: 0, sentiment: "neutral" as const, watchlistCount: 0, trending: false };
  }
}

async function getRedditMentions(ticker: string) {
  try {
    // Use Reddit's public JSON search
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(ticker + " stock")}&sort=new&limit=15&t=day`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent": "HTLabs:v1.0 (stock market research tool)",
          "Accept": "application/json",
        }
      }
    );
    if (!res.ok) throw new Error(`Reddit ${res.status}`);
    const data = await res.json();
    const posts = data?.data?.children || [];
    const totalPosts = posts.length;
    const totalScore = posts.reduce((sum: number, p: any) => sum + (p?.data?.score || 0), 0);
    const subs = [...new Set(posts.map((p: any) => p?.data?.subreddit).filter(Boolean))] as string[];
    const wsb = subs.filter(s => ["wallstreetbets","stocks","investing","options","pennystocks","Superstonk"].includes(s));
    return {
      mentions: totalPosts * 6,
      posts: totalPosts,
      sentiment: totalScore > 100 ? 0.7 : totalScore > 20 ? 0.4 : 0,
      subreddits: wsb.length > 0 ? wsb : subs.slice(0, 3),
    };
  } catch {
    return { mentions: 0, posts: 0, sentiment: 0, subreddits: [] };
  }
}

async function getNewsVelocity(ticker: string, newsApiKey: string) {
  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(ticker)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${newsApiKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
    const data = await res.json();
    const articles = data?.articles || [];
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const recentArticles = articles.filter((a: any) => {
      const age = now - new Date(a.publishedAt).getTime();
      return age < oneHour;
    });
    const text = articles.map((a: any) => `${a.title} ${a.description}`).join(" ").toLowerCase();
    const bullishWords = ["surge", "rally", "beat", "upgrade", "breakout", "strong", "growth", "gain"];
    const bearishWords = ["fall", "drop", "miss", "downgrade", "loss", "warning", "risk", "decline"];
    const bullish = bullishWords.filter(w => text.includes(w)).length;
    const bearish = bearishWords.filter(w => text.includes(w)).length;
    const sentiment = (bullish - bearish) / Math.max(1, bullish + bearish);
    return {
      articles: articles.length,
      velocity: recentArticles.length,
      sentiment: Math.max(-1, Math.min(1, sentiment)),
    };
  } catch {
    return { articles: 0, velocity: 0, sentiment: 0 };
  }
}

function computeScores(
  stocktwits: Awaited<ReturnType<typeof getStocktwitsSentiment>>,
  reddit: Awaited<ReturnType<typeof getRedditMentions>>,
  news: Awaited<ReturnType<typeof getNewsVelocity>>,
) {
  let socialScore = 0;
  socialScore += Math.min(40, stocktwits.mentions * 2);
  socialScore += Math.min(20, reddit.posts * 4);
  socialScore += stocktwits.trending ? 15 : 0;
  socialScore += Math.min(15, news.velocity * 5);
  socialScore += stocktwits.sentiment === "bullish" ? 10 : stocktwits.sentiment === "bearish" ? -5 : 0;
  socialScore = Math.min(100, Math.max(0, Math.round(socialScore)));

  const newsLow = news.articles < 5 ? 20 : 0;
  const watchlistSignal = Math.min(20, (stocktwits.watchlistCount / 10000) * 20);
  let beforeCrowdScore = 0;
  beforeCrowdScore += Math.min(35, stocktwits.mentions > 5 ? stocktwits.mentions * 3 : 0);
  beforeCrowdScore += newsLow;
  beforeCrowdScore += watchlistSignal;
  beforeCrowdScore += reddit.posts > 0 && reddit.posts < 5 ? 15 : 0;
  beforeCrowdScore += socialScore * 0.3;
  beforeCrowdScore = Math.min(100, Math.max(0, Math.round(beforeCrowdScore)));

  let crowdStage: 1|2|3|4|5|6 = 1;
  if (socialScore >= 80) crowdStage = 6;
  else if (socialScore >= 65) crowdStage = 5;
  else if (socialScore >= 50) crowdStage = 4;
  else if (socialScore >= 35) crowdStage = 3;
  else if (socialScore >= 15) crowdStage = 2;

  const CROWD_STAGES = [
    { stage: 1, emoji: "👀", label: "Quiet Accumulation" },
    { stage: 2, emoji: "🧲", label: "Attention Building" },
    { stage: 3, emoji: "⚡", label: "Momentum Building" },
    { stage: 4, emoji: "🔥", label: "Crowd Igniting" },
    { stage: 5, emoji: "🚀", label: "Expansion" },
    { stage: 6, emoji: "⚠️", label: "Crowded" },
  ];

  const stageInfo = CROWD_STAGES[crowdStage - 1];
  const mentionVelocity = socialScore >= 60 ? "accelerating" : socialScore >= 30 ? "stable" : "quiet";

  const signals: string[] = [];
  if (stocktwits.mentions >= 15) signals.push("Social mentions accelerating.");
  if (stocktwits.trending) signals.push("Trending on Stocktwits.");
  if (reddit.posts >= 3) signals.push(`Active on Reddit (${reddit.subreddits[0] || "finance"}).`);
  if (news.velocity >= 2) signals.push("News coverage accelerating.");
  if (beforeCrowdScore >= 70) signals.push("Potential before-the-crowd setup.");
  if (stocktwits.sentiment === "bullish") signals.push("Retail sentiment is positive.");
  if (news.articles < 3 && socialScore >= 30) signals.push("Attention growing faster than news coverage.");
  if (stocktwits.watchlistCount > 50000) signals.push(`${(stocktwits.watchlistCount/1000).toFixed(0)}K users watching on Stocktwits.`);
  if (signals.length === 0) signals.push("Monitoring for social activity.");

  return { socialScore, beforeCrowdScore, crowdStage, crowdStageLabel: stageInfo.label, crowdStageEmoji: stageInfo.emoji, signals, mentionVelocity };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  const newsApiKey = process.env.NEWS_API_KEY;

  try {
    const [stocktwits, reddit, news] = await Promise.all([
      getStocktwitsSentiment(ticker),
      getRedditMentions(ticker),
      newsApiKey ? getNewsVelocity(ticker, newsApiKey) : Promise.resolve({ articles: 0, velocity: 0, sentiment: 0 }),
    ]);

    const scores = computeScores(stocktwits, reddit, news);

    return NextResponse.json({
      ticker,
      stocktwits,
      reddit,
      news,
      ...scores,
      acceleration: stocktwits.mentions > 0 ? Math.min(500, stocktwits.mentions * 10) : 0,
    });
  } catch (error) {
    console.error("SOCIAL INTEL ERROR:", error);
    return NextResponse.json({
      ticker,
      socialScore: 0,
      beforeCrowdScore: 0,
      crowdStage: 1,
      crowdStageLabel: "Quiet Accumulation",
      crowdStageEmoji: "👀",
      signals: ["Monitoring for social activity."],
      mentionVelocity: "quiet",
    });
  }
}
