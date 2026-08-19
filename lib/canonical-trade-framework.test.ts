import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { computeMeaningfulSupportResistance, excludeIncompleteEasternSessionBar } from "./canonical-trade-framework.ts";

const bar = (date: string, values: Partial<{ o: number; h: number; l: number; c: number }> = {}) => ({
  o: values.o ?? 0.8,
  h: values.h ?? 0.9,
  l: values.l ?? 0.75,
  c: values.c ?? 0.85,
  v: 100_000,
  t: new Date(`${date}T16:00:00.000Z`).getTime(),
});

test("excludes the incomplete current Eastern trading-day bar", () => {
  const bars = [
    bar("2026-08-13"),
    bar("2026-08-14", { h: 1.05, c: 0.84 }),
  ];
  const completed = excludeIncompleteEasternSessionBar(
    bars,
    new Date("2026-08-14T15:35:00.000Z"),
  );
  assert.equal(completed.length, 1);
  assert.equal(completed[0].t, bars[0].t);
});

test("nearby resistance inside normal noise cannot create an R:R cliff", () => {
  const bars = [
    bar("2026-08-11", { h: 0.844, l: 0.71, c: 0.8 }),
    bar("2026-08-12", { h: 1.1, l: 0.76, c: 0.82 }),
    bar("2026-08-13", { h: 1.04, l: 0.79, c: 0.83 }),
  ];
  const beforeCross = computeMeaningfulSupportResistance(bars, 0.8433, 0.06);
  const afterCross = computeMeaningfulSupportResistance(bars, 0.8518, 0.06);

  assert.equal(beforeCross.resistance, 1.04);
  assert.equal(afterCross.resistance, 1.04);
  assert.equal(beforeCross.hasKnownResistance, true);
  assert.equal(afterCross.hasKnownResistance, true);
});

test("reports price discovery when no observed resistance clears the meaningful buffer", () => {
  const bars = [
    bar("2026-08-11", { h: 0.84, l: 0.7, c: 0.8 }),
    bar("2026-08-12", { h: 0.845, l: 0.74, c: 0.82 }),
    bar("2026-08-13", { h: 0.85, l: 0.78, c: 0.83 }),
  ];
  const result = computeMeaningfulSupportResistance(bars, 0.8433, 0.06);

  assert.equal(result.hasKnownResistance, false);
  assert.ok(result.resistance > 0.8433);
});
