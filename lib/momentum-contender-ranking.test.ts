import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's strip-types runner resolves this source module directly.
import { selectOverallMomentumContenders } from "./momentum-contender-ranking.ts";

const candidate = (
  ticker: string,
  strategyScore: number,
  signalStrength = 50,
  relativeVolume = 5,
) => ({ ticker, strategyScore, signalStrength, relativeVolume });

test("keeps the entry-qualified hero fixed while ranking all other contenders together", () => {
  const hero = candidate("HERO", 78);
  const qualified = [hero, candidate("QUAL", 66)];
  const withheld = [candidate("FAST", 92), candidate("WATCH", 70)];

  const selected = selectOverallMomentumContenders(
    hero,
    qualified.slice(1),
    withheld,
    5,
  );

  assert.deepEqual(selected.map(({ ticker }) => ticker), [
    "FAST",
    "WATCH",
    "QUAL",
  ]);
  assert.equal(selected.some(({ ticker }) => ticker === hero.ticker), false);
});

test("deduplicates a ticker before limiting the overall contender list", () => {
  const duplicated = candidate("DUP", 90);
  const selected = selectOverallMomentumContenders(
    candidate("HERO", 95),
    [duplicated, candidate("LOW", 50)],
    [duplicated, candidate("MID", 70)],
    2,
  );

  assert.deepEqual(selected.map(({ ticker }) => ticker), ["DUP", "MID"]);
});
