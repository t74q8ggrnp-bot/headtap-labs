import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol")?.toUpperCase();

    if (!symbol) {
      return NextResponse.json([]);
    }

    const apiKey = process.env.FINNHUB_API_KEY;

    const today = new Date();
    const prior = new Date();

    prior.setDate(today.getDate() - 7);

    const from = prior.toISOString().split("T")[0];
    const to = today.toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${apiKey}`;

    const response = await fetch(url, {
      cache: "no-store",
    });

    const data = await response.json();

    return NextResponse.json(data.slice(0, 5));
  } catch (error) {
    console.error("NEWS API ERROR:", error);

    return NextResponse.json([]);
  }
}