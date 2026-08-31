import { NextResponse } from "next/server";
import {
  calculatePaperFillPrice,
  estimatePaperSlippageBps,
  getEasternMarketSession,
  isPaperDayOrderExpired,
  isPaperOrderSessionEligible,
  PAPER_TRADING_CONTRACT_VERSION,
  paperQuoteAgeMinutes,
  shouldFillPaperOrder,
} from "@/lib/paper-trading/engine";
import { getPaperTradingQuote } from "@/lib/paper-trading/quote";
import {
  createBracketChildren,
  getPaperServiceClient,
} from "@/lib/paper-trading/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  if (!CRON_SECRET || request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const service = getPaperServiceClient();
  const now = new Date();
  const session = getEasternMarketSession(now);
  const runInsert = await service
    .from("paper_match_runs")
    .insert({
      started_at: now.toISOString(),
      market_session: session,
      diagnostics: { authority: "manual_simulation_only" },
    })
    .select("id")
    .maybeSingle();
  const runId = runInsert.error ? null : runInsert.data?.id ?? null;
  if (runInsert.error) {
    console.warn("[manual-paper-match] heartbeat unavailable", {
      message: runInsert.error.message,
    });
  }
  const result = await service
    .from("paper_orders")
    .select("*")
    .in("status", ["accepted", "open", "partially_filled"])
    .order("submitted_at", { ascending: true })
    .limit(100);
  if (result.error) {
    if (runId) {
      await service.from("paper_match_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        diagnostics: {
          authority: "manual_simulation_only",
          error: result.error.message,
        },
      }).eq("id", runId);
    }
    return NextResponse.json({ ok: false, error: "Paper order queue unavailable." }, { status: 503 });
  }

  let filled = 0;
  let expired = 0;
  let rejected = 0;
  let skipped = 0;
  for (const order of result.data ?? []) {
    if (
      order.time_in_force === "day" &&
      isPaperDayOrderExpired(
        new Date(order.submitted_at),
        now,
        order.allow_extended_hours,
      )
    ) {
      await service.from("paper_orders").update({
        status: "expired",
        updated_at: now.toISOString(),
      }).eq("id", order.id);
      await service.from("paper_order_events").insert({
        account_id: order.account_id,
        user_id: order.user_id,
        order_id: order.id,
        event_type: "expired",
        detail: { reason: "day_order_ended" },
      });
      expired += 1;
      continue;
    }
    if (!isPaperOrderSessionEligible(session, order.allow_extended_hours)) {
      skipped += 1;
      continue;
    }

    try {
      const quote = await getPaperTradingQuote(order.symbol);
      const maxQuoteAge = quote.dataMode === "delayed" ? 35 : 5;
      if (paperQuoteAgeMinutes(quote, now) > maxQuoteAge) {
        skipped += 1;
        continue;
      }
      const intent = {
        side: order.side,
        orderType: order.order_type,
        limitPrice: order.limit_price === null ? null : Number(order.limit_price),
        stopPrice: order.stop_price === null ? null : Number(order.stop_price),
      };
      if (!shouldFillPaperOrder(intent, quote.price)) {
        skipped += 1;
        continue;
      }
      const quantity = Number(order.quantity) - Number(order.filled_quantity);
      const slippageBps = estimatePaperSlippageBps(quote, quantity * quote.price);
      const adverse = calculatePaperFillPrice(order.side, quote.price, slippageBps);
      const fillPrice = (order.order_type === "limit" || order.order_type === "stop_limit") && order.limit_price
        ? order.side === "buy" || order.side === "buy_to_cover"
          ? Math.min(adverse, Number(order.limit_price))
          : Math.max(adverse, Number(order.limit_price))
        : adverse;
      const applied = await service.rpc("paper_apply_fill", {
        p_order_id: order.id,
        p_fill_price: fillPrice,
        p_quote_source: quote.source,
        p_quote_timestamp: quote.timestamp,
        p_slippage_bps: slippageBps,
      });
      if (applied.error) {
        await service.from("paper_orders").update({
          status: "rejected",
          reject_reason: applied.error.message,
          updated_at: now.toISOString(),
        }).eq("id", order.id);
        await service.from("paper_order_events").insert({
          account_id: order.account_id,
          user_id: order.user_id,
          order_id: order.id,
          event_type: "rejected",
          detail: { reason: applied.error.message, authority: "paper_matcher" },
        });
        rejected += 1;
        continue;
      }
      if (order.order_class === "bracket_parent") {
        await createBracketChildren(service, order);
      }
      filled += 1;
    } catch (error) {
      skipped += 1;
      console.warn("[manual-paper-match] order skipped", {
        orderId: order.id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const completedAt = new Date().toISOString();
  if (runId) {
    const heartbeat = await service.from("paper_match_runs").update({
      status: "success",
      completed_at: completedAt,
      examined_count: (result.data ?? []).length,
      filled_count: filled,
      expired_count: expired,
      rejected_count: rejected,
      skipped_count: skipped,
      diagnostics: { authority: "manual_simulation_only" },
    }).eq("id", runId);
    if (heartbeat.error) {
      console.warn("[manual-paper-match] heartbeat completion failed", {
        message: heartbeat.error.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    contractVersion: PAPER_TRADING_CONTRACT_VERSION,
    examined: (result.data ?? []).length,
    filled,
    expired,
    rejected,
    skipped,
    marketSession: session,
    timestamp: completedAt,
  });
}
