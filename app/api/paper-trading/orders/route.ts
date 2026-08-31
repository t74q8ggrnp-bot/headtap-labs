import { NextResponse } from "next/server";
import {
  calculatePaperFillPrice,
  estimatePaperSlippageBps,
  getEasternMarketSession,
  isPaperCloseRequest,
  isPaperOrderSessionEligible,
  normalizePaperCloseIntent,
  normalizePaperOrderIntent,
  PAPER_TRADING_CONTRACT_VERSION,
  paperQuoteAgeMinutes,
  paperOrderRequestSymbol,
  shouldFillPaperOrder,
  simulatedBorrowTerms,
  validatePaperOrder,
} from "@/lib/paper-trading/engine";
import { getPaperTradingQuote } from "@/lib/paper-trading/quote";
import {
  accountState,
  authenticatePaperRequest,
  createBracketChildren,
  findPaperPosition,
  getOrCreatePaperAccount,
  loadPaperDashboard,
  positionState,
} from "@/lib/paper-trading/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const response = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json({ contractVersion: PAPER_TRADING_CONTRACT_VERSION, ...body }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });

function providerBoundFillPrice(
  side: "buy" | "sell" | "sell_short" | "buy_to_cover",
  orderType: "market" | "limit" | "stop" | "stop_limit",
  quotePrice: number,
  limitPrice: number | null,
  slippageBps: number,
) {
  const simulated = calculatePaperFillPrice(side, quotePrice, slippageBps);
  if ((orderType === "limit" || orderType === "stop_limit") && limitPrice) {
    return side === "buy" || side === "buy_to_cover"
      ? Math.min(simulated, limitPrice)
      : Math.max(simulated, limitPrice);
  }
  return simulated;
}

export async function POST(request: Request) {
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);

    const requestBody = await request.json().catch(() => null);
    const requestedClose = isPaperCloseRequest(requestBody);
    const normalizedIntent = normalizePaperOrderIntent(requestBody);
    const symbol = normalizedIntent?.symbol ?? paperOrderRequestSymbol(requestBody);
    if (!symbol) return response({ ok: false, error: "Invalid paper order." }, 400);

    const account = await getOrCreatePaperAccount(context);
    const [position, quote] = await Promise.all([
      findPaperPosition(context.service, account.id, symbol),
      getPaperTradingQuote(symbol),
    ]);
    const currentPosition = positionState(position);
    const intent = requestedClose
      ? normalizePaperCloseIntent(requestBody, currentPosition)
      : normalizedIntent;
    if (requestedClose && !intent) {
      return response({
        ok: false,
        error: "There is no matching open position to close.",
      }, 422);
    }
    if (!intent) return response({ ok: false, error: "Invalid paper order." }, 400);

    const validation = validatePaperOrder(
      intent,
      accountState(account),
      currentPosition,
      quote,
    );
    if (!validation.ok) {
      return response({ ok: false, error: validation.reason ?? "Order rejected." }, 422);
    }

    const session = getEasternMarketSession();
    const sessionEligible = isPaperOrderSessionEligible(
      session,
      intent.allowExtendedHours,
    );
    const conditionMet = shouldFillPaperOrder(intent, quote.price);
    const shouldFill = sessionEligible && conditionMet;
    const maxQuoteAge = quote.dataMode === "delayed" ? 35 : 5;
    const quoteAgeMinutes = paperQuoteAgeMinutes(quote);
    if (shouldFill && quoteAgeMinutes > maxQuoteAge) {
      return response({
        ok: false,
        error: `The ${quote.dataMode.replace("_", " ")} quote is too old to simulate a fill safely.`,
      }, 409);
    }

    const orderClass = intent.takeProfitPrice !== null ? "bracket_parent" : "simple";
    const inserted = await context.service
      .from("paper_orders")
      .insert({
        account_id: account.id,
        user_id: context.user.id,
        symbol: intent.symbol,
        side: intent.side,
        order_type: intent.orderType,
        time_in_force: intent.timeInForce,
        quantity: intent.quantity,
        limit_price: intent.limitPrice,
        stop_price: intent.stopPrice,
        allow_extended_hours: intent.allowExtendedHours,
        status: shouldFill ? "accepted" : "open",
        order_class: orderClass,
        bracket_take_profit_price: intent.takeProfitPrice,
        bracket_stop_loss_price: intent.stopLossPrice,
        strategy_source: intent.strategySource,
        quote_price_at_submit: quote.price,
        quote_source_at_submit: quote.source,
        quote_timestamp_at_submit: quote.timestamp,
        data_mode: quote.dataMode,
        context_snapshot: {
          market_session: session,
          quote_age_minutes: Number(quoteAgeMinutes.toFixed(2)),
          estimated_notional: validation.estimatedNotional,
          estimated_margin_required: validation.estimatedMarginRequired,
          simulated_borrow: intent.side === "sell_short"
            ? simulatedBorrowTerms(quote)
            : null,
          execution_authority: "manual_simulation_only",
        },
      })
      .select("*")
      .single();
    if (inserted.error) throw inserted.error;
    const order = inserted.data;

    const acceptedEvent = await context.service.from("paper_order_events").insert({
      account_id: account.id,
      user_id: context.user.id,
      order_id: order.id,
      event_type: shouldFill ? "accepted" : "opened",
      detail: {
        market_session: session,
        condition_met: conditionMet,
        quote_price: quote.price,
        quote_timestamp: quote.timestamp,
      },
    });
    if (acceptedEvent.error) throw acceptedEvent.error;

    if (shouldFill) {
      const slippageBps = estimatePaperSlippageBps(
        quote,
        validation.estimatedNotional,
      );
      const fillPrice = providerBoundFillPrice(
        intent.side,
        intent.orderType,
        quote.price,
        intent.limitPrice,
        slippageBps,
      );
      const filled = await context.service.rpc("paper_apply_fill", {
        p_order_id: order.id,
        p_fill_price: fillPrice,
        p_quote_source: quote.source,
        p_quote_timestamp: quote.timestamp,
        p_slippage_bps: slippageBps,
      });
      if (filled.error) {
        await context.service
          .from("paper_orders")
          .update({
            status: "rejected",
            reject_reason: filled.error.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
        await context.service.from("paper_order_events").insert({
          account_id: account.id,
          user_id: context.user.id,
          order_id: order.id,
          event_type: "rejected",
          detail: { reason: filled.error.message },
        });
        return response({ ok: false, error: "The paper ledger rejected this fill." }, 409);
      }
      if (orderClass === "bracket_parent") {
        await createBracketChildren(context.service, order);
      }
    }

    return response({
      ok: true,
      orderId: order.id,
      status: shouldFill ? "filled" : "open",
      message: shouldFill
        ? `Paper ${intent.side.replaceAll("_", " ")} filled in simulation.`
        : sessionEligible
          ? "Paper order accepted and waiting for its price condition."
          : "Paper order accepted for the next eligible session.",
      dashboard: await loadPaperDashboard(context),
    }, 201);
  } catch (error) {
    console.error("[manual-paper] order submit failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return response({ ok: false, error: "The paper order could not be submitted." }, 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await authenticatePaperRequest(request);
    if (!context) return response({ ok: false, error: "Authentication required." }, 401);
    const orderId = new URL(request.url).searchParams.get("orderId")?.trim();
    if (!orderId) return response({ ok: false, error: "Missing order id." }, 400);
    const account = await getOrCreatePaperAccount(context);
    const cancelled = await context.service
      .from("paper_orders")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("account_id", account.id)
      .in("status", ["accepted", "open", "partially_filled"])
      .select("id")
      .maybeSingle();
    if (cancelled.error) throw cancelled.error;
    if (!cancelled.data) return response({ ok: false, error: "Order is no longer cancellable." }, 409);
    await context.service.from("paper_order_events").insert({
      account_id: account.id,
      user_id: context.user.id,
      order_id: orderId,
      event_type: "cancelled",
      detail: { authority: "user" },
    });
    return response({ ok: true, dashboard: await loadPaperDashboard(context) });
  } catch (error) {
    console.error("[manual-paper] order cancellation failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return response({ ok: false, error: "The paper order could not be cancelled." }, 503);
  }
}
