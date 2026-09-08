// @ts-expect-error Node's strip-types runner resolves the TypeScript source.
import { evaluateHtAgentMarketTiming } from "./market-timing.ts";

// Validate persisted evidence, without re-evaluating a historical frame
// against today's clock or changing the original decision.
export function isHtAgentRiskAuditComplete(
  rules: unknown,
  allowed: unknown,
  options: { requireMarketTiming?: boolean } = {},
): boolean {
  if (!Array.isArray(rules) || rules.length === 0 || typeof allowed !== "boolean") return false;
  const codes = new Set<string>();
  for (const value of rules) {
    if (!value || typeof value !== "object") return false;
    const rule = value as Record<string, unknown>;
    if (typeof rule.code !== "string" || codes.has(rule.code)) return false;
    codes.add(rule.code);
    if (typeof rule.passed !== "boolean" || typeof rule.blocking !== "boolean") return false;
    if (typeof rule.message !== "string" || !rule.message) return false;
    if (!["passed", "failed", "unavailable", "not_evaluated"].includes(String(rule.status))) return false;
    if (rule.passed !== (rule.status === "passed")) return false;
    if (["unavailable", "not_evaluated"].includes(String(rule.status)) && rule.observed !== null) return false;
    if (rule.status === "not_evaluated" && (
      !Array.isArray(rule.dependsOn) || rule.dependsOn.length === 0 ||
      !rule.dependsOn.every((code) => typeof code === "string" && rules.some((dependency) =>
        dependency?.code === code && dependency.blocking === true && dependency.passed === false,
      ))
    )) return false;
    if (rule.code === "fresh_market_data" && options.requireMarketTiming) {
      if (!rule.marketTiming || typeof rule.marketTiming !== "object") return false;
      const timing = rule.marketTiming as Record<string, unknown>;
      if (typeof timing.evaluatedAt !== "string" || !Number.isFinite(Date.parse(timing.evaluatedAt))) return false;
      if (typeof rule.limit !== "number" || !Number.isFinite(rule.limit) || rule.limit < 0) return false;
      const price = timing.price as Record<string, unknown> | undefined;
      const nbbo = timing.nbbo as Record<string, unknown> | undefined;
      if (!price || !nbbo) return false;
      const expected = evaluateHtAgentMarketTiming(
        price.providerTimestamp, nbbo.providerTimestamp, Date.parse(timing.evaluatedAt), rule.limit,
      );
      if (timing.version !== expected.evidence.version || timing.maxAgeSeconds !== rule.limit) return false;
      for (const source of ["price", "nbbo"] as const) {
        const recorded = timing[source] as Record<string, unknown>;
        const clock = expected.evidence[source];
        if (recorded.providerTimestamp !== clock.providerTimestamp || recorded.ageSeconds !== clock.ageSeconds || recorded.status !== clock.status) return false;
      }
      if (rule.passed !== expected.fresh || rule.observed !== expected.observedAgeSeconds ||
        rule.status !== (expected.fresh ? "passed" : expected.available ? "failed" : "unavailable")) return false;
    }
  }
  const required = [
    "global_kill_switch", "profile_kill_switch", "canonical_eligible", "fresh_market_data",
    "timestamp_alignment", "market_session", "spread", "liquidity", "halt", "bad_print",
    "trade_levels", "risk_reward", "entry_quality", "extension", "duplicate", "position_count",
    "position_absent", "daily_drawdown", "gross_exposure", "position_risk", "buying_power",
  ];
  return required.every((code) => rules.some((rule) => rule.code === code && rule.blocking === true)) &&
    allowed === rules.every((rule) => !rule.blocking || rule.passed);
}
