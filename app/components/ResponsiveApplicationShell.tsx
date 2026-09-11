"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { APPLICATION_ROUTES, resolveApplicationRoute } from "@/lib/application-navigation";

export default function ResponsiveApplicationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const currentRoute = resolveApplicationRoute(pathname);

  return (
    <div
      className="ht-responsive-shell"
      data-application-route={currentRoute?.id ?? "unknown"}
      data-route-audience={currentRoute?.audience ?? "unknown"}
    >
      <a className="ht-skip-link" href="#ht-route-content">Skip to page content</a>
      <header className="ht-desktop-global-header">
        <Link href="/" className="ht-desktop-global-brand" aria-label="HT Labs home">HT LABS</Link>
        <nav className="ht-desktop-global-nav" aria-label="Application navigation">
          {APPLICATION_ROUTES.map((route) => {
            const active = currentRoute?.id === route.id;
            return (
              <Link
                key={route.id}
                href={route.href}
                className="ht-desktop-global-link"
                data-audience={route.audience}
                aria-current={active ? "page" : undefined}
              >
                {route.shortLabel}
              </Link>
            );
          })}
        </nav>
      </header>
      <div id="ht-route-content" className="ht-route-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
