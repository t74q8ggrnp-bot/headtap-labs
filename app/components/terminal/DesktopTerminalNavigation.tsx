"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

const routes = [
  { href: "/", label: "Home", icon: "⌂", exact: true },
  { href: "/scanner", label: "Scan", icon: "⌕", exact: true },
  { href: "/trade", label: "Trade", icon: "▥", exact: false },
  { href: "/paper", label: "Paper", icon: "▤", exact: true },
] as const;

export default function DesktopTerminalNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        searchButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const symbol = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return;
    setTicker("");
    setSearchOpen(false);
    router.push(`/trade/${encodeURIComponent(symbol)}`);
  };

  return (
    <nav className="ht-terminal-nav" aria-label="HT Labs terminal navigation">
      <Link href="/" className="ht-terminal-nav__brand" aria-label="HT Labs home">
        <Image src="/logo.png" alt="" width={2909} height={1959} priority />
      </Link>
      <div className="ht-terminal-nav__routes">
        {routes.map((route) => {
          const active = route.exact ? pathname === route.href : pathname === route.href || pathname.startsWith(`${route.href}/`);
          return (
            <Link key={route.href} href={route.href} aria-label={route.label} aria-current={active ? "page" : undefined} data-label={route.label}>
              <span aria-hidden="true">{route.icon}</span>
            </Link>
          );
        })}
        <button ref={searchButtonRef} type="button" aria-label="Search ticker" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)} data-label="Search · ⌘K">
          <span aria-hidden="true">⌕</span>
        </button>
      </div>
      <Link href="/support" className="ht-terminal-nav__more" aria-label="More HT Labs routes" data-label="More">
        <span aria-hidden="true">•••</span>
      </Link>
      {searchOpen ? (
        <form className="ht-terminal-search" role="search" onSubmit={submit}>
          <label htmlFor="ht-terminal-ticker-search">Search ticker</label>
          <input
            ref={inputRef}
            id="ht-terminal-ticker-search"
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="SPY"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button type="submit">Open</button>
          <button type="button" onClick={() => { setSearchOpen(false); searchButtonRef.current?.focus(); }}>Close</button>
        </form>
      ) : null}
    </nav>
  );
}

