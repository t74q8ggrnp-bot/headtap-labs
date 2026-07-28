// TEMPORARY — checks Alpaca positions directly, bypassing Supabase (which is
// currently down), to confirm GLOB/ARAY exposure during the outage. Delete after use.
import { NextResponse } from "next/server";
import { getPositions } from "@/lib/trading-bot/alpaca";

export async function GET() {
  const positions = await getPositions();
  return NextResponse.json({ positions });
}
