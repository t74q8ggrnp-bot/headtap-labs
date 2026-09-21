import "server-only";

export type FinnhubNewsItem = {
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

export type NewsApiArticle = {
  title?: string;
  description?: string;
  source?: { name?: string };
  url?: string;
  publishedAt?: string;
};

export type NormalizedArticle = {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
};

export type NewsIntel = {
  symbol: string;
  articles: NormalizedArticle[];
  newsVelocity: number;
  catalystStrength: string;
  narrativeSignal: string;
  sentimentBias: string;
  sentimentScore: number;
  hypeScore: number;
  sourceCount: number;
  // True only when at least one real article was found -- distinguishes
  // genuine "measured near-zero" from "no API keys configured" or "both
  // provider calls failed," which otherwise produce nearly identical
  // numeric scores (see buildNewsIntel's empty-article branch vs the old
  // route's hardcoded stub). Callers that treat this as scoring evidence
  // (ProX) must gate on this, not on the numbers alone.
  dataAvailable: boolean;
  status: "available" | "unavailable";
  collectedAt: string;
  newestArticleAt: string | null;
  providerRequests: number;
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

const BULLISH_WORDS = ["surge","surges","rally","rallies","beat","beats","raises","upgrade","growth","record","breakout","strong","profit","partnership","approval","launch"];
const BEARISH_WORDS = ["fall","falls","drop","drops","miss","cuts","downgrade","loss","probe","lawsuit","warning","weak","selloff","slump","risk","concern"];
const HYPE_WORDS = ["meme","retail","short squeeze","squeeze","reddit","wallstreetbets","stocktwits","trending","viral","options","unusual volume","speculative","crypto","ai","quantum"];

export function buildNewsIntel(
  symbol: string,
  articles: NormalizedArticle[],
  providerRequests = 0,
): NewsIntel {
  if (articles.length === 0) return emptyNewsIntel(symbol, providerRequests);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const text = articles.map((a) => `${a.headline} ${a.summary}`).join(" ").toLowerCase();
  const sourceCount = new Set(articles.map((a) => a.source)).size;
  const recentCount = articles.filter((a) => nowSeconds - a.datetime <= 60 * 60 * 24).length;

  const sentimentScore = clampScore(52 + getKeywordScore(text, BULLISH_WORDS, 7) - getKeywordScore(text, BEARISH_WORDS, 8) + Math.min(10, recentCount * 2), 20, 95);
  const hypeScore = clampScore(28 + getKeywordScore(text, HYPE_WORDS, 9) + Math.min(18, articles.length * 3) + Math.min(10, sourceCount * 2), 20, 95);
  const newsVelocity = clampScore(22 + Math.min(34, articles.length * 7) + Math.min(24, recentCount * 8) + Math.min(12, sourceCount * 3), 20, 95);

  const catalystStrength = newsVelocity >= 82 ? "High narrative velocity" : newsVelocity >= 68 ? "Fresh catalyst activity" : newsVelocity >= 50 ? "Light news activity" : "No fresh catalyst";
  const sentimentBias = sentimentScore >= 75 ? "Bullish narrative pressure" : sentimentScore >= 58 ? "Constructive narrative" : sentimentScore <= 38 ? "Bearish narrative pressure" : sentimentScore <= 48 ? "Cautious narrative" : "Neutral narrative";
  const narrativeSignal = hypeScore >= 78 ? "Retail narrative heating up" : newsVelocity >= 78 ? "Narrative pressure accelerating" : sentimentScore >= 70 && articles.length >= 2 ? "Constructive catalyst forming" : articles.length >= 1 ? "Fresh headline detected" : "Narrative still quiet";

  return {
    symbol,
    articles,
    newsVelocity,
    catalystStrength,
    narrativeSignal,
    sentimentBias,
    sentimentScore,
    hypeScore,
    sourceCount,
    dataAvailable: articles.length > 0,
    status: articles.length > 0 ? "available" : "unavailable",
    collectedAt: new Date().toISOString(),
    newestArticleAt: articles.length > 0
      ? new Date(Math.max(...articles.map((article) => article.datetime * 1_000))).toISOString()
      : null,
    providerRequests,
  };
}

export function emptyNewsIntel(symbol: string, providerRequests = 0): NewsIntel {
  return {
    symbol,
    articles: [],
    newsVelocity: 0,
    catalystStrength: "Catalyst evidence unavailable",
    narrativeSignal: "Narrative evidence unavailable",
    sentimentBias: "Sentiment unavailable",
    sentimentScore: 0,
    hypeScore: 0,
    sourceCount: 0,
    dataAvailable: false,
    status: "unavailable",
    collectedAt: new Date().toISOString(),
    newestArticleAt: null,
    providerRequests,
  };
}

async function fetchFinnhubArticles(
  symbol: string,
  finnhubKey: string,
): Promise<NormalizedArticle[]> {
  try {
    const today = new Date();
    const prior = new Date();
    prior.setDate(today.getDate() - 7);
    const from = prior.toISOString().split("T")[0];
    const to = today.toISOString().split("T")[0];

    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${finnhubKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as FinnhubNewsItem[];
    return (Array.isArray(data) ? data : []).slice(0, 8).map((item) => ({
      headline: item.headline || "Untitled headline",
      summary: item.summary || "",
      source: item.source || "Finnhub",
      url: item.url || "",
      datetime: Number.isFinite(item.datetime) && Number(item.datetime) > 0 ? Number(item.datetime) : 0,
    })).filter((article) => article.datetime > 0);
  } catch (err) {
    console.warn(`Finnhub news failed for ${symbol}:`, err);
    return [];
  }
}

async function fetchNewsApiArticles(
  symbol: string,
  newsApiKey: string,
): Promise<NormalizedArticle[]> {
  try {
    const query = encodeURIComponent(`"${symbol}" stock OR "${symbol}" shares`);
    const response = await fetch(
      `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=8&apiKey=${newsApiKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return ((data?.articles || []) as NewsApiArticle[]).map((a) => ({
      headline: a.title || "Untitled headline",
      summary: a.description || "",
      source: a.source?.name || "NewsAPI",
      url: a.url || "",
      datetime: a.publishedAt
        ? Math.floor(new Date(a.publishedAt).getTime() / 1000)
        : 0,
    })).filter((article) => Number.isFinite(article.datetime) && article.datetime > 0);
  } catch (err) {
    console.warn(`NewsAPI failed for ${symbol}:`, err);
    return [];
  }
}

export async function fetchNewsIntel(symbolInput: string): Promise<NewsIntel> {
  const symbol = symbolInput.trim().toUpperCase();
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;

  if (!finnhubKey && !newsApiKey) {
    console.warn("NEWS INTEL: No API keys configured. Returning empty intel.");
    return emptyNewsIntel(symbol, 0);
  }

  const [finnhubArticles, newsApiArticles] = await Promise.all([
    finnhubKey ? fetchFinnhubArticles(symbol, finnhubKey) : Promise.resolve([]),
    newsApiKey ? fetchNewsApiArticles(symbol, newsApiKey) : Promise.resolve([]),
  ]);

  const cleaned = uniqueArticles([...finnhubArticles, ...newsApiArticles])
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 10);
  return cleaned.length > 0
    ? buildNewsIntel(symbol, cleaned, Number(Boolean(finnhubKey)) + Number(Boolean(newsApiKey)))
    : emptyNewsIntel(symbol, Number(Boolean(finnhubKey)) + Number(Boolean(newsApiKey)));
}
