import { redirect } from "next/navigation";

export default function TradeWorkspaceEntryPage() {
  redirect("/market?ticker=SPY");
}
