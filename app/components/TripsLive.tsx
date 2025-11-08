// app/components/TripsLive.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Trip = {
  id: string;
  title: string;
  operator: string | null;
  retailer: string | null;
  booking_ref: string | null;
  depart_planned: string | null;
  arrive_planned: string | null;
  status: string | null;
  status_text: string;
  delay_minutes: number | null;
  potential_refund: number | null;
  created_at: string;
};

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
      // your refetch logic here
      // since we're not using SWR in this file, call load() directly
      void load();
      // @ts-ignore
      window.__TRIPS_REFRESHED = true;
    };
    window.addEventListener("trips:refresh", onRefresh);
    return () => window.removeEventListener("trips:refresh", onRefresh);
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="small">Loading trips…</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="small">Connect Gmail to see your journeys here.</p>
      </div>
    );
  }

  if (!trips.length) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="small">No journeys detected yet. We’ll keep checking.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
      {trips.map((t) => {
        const isRed =
          t.status_text?.toLowerCase().includes("delayed") ||
          (typeof t.delay_minutes === "number" && t.delay_minutes > 0);

        return (
          <div key={t.id} className="card" style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 800, color: "var(--fg-navy)" }}>{t.title}</div>
              <div
                className="badge"
                style={{
                  background: isRed ? "#ffecec" : "#ecf8f2",
                  color: isRed ? "#b00020" : "var(--fg-green)",
                  borderColor: isRed ? "#ffd7d7" : "#d6f0e4",
                }}
              >
                {t.status_text}
              </div>
            </div>

            <div className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {t.operator && <span>Operator: <strong>{t.operator}</strong></span>}
              {t.booking_ref && <span>Ref: <strong>{t.booking_ref}</strong></span>}
              {t.depart_planned && (
                <span>
                  Departs: <strong>{new Date(t.depart_planned).toLocaleString()}</strong>
                </span>
              )}
              {t.arrive_planned && (
                <span>
                  Arrives: <strong>{new Date(t.arrive_planned).toLocaleString()}</strong>
                </span>
              )}
              {t.potential_refund != null && (
                <span>
                  Potential: <strong>£{Number(t.potential_refund).toFixed(2)}</strong>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
