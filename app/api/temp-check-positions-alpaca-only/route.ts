// TEMPORARY — checks Alpaca positions AND raw order history directly,
// bypassing Supabase (which is currently down), to reconstruct how ANY/OTLK
// were opened. Delete after use.
import { NextResponse } from "next/server";
import { getPositions } from "@/lib/trading-bot/alpaca";

const ALPACA_KEY = process.env.ALPACA_API_KEY!;
const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY!;

export async function GET() {
  const positions = await getPositions();
  const res = await fetch("https://paper-api.alpaca.markets/v2/orders?status=all&limit=100&direction=asc", {
    headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
    cache: "no-store",
  });
  const orders = await res.json();
  return NextResponse.json({
    positions,
    orders: (orders ?? []).map((o: any) => ({
      symbol: o.symbol, side: o.side, status: o.status, qty: o.qty, notional: o.notional,
      filled_avg_price: o.filled_avg_price, submitted_at: o.submitted_at, filled_at: o.filled_at,
    })),
  });
}
