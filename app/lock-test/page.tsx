"use client";

// app/lock-test/page.tsx
//
// Same-origin concurrent lock test. The standalone HTML version failed
// because a file:// page and gethtlabs.com are different origins, and
// the browser blocks that cross-origin fetch before it ever reaches the
// server (shows up as "NetworkError when attempting to fetch resource").
// Living inside the app itself, this fetches /api/shadow-retrieval as a
// same-origin relative path, so there's no CORS boundary to cross.
//
// Not linked from anywhere in the nav — visit directly at /lock-test.
// Safe to delete once the lock is confirmed working; doesn't touch
// ht_signals or anything else in production.

import { useState } from "react";

export default function LockTestPage() {
  const [status1, setStatus1] = useState("Not started");
  const [status2, setStatus2] = useState("Not started");
  const [out1, setOut1] = useState("");
  const [out2, setOut2] = useState("");
  const [running, setRunning] = useState(false);

  const runTest = async () => {
    setRunning(true);
    setStatus1("Sent...");
    setStatus2("Sent...");
    setOut1("");
    setOut2("");

    // Distinct URLs + no-store: some browsers coalesce or serialize two
    // simultaneous requests to the exact identical URL at the connection
    // level. A harmless distinguishing param plus no-store removes any
    // chance of that happening here.
    const p1 = fetch("/api/shadow-retrieval?secret=htlabs-internal&testLockOnly=true&r=1", { cache: "no-store" })
      .then((r) => r.json()).catch((e) => ({ error: String(e) }));
    const p2 = fetch("/api/shadow-retrieval?secret=htlabs-internal&testLockOnly=true&r=2", { cache: "no-store" })
      .then((r) => r.json()).catch((e) => ({ error: String(e) }));

    const [r1, r2] = await Promise.all([p1, p2]);

    setStatus1("Done");
    setOut1(JSON.stringify(r1, null, 2));
    setStatus2("Done");
    setOut2(JSON.stringify(r2, null, 2));
    setRunning(false);
  };

  return (
    <div style={{ background: "#0a0a0a", color: "#eee", minHeight: "100vh", padding: 40, fontFamily: "-apple-system, sans-serif" }}>
      <h1 style={{ fontSize: 20, color: "#ff8c1a" }}>Concurrent Lock Test — /api/shadow-retrieval</h1>
      <p style={{ color: "#aaa", lineHeight: 1.5, maxWidth: 700 }}>
        Isolated lock test — skips the full market scan entirely and holds the lock
        deliberately for 3 seconds, so there's a wide, guaranteed window instead of a
        microsecond one. Click once, wait about 3-4 seconds, then screenshot both boxes below.
      </p>

      <button
        onClick={runTest}
        disabled={running}
        style={{
          background: running ? "#555" : "#ff6a00",
          color: "white",
          border: "none",
          padding: "16px 28px",
          fontSize: 16,
          fontWeight: "bold",
          borderRadius: 10,
          cursor: running ? "not-allowed" : "pointer",
          margin: "20px 0",
        }}
      >
        {running ? "Running..." : "Run Concurrent Test"}
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div style={{ background: "#151515", border: "1px solid #333", borderRadius: 10, padding: 16 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#ff8c1a", marginTop: 0 }}>Request 1</h2>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{status1}</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, color: "#ccc" }}>{out1}</pre>
        </div>
        <div style={{ background: "#151515", border: "1px solid #333", borderRadius: 10, padding: 16 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1, color: "#ff8c1a", marginTop: 0 }}>Request 2</h2>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{status2}</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, color: "#ccc" }}>{out2}</pre>
        </div>
      </div>
    </div>
  );
}
