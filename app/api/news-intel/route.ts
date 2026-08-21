import { NextResponse } from "next/server";
import { fetchNewsIntel } from "@/lib/news-intel";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  return NextResponse.json(await fetchNewsIntel(symbol));
}
