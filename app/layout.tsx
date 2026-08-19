import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import MobileAppNavigation from "./components/MobileAppNavigation";
import { MobileAppNavigationProvider } from "./components/MobileAppNavigationContext";
import NativeAppBridge from "./components/NativeAppBridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "HT Labs",
  description: "AI-powered tools and landing pages by HT Labs.",
  applicationName: "HT Labs",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HT Labs",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/app-icon.png",
    apple: "/app-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#050505",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <NativeAppBridge />
        <MobileAppNavigationProvider>
          <div className="ht-app-content">{children}</div>
          <Suspense fallback={null}>
            <MobileAppNavigation />
          </Suspense>
        </MobileAppNavigationProvider>
      </body>
    </html>
  );
}
