export type HomeAlertType = "before_crowd" | "momentum" | "catalyst";

export type HomeAlert = {
  id: string;
  ticker: string;
  type: HomeAlertType;
  title: string;
  message: string;
  confidence: number;
  timestamp: Date;
  read: boolean;
};

export function getSafeAccountIdentity(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase() ?? "";
  if (!normalized) return { initials: "HT", shortEmail: "HT Labs account" };

  const [localPart = "", domain = ""] = normalized.split("@");
  const initials = localPart
    .split(/[._+-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || normalized[0]?.toUpperCase() || "HT";
  const shortLocal = localPart.length > 12
    ? `${localPart.slice(0, 9)}…`
    : localPart;

  return {
    initials: initials.slice(0, 2),
    shortEmail: domain ? `${shortLocal}@${domain}` : shortLocal,
  };
}

export function getHomeAlertLane(type: HomeAlertType) {
  if (type === "before_crowd") return "Before the Crowd";
  if (type === "catalyst") return "Spot Momentum · Catalyst";
  return "Spot Momentum";
}

export function getCloudSyncStatus(input: {
  signedIn: boolean;
  cloudEnabled: boolean;
  syncState: "loading" | "local" | "syncing" | "synced" | "error";
  hasError: boolean;
}) {
  if (!input.signedIn) return "Device watchlist active. Sign in to synchronize it securely.";
  if (input.hasError || input.syncState === "error") {
    return "Cloud synchronization is temporarily unavailable. Your device watchlist remains intact.";
  }
  if (input.syncState === "syncing" || input.syncState === "loading") {
    return "Synchronizing your watchlist securely…";
  }
  if (input.cloudEnabled && input.syncState === "synced") {
    return "Cloud watchlist synchronized.";
  }
  return "Cloud synchronization is preparing.";
}
