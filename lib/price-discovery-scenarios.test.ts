import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension while the production bundler resolves the same module extensionless.
import { buildPriceDiscoveryScenario } from "./price-discovery-scenarios.ts";

test("suppresses collapsed CDTG-shaped expansion and tail ranges", () => {
  const result = buildPriceDiscoveryScenario({
    atrPercent: 102.53,
    currentMovePercent: 38.2,
    relativeVolume: 25,
    momentumScore: 99,
    explosionScore: 72,
    structuralRiskPercent: null,
  });

  assert.equal(result.bands, null);
  assert.match(result.unavailableReason ?? "", /not measurable/i);
});

test("keeps genuinely distinct conditional ranges", () => {
  const result = buildPriceDiscoveryScenario({
    atrPercent: 8,
    currentMovePercent: 42,
    relativeVolume: 6,
    momentumScore: 82,
    explosionScore: 76,
    structuralRiskPercent: 7,
  });

  assert.ok(result.bands);
  assert.ok(result.bands.base.max > result.bands.base.min);
  assert.ok(result.bands.expansion.max > result.bands.expansion.min);
  assert.ok(result.bands.tail.max > result.bands.tail.min);
  assert.equal(result.unavailableReason, null);
});

test("keeps missing volatility history explicitly unmeasurable", () => {
  const result = buildPriceDiscoveryScenario({
    atrPercent: null,
    currentMovePercent: 30,
    relativeVolume: 4,
    momentumScore: 80,
    explosionScore: 70,
    structuralRiskPercent: 5,
  });

  assert.equal(result.bands, null);
  assert.match(result.unavailableReason ?? "", /unavailable/i);
});
