import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { selectDueOutcomeMemberIds, shouldKeepOutcomeMemberComplete } from "./shadow-outcome-scheduler.ts";

test("selects distinct outcome parents by oldest due horizon", () => {
  assert.deepEqual(
    selectDueOutcomeMemberIds(
      [
        { member_outcome_id: "new", target_at: "2026-08-28T15:00:00Z" },
        { member_outcome_id: "old", target_at: "2026-08-28T14:00:00Z" },
        { member_outcome_id: "old", target_at: "2026-08-28T14:05:00Z" },
        { member_outcome_id: "middle", target_at: "2026-08-28T14:30:00Z" },
      ],
      2,
    ),
    ["old", "middle"],
  );
});

test("never demotes an already completed parent while resolving old horizons", () => {
  assert.equal(shouldKeepOutcomeMemberComplete("complete", false), true);
  assert.equal(shouldKeepOutcomeMemberComplete("active", true), true);
  assert.equal(shouldKeepOutcomeMemberComplete("active", false), false);
});
