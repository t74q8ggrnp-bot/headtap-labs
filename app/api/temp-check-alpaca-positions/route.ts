// TEMPORARY — confirms no stray positions/orders exist in the paper account before enabling the bot. Delete after use.
import { NextResponse } from "next/server";
import { getAccount, getPositions } from "@/lib/trading-bot/alpaca";

export async function GET() {
  const [account, positions] = await Promise.all([getAccount(), getPositions()]);
  return NextResponse.json({
    equity: account?.equity,
    cash: account?.cash,
    buying_power: account?.buying_power,
    positions,
  });
}
