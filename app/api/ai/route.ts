import { NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export async function POST(req: Request) {
  const rateLimit = checkApiRateLimit(req, {
    namespace: "public-ai-analysis",
    limit: 10,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { analysis: "AI analysis rate limit reached. Please retry shortly." },
      { status: 429, headers: rateLimit.headers },
    );
  }
  try {
    const body = await req.json();
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const price = Number(body.price);
    const change = Number(body.change);

    if (
      !SYMBOL_PATTERN.test(symbol) ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(change)
    ) {
      return NextResponse.json(
        { analysis: "A valid symbol, price, and change are required." },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const prompt = `You are HT Labs AI, a premium stock intelligence assistant.

Analyze this stock setup concisely and clearly.

Stock: ${symbol}
Price: $${price}
Change: ${change >= 0 ? "+" : ""}${change?.toFixed(2)}%

Provide:
1. What is driving this move (1-2 sentences)
2. Key signal quality assessment (1-2 sentences)
3. Risk level and what to watch for (1-2 sentences)
4. One research posture (monitor / wait / risk elevated)

Keep it direct, data-driven, and under 150 words. Do not give personalized
financial advice, size a trade, or imply execution authority.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("OpenAI error:", err);
      return NextResponse.json(
        { analysis: "AI analysis unavailable right now." },
        { status: 500, headers: rateLimit.headers },
      );
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content || "No analysis returned.";

    return NextResponse.json(
      { analysis, symbol, price, change },
      { headers: rateLimit.headers },
    );
  } catch (error) {
    console.error("AI route error:", error);
    return NextResponse.json(
      { analysis: "AI analysis failed. Please try again." },
      { status: 500, headers: rateLimit.headers },
    );
  }
}
