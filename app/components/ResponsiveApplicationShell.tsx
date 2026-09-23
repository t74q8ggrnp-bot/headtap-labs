"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { APPLICATION_ROUTES, resolveApplicationRoute } from "@/lib/application-navigation";

const primaryRouteIds = new Set(["discovery", "home", "paper", "agent", "account"]);
const secondaryRouteIds = new Set(["signals", "news", "prox", "support", "workspace"]);
const operatorRouteIds = new Set(["scanner", "qa", "validation", "trading-bot"]);

export default function ResponsiveApplicationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentRoute = resolveApplicationRoute(pathname);
  const [ticker, setTicker] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const primaryRoutes = APPLICATION_ROUTES.filter((route) => primaryRouteIds.has(route.id));
  const secondaryRoutes = APPLICATION_ROUTES.filter((route) => secondaryRouteIds.has(route.id));
  const operatorRoutes = APPLICATION_ROUTES.filter((route) => operatorRouteIds.has(route.id));
  const moreActive = Boolean(currentRoute && !primaryRouteIds.has(currentRoute.id));

  const openTicker = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return;
    setTicker("");
    setMobileSearchOpen(false);
    router.push(`/market?ticker=${encodeURIComponent(symbol)}`);
  };

  useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus();
  }, [mobileSearchOpen]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const compactViewport = window.matchMedia("(max-width: 1179px)");
    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimer = 0;
    const updateViewportOrigin = () => {
      const shell = shellRef.current;
      if (!shell) return;
      shell.style.setProperty(
        "--ht-visual-viewport-top",
        `${Math.max(0, viewport?.offsetTop ?? 0)}px`,
      );
      shell.style.setProperty(
        "--ht-visual-viewport-left",
        `${Math.max(0, viewport?.offsetLeft ?? 0)}px`,
      );
      shell.style.setProperty(
        "--ht-visual-viewport-width",
        `${Math.max(0, viewport?.width ?? window.innerWidth)}px`,
      );
    };
    const normalizeHorizontalViewport = (preservedScrollTop: number) => {
      if (!compactViewport.matches) {
        updateViewportOrigin();
        return;
      }
      const horizontalOffset = Math.max(
        Math.abs(window.scrollX),
        Math.abs(viewport?.offsetLeft ?? 0),
      );
      if (horizontalOffset > 0.5) {
        document.documentElement.scrollLeft = 0;
        document.body.scrollLeft = 0;
        window.scrollTo(0, preservedScrollTop);
      }
      updateViewportOrigin();
    };
    const settleOrientation = () => {
      const preservedScrollTop = window.scrollY;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          normalizeHorizontalViewport(preservedScrollTop);
        });
      });
      settleTimer = window.setTimeout(
        () => normalizeHorizontalViewport(preservedScrollTop),
        300,
      );
    };
    updateViewportOrigin();
    viewport?.addEventListener("resize", updateViewportOrigin);
    viewport?.addEventListener("scroll", updateViewportOrigin);
    window.addEventListener("orientationchange", settleOrientation);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      viewport?.removeEventListener("resize", updateViewportOrigin);
      viewport?.removeEventListener("scroll", updateViewportOrigin);
      window.removeEventListener("orientationchange", settleOrientation);
    };
  }, []);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Escape" || !mobileSearchOpen) return;
    event.preventDefault();
    setMobileSearchOpen(false);
    searchToggleRef.current?.focus();
  };

  const closeMenu = () => menuRef.current?.removeAttribute("open");

  return (
    <div
      ref={shellRef}
      className="ht-responsive-shell"
      data-application-route={currentRoute?.id ?? "unknown"}
      data-route-audience={currentRoute?.audience ?? "unknown"}
    >
      <a className="ht-skip-link" href="#ht-route-content">Skip to page content</a>
      <header className="ht-desktop-global-header">
        <Link href="/" className="ht-desktop-global-brand" aria-label="HT Labs Home">
          <Image src="/logo.png" alt="HT Labs" width={2909} height={1959} priority />
        </Link>

        <nav className="ht-desktop-global-nav" aria-label="Primary application navigation">
          {primaryRoutes.map((route) => {
            const active = currentRoute?.id === route.id;
            return (
              <Link key={route.id} href={route.href} className="ht-desktop-global-link" aria-current={active ? "page" : undefined}>
                {route.shortLabel}
              </Link>
            );
          })}
        </nav>

        <form className="ht-shell-search" role="search" data-mobile-open={mobileSearchOpen ? "true" : "false"} onSubmit={openTicker} onKeyDown={handleSearchKeyDown}>
          <button
            ref={searchToggleRef}
            type="button"
            className="ht-shell-search__toggle"
            aria-label="Search ticker"
            aria-expanded={mobileSearchOpen}
            onClick={() => setMobileSearchOpen((open) => !open)}
          >
            <span aria-hidden="true">⌕</span>
          </button>
          <input
            ref={searchInputRef}
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            aria-label="Search ticker"
            placeholder="Search ticker"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </form>

        <Link href="/account" className="ht-shell-account" aria-label="Open HT Labs account">HT</Link>

        <details ref={menuRef} className="ht-shell-more">
          <summary aria-label="More HT Labs routes" aria-current={moreActive ? "page" : undefined}>
            <span aria-hidden="true">•••</span>
          </summary>
          <div className="ht-shell-more__menu">
            <p>Intelligence and account</p>
            <nav aria-label="Intelligence and account routes">
              {secondaryRoutes.map((route) => (
                <Link key={route.id} href={route.href} onClick={closeMenu} aria-current={currentRoute?.id === route.id ? "page" : undefined}>
                  {route.label}
                </Link>
              ))}
            </nav>
            <p>Operator tools</p>
            <nav className="ht-shell-more__operator" aria-label="Operator routes">
              {operatorRoutes.map((route) => (
                <Link key={route.id} href={route.href} onClick={closeMenu} aria-current={currentRoute?.id === route.id ? "page" : undefined}>
                  {route.label}
                </Link>
              ))}
            </nav>
          </div>
        </details>
      </header>
      <div id="ht-route-content" className="ht-route-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
