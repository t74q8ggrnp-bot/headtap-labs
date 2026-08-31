import type { Metadata } from "next";
import { Suspense } from "react";
import PaperTradingDashboard from "@/app/components/paper/PaperTradingDashboard";

export const metadata: Metadata = {
  title: "Paper Trading | HT Labs",
  description: "Practice manual long and short trading with an isolated HT Labs simulation account.",
};

export default function PaperTradingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
      <PaperTradingDashboard />
    </Suspense>
  );
}
