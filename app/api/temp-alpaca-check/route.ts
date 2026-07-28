// TEMPORARY — confirms Alpaca actually accepts the configured credentials
// (read-only account check, no orders). Delete after use.
import { NextResponse } from "next/server";
import { getAccount } from "@/lib/trading-bot/alpaca";

export async function GET() {
  try {
    const account = await getAccount();
    return NextResponse.json({
      ok: true,
      status: account?.status,
      account_number: account?.account_number,
      buying_power: account?.buying_power,
      cash: account?.cash,
      pattern_day_trader: account?.pattern_day_trader,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message }, { status: 500 });
  }
}
