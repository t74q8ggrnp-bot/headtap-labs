import type { TradeFrameworkResult } from "@/lib/canonical-trade-framework";

export type BreakoutPotentialInput = {
  change: number;
  relativeVolume: number;
  momentumScore: number;
  crowdScore: number;
  trapScore: number;
  catalystScore: number;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

// Measures observed expansion fuel, not predicted return. Eligibility remains
// authoritative, and verified float will be added only when a reliable source
// is connected.
export function getBreakoutPotential(
  input: BreakoutPotentialInput,
  framework: TradeFrameworkResult,
  strategy: "spot_momentum" | "before_the_crowd" = "spot_momentum",
) {
  const move = Math.max(0, input.change);
  const volumeFuel = clamp(input.relativeVolume * 14);
  const momentumFuel = clamp(input.momentumScore);
  const catalystFuel = clamp(input.catalystScore * 1.25);
  const crowdTiming = clamp(100 - Math.abs(input.crowdScore - 42) * 1.5);
  const trapSafety = clamp(100 - input.trapScore);
  // Rewards a real move happening now — saturates at 100 by ~22%, but never
  // declines past that. A 100% mover is not a worse breakout than a 22%
  // mover on this dimension; crowdTiming/trapSafety already carry the
  // "how extended/crowded is this" risk signal separately.
  const moveStage = move <= 2 ? move * 25 : clamp(50 + (move - 2) * 2.5);
  const technicalRoom = clamp((framework.upsideMax ?? 0) * 5);

  // crowdTiming/trapSafety measure "is this early and uncrowded" — exactly
  // Before The Crowd's thesis, so it keeps full weight there. Spot Momentum's
  // thesis is the opposite: catch the move that's already happening. A big
  // real move being crowded/high-trap-by-formula (trapScore is literally
  // move% * 3.5) is not a weaker breakout, it's the point — that risk is
  // named via riskTags instead of shrinking the score here.
  const weights = strategy === "before_the_crowd"
    ? { volume: 0.25, momentum: 0.2, catalyst: 0.15, crowd: 0.15, trap: 0.1, moveStage: 0.1, technical: 0.05 }
    : { volume: 0.3, momentum: 0.25, catalyst: 0.15, crowd: 0.05, trap: 0.05, moveStage: 0.15, technical: 0.05 };

  const score = Math.round(clamp(
    volumeFuel * weights.volume +
    momentumFuel * weights.momentum +
    catalystFuel * weights.catalyst +
    crowdTiming * weights.crowd +
    trapSafety * weights.trap +
    moveStage * weights.moveStage +
    technicalRoom * weights.technical,
  ));

  return {
    score,
    label: score >= 82 ? "Explosive" : score >= 68 ? "High" : score >= 52 ? "Building" : "Limited",
    components: {
      volumeFuel: Math.round(volumeFuel),
      momentumFuel: Math.round(momentumFuel),
      catalystFuel: Math.round(catalystFuel),
      crowdTiming: Math.round(crowdTiming),
      trapSafety: Math.round(trapSafety),
      moveStage: Math.round(moveStage),
      technicalRoom: Math.round(technicalRoom),
    },
    floatDataStatus: "unavailable" as const,
  };
}
