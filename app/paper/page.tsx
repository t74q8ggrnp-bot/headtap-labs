import type { Metadata } from "next";
import { Suspense } from "react";
import PaperTradingDashboard from "@/app/components/paper/PaperTradingDashboard";

export const metadata: Metadata = {
  title: "Paper Trading | HT Labs",
  description: "Practice manual long and short trading with an isolated HT Labs simulation account.",
};

export default function PaperTradingPage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-[#050505] px-6 text-center text-white" role="status" aria-live="polite" aria-busy="true"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">HT Paper</p><p className="mt-3 text-xl font-black">Opening the paper workspace</p><p className="mt-2 text-sm text-zinc-500">Preparing the secure review flow…</p></div></div>}>
      <PaperTradingDashboard />
    </Suspense>
  );
}
