import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol")?.toUpperCase();

    if (!symbol) {
      return NextResponse.json(
        { error: "Missing symbol", c: 0, dp: 0 },
        { status: 400 }
      );
    }

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;

    const response = await fetch(yahooUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    });

    const data = await response.json();

    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    const price = Number(meta?.regularMarketPrice || 0);
    const previousClose = Number(meta?.chartPreviousClose || meta?.previousClose || 0);

    const percentChange =
      price && previousClose
        ? ((price - previousClose) / previousClose) * 100
        : 0;

    return NextResponse.json({
      c: price,
      dp: percentChange,
      symbol,
    });
  } catch (error) {
    console.error("QUOTE API ERROR:", error);

    return NextResponse.json(
      { error: "Failed to fetch quote", c: 0, dp: 0 },
      { status: 500 }
    );
  }
}