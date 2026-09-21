import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { checkDurableApiRateLimit, recordExternalRequestTelemetry } from "@/lib/durable-api-guard";
import { normalizeMarketWorkspaceSymbol } from "@/lib/market-workspace-route";

type AnalysisResult = {
  analysis: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

async function generateAnalysis(symbol: string, price: number, change: number): Promise<AnalysisResult> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) throw new Error("analysis unavailable");
  const prompt = `Analyze only this supplied quote context for research: ${symbol}, price $${price}, change ${change >= 0 ? "+" : ""}${change.toFixed(2)}%. Explain the move cannot be known from price alone; assess observable quote momentum, identify missing evidence, state risk, and give one monitor/wait/risk-elevated research posture. Under 150 words. No personalized advice, position sizing, target, or execution authority.`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("analysis unavailable");
  const data = await response.json();
  const analysis = typeof data.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content.trim().slice(0, 2_000)
    : "";
  if (!analysis) throw new Error("analysis unavailable");
  return {
    analysis,
    inputTokens: Number(data.usage?.prompt_tokens) || null,
    outputTokens: Number(data.usage?.completion_tokens) || null,
  };
}

const cachedAnalysis = unstable_cache(generateAnalysis, ["public-ai-analysis-v2"], {
  revalidate: 900,
  tags: ["public-ai-analysis"],
});

export async function POST(request: Request) {
  const rateLimit = await checkDurableApiRateLimit(request, {
    namespace: "public-ai-analysis",
    limit: 10,
    windowMs: 60_000,
    failureMode: "fail_closed",
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: "unavailable", code: "rate_limited", analysis: "AI analysis is temporarily unavailable." },
      { status: 429, headers: rateLimit.headers },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return NextResponse.json(
      { status: "unavailable", code: "payload_too_large", analysis: "The analysis request is too large." },
      { status: 413, headers: rateLimit.headers },
    );
  }

  try {
    const body = await request.json();
    const symbol = normalizeMarketWorkspaceSymbol(body?.symbol);
    const price = Number(body?.price);
    const change = Number(body?.change);
    if (!symbol || !Number.isFinite(price) || price <= 0 || price > 10_000_000 || !Number.isFinite(change) || Math.abs(change) > 100_000) {
      return NextResponse.json(
        { status: "unavailable", code: "invalid_input", analysis: "A valid symbol, price, and change are required." },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const boundedPrice = Number(price.toFixed(4));
    const boundedChange = Number(change.toFixed(4));
    const result = await cachedAnalysis(symbol, boundedPrice, boundedChange);
    const receipt = await recordExternalRequestTelemetry({
      endpoint: "/api/ai",
      provider: "openai",
      operation: "quote_context_analysis",
      requestCount: 1,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      outcome: "success",
      metadata: { symbol },
    });
    return NextResponse.json({
      status: "available",
      analysis: result.analysis,
      symbol,
      price: boundedPrice,
      change: boundedChange,
      evidenceScope: "supplied_quote_only",
      telemetry: {
        openAiRequests: 1,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: null,
        durableReceiptRecorded: receipt.recorded,
      },
    }, { headers: rateLimit.headers });
  } catch {
    void recordExternalRequestTelemetry({
      endpoint: "/api/ai",
      provider: "openai",
      operation: "quote_context_analysis",
      requestCount: 1,
      outcome: "unavailable",
    });
    return NextResponse.json(
      { status: "unavailable", code: "analysis_unavailable", analysis: "AI analysis is unavailable right now." },
      { status: 503, headers: rateLimit.headers },
    );
  }
}
