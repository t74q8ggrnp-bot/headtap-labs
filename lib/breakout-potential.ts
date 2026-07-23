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

  const score = Math.round(clamp(
    volumeFuel * 0.25 +
    momentumFuel * 0.2 +
    catalystFuel * 0.15 +
    crowdTiming * 0.15 +
    trapSafety * 0.1 +
    moveStage * 0.1 +
    technicalRoom * 0.05,
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
