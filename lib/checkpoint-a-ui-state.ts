// @ts-expect-error The Node strip-types test runner requires the explicit TypeScript extension.
import { resolveApplicationRoute } from "./application-navigation.ts";

export type MobileAppTab =
  | "home"
  | "convictions"
  | "scanner"
  | "workspace"
  | "watchlist"
  | "profile"
  | "paper"
  | "more";

export function resolveMobileActiveTab(
  pathname: string,
  homeTab: MobileAppTab,
): MobileAppTab | null {
  const route = resolveApplicationRoute(pathname);
  if (!route) return null;
  if (route.id === "home") return homeTab;
  if (route.id === "paper") return "paper";
  if (route.id === "scanner") return "scanner";
  if (route.id === "workspace") return "workspace";
  if (["account", "support", "privacy", "terms"].includes(route.id)) return "profile";
  return "more";
}

export type PaperAccountStatusTone = "active" | "pending" | "neutral" | "unavailable";

export function resolvePaperAccountStatus(input: {
  authReady: boolean;
  signedIn: boolean;
  loading: boolean;
  dashboardReady: boolean;
}): { label: string; tone: PaperAccountStatusTone } {
  if (!input.authReady) return { label: "Checking paper session", tone: "pending" };
  if (!input.signedIn) return { label: "Sign in required", tone: "neutral" };
  if (input.loading) return { label: "Loading paper account", tone: "pending" };
  if (!input.dashboardReady) return { label: "Paper account unavailable", tone: "unavailable" };
  return { label: "Paper account active", tone: "active" };
}

export function resolveQaHealth(input: {
  totalSystems: number;
  resolvedSystems: number;
  operational: number;
  degraded: number;
  running: boolean;
  hasCompletedRun: boolean;
}): { score: number | null; label: string } {
  const complete = input.hasCompletedRun
    && !input.running
    && input.totalSystems > 0
    && input.resolvedSystems === input.totalSystems;

  if (!complete) return { score: null, label: "Checking systems..." };

  const score = Math.round(
    ((input.operational + input.degraded * 0.5) / input.totalSystems) * 100,
  );
  const label = score >= 90
    ? "All Systems Go"
    : score >= 70
      ? "Degraded"
      : "Critical Issues";
  return { score, label };
}

export type ReadOnlySurface = "trading-bot" | "prox";

export function matureReadOnlyFailure(surface: ReadOnlySurface, status?: number): string {
  if (status === 401 || status === 403) {
    return surface === "trading-bot"
      ? "Paper-bot records are available only to an authorized operator session. No live brokerage access is exposed here."
      : "Pro X discovery is available only to authorized HT Labs operators.";
  }

  return surface === "trading-bot"
    ? "The paper-bot trade log is temporarily unavailable. Existing paper-bot operation is unaffected."
    : "Pro X discovery is temporarily unavailable. Canonical rankings are unaffected.";
}
