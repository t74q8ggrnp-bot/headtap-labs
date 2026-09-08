import type { Metadata } from "next";
import CoinApiResearchDesk from "@/app/components/crypto/CoinApiResearchDesk";

export const metadata: Metadata = {
  title: "Crypto Research | HT Labs",
  description: "Shared CoinAPI prices, market evidence and collection status.",
  robots: { index: false, follow: false },
};

export default function CryptoResearchPage() {
  return <CoinApiResearchDesk />;
}
