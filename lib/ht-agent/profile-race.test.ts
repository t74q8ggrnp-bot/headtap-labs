import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const declaration = parsed.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "getOrCreateHtAgentProfile"
);
assert.ok(declaration, "Server contract changed: missing getOrCreateHtAgentProfile");
const compiled = ts.transpileModule(
  `${declaration.getText(parsed)}\nexports.getOrCreateHtAgentProfile = getOrCreateHtAgentProfile;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

const winner = {
  id: "profile",
  user_id: "user",
  paper_account_id: "paper",
  mode: "approval_paper",
  status: "active",
  kill_switch: false,
  policy_version: "current",
  risk_policy: { maxOpenPositions: 4 },
};

function harness(insertResult: { data: unknown; error: unknown }, retryResult = { data: winner, error: null }) {
  let profileReads = 0;
  let inserts = 0;
  let singleCalls = 0;
  const service = { from(table: string) {
    assert.equal(table, "ht_agent_profiles");
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      insert() { inserts += 1; return chain; },
      async maybeSingle() { profileReads += 1; return { data: null, error: null }; },
      async single() {
        singleCalls += 1;
        if (inserts > 0 && singleCalls === 1) return insertResult;
        profileReads += 1;
        return retryResult;
      },
    };
    return chain;
  } };
  const exports = {} as { getOrCreateHtAgentProfile: (context: unknown) => Promise<unknown> };
  vm.runInNewContext(compiled, {
    exports,
    getOrCreatePaperAccount: async () => ({ id: "paper" }),
  });
  return { exports, context: { user: { id: "user" }, service }, reads: () => profileReads };
}

test("a simultaneous first-use insert reads the unique winner without overwriting it", async () => {
  const h = harness({ data: null, error: { code: "23505" } });
  assert.deepEqual(await h.exports.getOrCreateHtAgentProfile(h.context), winner);
  assert.equal(h.reads(), 2);
});

test("non-unique creation failures remain failures", async () => {
  const h = harness({ data: null, error: { code: "57014" } });
  await assert.rejects(h.exports.getOrCreateHtAgentProfile(h.context));
  assert.equal(h.reads(), 1);
});
