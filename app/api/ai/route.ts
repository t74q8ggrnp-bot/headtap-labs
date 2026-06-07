import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { symbol, price, change } = body;

    if (!symbol) {
      return NextResponse.json({ analysis: "Missing stock symbol." }, { status: 400 });
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
4. One clear action directive (buy/watch/avoid/wait)

Keep it direct, data-driven, and under 150 words. No fluff.`;

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
      return NextResponse.json({ analysis: "AI analysis unavailable right now." }, { status: 500 });
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content || "No analysis returned.";

    return NextResponse.json({ analysis, symbol, price, change });
  } catch (error) {
    console.error("AI route error:", error);
    return NextResponse.json({ analysis: "AI analysis failed. Please try again." }, { status: 500 });
  }
}
