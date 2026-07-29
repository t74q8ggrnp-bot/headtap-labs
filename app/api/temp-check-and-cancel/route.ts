// TEMPORARY — checks the pending ANY sell order and cancels it if still
// pending (not yet filled), per explicit user request not to lock in the
// loss right now. Delete after use.
import { NextResponse } from "next/server";
import { getPositions } from "@/lib/trading-bot/alpaca";

const ALPACA_KEY = process.env.ALPACA_API_KEY!;
const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY!;
const HEADERS = { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET };
const ORDER_ID = "bea96a5e-f6ac-464e-8c80-cb2518ed8bbd";

export async function GET() {
  const orderRes = await fetch(`https://paper-api.alpaca.markets/v2/orders/${ORDER_ID}`, { headers: HEADERS, cache: "no-store" });
  const order = await orderRes.json();

  let cancelResult: string | null = null;
  if (!order.filled_at && !order.canceled_at && !order.expired_at) {
    const cancelRes = await fetch(`https://paper-api.alpaca.markets/v2/orders/${ORDER_ID}`, { method: "DELETE", headers: HEADERS });
    cancelResult = `${cancelRes.status}`;
  }

  const positions = await getPositions();
  return NextResponse.json({
    orderStatusBeforeAction: order.status,
    orderFilled: Boolean(order.filled_at),
    cancelAttempted: cancelResult !== null,
    cancelResultStatus: cancelResult,
    anyPosition: positions.find((p) => p.symbol === "ANY") ?? null,
  });
}
