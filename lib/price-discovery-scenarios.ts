export const PRICE_DISCOVERY_SCENARIO_VERSION =
  "price-discovery-scenarios-v2-nondegenerate" as const;

export type PriceDiscoveryScenarioBands = {
  methodologyVersion: typeof PRICE_DISCOVERY_SCENARIO_VERSION;
  unit: "additional_from_current_price";
  base: { min: number; max: number };
  expansion: { min: number; max: number };
  tail: { min: number; max: number };
  structuralRisk: number | null;
  expansionRr: number | null;
  inputs: {
    atrPercent: number;
    currentMovePercent: number;
    relativeVolume: number;
    momentumScore: number;
    explosionScore: number;
  };
};

export type PriceDiscoveryScenarioResult = {
  bands: PriceDiscoveryScenarioBands | null;
  unavailableReason: string | null;
};

type PriceDiscoveryScenarioInput = {
  atrPercent: number | null;
  currentMovePercent: number;
  relativeVolume: number;
  momentumScore: number;
  explosionScore: number;
  structuralRiskPercent: number | null;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, value));
const roundedPercent = (value: number) =>
  Math.round(Math.min(200, value) * 10) / 10;

const hasMeasurableWidth = (range: { min: number; max: number }) =>
  Number.isFinite(range.min) &&
  Number.isFinite(range.max) &&
  range.min >= 0 &&
  range.max > range.min;

/**
 * Builds conditional continuation ranges without asserting a target.
 *
 * The prior model could let a very large ATR-derived base overwhelm the live
 * impulse. `Math.max` then collapsed expansion and tail into identical values,
 * which looked precise while containing no measurable range. This contract
 * fails closed whenever any displayed band has zero width after rounding.
 */
export function buildPriceDiscoveryScenario(
  input: PriceDiscoveryScenarioInput,
): PriceDiscoveryScenarioResult {
  if (
    input.atrPercent === null ||
    !Number.isFinite(input.atrPercent) ||
    input.atrPercent <= 0
  ) {
    return {
      bands: null,
      unavailableReason:
        "Reliable volatility history is unavailable, so continuation ranges are not measurable.",
    };
  }

  const volumeFuel = clampScore(input.relativeVolume * 7.5);
  const fuelFactor = Math.max(
    0.6,
    Math.min(
      1.2,
      (volumeFuel * 0.35 +
        clampScore(input.momentumScore) * 0.4 +
        clampScore(input.explosionScore) * 0.25) /
        100,
    ),
  );
  const impulse = Math.max(0, Math.min(150, input.currentMovePercent));
  const baseMin = input.atrPercent * 0.75;
  const baseMax = input.atrPercent * (1 + fuelFactor);
  const expansionMin = Math.max(baseMax, impulse * 0.35 * fuelFactor);
  const expansionMax = Math.max(
    expansionMin,
    impulse * 0.75 * fuelFactor,
  );
  const tailMin = Math.max(expansionMax, impulse * 0.9 * fuelFactor);
  const tailMax = Math.max(tailMin, impulse * 1.5 * fuelFactor);

  const base = {
    min: roundedPercent(baseMin),
    max: roundedPercent(baseMax),
  };
  const expansion = {
    min: roundedPercent(expansionMin),
    max: roundedPercent(expansionMax),
  };
  const tail = {
    min: roundedPercent(tailMin),
    max: roundedPercent(tailMax),
  };

  if (
    !hasMeasurableWidth(base) ||
    !hasMeasurableWidth(expansion) ||
    !hasMeasurableWidth(tail)
  ) {
    return {
      bands: null,
      unavailableReason:
        "Historical volatility overwhelms the live impulse, so a reliable continuation range is not measurable.",
    };
  }

  const expansionMidpoint = (expansionMin + expansionMax) / 2;
  const structuralRisk =
    input.structuralRiskPercent !== null &&
    Number.isFinite(input.structuralRiskPercent) &&
    input.structuralRiskPercent > 0
      ? roundedPercent(input.structuralRiskPercent)
      : null;

  return {
    bands: {
      methodologyVersion: PRICE_DISCOVERY_SCENARIO_VERSION,
      unit: "additional_from_current_price",
      base,
      expansion,
      tail,
      structuralRisk,
      expansionRr:
        structuralRisk !== null
          ? Math.round((expansionMidpoint / input.structuralRiskPercent!) * 10) /
            10
          : null,
      inputs: {
        atrPercent: roundedPercent(input.atrPercent),
        currentMovePercent: roundedPercent(input.currentMovePercent),
        relativeVolume: roundedPercent(input.relativeVolume),
        momentumScore: Math.round(input.momentumScore),
        explosionScore: Math.round(input.explosionScore),
      },
    },
    unavailableReason: null,
  };
}
