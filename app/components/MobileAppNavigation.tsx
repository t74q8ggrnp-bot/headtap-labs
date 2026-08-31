"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMobileAppNavigation } from "./MobileAppNavigationContext";

type AppTab = "home" | "convictions" | "scanner" | "watchlist" | "profile" | "crypto" | "paper";

const items: Array<{ tab: AppTab; label: string; href: string }> = [
  { tab: "home", label: "Home", href: "/" },
  { tab: "convictions", label: "Top", href: "/?tab=convictions" },
  { tab: "scanner", label: "Scanner", href: "/?tab=scanner" },
  { tab: "watchlist", label: "Saved", href: "/?tab=watchlist" },
  { tab: "profile", label: "Profile", href: "/?tab=profile" },
  { tab: "crypto", label: "Crypto", href: "/crypto" },
  { tab: "paper", label: "Paper", href: "/paper" },
];

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
  if (tab === "watchlist") return (
    <svg {...common}><path d="m12 3.2 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9z"/></svg>
  );
  if (tab === "profile") return (
    <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4 2.6-6 6.5-6s6 2 6.5 6"/></svg>
  );
  if (tab === "paper") return (
    <svg {...common}><path d="M4 5.5h16v13H4z"/><path d="M7 9h10M7 13h5M15.5 13v3M14 14.5h3"/></svg>
  );
  return (
    <svg {...common}><circle cx="12" cy="12" r="8.5"/><path d="M9.4 7.2h3.7a2.4 2.4 0 0 1 0 4.8H9.4h4.2a2.4 2.4 0 0 1 0 4.8H9.4"/><path d="M11 5v14M14 5.8v1.5M14 16.7v1.5"/></svg>
  );
}

export default function MobileAppNavigation() {
  const pathname = usePathname();
  const { homeTab, setHomeTab } = useMobileAppNavigation();
  const activeTab: AppTab =
    pathname === "/paper" ? "paper" :
    pathname === "/crypto" ? "crypto" :
    pathname === "/scanner" ? "scanner" :
    pathname === "/" ? homeTab : "home";

  const activateHomeTab = (tab: AppTab) => {
    if (tab !== "crypto" && tab !== "paper") setHomeTab(tab);
  };

  return (
    <nav className="ht-mobile-global-nav" aria-label="Primary app navigation">
      <div className="grid w-full grid-cols-7 px-1 pt-1">
        {items.map(({ tab, label, href }) => {
          const active = activeTab === tab;
          const className = `relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 transition active:scale-95 ${active ? "text-orange-400" : "text-zinc-600"}`;
          const content = (
            <>
              {active && <span className="absolute top-0 h-0.5 w-5 rounded-full bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.75)]" />}
              <TabIcon tab={tab} />
              <span className={`text-[8px] font-black uppercase tracking-[0.04em] ${active ? "text-orange-300" : "text-zinc-600"}`}>
                {label}
              </span>
            </>
          );

          if (pathname === "/" && tab !== "crypto" && tab !== "paper") {
            return (
              <button
                key={tab}
                type="button"
                onClick={() => activateHomeTab(tab)}
                aria-label={label}
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
    </nav>
  );
}
