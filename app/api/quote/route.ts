import { NextResponse } from "next/server";

type FinnhubQuote = {
  c?: number; // current price
  d?: number; // change
  dp?: number; // percent change
  h?: number;
  l?: number;
  o?: number;
  pc?: number; // previous close
  t?: number;
};

async function getYahooQuote(symbol: string) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;

  const response = await fetch(yahooUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Yahoo quote failed for ${symbol}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;

  const price = Number(meta?.regularMarketPrice || 0);
  const previousClose = Number(
    meta?.chartPreviousClose || meta?.previousClose || 0
  );

  const percentChange =
    price && previousClose ? ((price - previousClose) / previousClose) * 100 : 0;

  return {
    symbol,
    c: price,
    dp: percentChange,
    pc: previousClose,
    source: "yahoo",
  };
}

async function getFinnhubQuote(symbol: string) {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    throw new Error("Missing FINNHUB_API_KEY");
  }

  const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;

  const response = await fetch(finnhubUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Finnhub quote failed for ${symbol}`);
  }

  const data: FinnhubQuote = await response.json();

  const price = Number(data.c || 0);
  const percentChange = Number(data.dp || 0);
  const previousClose = Number(data.pc || 0);

  if (!price) {
    throw new Error(`Finnhub returned no price for ${symbol}`);
  }

  return {
    symbol,
    c: price,
    dp: percentChange,
    pc: previousClose,
    high: Number(data.h || 0),
    low: Number(data.l || 0),
    open: Number(data.o || 0),
    timestamp: Number(data.t || 0),
    source: "finnhub",
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol")?.toUpperCase().trim();

    if (!symbol) {
      return NextResponse.json(
        { error: "Missing symbol", c: 0, dp: 0 },
        { status: 400 }
      );
    }

    try {
      const finnhubQuote = await getFinnhubQuote(symbol);
      return NextResponse.json(finnhubQuote);
    } catch (finnhubError) {
      console.warn("Finnhub fallback triggered:", finnhubError);

      const yahooQuote = await getYahooQuote(symbol);
      return NextResponse.json(yahooQuote);
    }
  } catch (error) {
    console.error("QUOTE API ERROR:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch quote",
        c: 0,
        dp: 0,
        symbol: null,
        source: "error",
      },
      { status: 500 }
    );
  }
}
