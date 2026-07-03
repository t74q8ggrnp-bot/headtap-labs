import { NextResponse } from "next/server";

// Social Intel — NewsAPI only.
// Stocktwits and Reddit were removed: both require paid API access for
// reliable commercial use and were returning zeros or stale data silently.
// NewsAPI is the only real data source here and is wired correctly.

const NEWS_API_KEY = process.env.NEWS_API_KEY;

async function getNewsIntel(ticker: string, apiKey: string) {
  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(ticker)}&language=en&sortBy=publishedAt&pageSize=15&apiKey=${apiKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
    const data = await res.json();
    const articles = data?.articles || [];

    const now = Date.now();
    const oneHour  = 60 * 60 * 1000;
    const sixHours = 6  * oneHour;

    const lastHour  = articles.filter((a: any) => now - new Date(a.publishedAt).getTime() < oneHour).length;
    const last6h    = articles.filter((a: any) => now - new Date(a.publishedAt).getTime() < sixHours).length;

    const text = articles
      .map((a: any) => `${a.title ?? ""} ${a.description ?? ""}`)
      .join(" ")
      .toLowerCase();

    const bullishWords = ["surge", "rally", "beat", "upgrade", "breakout", "strong", "growth", "gain", "soar", "jump"];
    const bearishWords = ["fall", "drop", "miss", "downgrade", "loss", "warning", "risk", "decline", "plunge", "cut"];

    const bullishHits = bullishWords.filter(w => text.includes(w)).length;
    const bearishHits = bearishWords.filter(w => text.includes(w)).length;
    const rawSentiment = (bullishHits - bearishHits) / Math.max(1, bullishHits + bearishHits);
    const sentiment = Math.max(-1, Math.min(1, rawSentiment));

    // Sources — deduplicated
    const sources = [...new Set(
      articles.map((a: any) => a.source?.name).filter(Boolean)
    )].slice(0, 5) as string[];

    return {
      articles: articles.length,
      lastHour,
      last6h,
      sentiment,
      sources,
    };
  } catch {
    return { articles: 0, lastHour: 0, last6h: 0, sentiment: 0, sources: [] };
  }
}

function computeScores(news: Awaited<ReturnType<typeof getNewsIntel>>) {
  // Social score — driven entirely by news velocity and sentiment.
  // Weights are honest: high recent article count = more attention,
  // breaking coverage in the last hour = accelerating signal.
  let socialScore = 0;
  socialScore += Math.min(40, news.articles * 4);       // up to 40 pts for article count
  socialScore += Math.min(30, news.lastHour * 15);      // up to 30 pts for breaking coverage
  socialScore += Math.min(15, news.last6h * 3);         // up to 15 pts for recent coverage
  socialScore += news.sentiment > 0.3 ? 10 : news.sentiment < -0.3 ? -5 : 0; // sentiment tilt
  socialScore = Math.min(100, Math.max(0, Math.round(socialScore)));

  // Before-crowd score — low article count + some velocity = early signal.
  // If everyone is already writing about it, you're not early.
  let beforeCrowdScore = 0;
  if (news.articles < 3 && news.lastHour >= 1) beforeCrowdScore += 40; // very early, breaking
  else if (news.articles < 5) beforeCrowdScore += 25;                   // low coverage = early
  else if (news.articles < 10) beforeCrowdScore += 10;                  // moderate coverage
  beforeCrowdScore += Math.min(30, news.lastHour * 10);                 // breaking velocity
  beforeCrowdScore += socialScore * 0.3;
  beforeCrowdScore = Math.min(100, Math.max(0, Math.round(beforeCrowdScore)));

  // Crowd stage — based on how much coverage already exists
  let crowdStage: 1 | 2 | 3 | 4 | 5 | 6 = 1;
  if (socialScore >= 80)      crowdStage = 6;
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
  const mentionVelocity =
    news.lastHour >= 3 ? "accelerating" :
    news.last6h >= 3   ? "stable" :
                         "quiet";

  const signals: string[] = [];
  if (news.lastHour >= 3)  signals.push("Breaking news coverage accelerating.");
  if (news.lastHour >= 1)  signals.push("Recent news activity detected.");
  if (news.articles < 3 && news.lastHour >= 1) signals.push("Attention growing before widespread coverage.");
  if (news.sentiment > 0.3)  signals.push("News sentiment is positive.");
  if (news.sentiment < -0.3) signals.push("News sentiment is negative.");
  if (news.sources.length >= 3) signals.push(`Coverage from ${news.sources.length} sources.`);
  if (beforeCrowdScore >= 70) signals.push("Potential before-the-crowd setup.");
  if (signals.length === 0) signals.push("Monitoring for news activity.");

  return {
    socialScore,
    beforeCrowdScore,
    crowdStage,
    crowdStageLabel: stageInfo.label,
    crowdStageEmoji: stageInfo.emoji,
    signals,
    mentionVelocity,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  if (!NEWS_API_KEY) {
    return NextResponse.json({
      ticker,
      socialScore: 0,
      beforeCrowdScore: 0,
      crowdStage: 1,
      crowdStageLabel: "Quiet Accumulation",
      crowdStageEmoji: "👀",
      signals: ["NEWS_API_KEY not configured."],
      mentionVelocity: "quiet",
      news: { articles: 0, lastHour: 0, last6h: 0, sentiment: 0, sources: [] },
      acceleration: 0,
    });
  }

  try {
    const news = await getNewsIntel(ticker, NEWS_API_KEY);
    const scores = computeScores(news);

    return NextResponse.json({
      ticker,
      news,
      ...scores,
      acceleration: Math.min(500, news.lastHour * 50 + news.last6h * 10),
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
      signals: ["Monitoring for news activity."],
      mentionVelocity: "quiet",
      news: { articles: 0, lastHour: 0, last6h: 0, sentiment: 0, sources: [] },
      acceleration: 0,
    });
  }
}
