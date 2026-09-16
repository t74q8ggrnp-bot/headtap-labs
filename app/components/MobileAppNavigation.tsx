"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { APPLICATION_ROUTES, resolveApplicationRoute } from "@/lib/application-navigation";
import { resolveMobileActiveTab, type MobileAppTab as AppTab } from "@/lib/checkpoint-a-ui-state";
import { AccessibleDialogSheet } from "./ui/ApplicationPrimitives";
import { useMobileAppNavigation } from "./MobileAppNavigationContext";
import { useShellAuthSession } from "@/app/hooks/useShellAuthSession";
import { getSafeAccountIdentity } from "@/lib/home-account";

const items: Array<{ tab: AppTab; label: string; href: string }> = [
  { tab: "home", label: "Home", href: "/" },
  { tab: "scanner", label: "Markets", href: "/?markets=open" },
  { tab: "workspace", label: "Work", href: "/trade" },
  { tab: "paper", label: "Paper", href: "/paper" },
  { tab: "profile", label: "Account", href: "/account" },
];

const moreRoutes = APPLICATION_ROUTES.filter((route) =>
  ["signals", "news", "prox", "agent", "account", "support", "qa", "validation", "trading-bot"].includes(route.id),
);

function TabIcon({ tab }: { tab: AppTab }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (tab === "home") return (
    <svg {...common}><path d="m3.5 10.5 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M9.5 20v-6h5v6"/></svg>
  );
  if (tab === "convictions") return (
    <svg {...common}><path d="M13.2 2.5c.5 3-1.6 4.4-3.2 6.2-1.5 1.7-2.5 3.4-2.5 5.8A4.6 4.6 0 0 0 12 19.2a4.7 4.7 0 0 0 4.7-4.8c0-1.8-.7-3.2-1.8-4.7-.3 2-1.4 3-2.5 3.8.3-2.9-1-5-3.4-6.8"/></svg>
  );
  if (tab === "scanner") return (
    <svg {...common}><path d="m13.2 2.5-8 11h6.6l-1 8 8-11h-6.6z"/></svg>
  );
  if (tab === "workspace") return (
    <svg {...common}><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 4-6"/><path d="M17 7h3v3"/></svg>
  );
  if (tab === "watchlist") return (
    <svg {...common}><path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9z"/></svg>
  );
  if (tab === "profile") return (
    <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4 2.6-6 6.5-6s6 2 6.5 6"/></svg>
  );
  if (tab === "paper") return (
    <svg {...common}><path d="M4 5.5h16v13H4z"/><path d="M7 9h10M7 13h5M15.5 13v3M14 14.5h3"/></svg>
  );
  if (tab === "more") return (
    <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>
  );
  return null;
}

export default function MobileAppNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { homeTab } = useMobileAppNavigation();
  const { session, ready: authReady } = useShellAuthSession();
  const accountIdentity = getSafeAccountIdentity(session?.user.email);
  const activeTab = resolveMobileActiveTab(pathname, pathname === "/" ? "home" : homeTab);
  const currentRoute = resolveApplicationRoute(pathname);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <Fragment>
      <nav className="ht-mobile-global-nav" aria-label="Primary app navigation" data-application-route={currentRoute?.id ?? "unknown"}>
        <div className="w-full">
          <div className="grid grid-cols-5 px-1 pt-1">
          {items.map(({ tab, label, href }) => {
            const active = activeTab === tab;
            const className = `relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 transition active:scale-95 ${active ? "text-orange-400" : "text-zinc-600"}`;
            const content = (
              <>
                {active && <span className="absolute top-0 h-0.5 w-5 bg-orange-400" />}
                <TabIcon tab={tab} />
                <span className={`text-[8px] font-black uppercase tracking-[0.04em] ${active ? "text-orange-300" : "text-zinc-600"}`}>
                  {label}
                </span>
              </>
            );

            if (tab === "scanner") {
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    if (pathname === "/") window.dispatchEvent(new CustomEvent("htlabs:open-markets"));
                    else router.push(href);
                  }}
                  aria-label="Open Spot Momentum, Before the Crowd, Watchlist, and Recently Viewed"
                  aria-current={active ? "page" : undefined}
                  aria-haspopup="dialog"
                  className={className}
                >
                  {content}
                </button>
              );
            }

            if (tab === "profile") {
              return (
                <button
                  key={tab}
                  type="button"
                  disabled={!authReady}
                  onClick={() => {
                    if (pathname === "/") window.dispatchEvent(new CustomEvent("htlabs:open-account"));
                    else router.push(session ? "/account" : "/?auth=signin");
                  }}
                  aria-label={!authReady ? "Checking account" : session ? `Open account for ${accountIdentity.shortEmail}` : "Sign in to HT Labs"}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {content}
                </button>
              );
            }

            return (
              <Link
                key={tab}
                href={href}
                scroll={false}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={className}
              >
                {content}
              </Link>
            );
          })}
          </div>
        </div>
      </nav>
      <AccessibleDialogSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        title="HT Labs navigation"
        description="Open a market, operator, account, or support surface."
        presentation="sheet"
      >
        <section className="ht-mobile-account-entry" aria-label="HT Labs account">
          <button
            type="button"
            disabled={!authReady}
            onClick={() => {
              setMoreOpen(false);
              if (pathname === "/") {
                window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("htlabs:open-account")));
              } else {
                router.push(session ? "/?account=profile" : "/?auth=signin");
              }
            }}
          >
            <span aria-hidden="true">{!authReady ? "…" : session ? accountIdentity.initials : "↪"}</span>
            <span><strong>{!authReady ? "Checking session" : session ? accountIdentity.shortEmail : "Sign in"}</strong><small>{session ? "Account, synchronization, and privacy" : "Sync watchlists and private product features"}</small></span>
          </button>
          {pathname === "/" ? (
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("htlabs:open-alerts")));
              }}
            >
              <span aria-hidden="true">◌</span>
              <span><strong>HT Alerts</strong><small>Canonical opportunity notifications</small></span>
            </button>
          ) : null}
        </section>
        <nav id="application-routes" className="ht-mobile-route-list" aria-label="All application routes">
          {moreRoutes.map((route) => {
            const active = currentRoute?.id === route.id;
            return (
              <Link
                key={route.id}
                href={route.href}
                onClick={() => setMoreOpen(false)}
                className="ht-mobile-route-link"
                data-audience={route.audience}
                aria-current={active ? "page" : undefined}
              >
                <span>{route.label}</span>
                {active ? <span className="ht-mobile-route-current">Current</span> : null}
              </Link>
            );
          })}
        </nav>
      </AccessibleDialogSheet>
    </Fragment>
  );
}
