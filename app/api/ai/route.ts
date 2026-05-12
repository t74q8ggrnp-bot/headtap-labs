import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { symbol, price, change } = body;

    if (!symbol) {
      return NextResponse.json(
        { analysis: "Missing stock symbol.", price: price ?? null, change: change ?? null },
        { status: 400 }
      );
    }

    const prompt = `
You are HEADTAP AI, a premium AI stock scanner assistant.

Analyze this stock setup using ONLY the data provided.

Stock:
Symbol: ${symbol}
Price: $${price}
Percent Change: ${change}%

Return the response in this exact format:

BIAS:
Bullish, Bearish, or Neutral

CONFIDENCE:
0-100%

MOMENTUM:
Explain the current momentum in 1-2 short sentences.

ENTRY ZONE:
Give a simple possible entry zone based on the current price.

RISK LEVEL:
Low, Medium, or High

SETUP SUMMARY:
Give a short premium-style trading setup summary.
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          analysis:
            data.error?.message ||
            "OpenAI request failed. Check your API key or model.",
          symbol,
          price,
          change,
        },
        { status: 500 }
      );
    }

    const analysis =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      data.output?.[1]?.content?.[0]?.text ||
      "OpenAI responded, but no text was found.";

    return NextResponse.json({
      symbol,
      price,
      change,
      analysis,
    });
  } catch (error) {
    console.error("AI ROUTE ERROR:", error);

    return NextResponse.json(
      {
        analysis: "AI route failed. Check terminal for details.",
        price: null,
        change: null,
      },
      { status: 500 }
    );
  }
}