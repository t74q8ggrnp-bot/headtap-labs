import { NextResponse } from "next/server";

type FinnhubNewsItem = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

type NewsApiArticle = {
  title?: string;
  description?: string;
  source?: { name?: string };
  url?: string;
  publishedAt?: string;
};

type NormalizedArticle = {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
};

const clampScore = (value: number, min = 0, max = 99) =>
  Math.min(max, Math.max(min, Math.round(value)));

const uniqueArticles = (articles: NormalizedArticle[]) => {
  const seen = new Set<string>();
  return articles.filter((a) => {
    const key = `${a.headline.toLowerCase()}-${a.source.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getKeywordScore = (text: string, words: string[], weight: number) =>
  words.reduce((score, word) => (text.includes(word) ? score + weight : score), 0);

const buildIntel = (symbol: string, articles: NormalizedArticle[]) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const text = articles.map((a) => `${a.headline} ${a.summary}`).join(" ").toLowerCase();
  const sourceCount = new Set(articles.map((a) => a.source)).size;
  const recentCount = articles.filter((a) => nowSeconds - a.datetime <= 60 * 60 * 24).length;

  const bullishWords = ["surge","surges","rally","rallies","beat","beats","raises","upgrade","growth","record","breakout","strong","profit","partnership","approval","launch"];
  const bearishWords = ["fall","falls","drop","drops","miss","cuts","downgrade","loss","probe","lawsuit","warning","weak","selloff","slump","risk","concern"];
  const hypeWords = ["meme","retail","short squeeze","squeeze","reddit","wallstreetbets","stocktwits","trending","viral","options","unusual volume","speculative","crypto","ai","quantum"];

  const sentimentScore = clampScore(52 + getKeywordScore(text, bullishWords, 7) - getKeywordScore(text, bearishWords, 8) + Math.min(10, recentCount * 2), 20, 95);
  const hypeScore = clampScore(28 + getKeywordScore(text, hypeWords, 9) + Math.min(18, articles.length * 3) + Math.min(10, sourceCount * 2), 20, 95);
  const newsVelocity = clampScore(22 + Math.min(34, articles.length * 7) + Math.min(24, recentCount * 8) + Math.min(12, sourceCount * 3), 20, 95);

  const catalystStrength = newsVelocity >= 82 ? "High narrative velocity" : newsVelocity >= 68 ? "Fresh catalyst activity" : newsVelocity >= 50 ? "Light news activity" : "No fresh catalyst";
  const sentimentBias = sentimentScore >= 75 ? "Bullish narrative pressure" : sentimentScore >= 58 ? "Constructive narrative" : sentimentScore <= 38 ? "Bearish narrative pressure" : sentimentScore <= 48 ? "Cautious narrative" : "Neutral narrative";
  const narrativeSignal = hypeScore >= 78 ? "Retail narrative heating up" : newsVelocity >= 78 ? "Narrative pressure accelerating" : sentimentScore >= 70 && articles.length >= 2 ? "Constructive catalyst forming" : articles.length >= 1 ? "Fresh headline detected" : "Narrative still quiet";

  return { symbol, articles, newsVelocity, catalystStrength, narrativeSignal, sentimentBias, sentimentScore, hypeScore, sourceCount };
};

const emptyIntel = (symbol: string) => ({
  symbol,
  articles: [],
  newsVelocity: 25,
  catalystStrength: "No fresh catalyst",
  narrativeSignal: "Narrative still quiet",
  sentimentBias: "Neutral narrative",
  sentimentScore: 50,
  hypeScore: 25,
  sourceCount: 0,
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;

  // If neither key is configured, return empty intel gracefully — no crash
  if (!finnhubKey && !newsApiKey) {
    console.warn("NEWS INTEL: No API keys configured. Returning empty intel.");
    return NextResponse.json(emptyIntel(symbol));
  }

  const articles: NormalizedArticle[] = [];

  // Finnhub news
  if (finnhubKey) {
    try {
      const today = new Date();
      const prior = new Date();
      prior.setDate(today.getDate() - 7);
      const from = prior.toISOString().split("T")[0];
      const to = today.toISOString().split("T")[0];

      const response = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${finnhubKey}`,
        { cache: "no-store", signal: AbortSignal.timeout(6000) }
      );

      if (response.ok) {
        const data = (await response.json()) as FinnhubNewsItem[];
        articles.push(
          ...(Array.isArray(data) ? data : []).slice(0, 8).map((item) => ({
            headline: item.headline || "Untitled headline",
            summary: item.summary || "",
            source: item.source || "Finnhub",
            url: item.url || "",
            datetime: item.datetime || Math.floor(Date.now() / 1000),
          }))
        );
      }
    } catch (err) {
      console.warn(`Finnhub news failed for ${symbol}:`, err);
    }
  }

  // NewsAPI
  if (newsApiKey) {
    try {
      const query = encodeURIComponent(`"${symbol}" stock OR "${symbol}" shares`);
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=8&apiKey=${newsApiKey}`,
        { cache: "no-store", signal: AbortSignal.timeout(6000) }
      );

      if (response.ok) {
        const data = await response.json();
        articles.push(
          ...((data?.articles || []) as NewsApiArticle[]).map((a) => ({
            headline: a.title || "Untitled headline",
            summary: a.description || "",
            source: a.source?.name || "NewsAPI",
            url: a.url || "",
            datetime: a.publishedAt
              ? Math.floor(new Date(a.publishedAt).getTime() / 1000)
              : Math.floor(Date.now() / 1000),
          }))
        );
      }
    } catch (err) {
      console.warn(`NewsAPI failed for ${symbol}:`, err);
    }
  }

  const cleaned = uniqueArticles(articles).sort((a, b) => b.datetime - a.datetime).slice(0, 10);
  return NextResponse.json(buildIntel(symbol, cleaned));
}
