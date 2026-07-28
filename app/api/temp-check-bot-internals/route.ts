// TEMPORARY — reproduces the trading-bot route's internal self-fetch to find why every cron cycle 500s. Delete after use.
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const baseUrl = new URL(req.url).origin;
  const target = `${baseUrl}/api/opportunities?type=momentum&limit=10`;
  try {
    const res = await fetch(target, { cache: "no-store" });
    const text = await res.text();
    return NextResponse.json({
      baseUrl,
      target,
      status: res.status,
      ok: res.ok,
      bodyPreview: text.slice(0, 500),
    });
  } catch (err: any) {
    return NextResponse.json({ baseUrl, target, error: err?.message ?? String(err) }, { status: 500 });
  }
}
