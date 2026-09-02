import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

type LegalDocumentProps = {
  eyebrow: string;
  title: string;
  updated: string;
  summary: string;
  children: ReactNode;
};

export default function LegalDocument({
  eyebrow,
  title,
  updated,
  summary,
  children,
}: LegalDocumentProps) {
  return (
    <main className="min-h-screen bg-[#050505] px-5 pb-28 pt-8 text-white sm:px-8 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <nav className="mb-10 flex flex-wrap items-center justify-between gap-4" aria-label="Legal navigation">
          <Link href="/" className="inline-flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
            <Image src="/logo.png" alt="HT Labs home" width={2909} height={1959} className="h-10 w-auto" priority />
          </Link>
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em] text-zinc-400">
            <Link href="/account" className="rounded-full border border-white/10 px-4 py-2 hover:border-orange-400/50 hover:text-white">Account</Link>
            <Link href="/support" className="rounded-full border border-white/10 px-4 py-2 hover:border-orange-400/50 hover:text-white">Support</Link>
            <Link href="/privacy" className="rounded-full border border-white/10 px-4 py-2 hover:border-orange-400/50 hover:text-white">Privacy</Link>
            <Link href="/terms" className="rounded-full border border-white/10 px-4 py-2 hover:border-orange-400/50 hover:text-white">Terms</Link>
          </div>
        </nav>

        <article className="overflow-hidden rounded-[2rem] border border-orange-400/15 bg-zinc-950 shadow-2xl shadow-orange-950/20">
          <header className="border-b border-white/10 bg-gradient-to-br from-orange-500/10 via-transparent to-cyan-500/[0.04] px-6 py-9 sm:px-10 sm:py-12">
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-orange-300">{eyebrow}</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
            <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-zinc-300">{summary}</p>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">Last updated {updated}</p>
          </header>
          <div className="space-y-9 px-6 py-9 text-sm leading-7 text-zinc-300 sm:px-10 sm:py-12 [&_a]:font-bold [&_a]:text-orange-300 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-white [&_li]:pl-1 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
            {children}
          </div>
        </article>
      </div>
    </main>
  );
}
