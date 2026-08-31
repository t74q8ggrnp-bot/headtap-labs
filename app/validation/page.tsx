import type { Metadata } from "next";
import MarketValidationCockpit from "@/app/components/validation/MarketValidationCockpit";

export const metadata: Metadata = {
  title: "Market Validation | HT Labs",
  description: "Internal real-time market pipeline validation cockpit.",
};

export default function MarketValidationPage() {
  return <MarketValidationCockpit />;
}
