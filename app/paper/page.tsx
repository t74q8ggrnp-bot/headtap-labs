import type { Metadata } from "next";
import { Suspense } from "react";
import PaperTradingDashboard from "@/app/components/paper/PaperTradingDashboard";
import TerminalRouteLoading from "@/app/components/ui/TerminalRouteLoading";

export const metadata: Metadata = {
  title: "Paper Trading | HT Labs",
  description: "Practice manual long and short trading with an isolated HT Labs simulation account.",
};

export default function PaperTradingPage() {
  return (
    <Suspense fallback={<TerminalRouteLoading label="Opening the paper workspace" />}>
      <PaperTradingDashboard />
    </Suspense>
  );
}
