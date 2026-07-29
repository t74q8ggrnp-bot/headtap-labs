// TEMPORARY — checks the stuck ANY sell order + current position status. Delete after use.
import { NextResponse } from "next/server";
import { getPositions } from "@/lib/trading-bot/alpaca";

const ALPACA_KEY = process.env.ALPACA_API_KEY!;
const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY!;

export async function GET() {
  const [positions, orderRes] = await Promise.all([
    getPositions(),
    fetch("https://paper-api.alpaca.markets/v2/orders/bea96a5e-f6ac-464e-8c80-cb2518ed8bbd", {
      headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
      cache: "no-store",
    }),
  ]);
  const order = await orderRes.json();
  return NextResponse.json({
    anyPosition: positions.find((p) => p.symbol === "ANY") ?? null,
    stuckOrder: order,
  });
}
