import type { Metadata } from "next";
import CryptoPaperDashboard from "@/app/components/paper/CryptoPaperDashboard";

export const metadata: Metadata = { title:"Crypto Paper Trading | HT Labs",
  description:"Practice spot crypto buying and selling with shared CoinAPI market data.", robots:{index:false,follow:false} };
export default function CryptoPaperPage() { return <CryptoPaperDashboard />; }
