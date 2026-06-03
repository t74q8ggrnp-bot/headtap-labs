import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HT Labs",
  description: "AI-powered tools and landing pages by HT Labs.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}