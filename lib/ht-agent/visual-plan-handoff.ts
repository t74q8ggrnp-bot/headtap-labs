import type { PaperOrderIntent } from "@/lib/paper-trading/engine";
import type { AgentPlanLifecycleState, AgentXVisualPlanDefinition } from "./visual-plan";

function samePrice(left: number | null, right: number) {
  return left !== null && Math.abs(left - right) <= Math.max(0.000001, right * 0.000001);
}

export function validateVisualPlanHandoffIntent(input: {
  intent: PaperOrderIntent;
  definition: AgentXVisualPlanDefinition;
  lifecycleState: AgentPlanLifecycleState;
}) {
  const { intent, definition, lifecycleState } = input;
  const planSession = definition.chartObjects.find(
    (object) => object.authority === "agent",
  )?.timing.session;
  if (
    definition.paperOnly !== true ||
    definition.executionAuthority !== "none" ||
    intent.strategySource !== "ht_agent" ||
    intent.symbol !== definition.symbol ||
    intent.side !== "buy" ||
    intent.timeInForce !== "day" ||
    !planSession ||
    intent.allowExtendedHours !== (planSession !== "regular") ||
    intent.limitPrice !== null ||
    intent.quantity > definition.positionRisk.quantity ||
    !samePrice(intent.takeProfitPrice, definition.targetOne) ||
    !samePrice(intent.stopLossPrice, definition.stopPrice)
  ) return { ok: false as const, reason: "The reviewed paper order no longer matches the immutable Agent X plan." };
  if (lifecycleState === "watching") {
    if (intent.orderType !== "stop" || !samePrice(intent.stopPrice, definition.triggerPrice)) {
      return { ok: false as const, reason: "A watching plan must remain a trigger-stop paper order at its immutable entry level." };
    }
  } else if (lifecycleState === "triggered") {
    if (intent.orderType !== "market" || intent.stopPrice !== null) {
      return { ok: false as const, reason: "A triggered plan must be reviewed as a current market paper order." };
    }
  } else {
    return { ok: false as const, reason: `The ${lifecycleState} plan cannot create a paper order.` };
  }
  return { ok: true as const, reason: null };
}
