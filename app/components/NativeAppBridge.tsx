"use client";

import { Capacitor } from "@capacitor/core";
import Image from "next/image";
import { useEffect, useState } from "react";

export default function NativeAppBridge() {
  const [isNative, setIsNative] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showStartup, setShowStartup] = useState(true);

  useEffect(() => {
    const nativeDetectionTimer = window.setTimeout(() => {
      setIsNative(
        Capacitor.isNativePlatform() || navigator.userAgent.includes("HTLabsApp/"),
      );
    }, 0);
    return () => window.clearTimeout(nativeDetectionTimer);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("ht-native-app", isNative);
    document.documentElement.classList.toggle(
      "ht-native-ios",
      isNative && Capacitor.getPlatform() === "ios",
    );

    const updateConnection = () => setIsOffline(!navigator.onLine);
    const connectionTimer = window.setTimeout(updateConnection, 0);
    const startupTimer = window.setTimeout(() => setShowStartup(false), 900);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    return () => {
      window.clearTimeout(connectionTimer);
      window.clearTimeout(startupTimer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      document.documentElement.classList.remove("ht-native-app", "ht-native-ios");
    };
  }, [isNative]);

  return (
    <>
      {isNative && showStartup && (
        <div className="ht-native-startup" role="status" aria-label="Starting HT Labs">
          <Image src="/app-icon.png" alt="" width={112} height={112} priority className="ht-native-startup-logo" />
          <p className="ht-native-startup-name">HT LABS</p>
          <p className="ht-native-startup-copy">Loading market intelligence</p>
          <span className="ht-native-startup-bar" />
        </div>
      )}
      {isNative && isOffline && (
        <div className="ht-native-offline" role="status" aria-live="polite">
          <span className="ht-native-offline-dot" />
          Offline — live market data will resume automatically
        </div>
      )}
    </>
  );
}
