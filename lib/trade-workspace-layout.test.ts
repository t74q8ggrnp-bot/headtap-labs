import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { resolveTradeWorkspaceChartHeight } from "./trade-workspace-layout.ts";

test("workspace chart height responds to the supported mobile viewports", () => {
  const narrowPhone = resolveTradeWorkspaceChartHeight({ width: 320, height: 568 });
  const compactPhone = resolveTradeWorkspaceChartHeight({ width: 375, height: 667 });
  const standardPhone = resolveTradeWorkspaceChartHeight({ width: 390, height: 844 });
  const largePhone = resolveTradeWorkspaceChartHeight({ width: 430, height: 932 });

  assert.equal(narrowPhone, 280);
  assert.equal(compactPhone, 376);
  assert.equal(standardPhone, 552);
  assert.equal(largePhone, 620);
  assert.ok(compactPhone < standardPhone);
  assert.ok(standardPhone < largePhone);
});

test("workspace chart height remains bounded on desktop", () => {
  assert.equal(resolveTradeWorkspaceChartHeight({ width: 1024, height: 768 }), 500);
  assert.equal(resolveTradeWorkspaceChartHeight({ width: 1280, height: 800 }), 504);
  assert.equal(resolveTradeWorkspaceChartHeight({ width: 1440, height: 900 }), 600);
  assert.equal(resolveTradeWorkspaceChartHeight({ width: 1720, height: 1000 }), 704);
});

test("workspace chart height tolerates unusable viewport input", () => {
  assert.equal(resolveTradeWorkspaceChartHeight({ width: Number.NaN, height: 0 }), 500);
});

test("workspace header uses a compact desktop provenance layout below the wide workspace breakpoint", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../app/components/trade/TradeWorkspaceHeader.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(source, /lg:py-2 2xl:py-3/);
  assert.match(source, /lg:py-3 2xl:py-5/);
  assert.match(source, /lg:mt-2 2xl:mt-4/);
  assert.equal(
    source.match(/lg:flex lg:min-w-0 lg:items-center lg:gap-2 lg:py-1\.5 2xl:block 2xl:py-2\.5/g)?.length,
    3,
  );
});
