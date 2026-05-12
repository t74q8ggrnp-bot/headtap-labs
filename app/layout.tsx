import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HT Labs",
  description: "AI-powered tools and landing pages by HT Labs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}