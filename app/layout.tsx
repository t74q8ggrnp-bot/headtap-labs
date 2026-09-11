import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import MobileAppNavigation from "./components/MobileAppNavigation";
import { MobileAppNavigationProvider } from "./components/MobileAppNavigationContext";
import NativeAppBridge from "./components/NativeAppBridge";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Phase25BaselineProbe from "./components/dev/Phase25BaselineProbe";
import ResponsiveApplicationShell from "./components/ResponsiveApplicationShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "HT Labs",
  description: "Market research, visual trade planning, and paper-trading tools from HT Labs.",
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
        <Analytics />
        <SpeedInsights />
        {process.env.NODE_ENV === "development" ? <Phase25BaselineProbe /> : null}
        <MobileAppNavigationProvider>
          <ResponsiveApplicationShell>
            <div className="ht-app-content">{children}</div>
          </ResponsiveApplicationShell>
          <Suspense fallback={null}>
            <MobileAppNavigation />
          </Suspense>
        </MobileAppNavigationProvider>
      </body>
    </html>
  );
}
