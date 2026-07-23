// lib/security-type-policy.ts
//
// Single shared source for security-type support policy and
// leverage/inverse detection. Previously lived inline inside
// security-metadata-route.ts only; shadow-retrieval needs the exact
// same policy, and duplicating it would recreate the same
// "two implementations of one thing" problem this whole project has
// been fixing. Both routes import from here now.

export const SECURITY_TYPE_POLICY: Record<
  string,
  { status: "supported" | "excluded" | "deferred"; reason: string }
> = {
  CS:      { status: "supported", reason: "Common Stock — the core target of both engines" },
  ADRC:    { status: "supported", reason: "ADR Common — foreign common-stock equivalent, same trade-quality logic applies; subject to the same gates as CS" },
  ADRP:    { status: "excluded",  reason: "ADR Preferred — behaves like fixed income, not momentum/growth equity" },
  ADRR:    { status: "excluded",  reason: "ADR Rights — a warrant-like derivative on the underlying, not the equity itself" },
  ADRW:    { status: "excluded",  reason: "ADR Warrants — explicit derivative instrument" },
  UNIT:    { status: "excluded",  reason: "Combined SPAC-style instrument — structurally different trading behavior than a single equity" },
  RIGHT:   { status: "excluded",  reason: "Rights — derivative on the underlying, not the equity itself" },
  PFD:     { status: "excluded",  reason: "Preferred Stock — fixed-income-like behavior, doesn't fit the momentum/crowd thesis" },
  FUND:    { status: "excluded",  reason: "Basket product — same reasoning as ETF exclusion" },
  SP:      { status: "excluded",  reason: "Structured Product — issuer-defined payoff structure, not standard equity risk/reward" },
  WARRANT: { status: "excluded",  reason: "Explicit derivative instrument" },
  INDEX:   { status: "excluded",  reason: "Not a tradeable security — a reference benchmark" },
  ETF:     { status: "excluded",  reason: "Per explicit product decision — baskets of companies, not individual-equity discovery" },
  ETN:     { status: "excluded",  reason: "Per explicit product decision — additionally carries issuer credit risk, structurally unlike equity" },
  ETV:     { status: "excluded",  reason: "Exchange-Traded Vehicle — same basket-product family as ETF/ETN" },
  BOND:    { status: "excluded",  reason: "Corporate Bond — entirely different asset class, not equity" },
  BASKET:  { status: "excluded",  reason: "Basket product — same family as ETF/FUND" },
  OTHER:   { status: "excluded",  reason: "Undefined catch-all — no way to apply consistent trade-quality logic to an unspecified category" },
  GDR:  { status: "deferred", reason: "Global Depositary Receipt — likely similar in spirit to ADR, but not enough confirmed detail to decide with confidence; defaults to excluded pending explicit review" },
  OS:   { status: "deferred", reason: "Definition not confirmed in research retrieved — defaults to excluded pending explicit review" },
  NYRS: { status: "deferred", reason: "Definition not confirmed in research retrieved — defaults to excluded pending explicit review" },
  AGEN: { status: "deferred", reason: "Definition not confirmed in research retrieved — defaults to excluded pending explicit review" },
  EQLK: { status: "deferred", reason: "Name suggests equity-linked/structured — likely excluded eventually, but not enough confirmed basis to assert now" },
  LT:   { status: "deferred", reason: "Definition not confirmed in research retrieved — defaults to excluded pending explicit review" },
};

const LEVERAGE_PATTERNS = [
  /\b2x\b/i, /\b3x\b/i, /\b-1x\b/i, /\bultra\b/i,
  /\bdaily bull/i, /\bdaily bear/i, /\binverse\b/i, /\bleveraged\b/i,
];

export function detectLeverage(issuerName: string | null): boolean | null {
  if (!issuerName) return null;
  return LEVERAGE_PATTERNS.some((p) => p.test(issuerName));
}

export function isSupportedType(type: string | undefined | null): boolean {
  if (!type) return false;
  const policy = SECURITY_TYPE_POLICY[type];
  return policy ? policy.status === "supported" : false;
}
