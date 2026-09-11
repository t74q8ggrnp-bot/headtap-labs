export type ApplicationRouteId =
  | "home"
  | "workspace"
  | "scanner"
  | "signals"
  | "news"
  | "prox"
  | "paper"
  | "agent"
  | "qa"
  | "validation"
  | "trading-bot"
  | "account"
  | "privacy"
  | "terms"
  | "support";

export type ApplicationRoute = {
  id: ApplicationRouteId;
  label: string;
  shortLabel: string;
  href: string;
  match: "exact" | "prefix";
  audience: "market" | "operator" | "account";
};

export const APPLICATION_ROUTES: readonly ApplicationRoute[] = [
  { id: "home", label: "Home", shortLabel: "Home", href: "/", match: "exact", audience: "market" },
  { id: "scanner", label: "Scanner", shortLabel: "Scanner", href: "/scanner", match: "exact", audience: "market" },
  { id: "signals", label: "Signal History", shortLabel: "Signals", href: "/signals", match: "exact", audience: "market" },
  { id: "news", label: "News Intel", shortLabel: "News", href: "/news-feed", match: "exact", audience: "market" },
  { id: "workspace", label: "Trading Workspace", shortLabel: "Workspace", href: "/trade", match: "prefix", audience: "market" },
  { id: "prox", label: "Pro X", shortLabel: "Pro X", href: "/prox", match: "exact", audience: "operator" },
  { id: "paper", label: "Paper Trading", shortLabel: "Paper", href: "/paper", match: "exact", audience: "market" },
  { id: "agent", label: "HT Agent", shortLabel: "Agent", href: "/agent", match: "exact", audience: "operator" },
  { id: "qa", label: "System QA", shortLabel: "QA", href: "/qa", match: "exact", audience: "operator" },
  { id: "validation", label: "Market Validation", shortLabel: "Validation", href: "/validation", match: "exact", audience: "operator" },
  { id: "trading-bot", label: "Paper Bot Log", shortLabel: "Bot Log", href: "/trading-bot", match: "exact", audience: "operator" },
  { id: "account", label: "Account & Privacy", shortLabel: "Account", href: "/account", match: "exact", audience: "account" },
  { id: "support", label: "Support", shortLabel: "Support", href: "/support", match: "exact", audience: "account" },
  { id: "privacy", label: "Privacy Policy", shortLabel: "Privacy", href: "/privacy", match: "exact", audience: "account" },
  { id: "terms", label: "Terms of Use", shortLabel: "Terms", href: "/terms", match: "exact", audience: "account" },
] as const;

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function resolveApplicationRoute(pathname: string): ApplicationRoute | null {
  const normalized = normalizePathname(pathname);
  return APPLICATION_ROUTES.find((route) => route.match === "exact"
    ? normalized === route.href
    : normalized === route.href || normalized.startsWith(`${route.href}/`)) ?? null;
}
