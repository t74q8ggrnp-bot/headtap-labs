"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type MobileHomeTab = "home" | "convictions" | "scanner" | "watchlist" | "profile";

const validTabs = new Set<MobileHomeTab>([
  "home",
  "convictions",
  "scanner",
  "watchlist",
  "profile",
]);

type MobileAppNavigationValue = {
  homeTab: MobileHomeTab;
  setHomeTab: (tab: MobileHomeTab) => void;
};

const MobileAppNavigationContext = createContext<MobileAppNavigationValue | null>(null);

function tabFromLocation(): MobileHomeTab {
  const requested = new URLSearchParams(window.location.search).get("tab") as MobileHomeTab | null;
  return requested && validTabs.has(requested) ? requested : "home";
}

export function MobileAppNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [homeTab, setHomeTabState] = useState<MobileHomeTab>("home");

  useEffect(() => {
    const syncFromLocation = () => setHomeTabState(tabFromLocation());
    const routeSyncTimer = window.setTimeout(syncFromLocation, 0);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.clearTimeout(routeSyncTimer);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [pathname]);

  const setHomeTab = useCallback((tab: MobileHomeTab) => {
    setHomeTabState(tab);
    if (window.location.pathname === "/") {
      const url = tab === "home" ? "/" : `/?tab=${tab}`;
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  return (
    <MobileAppNavigationContext.Provider value={{ homeTab, setHomeTab }}>
      {children}
    </MobileAppNavigationContext.Provider>
  );
}

export function useMobileAppNavigation() {
  const value = useContext(MobileAppNavigationContext);
  if (!value) throw new Error("useMobileAppNavigation must be used inside MobileAppNavigationProvider");
  return value;
}
