// app/components/TripsLive.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import TripCard from "./TripCard";

type Trip = Parameters<typeof TripCard>[0]["t"];

type ListResp =
  | { ok: true; authenticated: boolean; trips: Trip[] }
  | { ok: false; error?: string; trips: Trip[] };

export default function TripsLive({
  pollMs = 8000,
}: {
  pollMs?: number;
}) {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [authed, setAuthed] = useState<boolean>(false);
  const timer = useRef<number | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/trips/list", { cache: "no-store" });
      const j: ListResp = await r.json();
      if ("authenticated" in j) setAuthed(j.authenticated);
      if (j.ok) setTrips(j.trips || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();

    // poll
    timer.current = window.setInterval(load, pollMs);
    return () => {
      alive = false;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [pollMs]);

  // listen for manual refresh events
  useEffect(() => {
    const onRefresh = () => {
      // since we're not using SWR in this file, call load() directly
      void load();
      // @ts-ignore
      window.__TRIPS_REFRESHED = true;
    };
    window.addEventListener("trips:refresh", onRefresh);
    return () => window.removeEventListener("trips:refresh", onRefresh);
  }, []);

  if (!authed && !loading) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="small">Connect Gmail to see your journeys here.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      {/* refresh icon button (spins while loading) */}
      <button
        aria-label="Refresh"
        onClick={load}
        className="btnIcon"
        style={{
          position: "absolute",
          right: 24,
          top: 24,
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--fg-navy)",
          color: "#fff",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transition: "transform 0.6s",
            transform: loading ? "rotate(360deg)" : "none",
          }}
        >
          ↻
        </span>
      </button>

      {loading && (
        <div className="card">
          <p className="small">Loading trips…</p>
        </div>
      )}

      {!loading && !trips.length && authed && (
        <div className="card">
          <p className="small">No tickets yet. New trips will appear here automatically.</p>
        </div>
      )}

      {!loading &&
        authed &&
        trips.map((t) => <TripCard key={t.id} t={t} />)}
    </div>
  );
}
