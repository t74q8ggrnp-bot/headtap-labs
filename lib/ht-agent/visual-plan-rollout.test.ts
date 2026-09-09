import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { visualPlanSymbolInScope } from "./visual-plan-rollout.ts";

test("the initial visual-plan rollout is explicitly symbol-scoped", () => {
  const initial = { symbols: ["SPY", "QQQ"] };
  assert.equal(visualPlanSymbolInScope(initial, "SPY"), true);
  assert.equal(visualPlanSymbolInScope(initial, "AAPL"), false);
  assert.equal(visualPlanSymbolInScope({ symbols: ["*"] }, "AAPL"), true);
  assert.equal(visualPlanSymbolInScope({ symbols: "SPY" }, "SPY"), false);
});
