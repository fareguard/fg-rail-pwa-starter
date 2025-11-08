"use client";

import { useState, useCallback } from "react";

export default function RefreshIconButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // kick ingestion (read Gmail + save raw_emails + parse trips)
      await fetch("/api/ingest/google/save", { method: "POST", cache: "no-store" });
      // create missing claims from trips
      await fetch("/api/queue", { cache: "no-store" });
      // tell any listeners (e.g., TripsLive) to refetch
      window.dispatchEvent(new Event("trips:refresh"));
      // if nothing is listening, fall back to a soft reload after a moment
      setTimeout(() => {
        // @ts-ignore
        if (!window.__TRIPS_REFRESHED) location.reload();
      }, 600);
    } catch (e) {
      console.error("manual refresh failed:", e);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <button
      aria-label="Refresh"
      title="Refresh"
      onClick={onClick}
      disabled={busy}
      className={`refreshBtn ${className}`}
      style={{
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9999,
        background: "var(--fg-navy, #0f1b2d)",
        color: "white",
        opacity: busy ? 0.85 : 1,
      }}
    >
      {/* simple circular arrow; spins while busy */}
      <svg
        className={busy ? "refreshIcon busy" : "refreshIcon"}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M20 12a8 8 0 1 1-2.343-5.657"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 4v6h-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
