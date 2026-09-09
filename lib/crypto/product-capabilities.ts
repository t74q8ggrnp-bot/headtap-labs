export const CRYPTO_PRODUCT_CAPABILITY_POLICY_VERSION =
  "crypto-product-shelving-v1";

export type CryptoProductCapability =
  | "publicUiEnabled"
  | "publicApiEnabled"
  | "providerCollectionEnabled"
  | "paperOrderEntryEnabled"
  | "paperMatchingEnabled"
  | "coinApiResearchCollectionEnabled"
  | "coinApiEvidenceMaintenanceEnabled";

export type CryptoProductCapabilities = Readonly<
  Record<CryptoProductCapability, boolean>
>;

export type CryptoShelvingOperationalEvidence = Readonly<{
  configuredCryptoSchedules: readonly string[];
  activityReadStatus: "pending_database_probe" | "verified" | "partial" | "unavailable";
  latestPublicCollectionAt: string | null;
  latestCoinApiRequestAt: string | null;
  latestRecordedProviderActivityAt: string | null;
  coinApiDatabaseCollectionEnabled: boolean | null;
  checkedAt: string | null;
}>;

const DISABLED_CRYPTO_PRODUCT_CAPABILITIES: CryptoProductCapabilities = {
  publicUiEnabled: false,
  publicApiEnabled: false,
  providerCollectionEnabled: false,
  paperOrderEntryEnabled: false,
  paperMatchingEnabled: false,
  coinApiResearchCollectionEnabled: false,
  coinApiEvidenceMaintenanceEnabled: false,
};

/**
 * Crypto is intentionally shelved in production. Reactivation requires a
 * reviewed code change; an environment variable or stale cron cannot bypass
 * this contract.
 */
export const CRYPTO_PRODUCT_CAPABILITIES = Object.freeze(
  DISABLED_CRYPTO_PRODUCT_CAPABILITIES,
);

export function createCryptoProductCapabilities(
  overrides: Partial<CryptoProductCapabilities> = {},
): CryptoProductCapabilities {
  return Object.freeze({
    ...DISABLED_CRYPTO_PRODUCT_CAPABILITIES,
    ...overrides,
  });
}

export function isCryptoCapabilityEnabled(
  capability: CryptoProductCapability,
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
) {
  return capabilities[capability] === true;
}

export class CryptoProductUnavailableError extends Error {
  readonly code = "CRYPTO_PRODUCT_UNAVAILABLE";

  constructor() {
    super("Crypto is currently unavailable.");
    this.name = "CryptoProductUnavailableError";
  }
}

export function areCryptoCapabilitiesEnabled(
  required: CryptoProductCapability | readonly CryptoProductCapability[],
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
) {
  const requirements = Array.isArray(required) ? required : [required];
  return requirements.every((capability) =>
    isCryptoCapabilityEnabled(capability, capabilities)
  );
}

export function assertCryptoCapabilitiesEnabled(
  required: CryptoProductCapability | readonly CryptoProductCapability[],
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
) {
  if (!areCryptoCapabilitiesEnabled(required, capabilities)) {
    throw new CryptoProductUnavailableError();
  }
}

export function isCryptoProductIntentionallyShelved(
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
) {
  return Object.values(capabilities).every((enabled) => enabled === false);
}

export function cryptoProviderCallsAreProhibited(
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
) {
  return !capabilities.providerCollectionEnabled &&
    !capabilities.coinApiResearchCollectionEnabled &&
    !capabilities.coinApiEvidenceMaintenanceEnabled;
}

export function cryptoUnavailableResponse() {
  return Response.json(
    {
      ok: false,
      code: "CRYPTO_PRODUCT_UNAVAILABLE",
      error: "Crypto is currently unavailable.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Retry-After": "86400",
      },
    },
  );
}

export function withCryptoCapabilities<TArgs extends unknown[]>(
  required: CryptoProductCapability | readonly CryptoProductCapability[],
  handler: (...args: TArgs) => Response | Promise<Response>,
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
) {
  const requirements = Array.isArray(required) ? required : [required];
  return async (...args: TArgs) => {
    if (!areCryptoCapabilitiesEnabled(requirements, capabilities)) {
      return cryptoUnavailableResponse();
    }
    return handler(...args);
  };
}

export function buildShelvedCryptoHealthCheck(
  capabilities: CryptoProductCapabilities = CRYPTO_PRODUCT_CAPABILITIES,
  operationalEvidence?: CryptoShelvingOperationalEvidence,
) {
  const intentionallyShelved = isCryptoProductIntentionallyShelved(capabilities);
  const providerCallsProhibited = cryptoProviderCallsAreProhibited(capabilities);
  const configuredCryptoSchedules = operationalEvidence?.configuredCryptoSchedules ?? null;
  const scheduleConfigInspected = configuredCryptoSchedules !== null;
  const scheduledCollectionAbsent = scheduleConfigInspected &&
    configuredCryptoSchedules.length === 0;
  const shelvingBoundaryVerified = intentionallyShelved &&
    providerCallsProhibited && scheduledCollectionAbsent;

  return {
    name: "crypto_product_status",
    ok: shelvingBoundaryVerified,
    message: shelvingBoundaryVerified
      ? "Crypto is intentionally shelved; public access, collection, paper actions, and provider calls are disabled."
      : !scheduledCollectionAbsent
        ? "Crypto is code-disabled, but the deployed schedule configuration does not prove that scheduled collection is absent."
      : "Crypto capability state requires active subsystem validation.",
    detail: {
      state: intentionallyShelved ? "intentionally_disabled" : "active_or_partial",
      policyVersion: CRYPTO_PRODUCT_CAPABILITY_POLICY_VERSION,
      capabilities,
      providerCallsProhibited,
      scheduledCollectionExpected: false,
      scheduledCollectionConfig: {
        source: "deployed_vercel_json",
        inspected: scheduleConfigInspected,
        cryptoPaths: configuredCryptoSchedules,
        absent: scheduleConfigInspected ? scheduledCollectionAbsent : null,
      },
      runtimeCollectionEntryPointsFailClosed: providerCallsProhibited,
      operationalEvidence: operationalEvidence ?? {
        configuredCryptoSchedules: null,
        activityReadStatus: "pending_database_probe",
        latestPublicCollectionAt: null,
        latestCoinApiRequestAt: null,
        latestRecordedProviderActivityAt: null,
        coinApiDatabaseCollectionEnabled: null,
        checkedAt: null,
      },
      operationalEvidenceMeaning:
        "Latest recorded activity is retained audit evidence for comparison with deployment time, not a freshness requirement or permission to collect. The database toggle is dormant and cannot override the code-owned boundary.",
      databaseToggleCanReactivateCrypto: false,
      historicalCodeAndDataPolicy: "preserved_read_only",
      reactivationRequiresReviewedCodeChange: true,
    },
  };
}
