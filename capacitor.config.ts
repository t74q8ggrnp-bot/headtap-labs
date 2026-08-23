import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.gethtlabs.app",
  appName: "HT Labs",
  webDir: "capacitor-web",
  loggingBehavior: "production",
  appendUserAgent: "HTLabsApp/1.0",
  backgroundColor: "#050505",
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: "#050505",
      showSpinner: false,
    },
  },
  ios: {
    backgroundColor: "#050505",
    allowsLinkPreview: false,
    contentInset: "never",
    preferredContentMode: "mobile",
  },
  server: {
    url: "https://gethtlabs.com",
    cleartext: false,
    errorPath: "offline.html",
  },
};

export default config;
