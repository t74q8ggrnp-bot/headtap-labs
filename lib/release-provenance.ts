export const PRODUCT_SCHEMA_MIGRATION_LEVEL = "0060_product_integrity_guardrails";

function clean(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getReleaseProvenance(input: Record<string, string | undefined> = process.env) {
  const gitSha = clean(input.VERCEL_GIT_COMMIT_SHA ?? input.GIT_COMMIT_SHA);
  const deploymentId = clean(input.VERCEL_DEPLOYMENT_ID ?? input.VERCEL_URL);
  const immutableUrl = clean(input.VERCEL_URL);
  const productionUrl = clean(input.VERCEL_PROJECT_PRODUCTION_URL);
  const buildTimestamp = clean(input.NEXT_PUBLIC_BUILD_TIMESTAMP);
  const provider = input.VERCEL === "1" ? "vercel" : "local";
  const missing = [
    ["gitSha", gitSha],
    ["deploymentId", deploymentId],
    ["buildTimestamp", buildTimestamp],
  ].filter(([, value]) => value === null).map(([name]) => name);

  return {
    ok: missing.length === 0,
    status: missing.length === 0 ? "verified" as const : "incomplete" as const,
    provider,
    gitSha,
    deploymentId,
    immutableUrl: immutableUrl ? `https://${immutableUrl}` : null,
    productionUrl: productionUrl ? `https://${productionUrl}` : null,
    buildTimestamp,
    expectedSchemaMigrationLevel: PRODUCT_SCHEMA_MIGRATION_LEVEL,
    missing,
  };
}
