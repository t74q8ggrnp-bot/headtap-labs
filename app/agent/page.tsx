import type { Metadata } from "next";
import HtAgentDashboard from "@/app/components/agent/HtAgentDashboard";

export const metadata: Metadata = {
  title: "HT Agent | HT Labs",
  description: "Paper-only HT Agent decision, risk, approval, and portfolio control.",
};

export default function HtAgentPage() {
  return <HtAgentDashboard />;
}
