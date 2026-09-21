import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { getReleaseProvenance, PRODUCT_SCHEMA_MIGRATION_LEVEL } from "./release-provenance.ts";

test("release provenance separates immutable deployment identity from application health", () => {
  const receipt = getReleaseProvenance({
    VERCEL: "1",
    VERCEL_GIT_COMMIT_SHA: "abc123",
    VERCEL_DEPLOYMENT_ID: "dpl_example",
    VERCEL_URL: "example-immutable.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "gethtlabs.com",
    NEXT_PUBLIC_BUILD_TIMESTAMP: "2026-09-21T12:00:00.000Z",
  });

  assert.equal(receipt.ok, true);
  assert.equal(receipt.gitSha, "abc123");
  assert.equal(receipt.deploymentId, "dpl_example");
  assert.equal(receipt.immutableUrl, "https://example-immutable.vercel.app");
  assert.equal(receipt.expectedSchemaMigrationLevel, PRODUCT_SCHEMA_MIGRATION_LEVEL);
});

test("missing deployment provenance is an explicit release-integrity failure", () => {
  const receipt = getReleaseProvenance({ NEXT_PUBLIC_BUILD_TIMESTAMP: "" });
  assert.equal(receipt.ok, false);
  assert.deepEqual(receipt.missing, ["gitSha", "deploymentId", "buildTimestamp"]);
});
