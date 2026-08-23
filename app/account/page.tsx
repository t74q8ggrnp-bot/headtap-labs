import type { Metadata } from "next";
import AccountSettings from "@/app/components/account/AccountSettings";

export const metadata: Metadata = {
  title: "Account & Privacy | HT Labs",
  description: "Manage or permanently delete your HT Labs account.",
};

export default function AccountPage() {
  return <AccountSettings />;
}
