import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { checkDurableApiRateLimit, recordExternalRequestTelemetry } from "@/lib/durable-api-guard";
import { marketChartPollingState } from "@/lib/market-chart-polling";
import { normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type BullBearPayload = {
  onRadar: string;
  bullCase: string[];
  bearCase: string[];
  crowdFocus: string;
  htRead: string;
};

type SignalEvidence = {
  catalyst_score: number | null;
  state: string | null;
  pattern: string | null;
  crowd_score: number | null;
  ht_score: number | null;
  change_percent: number | null;
  relative_volume: number | null;
  scanned_at: string | null;
};

type NewsEvidence = {
  title: string;
  description?: string;
  published_utc: string;
  author?: string;
};

class BullBearUnavailableError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BullBearUnavailableError";
  }
}

const globalState = globalThis as typeof globalThis & {
  __htBullBearInflight?: Map<string, Promise<Record<string, unknown>>>;
};
const inflight = globalState.__htBullBearInflight ?? new Map();
globalState.__htBullBearInflight = inflight;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

function safeString(value: unknown, maxLength = 400) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function parsePayload(value: unknown): BullBearPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const onRadar = safeString(source.onRadar);
  const crowdFocus = safeString(source.crowdFocus);
  const htRead = safeString(source.htRead);
  const list = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.map((item) => safeString(item, 240)).filter((item): item is string => Boolean(item)).slice(0, 3)
    : [];
  const bullCase = list(source.bullCase);
  const bearCase = list(source.bearCase);
  if (!onRadar || !crowdFocus || !htRead || bullCase.length === 0 || bearCase.length === 0) return null;
  return { onRadar, bullCase, bearCase, crowdFocus, htRead };
}

function easternDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function cacheWindow(now = new Date()) {
  const halfHour = Math.floor(now.getTime() / (30 * 60 * 1000));
  const session = marketChartPollingState(now, "extended");
  return `${easternDate(now)}:${session.reason}:${halfHour}`;
}

async function generateBullBear(symbol: string, windowKey: string) {
  const polygonKey = process.env.POLYGON_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const supabase = getSupabase();
  if (!openAiKey || (!polygonKey && !supabase)) {
    throw new BullBearUnavailableError("evidence_provider_not_configured");
  }

  let providerRequestCount = 0;
  let articles: NewsEvidence[] = [];
  let newsStatus: "verified" | "unavailable" = "unavailable";
  if (polygonKey) {
    providerRequestCount += 1;
    const newsUrl = new URL("https://api.polygon.io/v2/reference/news");
    newsUrl.searchParams.set("ticker", symbol);
    newsUrl.searchParams.set("limit", "8");
    newsUrl.searchParams.set("order", "desc");
    const newsResponse = await fetch(newsUrl, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${polygonKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (newsResponse.ok) {
      const payload = await newsResponse.json();
      articles = (Array.isArray(payload?.results) ? payload.results : [])
        .map((item: Record<string, unknown>) => ({
          title: safeString(item.title, 300) ?? "",
          description: safeString(item.description, 600) ?? undefined,
          published_utc: safeString(item.published_utc, 80) ?? "",
          author: safeString(item.author, 100) ?? undefined,
        }))
        .filter((item: NewsEvidence) => item.title && item.published_utc)
        .slice(0, 8);
      newsStatus = "verified";
    }
  }

  let signal: SignalEvidence | null = null;
  let signalStatus: "verified" | "unavailable" = "unavailable";
  if (supabase) {
    const result = await supabase
      .from("ht_signals")
      .select("catalyst_score,state,pattern,crowd_score,ht_score,change_percent,relative_volume,scanned_at")
      .eq("ticker", symbol)
      .maybeSingle();
    if (!result.error) {
      signal = result.data as SignalEvidence | null;
      signalStatus = "verified";
    }
  }

  if (articles.length === 0 && !signal) {
    throw new BullBearUnavailableError("no_supporting_evidence");
  }

  const newsContext = articles.length > 0
    ? articles.map((article, index) => `${index + 1}. ${JSON.stringify(article.title)}${article.description ? ` — ${article.description}` : ""}`).join("\n")
    : "No verified recent article was returned. Do not infer a catalyst from absence.";
  const signalContext = signal
    ? `Canonical observation: HT score ${signal.ht_score ?? "unavailable"}; catalyst score ${signal.catalyst_score ?? "unavailable"}; state ${signal.state ?? "unavailable"}; pattern ${signal.pattern ?? "unavailable"}; change ${signal.change_percent ?? "unavailable"}%; relative volume ${signal.relative_volume ?? "unavailable"}; crowd score ${signal.crowd_score ?? "unavailable"}; observed ${signal.scanned_at ?? "timestamp unavailable"}.`
    : "No current Canonical observation is available.";
  const prompt = `Analyze ${symbol} using only the supplied evidence. Do not use general market knowledge, invent a catalyst, recommend a trade, or imply execution authority. If evidence is limited, say so plainly.\n\nVERIFIED NEWS EVIDENCE:\n${newsContext}\n\n${signalContext}\n\nReturn JSON with onRadar, bullCase (up to 3 factual strings), bearCase (up to 3 factual strings), crowdFocus, and htRead.`;

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 600,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!aiResponse.ok) throw new BullBearUnavailableError("synthesis_unavailable");

  const aiData = await aiResponse.json();
  const raw = aiData.choices?.[0]?.message?.content;
  let decoded: unknown;
  try {
    decoded = JSON.parse(typeof raw === "string" ? raw : "");
  } catch {
    throw new BullBearUnavailableError("invalid_synthesis_response");
  }
  const analysis = parsePayload(decoded);
  if (!analysis) throw new BullBearUnavailableError("invalid_synthesis_response");

  const newestNewsAt = articles
    .map((article) => Date.parse(article.published_utc))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const generatedAt = new Date().toISOString();
  const telemetryReceipt = await recordExternalRequestTelemetry({
    endpoint: "/api/bull-bear",
    provider: "massive+openai",
    operation: "evidence_synthesis",
    requestCount: providerRequestCount + 1,
    inputTokens: Number(aiData.usage?.prompt_tokens) || null,
    outputTokens: Number(aiData.usage?.completion_tokens) || null,
    outcome: "success",
    sourceTimestamp: signal?.scanned_at ?? (Number.isFinite(newestNewsAt) ? new Date(newestNewsAt).toISOString() : null),
    metadata: { ticker: symbol, cacheWindow: windowKey },
  });
  return {
    ticker: symbol,
    status: "available",
    ...analysis,
    evidence: {
      news: newsStatus,
      canonicalSignal: signalStatus,
      newsCount: articles.length,
      newestNewsAt: Number.isFinite(newestNewsAt) ? new Date(newestNewsAt).toISOString() : null,
      signalObservedAt: signal?.scanned_at ?? null,
      cacheWindow: windowKey,
    },
    freshness: { generatedAt, maxAgeSeconds: 1_800 },
    telemetry: {
      massiveRequests: providerRequestCount,
      openAiRequests: 1,
      inputTokens: Number(aiData.usage?.prompt_tokens) || null,
      outputTokens: Number(aiData.usage?.completion_tokens) || null,
      cached: false,
      durableReceiptRecorded: telemetryReceipt.recorded,
    },
  };
}

const cachedBullBear = unstable_cache(generateBullBear, ["ht-bull-bear-v2"], {
  revalidate: 1_800,
  tags: ["bull-bear"],
});

async function coalescedBullBear(symbol: string, windowKey: string) {
  const key = `${symbol}:${windowKey}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = cachedBullBear(symbol, windowKey).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

export async function GET(request: NextRequest) {
  const rateLimit = await checkDurableApiRateLimit(request, {
    namespace: "public-bull-bear",
    limit: 12,
    windowMs: 60_000,
    failureMode: "fail_closed",
  });
  if (!rateLimit.allowed) {
    void recordExternalRequestTelemetry({
      endpoint: "/api/bull-bear",
      provider: "none",
      operation: "evidence_synthesis",
      requestCount: 0,
      outcome: "rate_limited",
    });
    return NextResponse.json({
      status: "unavailable",
      code: "rate_limited",
      message: "Bull/bear evidence is temporarily unavailable.",
    }, { status: 429, headers: rateLimit.headers });
  }

  const ticker = normalizeMarketWorkspaceSymbol(request.nextUrl.searchParams.get("ticker"));
  if (!ticker) {
    return NextResponse.json({
      status: "unavailable",
      code: "invalid_ticker",
      message: "A valid stock or ETF ticker is required.",
    }, { status: 400, headers: rateLimit.headers });
  }

  try {
    const payload = await coalescedBullBear(ticker, cacheWindow());
    return NextResponse.json(payload, {
      headers: {
        ...rateLimit.headers,
        "Cache-Control": "public, max-age=60, s-maxage=1800, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    const code = error instanceof BullBearUnavailableError ? error.code : "evidence_generation_failed";
    console.error("[bull-bear] evidence unavailable", { ticker, code });
    void recordExternalRequestTelemetry({
      endpoint: "/api/bull-bear",
      provider: "massive+openai",
      operation: "evidence_synthesis",
      requestCount: 0,
      outcome: "unavailable",
      metadata: { ticker, code },
    });
    return NextResponse.json({
      ticker,
      status: "unavailable",
      code,
      message: `Bull/bear evidence is unavailable for ${ticker}. No analysis was fabricated.`,
      evidence: { news: "unavailable", canonicalSignal: "unavailable" },
      freshness: { generatedAt: null, maxAgeSeconds: 1_800 },
      telemetry: { massiveRequests: null, openAiRequests: null, cached: false },
    }, { status: 503, headers: rateLimit.headers });
  }
}
